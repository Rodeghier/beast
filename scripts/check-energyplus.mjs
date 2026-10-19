import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url), cache = new Map();
function load(path) {
  let file = resolve(root, path);
  if (!existsSync(file)) file += existsSync(file + '.tsx') ? '.tsx' : '.ts';
  if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'));
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const local = id => id.startsWith('@/') ? load(id.slice(2)) : id.startsWith('.') ? load(resolve(dirname(file), id)) : require(id);
  new Function('require', 'module', 'exports', code)(local, module, module.exports);
  return module.exports;
}
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const ep = load('lib/energyplus.ts'), catalog = load('lib/equipment-catalog.ts'), c = load('lib/rtu-curves.ts'), m = load('lib/rtu.ts'), s = load('lib/school.ts');
const csv = load('lib/csv.ts');
const manifest = load('docs/energyplus/manifest.json');
assert.equal(ep.ENERGYPLUS_VERSION, '26.2.0');
assert.equal(ep.ENERGYPLUS_PROFILES.length, 37);
assert.ok(ep.ENERGYPLUS_PROFILES.every(p => p.cop > 0 && p.cop < 20));
assert.ok(!ep.ENERGYPLUS_PROFILES.some(p => p.id === 'energyplus-cooling-lennox-kha060s4-cooling'));
const [equipmentHeaders, ...sourceEquipment] = csv.parseCsv(readFileSync(resolve(root, 'public/data/energyplus-equipment.csv'), 'utf8').replace(/^\ufeff/, ''));
const conflicted = sourceEquipment.find(row => row[equipmentHeaders.indexOf('equipment_name')] === 'Lennox KHA060S4 Cooling');
assert.equal(conflicted[equipmentHeaders.indexOf('status')], 'not-integrated');
assert.equal(conflicted[equipmentHeaders.indexOf('rated_COP_W_W')], '385');
assert.ok(conflicted[equipmentHeaders.indexOf('reason')].includes('3.85'));
for (const source of manifest.sources) {
  const bytes = readFileSync(resolve(root, 'docs/energyplus/upstream', source.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, source.file);
}
const data = name => csv.parseCsv(readFileSync(resolve(root, 'public/data', name), 'utf8').replace(/^\ufeff/, ''));
const [coverageHeaders, ...coverage] = data('energyplus-coverage.csv');
assert.equal(coverage.length, manifest.counts.dictionaryObjects);
assert.equal(new Set(coverage.map(row => row[0])).size, coverage.length);
assert.ok(coverage.every(row => row.length === coverageHeaders.length && row[3].length > 20));
for (const type of ['Chiller:Electric:EIR', 'Boiler:HotWater', 'Coil:Cooling:DX:MultiSpeed', 'Refrigeration:Compressor', 'Generator:Photovoltaic', 'GroundHeatExchanger:System']) {
  const row = coverage.find(row => row[0] === type); assert.ok(row, type); assert.equal(row[2], 'not-integrated', type);
}
const [fitHeaders, ...fits] = data('energyplus-curve-fits.csv');
assert.equal(fits.length, manifest.counts.curveExportRows);
assert.ok(fits.every(row => row.length === fitHeaders.length));
const value = (row, name) => row[fitHeaders.indexOf(name)];
const fit = fits.find(row => value(row, 'curve_name') === 'JCI J05XP Cooling CAPFTemp');
near(Number(value(fit, 'coefficient_1')), 1.2677486847, 1e-12);
near(Number(value(fit, 'coefficient_6')), -0.0004993062, 1e-14);
assert.ok(fits.some(row => value(row, 'curve_type') === 'Embedded equipment coefficients'));
for (const source of manifest.sources.filter(o => o.file.endsWith('.idf'))) {
  const raw = readFileSync(resolve(root, 'docs/energyplus/upstream', source.file), 'utf8').replace(/!.*$/gm, '');
  const expected = raw.split(';').map(b => b.trim()).filter(b => /^(Curve:|Table:)/i.test(b));
  const actual = new Set(fits.filter(row => value(row, 'dataset') === source.file && /^(Curve:|Table:)/i.test(value(row, 'curve_type'))).map(row => value(row, 'source_object_index')));
  assert.equal(actual.size, expected.length, `${source.file}: every curve/table exported`);
}

const db = s.celsius(80), wb = s.celsius(67), ws = s.humidityRatio(wb, 100);
const w = ((2501 - 2.326 * wb) * ws - 1.006 * (db - wb)) / (2501 + 1.86 * db - 4.186 * wb);
const school = { ...s.DEFAULT_SCHOOL, people: 0, infiltrationAch: 0, ventilationArea: 0, ventilationPerson: 0, lightingW: 0, equipmentW: 0, windowPercent: 0, solarAbsorptance: 0 };
const weather = [-10, 10, 40, 75, 90, 105].flatMap((f, i) => [25, 75].map((rh, j) => ({ year: 2025, month: 1, day: i + 1, hour: j + 12, minute: 0, temperature: s.celsius(f), humidity: rh, dhi: 0, dni: 0, ghi: 0 })));
const loads = s.simulateSchool(weather, school);
for (const p of ep.ENERGYPLUS_PROFILES) {
  assert.ok(p.cfmPerTon > 250 && p.cfmPerTon < 600, `${p.name}: SI airflow conversion`);
  near(p.cfmPerTon * (p.basisCapacityW / 3516.8528420667) * 0.00047194745, p.airflowM3s, 1e-7);
  const roles = p.curves;
  for (const curve of Object.values(roles)) {
    const x = (curve.minX + curve.maxX) / 2, y = curve.minY === null ? 0 : (curve.minY + curve.maxY) / 2;
    const bounded = ep.evaluateEnergyPlusCurve(curve, curve.minX - 100, y);
    near(bounded.value, ep.evaluateEnergyPlusCurve(curve, curve.minX, y).value); assert.equal(bounded.bounded, true);
    const a = curve.coefficients;
    let manual = a[0] + a[1] * x;
    if (curve.type !== 'Curve:Linear') manual += a[2] * x * x;
    if (curve.type === 'Curve:Cubic') manual += a[3] * x ** 3;
    if (curve.type === 'Curve:Biquadratic') manual += a[3] * y + a[4] * y * y + a[5] * x * y;
    manual = Math.min(curve.maxOutput ?? Infinity, Math.max(curve.minOutput ?? -Infinity, manual));
    near(ep.evaluateEnergyPlusCurve(curve, x, y).value, manual, 1e-10);
  }
  near(c.ratedCop(10, p.mode, p.id), p.cop);
  near(c.runtimeFraction(.5, p.mode, p.id), .5 / .925);
  const system = { ...catalog.DEFAULT_SYSTEM, [p.mode]: p.id };
  assert.equal(catalog.validateSystem(system), null);
  if (p.mode === 'cooling') {
    const point = c.coolingOperatingPoint(db, w, 35, p.cfmPerTon, p.id);
    assert.ok(point.shr > 0 && point.shr < 1, `${p.name}: rated latent performance`);
    near(point.shr, p.shr, .035);
    assert.ok(c.ratedBypassFactor(p.id).bf > 0);
  } else {
    const sourcePeer = sourceEquipment.find(row => row[equipmentHeaders.indexOf('dataset')] === p.file
      && row[equipmentHeaders.indexOf('equipment_type')] === p.basisRatingType
      && row[equipmentHeaders.indexOf('equipment_name')] === p.basisRatingName);
    assert.ok(sourcePeer, `${p.name}: matched source cooling rating`);
    near(p.basisCapacityW, Number(sourcePeer[equipmentHeaders.indexOf('rated_capacity_W')]));
    near(p.capacityRatio, p.capacityW / Number(sourcePeer[equipmentHeaders.indexOf('rated_capacity_W')]));
    const point = c.heatingOperatingPoint(2, 10, 21.11, 15, 8.33, .005, p.cfmPerTon, p.id, 0);
    const cap = ep.evaluateEnergyPlusCurve(roles.capacityTemperature, roles.capacityTemperature.type === 'Curve:Biquadratic' ? 21.11 : 8.33, 8.33).value * ep.evaluateEnergyPlusCurve(roles.capacityFlow, 1).value;
    const eir = ep.evaluateEnergyPlusCurve(roles.eirTemperature, roles.eirTemperature.type === 'Curve:Biquadratic' ? 21.11 : 8.33, 8.33).value * ep.evaluateEnergyPlusCurve(roles.eirFlow, 1).value;
    near(point.capacityBtu, 2 * 10 * 12000 * p.capacityRatio * cap);
    near(point.inputKw, point.capacityBtu / c.BTU_PER_KWH * eir / p.cop);
    const colder = c.heatingOperatingPoint(2, 10, 21.11, 15, 1, .005, p.cfmPerTon, p.id, 0);
    assert.ok(colder.capacityBtu < point.capacityBtu, `${p.name}: source capacity must respond to outdoor temperature`);
    assert.equal(c.heatingOperatingPoint(1, 10, 21.11, 15, -25, .005, 404, p.id, 0).capacityBtu, 0);
  }
  const result = m.selectRtu(loads, school, m.DEFAULT_RTU, system);
  assert.ok(result.equipment, `${p.name}: equipment can be sized`);
  for (const row of result.rows) {
    assert.ok(Number.isFinite(row.electricity) && row.electricity >= 0, p.name);
    near(row.electricity, row.compressorKwh + row.fanKwh + row.reheatKwh + row.directHeatKwh);
    near(row.heatingDemand, row.deliveredHeating + row.unmetHeating);
    assert.ok(row.unmetCooling <= 1, `${p.name}: cooling service covered`);
  }
  const exported = csv.parseCsv(m.rtuCsv(loads, school, result, m.DEFAULT_RTU, 'Test city', 'UTC-6'));
  assert.equal(exported[0].length, exported[1].length);
  assert.equal(exported[1][exported[0].indexOf('EnergyPlus_commit')], ep.ENERGYPLUS_COMMIT);
}
assert.ok(catalog.validateSystem({ heating: ep.ENERGYPLUS_PROFILES.find(p => p.mode === 'cooling').id, cooling: 'standard', lockoutF: 0 }));
assert.ok(catalog.validateSystem({ heating: 'standard', cooling: 'energyplus-unknown', lockoutF: 0 }));
assert.ok(catalog.HEATING_OPTIONS.find(o => o.id === 'energyplus-heating-lennox-kha060s4-cooling').name.endsWith(' Heating'));
const univariate = ep.ENERGYPLUS_PROFILES.find(p => p.id === 'energyplus-heating-lennox-tha060s2-cooling');
const at5 = ep.energyPlusFactors(univariate, 15, 5, univariate.cfmPerTon);
const independentCubic = .7414834834 + .0291699781 * 5 + .0002487638 * 25 - .0000031828 * 125;
near(at5.capacity, independentCubic * univariate.capacityRatio, 1e-9);
near(at5.capacity, ep.energyPlusFactors(univariate, 25, 5, univariate.cfmPerTon).capacity);
// Exercise a complete calendar through both new coil paths together.
const annualWeather = Array.from({ length: 8760 }, (_, i) => {
  const time = new Date(Date.UTC(2025, 0, 1, i)), pattern = weather[i % weather.length];
  return { ...pattern, month: time.getUTCMonth() + 1, day: time.getUTCDate(), hour: time.getUTCHours() };
});
const annualLoads = s.simulateSchool(annualWeather, { ...school, people: 1200, ventilationArea: .12, ventilationPerson: 10 });
const annual = m.selectRtu(annualLoads, { ...school, people: 1200, ventilationArea: .12, ventilationPerson: 10 }, m.DEFAULT_RTU,
  { heating: 'energyplus-heating-jci-j05xp-heating', cooling: 'energyplus-cooling-jci-j05xp-cooling', lockoutF: 0 });
assert.ok(annual.equipment); assert.equal(annual.summary.fullYear, true); assert.equal(annual.summary.completeHours, 8760);
near(annual.summary.electricity, annual.rows.reduce((sum, row) => sum + row.electricity, 0));
near(annual.summary.siteMMBtu, annual.summary.electricity * c.BTU_PER_KWH / 1e6);
assert.equal(annual.summary.unmetCoolingHours, 0);
const { EnergyPlusCatalog } = load('components/energyplus-catalog.tsx');
const html = renderToStaticMarkup(createElement(EnergyPlusCatalog));
for (const name of ['energyplus-curve-fits.csv', 'energyplus-equipment.csv', 'energyplus-coverage.csv']) assert.ok(html.includes(name));
assert.ok(html.includes('Not integrated') && html.includes('Chiller:Electric:EIR'));
console.log(`EnergyPlus checks passed: ${ep.ENERGYPLUS_PROFILES.length} selectable profiles, source hashes, complete curve export, dictionary coverage, SI conversion, source coefficients/limits, COP/PLF, sizing, hourly and full-year balances, lockout, provenance and rendered download links.`);
