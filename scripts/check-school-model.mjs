import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Exercise the actual TypeScript implementation without another dependency.
const temp = mkdtempSync(join(tmpdir(), "school-model-"));
async function moduleFrom(file) {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace('from "./solar"', 'from "./solar.mjs"'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const target = join(temp, file.split("/").pop().replace(/\.ts$/, ".mjs"));
  const { writeFileSync } = await import("node:fs"); writeFileSync(target, output);
  return import(pathToFileURL(target).href);
}
try {
  const solar = await moduleFrom("lib/solar.ts");
  const m = await moduleFrom("lib/school.ts");
  const { parseClimateCsv, parseCsv } = await moduleFrom("lib/csv.ts");
  const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
  const row = (temperature, humidity = 50, rest = {}) => ({ year: 2025, month: 1, day: 7, hour: 12, minute: 0, temperature, humidity, dhi: 0, dni: 0, ghi: 0, ...rest });
  const bare = { ...m.DEFAULT_SCHOOL, people: 0, infiltrationAch: 0, ventilationArea: 0, ventilationPerson: 0, lightingW: 0, equipmentW: 0, windowPercent: 0, solarAbsorptance: 0 };
  // Independent radiation geometry and hand-computed glazing/sol-air examples.
  const site = { latitude: 0, longitude: 0, utcOffset: 0 };
  const southSun = { east: 0, north: -0.6, up: 0.8 };
  close(solar.wallIrradiance(100, 800, 740, 0.2, 180, southSun), 480 + 50 + 74);
  close(solar.wallIrradiance(100, 800, 740, 0.2, 0, southSun), 50 + 74);
  close(solar.wallIrradiance(100, 800, 740, 0.2, 180, { ...southSun, up: -0.1 }), 124);
  const sun = solar.sunVector(row(20, 50, { month: 3, day: 20, hour: 11 }), site);
  close(sun.east ** 2 + sun.north ** 2 + sun.up ** 2, 1);
  assert.ok(sun.up > 0.98 && sun.east > 0);
  assert.ok(solar.sunVector(row(20, 50, { hour: 0 }), site).up < 0);
  const diffuse = row(20, 50, { dhi: 100, dni: 0, ghi: 100 });
  const geometry = { ...m.DEFAULT_SCHOOL, stories: 1, aspectRatio: 1, ceilingFt: 10, windowPercent: 20, shgc: 0.5, shadeFactor: 1, roofU: 0, wallU: 0, groundReflectance: 0 };
  const glazing = solar.solarGains(diffuse, geometry, 10000, site);
  close(glazing.windows, 4 * 100 * 10 * 0.2 * 0.5 * 50 * 0.316998331);
  close(glazing.total, glazing.windows);
  close(solar.solarGains(diffuse, { ...geometry, shadeFactor: 0.4 }, 10000, site).total, glazing.total * 0.4);
  const roof = solar.solarGains(diffuse, { ...geometry, windowPercent: 0, roofU: 0.04, solarAbsorptance: 0.6, outdoorFilm: 3 }, 10000, site);
  close(roof.opaque, 10000 * 0.04 * 0.6 / 3 * 100 * 0.316998331);
  close(solar.solarGains(diffuse, { ...geometry, rotationDeg: 90 }, 10000, site).total, glazing.total);
  assert.equal(solar.solarGains(row(20), geometry, 10000).total, 0);
  assert.equal(solar.solarGains(diffuse, geometry, 10000).total, null);
  assert.equal(solar.solarGains({ ...diffuse, ghi: null }, geometry, 10000, site).total, null);
  assert.equal(solar.solarLocation({ Latitude: "", Longitude: "0", "Time Zone": "0" }), null);
  assert.deepEqual(solar.solarLocation({ Latitude: "43", Longitude: "-89", "Local Time Zone": "-6" }), { latitude: 43, longitude: -89, utcOffset: -6 });
  const withSolar = m.simulateSchool([diffuse], { ...bare, ...geometry, heatingF: 60, coolingF: 65 }, site)[0];
  const withoutSolar = m.simulateSchool([row(20)], { ...bare, ...geometry, heatingF: 60, coolingF: 65 }, site)[0];
  close(withSolar.sensibleCooling - withoutSolar.sensibleCooling, -withSolar.solarGain);
  assert.equal(m.simulateSchool([{ ...diffuse, dni: null }], bare, site)[0].heating, null);
  const csvHead = "Year,Month,Day,Hour,Minute,Temperature,Relative Humidity,DHI,DNI,GHI\n";
  assert.deepEqual(parseClimateCsv(csvHead + "2025,1,1,0,0,20,50,100,800,740", 2025).rows[0], row(20, 50, { day: 1, hour: 0, dhi: 100, dni: 800, ghi: 740 }));
  assert.equal(parseClimateCsv(csvHead + "2025,1,1,0,0,20,50,100,-999,740", 2025).rows[0].dni, null);
  assert.throws(() => parseClimateCsv("DHI Units\nkWh/m2\n" + csvHead + "2025,1,1,0,0,20,50,1,1,1", 2025), /Unsupported DHI Units/);
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
    const annual = m.simulateSchool(raw.rows, m.DEFAULT_SCHOOL, solar.solarLocation(raw.metadata));
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
    const changed = m.simulateSchool(raw.rows, { ...m.DEFAULT_SCHOOL, envelopeUa: 0.2 }, solar.solarLocation(raw.metadata));
    assert.ok(m.summarizeLoads(changed).heating.value > summary.heating.value);
    console.log(JSON.stringify({ records: annual.length, peaks: { sensible: summary.sensible, total: summary.total, heating: summary.heating } }));
  }
  console.log("School model checks passed: psychrometrics, analytical loads, signs, moisture, schedule, missing data, validation, export, and recalculation.");
} finally { rmSync(temp, { recursive: true, force: true }); }
