import { STATES } from "@/lib/climate";

const DATASET_ROOT = "nrel-pds-building-stock/end-use-load-profiles-for-us-building-stock/2025/comstock_amy2018_release_3/timeseries_aggregates/by_county";
const S3_BASE = "https://oedi-data-lake.s3.amazonaws.com/";
const CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};
const BUILDING_TYPES = ["FullServiceRestaurant", "Grocery", "Hospital", "LargeHotel", "LargeOffice", "MediumOffice", "Outpatient", "PrimarySchool", "QuickServiceRestaurant", "RetailStandalone", "RetailStripmall", "SecondarySchool", "SmallHotel", "SmallOffice", "Warehouse"] as const;

type CountyGeography = { GEOID?: string; STATE?: string; COUNTY?: string; NAME?: string };
type GeocoderResponse = { result?: { geographies?: { Counties?: CountyGeography[] } } };

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function resolveCounty(latitude: number, longitude: number, state: string) {
  const params = new URLSearchParams({ x: String(longitude), y: String(latitude), benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json" });
  const response = await fetch(`${CENSUS_GEOCODER}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("The Census geocoder could not resolve this location.");
  const payload = await response.json() as GeocoderResponse;
  const county = payload.result?.geographies?.Counties?.[0];
  if (!county?.STATE || !county.COUNTY || !county.NAME || county.STATE !== STATE_FIPS[state]) return null;
  return { fips: `G${county.STATE}0${county.COUNTY}0`, name: county.NAME };
}

async function availableTypes(countyFips: string) {
  const prefix = `${DATASET_ROOT}/upgrade=0/county=${countyFips}/`;
  const params = new URLSearchParams({ "list-type": "2", prefix });
  const response = await fetch(`${S3_BASE}?${params}`, { headers: { Accept: "application/xml" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("OEDI could not list county aggregate files.");
  const xml = await response.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(match => match[1]);
  const available = new Set(keys.map(key => key.split("/").at(-1)?.toLowerCase()));
  return BUILDING_TYPES.filter(type => available.has(`up0-${countyFips.toLowerCase()}-${type.toLowerCase()}.csv`));
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const latitude = Number(query.get("latitude"));
  const longitude = Number(query.get("longitude"));
  const state = (query.get("state") || "").toUpperCase();
  const expectedCounty = query.get("county")?.trim() || "";
  const buildingType = query.get("buildingType") || "";
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Object.hasOwn(STATES, state) || expectedCounty.length > 100) {
    return errorResponse("A valid US place, state, and county are required.", 400);
  }
  if (buildingType && !(BUILDING_TYPES as readonly string[]).includes(buildingType)) return errorResponse("Choose a supported ComStock building type.", 400);

  try {
    const county = await resolveCounty(latitude, longitude, state);
    if (!county) return errorResponse("The selected place could not be resolved to a ComStock county in the selected state.", 404);
    const normalizeCounty = (value: string) => value.toLowerCase().replace(/\s+(county|parish|borough|census area|municipality)$/i, "").replace(/[^a-z0-9]/g, "");
    if (expectedCounty && normalizeCounty(expectedCounty) !== normalizeCounty(county.name)) {
      return errorResponse(`The selected place's county (${expectedCounty}) does not match the county at its coordinates (${county.name}). Please choose the correct location match.`, 409);
    }
    const types = await availableTypes(county.fips);
    if (!buildingType) {
      return Response.json({ county: county.name, countyFips: county.fips, buildingTypes: types }, { headers: { "Cache-Control": "public, max-age=86400" } });
    }
    if (!types.includes(buildingType as typeof BUILDING_TYPES[number])) return errorResponse(`${buildingType} aggregate data are not available for ${county.name}.`, 404);

    const key = `${DATASET_ROOT}/upgrade=0/county=${county.fips}/up0-${county.fips.toLowerCase()}-${buildingType.toLowerCase()}.csv`;
    const data = await fetch(`${S3_BASE}${key.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(60_000) });
    if (!data.ok || !data.body) return errorResponse("The selected ComStock county profile could not be downloaded from OEDI.", data.status === 404 ? 404 : 502);
    return new Response(data.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="comstock-${state}-${county.fips}-${buildingType.toLowerCase()}-2018.csv"`, "Cache-Control": "public, max-age=86400" } });
  } catch {
    return errorResponse("ComStock county data could not be reached. Please retry in a moment.", 502);
  }
}
