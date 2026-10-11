import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "rtu-model-"));
const source = readFileSync(new URL("../lib/data/rtu/comstock-standard.json", import.meta.url), "utf8");
for (const name of ["csv", "school", "equipment-catalog", "rtu-curves", "rtu", "equipment-comparison"]) {
  let code = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8").replace('import source from "./data/rtu/comstock-standard.json";', `const source = ${source};`).replace(/from "\.\/(csv|school|rtu-curves|rtu|equipment-catalog)"/g, 'from "./$1.mjs"');
  code = code.replace(/import (\w+) from "(\.\/data\/rtu\/[^"]+\.json)";/g, (_, variable, path) => `const ${variable} = ${readFileSync(new URL(`../lib/${path.slice(2)}`, import.meta.url), "utf8")};`);
  writeFileSync(join(temp, name + ".mjs"), ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
try {
  const m = await import(pathToFileURL(join(temp, "rtu.mjs")).href), c = await import(pathToFileURL(join(temp, "rtu-curves.mjs")).href), s = await import(pathToFileURL(join(temp, "school.mjs")).href), csv = await import(pathToFileURL(join(temp, "csv.mjs")).href);
  const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
  const school = s.DEFAULT_SCHOOL, rtu = m.DEFAULT_RTU;
  const row = (f, rh = 50, rest = {}) => ({ year: 2025, month: 1, day: 7, hour: 12, minute: 0, temperature: s.celsius(f), humidity: rh, ...rest });
  assert.equal(createHash("sha256").update(source).digest("hex"), "1119708509b5b26cf41f41c2296412f3f1637e2407560c20abcca9799dd0a24b");
  close(c.lookup("c_cap_high_T", 19.44, 35).value, 1);
  close(c.lookup("h_cap_T", 21.11, -17.78).value, 0.3974);
  close(c.lookup("h_eir_T", 21.11, -17.78).value, 2.6433);
  const data = JSON.parse(source).tables.curves.table.find(c => c.name === "c_cap_high_T");
  const points = Object.entries(data).filter(([k]) => /^data_point\d+$/.test(k)).map(([, v]) => v.split(",").map(Number));
  const corners = points.filter(p => [16.67, 17.22].includes(p[0]) && [35, 40.56].includes(p[1]));
  assert.equal(corners.length, 4); close(c.lookup("c_cap_high_T", (16.67 + 17.22) / 2, (35 + 40.56) / 2).value, corners.reduce((a, p) => a + p[2], 0) / 4);
  assert.ok(c.lookup("c_cap_high_T", 19.44, 20).bounded);
  close(c.lookup("c_cap_high_T", 19.44, 20).value, c.lookup("c_cap_high_T", 19.44, 29.44).value);
  close(c.wetBulbC(25, s.humidityRatio(25, 100)), 25, 1e-4);
  // Published PsychroLib example: 25 C, 80% RH -> 22.380359 C wet bulb.
  close(c.wetBulbC(25, s.humidityRatio(25, 80)), 22.380359064, 0.002);
  const mixed = c.mixedAir(70, 0.008, 90, 0.012, 0.25);
  close(mixed.w, 0.009); close(mixed.db, (0.75 * (1.006 * s.celsius(70) + 0.008 * (2501 + 1.86 * s.celsius(70))) + 0.25 * (1.006 * s.celsius(90) + 0.012 * (2501 + 1.86 * s.celsius(90))) - 2501 * 0.009) / (1.006 + 1.86 * 0.009));
  close(c.runtimeFraction(0.5, "cooling"), 0.5 / 0.875); close(c.runtimeFraction(0, "heating"), 0); close(c.runtimeFraction(1, "heating"), 1);
  assert.ok(c.heatingFactors(21.11, 15, s.celsius(-1), 0.001, 404).lockout);
  assert.ok(c.heatingFactors(21.11, 15, s.celsius(0), 0.001, 404).capacity > 0);
  const bare = { ...school, people: 0, infiltrationAch: 0, ventilationArea: 0, ventilationPerson: 0, lightingW: 0, equipmentW: 0, solarPeak: 0 };
  const equipment = m.equipmentFor(2, 25, rtu), fanKw = 50 * 404 * 0.5 / 1000;
  const coldRow = s.simulateSchool([row(-5, 0)], bare)[0], cold = m.simulateRtuHour(coldRow, equipment, rtu, bare);
  close(cold.deliveredHeating, 0); assert.ok(cold.lockout); close(cold.unmetHeating, coldRow.heating - fanKw * c.BTU_PER_KWH);
  close(cold.electricity, fanKw + 2 * 60 * 2.5 ** 0.67 / 1000);
  // A deliberately undersized unit at +17 F: shortfall must occur ABOVE
  // lockout, and the compressor must draw mapped full-load input, not the
  // electrical power that would be needed to satisfy the entire building load.
  const small = m.equipmentFor(1, 25, rtu);
  const limitedLoad = s.simulateSchool([row(17, 60)], bare)[0];
  const limited = m.simulateRtuHour(limitedLoad, small, rtu, bare);
  assert.equal(limited.lockout, false); assert.ok(limited.unmetHeating > 100000);
  assert.equal(limited.heatingShortfallReason, "Heat demand exceeds available heating capacity");
  close(limited.deliveredHeating, limited.usableHeating); close(limited.runtime, 1);
  close(limited.unmetHeating, limited.heatingDemand - limited.availableHeating);
  close(limited.compressorKwh + limited.defrostKwh, limited.heatingFullLoadKw);
  close(limited.operatingCop, limited.heatingFullLoadCop);
  close(limitedLoad.heating, limited.fanHeatCredit + limited.deliveredHeating + limited.unmetHeating);
  // Doubling demand at the same operating point must NOT increase capacity or
  // compressor power once full output is reached.
  const highLoad = { ...limitedLoad, heating: limitedLoad.heating + 200000, heatBalance: limitedLoad.heatBalance + 200000 };
  const higher = m.simulateRtuHour(highLoad, small, rtu, bare);
  close(higher.availableHeating, limited.availableHeating); close(higher.electricity, limited.electricity);
  close(higher.unmetHeating - limited.unmetHeating, 200000);
  const op = (tons, outdoorF, enteringF, count = 1) => c.heatingOperatingPoint(count, tons, s.celsius(enteringF), c.wetBulbC(s.celsius(enteringF), s.humidityRatio(s.celsius(enteringF), 40)), s.celsius(outdoorF), s.humidityRatio(s.celsius(outdoorF), 60), 404);
  const at17 = op(25, 17, 70), at47 = op(25, 47, 70), enter55 = op(25, 17, 55), enter80 = op(25, 17, 80), tenTon = op(10, 17, 70), doubled = op(25, 17, 70, 2);
  assert.ok(at17.capacityBtu < at47.capacityBtu && at17.cop < at47.cop);
  assert.ok(Math.abs(enter55.capacityBtu - enter80.capacityBtu) > 1000);
  assert.ok(Math.abs(enter55.inputKw - enter80.inputKw) > 0.01);
  assert.ok(Math.abs(enter55.cop - enter80.cop) > 0.001);
  close(doubled.capacityBtu, at17.capacityBtu * 2); close(doubled.inputKw, at17.inputKw * 2); close(doubled.cop, at17.cop);
  assert.ok(tenTon.capacityBtu < at17.capacityBtu && tenTon.inputKw < at17.inputKw);
  assert.ok(Math.abs(tenTon.cop - at17.cop) > 0.001); // per-unit-size rated COP fit
  const heatingCases = [[25, 0, 70], [25, 17, 70], [25, 47, 70], [25, 17, 55], [25, 17, 80], [10, 17, 70]].map(([tons, outdoorF, enteringF]) => ({ tons, outdoorF, enteringF, ...op(tons, outdoorF, enteringF) }));
  if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify({ version: m.RTU_VERSION, enteringRh: 40, outdoorRh: 60, cases: heatingCases, undersizedCase: { buildingNeed: limitedLoad.heating, outdoorF: 17, units: 1, tons: 25, ...limited } }, null, 2));
  const mild = m.simulateRtuHour(s.simulateSchool([row(72, 0)], bare)[0], equipment, rtu, bare);
  assert.equal(mild.mode, "Fan only"); close(mild.electricity, fanKw); close(mild.sensibleDemand, 0);
  const hotRow = s.simulateSchool([row(95, 0)], bare)[0], hot = m.simulateRtuHour(hotRow, equipment, rtu, bare);
  close(hot.sensibleDemand, -(300000 + fanKw * c.BTU_PER_KWH)); // fan heat counted once
  close(hot.sensibleDemand, hot.deliveredCooling * rtu.sensibleHeatRatio, 1e-5);
  close(hot.reheatKwh, 0); close(hot.unmetCooling, 0);
  const latentOnly = { ...bare, people: 1200, sensiblePerson: 0, latentPerson: 155 };
  const latent = m.simulateRtuHour(s.simulateSchool([row(72, 50)], latentOnly)[0], m.equipmentFor(10, 25, rtu), rtu, latentOnly);
  assert.ok(latent.reheatKwh > 0); close(-latent.deliveredCooling * rtu.sensibleHeatRatio - latent.reheatKwh * c.BTU_PER_KWH, -latent.sensibleDemand, 1e-5);
  assert.equal(m.simulateRtuHour(s.simulateSchool([{ ...row(90), humidity: null }], school)[0], equipment, rtu, school).electricity, null);
  assert.ok(m.validateRtu({ ...rtu, fanWPerCfm: NaN }));
  const short = m.selectRtu(s.simulateSchool([row(75), { ...row(75), humidity: null }], school), school, rtu);
  assert.equal(short.summary.fullYear, false); assert.equal(short.summary.completeHours, 1);
  assert.equal(short.equipment.peakVentilationCfm, 30000); // 5250 CFM infiltration does not count
  const catalog = await import(pathToFileURL(join(temp, "equipment-catalog.mjs")).href);
  const comp = await import(pathToFileURL(join(temp, "equipment-comparison.mjs")).href);
  const manifest = JSON.parse(readFileSync(new URL("../docs/equipment-sources.json", import.meta.url), "utf8"));
  for (const entry of manifest.files.filter(f => f.family)) {
    const text = readFileSync(new URL(`../lib/data/rtu/comstock-${entry.family}.json`, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), entry.sha256);
    for (const curve of JSON.parse(text).tables.curves.table) {
      if (curve.form !== "MultiVariableLookupTable") continue;
      for (const [key, value] of Object.entries(curve)) if (/^data_point\d+$/.test(key)) {
        const pt = value.split(",").map(Number);
        close(c.lookup(curve.name, pt[0], curve.number_independent_variables === 1 ? 0 : pt[1], entry.family).value, pt.at(-1));
      }
    }
  }
  // Finite fixed-output coils: doubling demand cannot increase capacity.
  const bank = { ...small, heatingBankBtuEach: 200000 };
  for (const heating of ["gas", "resistance"]) {
    const system = { heating, cooling: "standard", lockoutF: 0 };
    const hour = m.simulateRtuHour(limitedLoad, bank, rtu, bare, system);
    const more = m.simulateRtuHour(highLoad, bank, rtu, bare, system);
    close(hour.availableHeating, 200000); close(hour.deliveredHeating, 200000);
    close(more.unmetHeating - hour.unmetHeating, 200000);
    close(more.electricity, hour.electricity); close(more.gasTherms, hour.gasTherms);
    close(hour.runtime, 0); close(hour.compressorKwh, 0); // DX compressor stays off during direct heat.
    if (heating === "gas") { close(hour.gasTherms, 2.5); assert.equal(hour.operatingCop, null); assert.equal(hour.heatingFullLoadKw, null); }
    else { close(hour.directHeatKwh * c.BTU_PER_KWH, 200000); close(hour.operatingCop, 1); close(hour.gasTherms, 0); }
  }
  // Independent polynomial evaluation at a published rated point; axis order
  // is entering DB, outdoor DB, despite swapped descriptive names in source.
  const vh = c.polynomial("heat_cap_ft4", s.celsius(70), s.celsius(47), "variable");
  close(vh.value, 0.93607915412 - .005481563544*s.celsius(70) - .0000085897908*s.celsius(70)**2 + .02491053192*s.celsius(47) + .000053087076*s.celsius(47)**2 - .000155750364*s.celsius(70)*s.celsius(47));
  for (const family of Object.keys(catalog.FAMILIES)) {
    const low = c.heatingOperatingPoint(1, 25, s.celsius(70), s.celsius(55), s.celsius(5), s.humidityRatio(s.celsius(5), 50), 404, family, -10);
    const high = c.heatingOperatingPoint(1, 25, s.celsius(70), s.celsius(55), s.celsius(47), s.humidityRatio(s.celsius(47), 50), 404, family, -10);
    assert.ok(low.capacityBtu > 0 && high.capacityBtu > 0 && Number.isFinite(low.inputKw));
    assert.ok(Math.abs(low.capacityBtu - high.capacityBtu) > 10000);
    assert.ok(Math.abs(low.cop - high.cop) > .1);
  }
  assert.ok(c.heatingOperatingPoint(1,25,21,15,s.celsius(-11),.001,404,"cold",-10).lockout);
  const fixture = process.argv[2];
  if (fixture) {
    const climate = csv.parseClimateCsv(readFileSync(fixture, "utf8"), 2025), loads = s.simulateSchool(climate.rows, school);
    const t0 = performance.now(), result = m.selectRtu(loads, school, rtu);
    const elapsed = performance.now() - t0;
    assert.ok(result.equipment); assert.equal(result.rows.length, 8760); assert.equal(result.summary.fullYear, true); assert.equal(result.summary.unmetCoolingHours, 0);
    const eq = result.equipment;
    assert.ok(eq.outdoorCapacityCfm >= 30000); assert.ok(eq.outdoorCapacityCfm < 35000 || eq.count > 12);
    for (const r of result.rows) {
      for (const k of ["electricity", "compressorKwh", "fanKwh", "defrostKwh", "crankcaseKwh", "reheatKwh", "unmetHeating", "unmetCooling", "deliveredHeating"]) assert.ok(Number.isFinite(r[k]) && r[k] >= -1e-6, `${k}: ${r[k]}`);
      close(r.electricity, r.compressorKwh + r.fanKwh + r.defrostKwh + r.crankcaseKwh + r.reheatKwh);
      close(r.heatingDemand, r.deliveredHeating + r.unmetHeating, 1e-5);
      close(r.unmetHeating, Math.max(0, r.heatingDemand - r.usableHeating));
      assert.ok(r.deliveredHeating <= r.availableHeating + 1e-6);
      if (r.heatingFullLoadCop !== null) close(r.availableHeating, r.heatingFullLoadKw * c.BTU_PER_KWH * r.heatingFullLoadCop, 1e-5);
      if (r.operatingCop !== null) close(r.deliveredHeating - r.deliveredCooling, r.operatingCop * c.BTU_PER_KWH * (r.compressorKwh + r.defrostKwh), 1e-5);
      if (r.deliveredCooling < 0) assert.ok(r.availableCooling + 1 >= -r.deliveredCooling * 1.1);
      assert.ok(r.runtime >= 0 && r.runtime <= 1); assert.ok(r.outdoorFraction <= 0.25);
    }
    close(result.summary.electricity, result.summary.compressor + result.summary.fan + result.summary.defrost + result.summary.crankcase + result.summary.reheat, 1e-5);
    // Independently reject every smaller-count/size arrangement using hourly
    // available capacity vs demand, not the selection loop itself.
    for (let n = 1; n <= eq.count; n++) for (const tons of m.UNIT_SIZES) {
      if (n === eq.count && tons >= eq.tonsEach) continue;
      const candidate = m.equipmentFor(n, tons, rtu);
      if (candidate.outdoorCapacityCfm < 30000) continue;
      assert.ok(loads.some(row => { const r = m.simulateRtuHour(row, candidate, rtu, school); return r.availableCooling > 0 && r.availableCooling + 0.01 < Math.max(-r.sensibleDemand / 0.77, -r.latentDemand / 0.23) * 1.1; }));
    }
    const exported = m.rtuCsv(loads, school, result, rtu, 'Madison, "WI"', "UTC-6"), parsed = csv.parseCsv(exported);
    assert.equal(parsed.length, 8763); assert.equal(parsed[0].length, parsed[1].length); assert.equal(parsed[2].length, parsed.at(-1).length);
    const energyIdx = parsed[2].indexOf("RTU_electricity_kWh"), unmetIdx = parsed[2].indexOf("Unmet_heating_BTU_hr");
    assert.ok(energyIdx > 0 && unmetIdx > 0); close(Number(parsed[3][energyIdx]), result.rows[0].electricity, 1e-6);
    for (const key of ["Usable_heating_capacity_BTU_hr", "Full_load_heating_electric_input_kW", "Full_load_electric_heating_COP", "Operating_electric_coil_COP", "Gas_input_therms", "Primary_resistance_heating_kWh", "Heating_shortfall_reason"]) assert.ok(parsed[2].includes(key));
    close(result.summary.electricity, 1712593.666284107, .001); // original standard case remains unchanged
    const comparisons = [];
    for (const heating of catalog.HEATING_OPTIONS.map(o => o.id)) {
      for (const cooling of catalog.COOLING_OPTIONS.map(o => o.id)) {
        const system = { heating, cooling, lockoutF: heating === "cold" ? -10 : 0 };
        const comparison = m.selectRtu(loads, school, rtu, system);
        assert.ok(comparison.equipment); assert.equal(comparison.summary.fullYear, true);
        assert.equal(comparison.summary.unmetCoolingHours, 0);
        for (const r of comparison.rows) {
          for (const key of ["electricity", "gasTherms", "directHeatKwh", "unmetHeating", "availableHeating"]) assert.ok(Number.isFinite(r[key]) && r[key] >= 0, `${heating}/${cooling} ${key}: ${r[key]}`);
          close(r.electricity, r.fanKwh + r.compressorKwh + r.defrostKwh + r.crankcaseKwh + r.reheatKwh + r.directHeatKwh, 1e-5);
          close(r.heatingDemand, r.deliveredHeating + r.unmetHeating, 1e-5);
          if (heating === "gas") close(r.deliveredHeating, r.gasTherms * 100000 * .8, 1e-5);
          if (heating === "resistance") close(r.deliveredHeating, r.directHeatKwh * c.BTU_PER_KWH, 1e-5);
          if (catalog.isHeatPump(heating)) close(r.gasTherms, 0);
        }
        close(comparison.summary.siteMMBtu, comparison.summary.electricity*c.BTU_PER_KWH/1e6+comparison.summary.gasTherms*.1, 1e-5);
        const parsedCsv = csv.parseCsv(m.rtuCsv(loads, school, comparison, rtu, "Madison, WI", "UTC-6"));
        assert.equal(parsedCsv[0].length, parsedCsv[1].length);assert.equal(parsedCsv[2].length,parsedCsv[3].length);
        close(Number(parsedCsv[3][parsedCsv[2].indexOf("Gas_input_therms")]), comparison.rows[0].gasTherms, 1e-6);
        if (heating === "gas") assert.equal(parsedCsv[3][parsedCsv[2].indexOf("Full_load_electric_heating_COP")], "");
        if (cooling === (heating === "variable" || heating === "cold" ? "variable" : heating === "lab" ? "lab" : "standard")) comparisons.push({ system, equipment: comparison.equipment, summary: comparison.summary });
      }
    }
    const summaryCsv = csv.parseCsv(comp.comparisonCsv([result, m.selectRtu(loads, school, rtu, catalog.ALTERNATIVE_SYSTEM)], "Madison, WI", 2025));
    assert.equal(summaryCsv.length, 3); assert.equal(summaryCsv[0].length, summaryCsv[2].length);
    if (process.argv[5]) writeFileSync(process.argv[5], JSON.stringify({ model: m.RTU_VERSION, location: "Madison, WI", year: 2025, cases: comparisons }, null, 2));
    console.log(JSON.stringify({ equipmentCases: comparisons.map(c => ({ heating: c.system.heating, cooling: c.system.cooling, count: c.equipment.count, electricity: Math.round(c.summary.electricity), gasTherms: Math.round(c.summary.gasTherms), unmetHours: c.summary.unmetHeatingHours })) }));
    const criticalIndex = result.rows.reduce((best, r, i) => { const utilization = x => x.availableCooling > 0 ? Math.max(-x.sensibleDemand / rtu.sensibleHeatRatio, -x.latentDemand / (1 - rtu.sensibleHeatRatio)) / x.availableCooling : 0; return utilization(r) > utilization(result.rows[best]) ? i : best; }, 0);
    const critical = { weather: climate.rows[criticalIndex], school: loads[criticalIndex], rtu: result.rows[criticalIndex] };
    const modelSummary = { critical, location: "Madison, WI", year: 2025, model: m.RTU_VERSION, equipment: eq, summary: result.summary, sample: result.rows[0], selectionMilliseconds: Math.round(elapsed) };
    console.log(JSON.stringify(modelSummary));
    if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(modelSummary, null, 2));
  }
  console.log("RTU checks passed: pinned map hash, grid nodes, interpolation, bounds, psychrometrics, cycling, fan heat, lockout, reheat, missing data, annual balance, ventilation, minimal selection, and CSV export.");
} finally { rmSync(temp, { recursive: true, force: true }); }
