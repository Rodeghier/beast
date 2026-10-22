import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// No network access or real credentials. Exercise upstream contracts and failure
// isolation with independent provider fixtures, plus the official EPA geometry.
const temp = mkdtempSync(join(tmpdir(), "location-energy-"));
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const emit = (name, source) => writeFileSync(join(temp, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const egrid = JSON.parse(read("lib/data/egrid-2023.json")), zip = JSON.parse(read("lib/data/egrid-zip-2023.json"));
emit("location-energy", read("lib/location-energy.ts").replace('import egridCo2e from "./data/egrid-co2e-2023.json";', `const egridCo2e = ${read("lib/data/egrid-co2e-2023.json")};`));
emit("climate", read("lib/climate.ts"));
emit("emissions", read("lib/emissions.ts"));
globalThis.__locationEnergyEnv = { NLR_API_KEY: "DO_NOT_TRANSMIT_THIS_SENTINEL" };
globalThis.__locationEnergyProcessEnv = {};
let route = read("app/api/location-energy/route.ts").replace('import { env } from "cloudflare:workers";', "const env = globalThis.__locationEnergyEnv;").replaceAll("process.env", "globalThis.__locationEnergyProcessEnv").replace('from "@/lib/climate"', 'from "./climate.mjs"').replace('from "@/lib/location-energy"', 'from "./location-energy.mjs"');
route = route.replace(/import (\w+) from "@\/lib\/(data\/[^"\n]+\.json)";/g, (_, name, path) => `const ${name} = ${read(`lib/${path}`)};`);
emit("route", route);
const fetchOriginal = globalThis.fetch;
try {
  const m = await import(pathToFileURL(join(temp, "location-energy.mjs")).href);
  const { GET } = await import(pathToFileURL(join(temp, "route.mjs")).href);
  const { totalCo2e } = await import(pathToFileURL(join(temp, "emissions.mjs")).href);
  const region = { kgCo2ePerKwh: 0.5 };
  const result = { error: null, summary: { completeHours: 8760, electricity: 1000 } };
  assert.equal(totalCo2e(result, region), 500);
  assert.equal(totalCo2e({ ...result, error: "Awaiting curves" }, region), null);
  assert.equal(totalCo2e(result, null), null);
  assert.equal(totalCo2e({ ...result, summary: { completeHours: 0, electricity: 0 } }, region), null);
  for (const v of [null, undefined, "", "  ", true, false, {}, [], "Infinity", NaN]) assert.equal(m.finiteNumber(v), null);
  assert.equal(m.finiteNumber("0"), 0);
  assert.equal(m.publicUrl("javascript:alert(1)"), null);
  assert.equal(m.publicUrl("https://example.com/tariff?api_key=secret"), null);
  assert.equal(m.publicUrl("https://user:secret@example.com/tariff"), null);
  const schedule = Array.from({ length: 12 }, () => Array(24).fill(0));
  const tariff = { label: "fixture", name: "General Service", utility: "Fixture Utility", sector: "Commercial", servicetype: "Bundled", startdate: 1, approved: true, energyratestructure: [[{ max: 1000, rate: "0.12", adj: "0.01", unit: "kWh" }, { rate: "0.10", unit: "kWh" }]], energyweekdayschedule: schedule, energyweekendschedule: schedule, flatdemandstructure: [[{ rate: 10 }]], flatdemandmonths: Array(12).fill(0), flatdemandunit: "kW", fixedchargefirstmeter: 25, fixedchargeunits: "$/month", mincharge: 0, minchargeunits: "$/month", source: "https://utility.example/tariff.pdf", uri: "https://apps.openei.org/USURDB/rate/view/fixture", peakkwcapacitymin: 20 };
  const parsed = m.parseElectricTariffs({ items: [tariff, tariff, { ...tariff, label: "expired", enddate: 2 }, { ...tariff, label: "future", startdate: 500 }, { ...tariff, label: "residential", sector: "Residential" }] }, 100);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].energyRates[0][0], { max: 1000, rate: .12, adjustment: .01, sell: null, unit: "kWh" });
  assert.equal(parsed[0].energyRates[0][1].max, null);
  assert.equal(parsed[0].eligibility.minKw, 20);
  assert.equal(parsed[0].minimumCharge, 0);
  assert.deepEqual(parsed[0].unsupportedClauses, []);
  assert.equal(parsed[0].fixedCharge, 25);
  const bad = m.parseElectricTariffs({ items: [{ ...tariff, energyweekendschedule: [[0]], lookbackPercent: 80, demandreactivepowercharge: .2, demandrateunit: "kVA", energyratestructure: [[{ rate: "bad", unit: "kWh/kW" }]] }] }, 100)[0];
  assert.equal(bad.energyWeekendSchedule, null);
  assert.equal(bad.energyRates[0][0].rate, null);
  assert.ok(bad.unsupportedClauses.includes("Demand ratchet / historical lookback"));
  assert.ok(bad.unsupportedClauses.includes("Missing or invalid period schedule"));
  assert.ok(bad.unsupportedClauses.includes("Missing tier price"));
  assert.equal(m.parseSchedule(schedule, 0), null);
  const outOfRange = structuredClone(schedule); outOfRange[0][1] = 1;
  assert.equal(m.parseSchedule(outOfRange, 1), null);
  const negative = m.parseElectricTariffs({ items: [{ ...tariff, energyratestructure: [[{ rate: -.05, adj: 0 }]] }] }, 100)[0];
  assert.equal(negative.energyRates[0][0].rate, -.05); // Credits are finite prices, not missing data.

  const gasRow = (period, value, rest = {}) => ({ period, value, duoarea: "SWI", process: "PCS", units: "$/MCF", ...rest });
  const gasPayload = { response: { data: [gasRow("2026-02", "8.5"), gasRow("2026-01", "7.5"), gasRow("2026-03", "NA"), gasRow("2026-04", null), gasRow("2026-05", 99, { duoarea: "SMN" }), gasRow("2026-06", 99, { units: "$/therm" }), gasRow("2026-07", 99, { process: "PR1" }), gasRow("2026-13", 99)] } };
  assert.deepEqual(m.parseGasPrices(gasPayload, "WI"), [{ period: "2026-02", dollarsPerMcf: 8.5 }, { period: "2026-01", dollarsPerMcf: 7.5 }]);
  const history = Array.from({ length: 36 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 11 - i, 1));
    const period = d.toISOString().slice(0, 7);
    return gasRow(period, period === "2026-06" || period === "2025-06" ? "W" : 10 + i);
  });
  const covered = m.parseGasPrices({ response: { data: history.reverse() } }, "WI");
  assert.equal(covered.length, 12);
  assert.equal(new Set(covered.map(p => p.period.slice(5))).size, 12);
  assert.deepEqual(covered.find(p => p.period.endsWith("-06")), { period: "2024-06", dollarsPerMcf: 40 });
  assert.equal(covered.find(p => p.period.endsWith("-12")).period, "2026-12");

  // Polygon holes and disjoint islands must not resolve as land in a region.
  const polygon = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]] };
  assert.equal(m.pointInGeometry(1, 1, polygon), true);
  assert.equal(m.pointInGeometry(3, 3, polygon), false);
  assert.equal(m.pointInGeometry(1, 11, polygon), false);
  const madison = m.resolveEmissions(43.0748, -89.3848, "WI", "53703", egrid, zip);
  assert.equal(madison.status, "ok");
  assert.deepEqual(madison.regions.map(r => r.code), ["MROE"]);
  assert.equal(madison.utilities[0].id, "11479");
  assert.equal(madison.regions[0].kgCo2PerKwh, 1397.313 * .45359237 / 1000);
  assert.equal(madison.regions[0].year, 2023);
  const coordinates = m.resolveEmissions(43.0748, -89.3848, "WI", null, egrid, zip);
  assert.ok(coordinates.regions.some(r => r.code === "MROE"));
  assert.equal(coordinates.method, "coordinates");
  assert.equal(m.resolveEmissions(43, -89, "MN", "53703", egrid, zip).status, "error");
  const overlappingZip = { utilities: [["1", "One", "MROE", "WI"], ["2", "Two", "MROW", "WI"]], zips: { "11111": [0, 1] } };
  const overlap = m.resolveEmissions(43, -89, "WI", "11111", egrid, overlappingZip);
  assert.equal(overlap.regions.length, 2);
  assert.equal(overlap.utilities.length, 2);
  assert.match(overlap.message, /Multiple subregions/);
  assert.equal(m.resolveEmissions(0, 0, "WI", null, egrid, zip).status, "error");
  assert.equal(egrid.provenance.dataYear, 2023);
  assert.equal(egrid.regions.length, 27);

  let calls = [];
  const request = (query = "latitude=43.0748&longitude=-89.3848&state=WI&zip=53703") => new Request(`https://site.example/api/location-energy?${query}`);
  globalThis.fetch = async () => { throw new Error("No network calls expected without provider keys"); };
  const missing = await (await GET(request())).json();
  assert.equal(missing.electricity.status, "missing_key");
  assert.equal(missing.gas.status, "missing_key");
  assert.equal(missing.emissions.status, "ok");
  assert.ok(!JSON.stringify(missing).includes("DO_NOT_TRANSMIT_THIS_SENTINEL"));
  assert.equal((await GET(request("latitude=&longitude=-89&state=WI"))).status, 400);
  assert.equal((await GET(request("latitude=43&longitude=-89&state=ZZ"))).status, 400);
  assert.equal((await GET(request("latitude=43&longitude=-89&state=WI&zip=53703-1234"))).status, 400);

  globalThis.__locationEnergyEnv.OPENEI_API_KEY = "fixture-openei-key";
  globalThis.__locationEnergyEnv.EIA_API_KEY = "fixture-eia-key";
  globalThis.fetch = async (url, options) => {
    const u = new URL(url); calls.push(u.hostname);
    assert.equal(options.redirect, "manual");
    assert.equal(u.protocol, "https:");
    if (u.hostname === "api.openei.org") {
      assert.equal(u.searchParams.get("api_key"), "fixture-openei-key");
      assert.equal(u.searchParams.get("sector"), "Commercial");
      return new Response("upstream failure with an imaginary sensitive URL", { status: 500 });
    }
    assert.equal(u.hostname, "api.eia.gov");
    assert.equal(u.searchParams.get("api_key"), "fixture-eia-key");
    assert.equal(u.searchParams.get("facets[duoarea][]"), "SWI");
    assert.equal(u.searchParams.get("length"), "60");
    return Response.json(gasPayload);
  };
  const partial = await (await GET(request())).json();
  assert.deepEqual(calls.sort(), ["api.eia.gov", "api.openei.org"]);
  assert.equal(partial.electricity.status, "error");
  assert.equal(partial.gas.status, "ok");
  assert.equal(partial.emissions.status, "ok");
  assert.equal(partial.emissions.naturalGas.kgCo2ePerTherm, 5.31145);
  const co2eRates = JSON.parse(read("lib/data/egrid-co2e-2023.json")).rates;
  for (const region of egrid.regions) {
    assert.ok(co2eRates[region.code] > region.lbCo2PerMwh, `Missing CO2e or wrong factor for ${region.code}`);
  }
  for (const region of partial.emissions.regions) {
    assert.equal(region.kgCo2ePerKwh, co2eRates[region.code] * .45359237 / 1000);
  }
  assert.ok(!JSON.stringify(partial).includes("imaginary sensitive URL"));
  assert.ok(!JSON.stringify(partial).includes("fixture-eia-key"));
  // Switching location must change both upstream requests and emissions geometry.
  globalThis.fetch = async url => {
    const u = new URL(url);
    if (u.hostname === "api.openei.org") {
      assert.equal(u.searchParams.get("lat"), "44.9778");
      assert.equal(u.searchParams.get("lon"), "-93.265");
      return Response.json({ items: [tariff] });
    }
    assert.equal(u.searchParams.get("facets[duoarea][]"), "SMN");
    return Response.json({ response: { data: [gasRow("2026-02", 12, { duoarea: "SMN" })] } });
  };
  const moved = await (await GET(request("latitude=44.9778&longitude=-93.265&state=MN"))).json();
  assert.equal(moved.gas.state, "MN");
  assert.equal(moved.gas.prices[0].dollarsPerMcf, 12);
  assert.ok(moved.emissions.regions.some(r => r.code === "MROW"));
  globalThis.fetch = async url => new URL(url).hostname === "api.openei.org" ? Response.json({ items: [tariff] }) : new Response("SECRET", { status: 403 });
  const reverse = await (await GET(request())).json();
  assert.equal(reverse.electricity.status, "ok");
  assert.equal(reverse.electricity.tariffs.length, 1);
  assert.equal(reverse.gas.status, "error");
  assert.match(reverse.gas.message, /API key/);
  assert.ok(!JSON.stringify(reverse).includes("SECRET"));
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: "https://untrusted.example/collect" } });
  const redirects = await (await GET(request())).json();
  assert.equal(redirects.electricity.status, "error");
  assert.equal(redirects.gas.status, "error");
  assert.equal(redirects.emissions.status, "ok");
  console.log("Location energy checks passed: tariff schedules and eligibility, safe parsing, gas units, EPA ZIP/geometry/overlap, missing keys, fixed upstreams and independent failures.");
} finally {
  globalThis.fetch = fetchOriginal;
  delete globalThis.__locationEnergyEnv;
  delete globalThis.__locationEnergyProcessEnv;
  rmSync(temp, { recursive: true, force: true });
}
