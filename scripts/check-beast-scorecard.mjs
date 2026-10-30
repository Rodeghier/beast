/**
 * OFFLINE VERIFICATION. Runs assertions against the actual source functions.
 * A failed assertion stops the command and points to the check that disagreed.
 * These checks are independent of a live provider connection. Read the handbook
 * for which engineering assumptions each check covers.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url), cache = new Map();
function load(path) {
  let file = resolve(root, path);
  if (!existsSync(file)) file += existsSync(file + ".tsx") ? ".tsx" : ".ts";
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const localRequire = name => name.startsWith("@/") ? load(name.slice(2)) : name.startsWith(".") ? load(resolve(dirname(file), name)) : require(name);
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}
const { parseElectricTariffs, EPA_NATURAL_GAS } = load("lib/location-energy.ts");
const { electricityBill, tierCharge, annualPerformance } = load("lib/utility-billing.ts");
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const schedule = () => Array.from({ length: 12 }, () => Array(24).fill(0));
const weekday = schedule(); weekday.forEach(month => { month[12] = 1; });
const raw = { label: "fixture", name: "Bundled TOU", utility: "Test Utility", sector: "Commercial", servicetype: "Bundled", startdate: 1,
  energyratestructure: [[{ max: 100, rate: .1, adj: .01, unit: "kWh" }, { rate: .2, unit: "kWh" }], [{ rate: .3, unit: "kWh" }]], energyweekdayschedule: weekday, energyweekendschedule: schedule(),
  demandratestructure: [[{ rate: 2 }], [{ rate: 3 }]], demandweekdayschedule: weekday, demandweekendschedule: schedule(), demandrateunit: "kW", demandwindow: 15,
  flatdemandstructure: [[{ rate: 5 }]], flatdemandmonths: Array(12).fill(0), flatdemandunit: "kW", fixedchargefirstmeter: 10, fixedchargeunits: "$/month", fueladjustmentsmonthly: Array(12).fill(.01) };
const tariff = parseElectricTariffs({ items: [raw] }, 100)[0];
const hour = (day, hour, electricity) => ({ year: 2025, month: 1, day, hour, minute: 0, electricity, gasTherms: 0 });
const hours = [hour(6, 12, 10), hour(6, 13, 120), hour(11, 12, 20)]; // Monday and Saturday.
const bill = electricityBill(hours, tariff);
assert.equal(bill.reason, null);
near(bill.months[0].energy, 23.5); near(bill.months[0].demand, 870); near(bill.months[0].fixed, 10); near(bill.months[0].total, 903.5);
assert.ok(bill.warnings.some(w => w.includes("15-minute")));
near(tierCharge(100, tariff.energyRates[0]), 11);
near(tierCharge(150, tariff.energyRates[0]), 21);
assert.throws(() => tierCharge(101, [tariff.energyRates[0][0]]));
assert.throws(() => tierCharge(10, [{ ...tariff.energyRates[0][0], rate: null, adjustment: null }]));
assert.throws(() => tierCharge(10, [{ ...tariff.energyRates[0][0], max: -1 }]));
near(tierCharge(10, [{ ...tariff.energyRates[0][1], rate: -.1 }]), -1);
near(electricityBill(hours, { ...tariff, minimumCharge: 1000, minimumChargeUnits: "$/month" }).months[0].minimum, 96.5);
near(electricityBill(hours, { ...tariff, minimumCharge: 2000, minimumChargeUnits: "$/year" }).total, 2000);
near(electricityBill(hours, { ...tariff, fixedCharge: 2, fixedChargeUnits: "$/day" }).months[0].fixed, 62);
near(electricityBill(hours, { ...tariff, fixedCharge: 240, fixedChargeUnits: "$/year" }).months[0].fixed, 20);
for (const bad of [undefined, { ...tariff, unsupportedClauses: ["Ratchet"] }, { ...tariff, serviceType: "Delivery" }, { ...tariff, energyWeekendSchedule: null }, { ...tariff, demandRateUnits: "kVA" }]) assert.equal(electricityBill(hours, bad).total, null);
for (const malformed of [{ fixedchargefirstmeter: "broken" }, { fueladjustmentsmonthly: [1] }, { energyratestructure: [[{ rate: .1, max: "bad" }]] }]) {
  const bad = parseElectricTariffs({ items: [{ ...raw, ...malformed }] }, 100)[0];
  assert.equal(electricityBill(hours, bad).total, null);
}
const seasonal = { ...tariff, flatDemandRates: [tariff.flatDemandRates[0], [{ max: null, rate: 8, adjustment: null, unit: null, sell: null }]], flatDemandMonths: [0, 1, ...Array(10).fill(0)] };
near(electricityBill([{ ...hours[0], month: 2, day: 3 }], seasonal).months[1].demand, 110);

const rows = Array.from({ length: 8760 }, (_, i) => { const d = new Date(Date.UTC(2025, 0, 1, i)); return { year: 2025, month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: 0 }; });
// Daily and demand-based limits affect tier allowances, never the $/kWh price.
const unitTariff = (unit, max) => parseElectricTariffs({ items: [{ ...raw,
  energyratestructure: [[{ max, rate: .1, unit, sell: .9 }, { rate: .2, unit, sell: .9 }]],
  energyweekdayschedule: schedule(), energyweekendschedule: schedule(), dgrules: "Net Metering",
  demandratestructure: undefined, flatdemandstructure: undefined, fueladjustmentsmonthly: undefined,
  fixedchargefirstmeter: 0,
}] }, 100)[0];
for (const [unit, max, expected] of [["kWh", 100, 20], ["kWh daily", 2, 23.8], ["kWh/kW", 1, 18], ["kWh/kW daily", .02, 22.56]]) {
  const selected = unitTariff(unit, max);
  assert.deepEqual(selected.unsupportedClauses, []);
  assert.ok(selected.notes.some(note => note.includes("no export compensation")));
  const computed = electricityBill(hours, selected);
  assert.equal(computed.reason, null);
  near(computed.months[0].energy, expected);
  near(electricityBill([hour(6, 12, 0)], selected).total, 0);
  assert.equal(electricityBill([hour(6, 12, -1)], selected).total, null);
}
const dailyFebruary = electricityBill([{ ...hour(3, 12, 150), month: 2 }], unitTariff("kWh daily", 2));
near(dailyFebruary.months[1].energy, 24.4); // 56 kWh allowance in February 2025.
assert.equal(electricityBill(hours, unitTariff("MWh", 1)).total, null);
const mixed = unitTariff("kWh/kW", 1);
mixed.energyRates[0][1].unit = "kWh";
near(electricityBill(hours, mixed).months[0].energy, 18);
const result = { scenario: { heating:"resistance",cooling:"heat-pump",efficiency:"standard" }, error: null, rows: rows.map(() => ({ electricity: 1,gasTherms:0 })), summary: { fullYear: true, completeHours: 8760, electricity: 8760, gasTherms:0, unmetHeatingHours: 0, unmetCoolingHours: 0 } };
const region = { kgCo2ePerKwh: .5, year: 2023, code: "TEST" };
const performance = annualPerformance(result, rows, tariff, region);
const manual = annualPerformance(result, rows, tariff, region, undefined, undefined, .15);
near(manual.cost, 8760 * .15);
near(manual.co2e, 8760 * .5 / 1000);
near(manual.energy, 8760*3412.141633/1e6);
near(annualPerformance(result, rows, undefined, region, undefined, undefined, .15).cost, manual.cost);
near(electricityBill(hours, undefined, 0).total, 0);
for (const invalidRate of [-1, NaN, Infinity]) assert.equal(electricityBill(hours, tariff, invalidRate).total, null);
assert.ok(manual.electricBill.months.every(m => m.demand === 0 && m.fixed === 0 && m.minimum === 0));
const demandTierPerformance = annualPerformance(result, rows, unitTariff("kWh/kW", 100), region);
near(demandTierPerformance.cost, 8760 * .2 - 12 * 100 * .1);
const { energyEmissions, totalCo2e } = load("lib/emissions.ts");
near(energyEmissions(1000, 0, region, undefined).co2e, 500);
near(totalCo2e(result, region) / 1000, performance.co2e);
assert.equal(energyEmissions(1000, 0, undefined, undefined).co2e, null);
assert.equal(energyEmissions(-1, 0, region, undefined).co2e, null);
assert.equal(energyEmissions(null, 0, region, undefined).co2e, null);
for (const key of ["energy", "cost", "co2e"]) near(performance[key], performance.months.reduce((sum, month) => sum + month[key], 0));
assert.equal(annualPerformance(result, rows, undefined, region).cost, null);
assert.equal(annualPerformance(result, rows, tariff, undefined).co2e, null);
assert.equal(annualPerformance({ ...result, error: "Awaiting curves" }, rows, tariff, region).energy, null);
assert.equal(annualPerformance({ ...result, summary: { ...result.summary, fullYear: false } }, rows, tariff, region).energy, null);
const duplicate = [...rows]; duplicate[1] = duplicate[0];
assert.equal(annualPerformance(result, duplicate, tariff, region).energy, null);
const badCalendar = [...rows]; badCalendar[0] = { ...badCalendar[0], month: 13 };
assert.equal(annualPerformance(result, badCalendar, tariff, region).energy, null);
const missing = { ...result, rows: result.rows.map((r, i) => i === 0 ? { ...r, electricity: null } : r) };
assert.equal(annualPerformance(missing, rows, tariff, region).energy, null);
const { AnnualScorecard } = load("components/annual-scorecard.tsx");
const render = (metrics, results = metrics.map(() => result)) => renderToStaticMarkup(createElement(AnnualScorecard, { performance: metrics, results, location: "Test City, WI", year: 2025, loading: false }));
const pendingHtml = renderToStaticMarkup(createElement(AnnualScorecard, { performance: [], results: [result], location: "Test City, WI", year: 2025, loading: false, ready: false }));
assert.match(pendingHtml, /Load results/);
assert.doesNotMatch(pendingHtml, /scorecard-scenario/);
const html = render([performance, performance, performance]);
assert.match(html, /Heat Pump Cooling \+ Electric Resistance Heating/); assert.match(html, /Compare annual performance/); assert.match(html, /Monthly performance/);
assert.match(html, /Annual energy consumption/); assert.match(html, /Annual CO/);
assert.doesNotMatch(html, /bypass factor|rated COP/);
assert.match(render([annualPerformance(result, rows, undefined, undefined)]), /Unavailable/);
assert.doesNotMatch(render([annualPerformance({ ...result, error: "Awaiting curves" }, rows, undefined, undefined)]), /\$0/);
assert.match(render([performance], [{ ...result, summary: { ...result.summary, unmetHeatingHours: 12 } }]), /12 heating hours/);
const gasData={status:"ok",state:"WI",prices:Array.from({length:12},(_,i)=>({period:`2026-${String(i+1).padStart(2,"0")}`,dollarsPerMcf:10.26}))};
const gasResult={...result,scenario:{heating:"gas",cooling:"heat-pump",efficiency:"standard"},rows:rows.map(()=>({electricity:0,gasTherms:1})),summary:{...result.summary,electricity:0,gasTherms:8760}};
const gasPerformance=annualPerformance(gasResult,rows,undefined,undefined,gasData,EPA_NATURAL_GAS);
near(gasPerformance.cost,8760);near(gasPerformance.co2e,8760*EPA_NATURAL_GAS.kgCo2ePerTherm/1000);near(gasPerformance.energy,876);
assert.equal(annualPerformance(gasResult,rows,undefined,undefined,undefined,EPA_NATURAL_GAS).cost,null);
near(annualPerformance(gasResult,rows,undefined,undefined,undefined,EPA_NATURAL_GAS).co2e,gasPerformance.co2e);
assert.match(render([gasPerformance],[gasResult]),/Heat Pump Cooling \+ Natural Gas Heating/);
console.log("Scorecard checks passed: electricity tariffs, independent costs/emissions, complete-year validation, reconciliation, missing curves, and rendered scorecards/graphs.");
