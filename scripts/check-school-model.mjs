/**
 * OFFLINE VERIFICATION. Runs assertions against the actual source functions.
 * A failed assertion stops the command and points to the check that disagreed.
 * These checks are independent of a live provider connection. Read the handbook
 * for which engineering assumptions each check covers.
 */

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
  const bare = { ...m.DEFAULT_SCHOOL, thermostatDeadbandF: 0, people: 0, infiltrationAch: 0, ventilationArea: 0, ventilationPerson: 0, lightingW: 0, equipmentW: 0, windowPercent: 0, solarAbsorptance: 0 };
  // Independent heat balance at/beyond the default +/-2 F control edges.
  const banded = { ...bare, thermostatDeadbandF: 2 };
  assert.equal(m.DEFAULT_SCHOOL.thermostatDeadbandF, 2);
  const bandRows = m.simulateSchool([67, 68, 69, 76, 77, 78].map(f => row(m.celsius(f), 0)), banded);
  assert.deepEqual(bandRows.map(r => r.heatingSetpointF), [68, 68, 68, 68, 68, 68]);
  assert.ok(bandRows.every(r => r.coolingSetpointF === 77));
  close(bandRows[0].heating, m.envelopeUA(banded));
  assert.ok(bandRows.slice(1).every(r => r.heating === 0));
  assert.ok(bandRows.slice(0, 5).every(r => r.sensibleCooling === 0));
  close(bandRows[5].sensibleCooling, -m.envelopeUA(banded));
  // Signed balances retain the band when equipment adds supply-fan heat.
  close(bandRows[3].coolBalance, -m.envelopeUA(banded));
  const setback = m.simulateSchool([row(m.celsius(70), 0, { hour: 0 })], banded)[0];
  assert.equal(setback.heatingSetpointF, 58); assert.equal(setback.coolingSetpointF, 87);
  for (const mode of ['heating', 'cooling']) {
    const weather = [row(m.celsius(mode === 'heating' ? 0 : 100), 50)];
    assert.deepEqual(m.simulateSchool(weather, banded, null, mode), m.simulateSchool(weather, bare, null, mode));
  }
  const humid = m.simulateSchool([row(m.celsius(75), 0)], { ...banded, people: 10, sensiblePerson: 0 })[0];
  assert.equal(humid.sensibleCooling, 0); assert.ok(humid.latentCooling < 0);
  for (const thermostatDeadbandF of [-1, 6, NaN, Infinity, undefined]) assert.ok(m.validateSchool({ ...bare, thermostatDeadbandF }));
  const bandCsv = parseCsv(m.schoolCsv(bandRows, banded, 'Test', 'UTC'));
  const bandMetadata = Object.fromEntries(bandCsv[0].map((key, i) => [key, bandCsv[1][i]]));
  assert.equal(bandMetadata.Thermostat_deadband_F, '2');
  assert.match(bandMetadata.Thermostat_control, /does not resolve starts/);
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
  // Compare derived outdoor wet bulb to independent PsychroLib reference cases.
  const references=JSON.parse(readFileSync(new URL('fixtures/mixed-air-reference.json',import.meta.url),'utf8'));
  for(const reference of references.cases){
    const derived=m.simulateSchool([row(m.celsius(reference.dryF),reference.rh)],bare)[0];
    close(derived.wetBulbF,reference.wetF,.003);
  }
  close(m.wetBulbF(86,m.humidityRatio(30,100)),86,.00001);
  close(m.humidityRatio(25,50),0.009881043690749623,1e-8);
  for(const invalid of [[null,50],[20,-1],[20,101],[20,null]]) assert.equal(m.simulateSchool([row(...invalid)],bare)[0].wetBulbF,null);
  assert.ok(Number.isFinite(m.simulateSchool([row(25,0)],bare)[0].wetBulbF));
  assert.equal(m.humidityRatio(25, 0), 0);
  // Independently derive the geometry-based envelope UA on this branch.
  const footprint = bare.floorAreaFt2 / bare.stories;
  const length = Math.sqrt(footprint * bare.aspectRatio);
  const bareUa = bare.roofU * footprint + bare.wallU * 2 * (length + footprint / length) * bare.stories * bare.ceilingFt;
  const hot = m.simulateSchool([row(m.celsius(90), 0)], bare)[0];
  close(hot.sensibleCooling, -15 * bareUa); close(hot.totalCooling, -15 * bareUa); assert.equal(hot.heating, 0);
  const cold = m.simulateSchool([row(m.celsius(20), 0)], bare)[0];
  close(cold.heating, 50 * bareUa); assert.equal(cold.sensibleCooling, 0);
  // Independent area/geometry examples. Total floor area includes every floor;
  // floor count changes the footprint and exterior walls, not the total volume.
  const small = { ...bare, floorAreaFt2: 10_000, ceilingFt: 10, stories: 1 };
  const smallLength = Math.sqrt(10000 * small.aspectRatio);
  const smallUa = 10000 * small.roofU + 2 * (smallLength + 10000 / smallLength) * 10 * small.wallU;
  close(m.simulateSchool([row(m.celsius(90), 0)], small)[0].sensibleCooling, -15 * smallUa);
  close(m.simulateSchool([row(m.celsius(20), 0)], small)[0].heating, 50 * smallUa);
  const air = { ...small, people: 10, ventilationPerson: 10, ventilationArea: 0.1, infiltrationAch: 0.6 };
  const oneFloor = m.simulateSchool([row(20)], air)[0];
  const fourFloors = m.simulateSchool([row(20)], { ...air, stories: 4 })[0];
  close(oneFloor.infiltrationCfm, 1000); close(oneFloor.ventilationCfm, 1100);
  close(fourFloors.infiltrationCfm, 1000); close(fourFloors.ventilationCfm, 1100);
  const doubleArea = m.simulateSchool([row(20)], { ...air, floorAreaFt2: 20_000 })[0];
  close(doubleArea.infiltrationCfm, 2000); close(doubleArea.ventilationCfm, 2100);
  assert.equal(doubleArea.occupants, oneFloor.occupants);
  const gainInputs = { ...small, lightingW: 1, equipmentW: 2 };
  close(m.simulateSchool([row(m.celsius(75), 0)], gainInputs)[0].sensibleCooling, -30000 * m.BTU_PER_WH);
  close(m.simulateSchool([row(m.celsius(75), 0)], { ...gainInputs, floorAreaFt2: 20000 })[0].sensibleCooling, -60000 * m.BTU_PER_WH);
  const glazingFloors = m.simulateSchool([diffuse], { ...small, ...geometry, floorAreaFt2: 10000, stories: 4 }, site)[0];
  close(glazingFloors.windowSolarGain, glazing.windows * 2);
  const roofInputs = { ...small, windowPercent: 0, wallU: 0, roofU: 0.04, solarAbsorptance: 0.6, outdoorFilm: 3 };
  close(m.simulateSchool([diffuse], roofInputs, site)[0].opaqueSolarGain, roof.opaque);
  close(m.simulateSchool([diffuse], { ...roofInputs, stories: 4 }, site)[0].opaqueSolarGain, roof.opaque / 4);
  const exportInputs = { ...small, floorAreaFt2: 12345, stories: 3 };
  const areaCsv = parseCsv(m.schoolCsv([cold], exportInputs, "Test", "UTC"));
  const metadata = Object.fromEntries(areaCsv[0].map((key, i) => [key, areaCsv[1][i]]));
  assert.equal(metadata.Floor_area_ft2, "12345"); assert.equal(metadata.Number_of_floors, "3");
  assert.equal(metadata.Building_footprint_ft2, "4115"); assert.equal(metadata.Conditioned_volume_ft3, "123450");
  for (const floorAreaFt2 of [0, -1, NaN, Infinity, undefined, 10_000_001]) {
    assert.ok(m.validateSchool({ ...small, floorAreaFt2 }));
    assert.throws(() => m.simulateSchool([row(20)], { ...small, floorAreaFt2 }));
  }
  for (const stories of [0, -1, 1.5, NaN, 31]) assert.ok(m.validateSchool({ ...small, stories }));
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
      assert.ok(r.wetBulbF === null || r.wetBulbF <= r.temperatureF + 1e-6);
      close(r.totalCooling, r.sensibleCooling + r.latentCooling);
    }
    const summary = m.summarizeLoads(annual);
    assert.equal(summary.daily.length, 365); assert.equal(summary.completeHours, 8760);
    const csv = parseCsv(m.schoolCsv(annual, m.DEFAULT_SCHOOL, 'Madison, "WI"', "UTC-6"));
    assert.equal(csv.length, 8763); assert.equal(csv[1][1], 'Madison, "WI"');
    assert.equal(csv[2][2], "Air_temperature_F"); assert.equal(csv[2][5], "Latent_cooling_BTU_hr");
    assert.equal(csv[3][0], "2025-01-01"); assert.equal(csv.at(-1)[1], "23:00");
    assert.ok(Number(csv[3][7]) >= 0);
    const changed = m.simulateSchool(raw.rows, { ...m.DEFAULT_SCHOOL, roofU: 0.2, wallU: 0.2 }, solar.solarLocation(raw.metadata));
    assert.ok(m.summarizeLoads(changed).heating.value > summary.heating.value);
    console.log(JSON.stringify({ records: annual.length, peaks: { sensible: summary.sensible, total: summary.total, heating: summary.heating } }));
  }
  console.log("School model checks passed: psychrometrics, analytical loads, signs, moisture, schedule, missing data, validation, export, and recalculation.");
} finally { rmSync(temp, { recursive: true, force: true }); }
