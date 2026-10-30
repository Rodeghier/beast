/**
 * SERVER PRICE AND EPA CONNECTION. Fetches electricity tariffs and state gas
 * prices, and resolves the bundled EPA region. Providers resolve independently
 * so one failed lookup does not erase the others. No equipment sizing is done here.
 */

import { env } from "cloudflare:workers";
import { STATES } from "@/lib/climate";
import egridData from "@/lib/data/egrid-2023.json";
import { ELECTRICITY_SOURCE, GAS_SOURCE, EMISSIONS_SOURCE, EPA_NATURAL_GAS, parseElectricTariffs, parseGasPrices, resolveEmissions, type ElectricityContext, type GasContext, type LocationEnergyContext } from "@/lib/location-energy";

/** Fixed upstreams, no redirects, no user-controlled URLs, no raw error bodies. */
async function providerJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(25000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 429 ? "rate_limit" : response.status === 401 || response.status === 403 ? "authorization" : "upstream");
  if (Number(response.headers.get("Content-Length")) > 5_000_000) throw new Error("oversized");
  const body = await response.text();
  if (body.length > 5_000_000) throw new Error("oversized");
  return JSON.parse(body);
}
const reason = (failure: unknown, provider: string): string => failure instanceof Error && failure.message === "authorization" ? `${provider} rejected the configured API key. The site owner must check the connection.` : failure instanceof Error && failure.message === "rate_limit" ? `${provider} reached its request limit. Try again later.` : `${provider} could not be retrieved. Try again later.`;

async function electricity(latitude: number, longitude: number, key: string | undefined): Promise<ElectricityContext> {
  if (!key) return { status: "missing_key", message: "Electricity tariff lookup requires an OpenEI/api.data.gov key configured for this service.", tariffs: [], sourceUrl: ELECTRICITY_SOURCE };
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL("https://api.openei.org/utility_rates");
  url.search = new URLSearchParams({ version: "8", format: "json", country: "USA", lat: String(latitude), lon: String(longitude), sector: "Commercial", approved: "true", effective_on_date: String(timestamp), detail: "full", limit: "100", api_key: key }).toString();
  const payload = await providerJson(url);
  const tariffs = parseElectricTariffs(payload, timestamp);
  const rawItems = payload && typeof payload === "object" && "items" in payload ? (payload as { items?: unknown }).items : null;
  if (!Array.isArray(rawItems)) throw new Error("upstream");
  const truncated = rawItems.length >= 100;
  return { status: "ok", message: tariffs.length ? `Commercial tariffs effective today near the selected city coordinates. Select the building's utility and eligible tariff; service type, voltage, demand and other conditions must be checked. ${truncated ? "Results are limited to 100 provider records; additional tariffs may exist. " : ""}The database is not a guarantee that a tariff is current or applies to this building.` : "OpenEI returned no current approved commercial tariffs for these coordinates. Check the utility's published tariff directly.", tariffs, sourceUrl: ELECTRICITY_SOURCE };
}

async function gas(state: string, key: string | undefined): Promise<GasContext> {
  if (!key) return { status: "missing_key", message: "Natural gas price lookup requires a separate EIA API key. EIA provides state commercial average delivered prices, not utility tariff structures.", prices: [], sourceUrl: GAS_SOURCE, state };
  const url = new URL("https://api.eia.gov/v2/natural-gas/pri/sum/data/");
  url.search = new URLSearchParams({ api_key: key, frequency: "monthly", "data[0]": "value", "facets[duoarea][]": `S${state}`, "facets[process][]": "PCS", "sort[0][column]": "period", "sort[0][direction]": "desc", length: "60" }).toString();
  const prices = parseGasPrices(await providerJson(url), state);
  const coverage = new Set(prices.map(price => Number(price.period.slice(5))));
  const missing = Array.from({ length: 12 }, (_, i) => i + 1).filter(month => !coverage.has(month));
  const coverageNote = missing.length ? ` Missing calendar months: ${missing.join(", ")}; EIA may withhold or omit prices.` : " All 12 calendar months are covered.";
  return { status: prices.length ? "ok" : "error", message: prices.length ? `Newest available price for each calendar month from the latest 60 EIA monthly records; source years may differ and are shown below.${coverageNote} State commercial average delivered prices ($/Mcf) include reported delivery, commodity, tax and other charges; they are not a utility tariff and should not have fixed charges added again. Actual gas tariff details require the local utility's published schedule.` : "EIA returned no valid commercial natural gas prices for this state.", prices, sourceUrl: GAS_SOURCE, state };
}

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const state = (p.get("state") || "").toUpperCase();
  const latText = p.get("latitude"), lonText = p.get("longitude");
  const latitude = Number(latText), longitude = Number(lonText);
  if (!latText?.trim() || !lonText?.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || !Object.hasOwn(STATES, state)) return Response.json({ error: "Provide valid coordinates and a US state." }, { status: 400 });
  const config = env as unknown as Record<string, string | undefined>;
  const openEiKey = config.OPENEI_API_KEY || process.env.OPENEI_API_KEY;
  const eiaKey = config.EIA_API_KEY || process.env.EIA_API_KEY;
  // Each provider resolves independently so a missing gas key never hides EPA data.
  const [electricResult, gasResult, emissionsResult] = await Promise.allSettled([
    electricity(latitude, longitude, openEiKey), gas(state, eiaKey),
    Promise.resolve().then(() => resolveEmissions(latitude, longitude, egridData)),
  ]);
  const result: LocationEnergyContext = {
    electricity: electricResult.status === "fulfilled" ? electricResult.value : { status: "error", message: reason(electricResult.reason, "OpenEI"), tariffs: [], sourceUrl: ELECTRICITY_SOURCE },
    gas: gasResult.status === "fulfilled" ? gasResult.value : { status: "error", message: reason(gasResult.reason, "EIA"), prices: [], sourceUrl: GAS_SOURCE, state },
    emissions: emissionsResult.status === "fulfilled" ? emissionsResult.value : { status: "error", message: "EPA subregion lookup could not be completed.", regions: [], utilities: [], method: "coordinates", naturalGas: EPA_NATURAL_GAS, sourceUrl: EMISSIONS_SOURCE },
    retrievedAt: new Date().toISOString(),
  };
  return Response.json(result, { headers: { "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
