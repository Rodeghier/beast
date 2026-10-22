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
const { parseCurves, curveValue, newScenario } = load("lib/performance-curves.ts");
const { simulateCurves, curveResultsCsv, curveComparisonCsv, BTU_PER_KWH, parseEnteringWetBulbCsv } = load("lib/curve-model.ts");
const { simulateSchool, DEFAULT_SCHOOL } = load("lib/school.ts");
const { parseCsv } = load("lib/csv.ts");
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);
// Synthetic test fixtures only; no equipment values are bundled in the application.
const surface = value => ({ outdoorF: [-40, 120], enteringWetBulbF: [30, 90], values: [[value,value],[value,value]] });
const curves = { heating: { capacity: surface(1), cop: surface(2) }, cooling: { capacity: surface(1), cop: surface(4), shr: surface(.75) } };
assert.deepEqual(parseCurves(curves), curves);
const plane = { outdoorF: [0, 10], enteringWetBulbF: [40, 60], values: [[40,50],[60,70]] };
near(curveValue(plane, 5, 50),55);
near(curveValue(plane, 10, 60),70);
near(curveValue(plane, 0, 40),40);
assert.equal(curveValue(plane, -1, 50),null); assert.equal(curveValue(plane, 5, 61),null);
for (const bad of [
  { ...curves, ratedCop: 3 },
  { ...curves, cooling: { ...curves.cooling, fanPower: 4 } },
  { ...curves, heating: { ...curves.heating, cop: surface(0) } },
  { ...curves, cooling: { ...curves.cooling, shr: surface(1.01) } },
  { ...curves, cooling: { ...curves.cooling, capacity: surface(-1) } },
  { ...curves, heating: { ...curves.heating, capacity: { ...surface(1), outdoorF: [0,0] } } },
  { ...curves, cooling: { ...curves.cooling, shr: { ...surface(.5), values: [[.5]] } } },
]) assert.throws(() => parseCurves(bad));
const climate = { year: 2025, month: 1, day: 1, hour: 0, minute: 0, temperature: 20, humidity: 50, dhi: 0, dni: 0, ghi: 0 };
const base = simulateSchool([climate],DEFAULT_SCHOOL)[0];
const row = { ...base, temperatureF: 80, heating: 1000, sensibleCooling: -750, latentCooling: -250, totalCooling: -1000 };
const scenario = { ...newScenario('Test'), curves, enteringWetBulbF: 60 };
const result = simulateCurves([row], scenario), r = result.rows[0];
near(result.referenceHeating,1000);near(result.referenceCooling,1000);
near(r.deliveredHeating,1000);near(r.deliveredCooling,1000);
near(r.electricity, 1000 / BTU_PER_KWH / 2 + 1000 / BTU_PER_KWH / 4);
near(r.unmetCooling,0);near(r.unmetHeating,0);
const limited = simulateCurves([row],{ ...scenario, curves: { ...curves, heating: { ...curves.heating, capacity: surface(.5) }, cooling: { ...curves.cooling, capacity: surface(.5) } } }).rows[0];
near(limited.unmetHeating,500);near(limited.unmetCooling,500);
for (const [shr, unmet] of [[0,750],[1,250]]) {
  const endpoint = simulateCurves([row],{ ...scenario, curves: { ...curves, cooling: { ...curves.cooling, shr: surface(shr) } } }).rows[0];
  near(endpoint.unmetCooling,unmet);assert.ok(Number.isFinite(endpoint.electricity));
}
for (const pending of [newScenario('Empty'), { ...scenario, enteringWetBulbF: null }]) {
  const p=simulateCurves([row],pending);assert.equal(p.summary.electricity,null);assert.equal(p.rows[0].unmetHeating,null);assert.equal(p.summary.completeHours,0);
}
assert.equal(simulateCurves([{ ...row, temperatureF: 121 }],scenario).summary.electricity,null);
assert.equal(simulateCurves([row],{ ...scenario, enteringWetBulbF: 91 }).summary.electricity,null);
near(simulateCurves([row],{ ...scenario, enteringWetBulbF: 91 }).rows[0].enteringWetBulbF,91);
near(simulateCurves([row],{ ...newScenario('Empty'), enteringWetBulbF: 60 }).rows[0].enteringWetBulbF,60);
assert.equal(simulateCurves([{ ...row, totalCooling: null }],scenario).summary.electricity,null);
const hourly = parseEnteringWetBulbCsv('Date,Time,Entering_wet_bulb_F\n2025-01-01,00:00,65');
near(simulateCurves([row],{ ...scenario, enteringWetBulbF: null, hourlyEnteringWetBulbF: hourly }).rows[0].enteringWetBulbF,65);
assert.equal(simulateCurves([{ ...row, hour: 1 }],{ ...scenario, enteringWetBulbF: null, hourlyEnteringWetBulbF: hourly }).summary.electricity,null);
for(const csv of ['Date,Time,Entering_wet_bulb_F\n2025-01-01,00:00,', 'Date,Time,Entering_wet_bulb_F\n2025-02-30,00:00,60', 'Date,Time,Entering_wet_bulb_F\n2025-01-01,00:00,60\n2025-01-01,00:00,61']) assert.throws(() => parseEnteringWetBulbCsv(csv));
const year = Array.from({length:8760},(_,i) => { const d=new Date(Date.UTC(2025,0,1,i));return { ...row, month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours() }; });
const annual = simulateCurves(year,scenario);assert.equal(annual.summary.fullYear,true);near(annual.summary.electricity,r.electricity*8760);
const duplicate=[...year];duplicate[1]=duplicate[0];assert.equal(simulateCurves(duplicate,scenario).summary.fullYear,false);
const exported = parseCsv(curveResultsCsv([row],DEFAULT_SCHOOL,result,'Test City','UTC-6'));
assert.equal(exported[0].length,exported[1].length);assert.equal(exported[2].length,exported[3].length);
near(Number(exported[3][exported[2].indexOf('Curve_electricity_kWh')]),r.electricity);
assert.doesNotMatch(exported[2].join(','),/bypass|EIR|gas|fan|rated|runtime|tons/i);
assert.match(curveComparisonCsv([result]),/Valid_hours/);
const { CurveScenarios }=load('components/curve-scenarios.tsx');
const markup=renderToStaticMarkup(createElement(CurveScenarios,{choices:[newScenario('Empty')],active:0,onActive:()=>{},onChange:()=>{}}));
assert.match(markup,/Awaiting 5 curves/);assert.match(markup,/entering wet-bulb/);assert.match(markup,/No default/);assert.doesNotMatch(markup,/ComStock|EIR|BF_rated/);
console.log('Curve checks passed: two-temperature interpolation, validation, empty placeholders, explicit wet-bulb inputs, capacity limits, SHR endpoints, energy balance, full-year coverage, CSVs and editor rendering.');
