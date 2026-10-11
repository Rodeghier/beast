import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Exercise the actual TypeScript implementation without another dependency.
const temp = mkdtempSync(join(tmpdir(), "school-model-"));
async function moduleFrom(file) {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const target = join(temp, file.split("/").pop().replace(/\.ts$/, ".mjs"));
  const { writeFileSync } = await import("node:fs"); writeFileSync(target, output);
  return import(pathToFileURL(target).href);
}
try {
  const m = await moduleFrom("lib/school.ts");
  const { parseClimateCsv, parseCsv } = await moduleFrom("lib/csv.ts");
  const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
  const row = (temperature, humidity = 50, rest = {}) => ({ year: 2025, month: 1, day: 7, hour: 12, minute: 0, temperature, humidity, ...rest });
  const bare = { ...m.DEFAULT_SCHOOL, people: 0, infiltrationAch: 0, ventilationArea: 0, ventilationPerson: 0, lightingW: 0, equipmentW: 0, solarPeak: 0 };
  close(m.fahrenheit(0), 32); close(m.fahrenheit(100), 212); close(m.fahrenheit(-40), -40);
  // PsychroLib's published 25°C / 80% example, independent of this code.
  close(m.dewPointF(25, 80), 21.309397163661785 * 1.8 + 32, 0.0001);
  close(m.dewPointF(-15, 100), 5); close(m.dewPointF(30, 100), 86);
  close(m.humidityRatio(25, 50), 0.009881043690749623, 1e-8);
  assert.equal(m.dewPointF(25, 0), null); assert.equal(m.dewPointF(null, 50), null);
  assert.equal(m.dewPointF(20, -1), null); assert.equal(m.dewPointF(20, 101), null);
  assert.equal(m.humidityRatio(25, 0), 0);
  // With only envelope UA=15,000 BTU/hr°F, these are hand calculations.
  const hot = m.simulateSchool([row(m.celsius(90), 0)], bare)[0];
  close(hot.sensibleCooling, -225000); close(hot.totalCooling, -225000); assert.equal(hot.heating, 0);
  const cold = m.simulateSchool([row(m.celsius(20), 0)], bare)[0];
  close(cold.heating, 750000); assert.equal(cold.sensibleCooling, 0);
  const neutral = m.simulateSchool([row(m.celsius(72), 0)], bare)[0];
  assert.equal(neutral.heating, 0); assert.equal(neutral.totalCooling, 0);
  const latent = m.simulateSchool([row(m.celsius(75), 50)], { ...bare, people: 1200, sensiblePerson: 0 })[0];
  close(latent.latentCooling, -186000); close(latent.totalCooling, -186000); close(latent.sensibleCooling, 0);
  const missing = m.simulateSchool([row(30, null), row(null, 50)], bare);
  assert.ok(missing[0].sensibleCooling < 0); assert.equal(missing[0].totalCooling, null);
  assert.equal(missing[1].sensibleCooling, null); assert.equal(missing[1].heating, null);
  const schedules = m.simulateSchool([
    row(20, 50, { hour: 6 }), row(20, 50, { hour: 7 }), row(20, 50, { hour: 17 }),
    row(20, 50, { day: 11 }), row(20, 50, { month: 7, day: 8 }),
  ], m.DEFAULT_SCHOOL);
  assert.deepEqual(schedules.map(r => r.occupants), [0, 1200, 0, 0, 120]);
  close(schedules[1].outdoorAirCfm, 35250); close(schedules[0].outdoorAirCfm, 5250);
  assert.equal(m.validateSchool({ ...bare, heatingF: 80 }), "Each heating setpoint must be lower than its cooling setpoint.");
  assert.ok(m.validateSchool({ ...bare, startHour: 20, endHour: 10 }));
  assert.ok(m.validateSchool({ ...bare, ceilingFt: NaN }));
  assert.ok(m.validateSchool({ ...bare, people: 0.5 }));
  // Verify UTC-derived weekdays don't depend on the host timezone.
  const tzBefore = process.env.TZ;
  process.env.TZ = "Pacific/Honolulu";
  const hawaii = m.simulateSchool([row(20)], m.DEFAULT_SCHOOL);
  process.env.TZ = "Pacific/Auckland";
  assert.deepEqual(m.simulateSchool([row(20)], m.DEFAULT_SCHOOL), hawaii);
  if (tzBefore === undefined) delete process.env.TZ; else process.env.TZ = tzBefore;
  const fixture = process.argv[2];
  if (fixture) {
    const raw = parseClimateCsv(readFileSync(fixture, "utf8"), 2025);
    const annual = m.simulateSchool(raw.rows, m.DEFAULT_SCHOOL);
    assert.equal(annual.length, 8760);
    for (const r of annual) {
      assert.ok(r.sensibleCooling <= 0 && r.totalCooling <= r.sensibleCooling && r.heating >= 0);
      assert.ok(!(r.heating > 0 && r.sensibleCooling < 0));
      assert.ok(r.dewPointF === null || r.dewPointF <= r.temperatureF + 1e-6);
      close(r.totalCooling, r.sensibleCooling + r.latentCooling);
    }
    const summary = m.summarizeLoads(annual);
    assert.equal(summary.daily.length, 365); assert.equal(summary.completeHours, 8760);
    const csv = parseCsv(m.schoolCsv(annual, m.DEFAULT_SCHOOL, 'Madison, "WI"', "UTC-6"));
    assert.equal(csv.length, 8763); assert.equal(csv[1][1], 'Madison, "WI"');
    assert.equal(csv[2][2], "Air_temperature_F"); assert.equal(csv[2][5], "Latent_cooling_BTU_hr");
    assert.equal(csv[3][0], "2025-01-01"); assert.equal(csv.at(-1)[1], "23:00");
    assert.ok(Number(csv[3][7]) >= 0);
    const changed = m.simulateSchool(raw.rows, { ...m.DEFAULT_SCHOOL, envelopeUa: 0.2 });
    assert.ok(m.summarizeLoads(changed).heating.value > summary.heating.value);
    console.log(JSON.stringify({ records: annual.length, peaks: { sensible: summary.sensible, total: summary.total, heating: summary.heating } }));
  }
  console.log("School model checks passed: psychrometrics, analytical loads, signs, moisture, schedule, missing data, validation, export, and recalculation.");
} finally { rmSync(temp, { recursive: true, force: true }); }
