import { STATES } from "@/lib/climate";
import { parseCsv } from "@/lib/csv";

const DATASET_ROOT = "nrel-pds-building-stock/end-use-load-profiles-for-us-building-stock/2025/comstock_amy2018_release_3/timeseries_aggregates/by_county";
const S3_BASE = "https://oedi-data-lake.s3.amazonaws.com/";
const CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};
const BUILDING_TYPES = ["FullServiceRestaurant", "Grocery", "Hospital", "LargeHotel", "LargeOffice", "MediumOffice", "Outpatient", "PrimarySchool", "QuickServiceRestaurant", "RetailStandalone", "RetailStripmall", "SecondarySchool", "SmallHotel", "SmallOffice", "Warehouse"] as const;
const METADATA_ROOT = "nrel-pds-building-stock/end-use-load-profiles-for-us-building-stock/2025/comstock_amy2018_release_3/metadata_and_annual_results_aggregates/by_state_and_county/full/csv";
const CHARACTERISTICS_CACHE = new Map<string, { expires: number; values: Record<string, { assumptions: Record<string, number>; representedWeight: number }> }>();

type CountyGeography = { GEOID?: string; STATE?: string; COUNTY?: string; NAME?: string };
type GeocoderResponse = { result?: { geographies?: { Counties?: CountyGeography[] } } };

const META_FIELDS = {
  type: "in.comstock_building_type", weight: "weight", area: "in.sqft..ft2",
  weekdayStart: "in.weekday_opening_time..hr", weekdayHours: "in.weekday_operating_hours..hr",
  heatingSetpoint: "in.tstat_htg_sp_f..f", heatingDelta: "in.tstat_htg_delta_f..delta_f",
  coolingSetpoint: "in.tstat_clg_sp_f..f", coolingDelta: "in.tstat_clg_delta_f..delta_f",
  stories: "in.number_of_stories", aspect: "in.aspect_ratio", rotation: "in.rotation..degrees",
  windowRatio: "out.params.window_to_wall_ratio", shgc: "out.params.average_window_shgc",
  roofU: "out.params.average_roof_u_value..btu_per_ft2_f_hr", wallU: "out.params.average_wall_u_value..btu_per_ft2_f_hr",
  windowU: "out.params.average_window_u_value..btu_per_ft2_f_hr", roofAbsorptance: "out.params.average_roof_absorptance",
  roofArea: "out.params.ext_roof_area..m2", wallArea: "out.params.ext_wall_area..m2", windowArea: "out.params.ext_window_area..m2",
  peopleDensity: "out.params.occupant_density_ppl_per_m_2..people_per_m2",
} as const;

type WeightedValue = { sum: number; weight: number };

async function readWeightedCharacteristics(state: string, countyFips: string) {
  const cached = CHARACTERISTICS_CACHE.get(countyFips);
  if (cached && cached.expires > Date.now()) return cached.values;
  const key = `${METADATA_ROOT}/state=${state}/county=${countyFips}/${state}_${countyFips}_upgrade0_agg.csv.gz`;
  const response = await fetch(`${S3_BASE}${key.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error("OEDI county building characteristics are unavailable.");

  // OEDI publishes this object as a gzip-compressed tar archive containing one CSV.
  const reader = response.body.pipeThrough(new DecompressionStream("gzip")).getReader();
  let chunk = new Uint8Array(0), offset = 0;
  async function readBytes(length: number) {
    const output = new Uint8Array(length); let written = 0;
    while (written < length) {
      if (offset >= chunk.length) { const next = await reader.read(); if (next.done) throw new Error("The OEDI metadata archive is incomplete."); chunk = next.value; offset = 0; }
      const count = Math.min(length - written, chunk.length - offset);
      output.set(chunk.subarray(offset, offset + count), written); offset += count; written += count;
    }
    return output;
  }
  const tarHeader = await readBytes(512);
  const csvSize = Number.parseInt(new TextDecoder().decode(tarHeader.subarray(124, 136)).replace(/\0/g, "").trim(), 8);
  if (!Number.isFinite(csvSize) || csvSize <= 0) throw new Error("The OEDI metadata archive has an unexpected layout.");

  const results = new Map<string, { sums: Map<string, WeightedValue>; people: WeightedValue; envelope: WeightedValue; rotationSin: number; rotationCos: number; representedWeight: number }>();
  const decoder = new TextDecoder(); let pending = "", header: string[] | null = null;
  let indexes: Partial<Record<keyof typeof META_FIELDS, number>> = {};
  let remaining = csvSize;
  const parseLine = (line: string) => {
    if (!line) return;
    const cells = parseCsv(line)[0]; if (!cells) return;
    if (!header) {
      header = cells;
      indexes = Object.fromEntries((Object.keys(META_FIELDS) as (keyof typeof META_FIELDS)[]).map(name => [name, header!.indexOf(META_FIELDS[name])]));
      return;
    }
    const value = (name: keyof typeof META_FIELDS) => Number(cells[indexes[name] ?? -1]);
    const type = cells[indexes.type ?? -1];
    const weight = value("weight"), area = value("area");
    if (!type || !Number.isFinite(weight) || weight <= 0 || !Number.isFinite(area) || area <= 0) return;
    let group = results.get(type);
    if (!group) { group = { sums: new Map(), people: { sum: 0, weight: 0 }, envelope: { sum: 0, weight: 0 }, rotationSin: 0, rotationCos: 0, representedWeight: 0 }; results.set(type, group); }
    group.representedWeight += weight;
    for (const field of Object.keys(META_FIELDS) as (keyof typeof META_FIELDS)[]) {
      if (["type", "weight", "rotation", "peopleDensity", "roofArea", "wallArea", "windowArea", "windowU"].includes(field)) continue;
      const number = value(field);
      if (!Number.isFinite(number) || number === 999) continue;
      const sum = group.sums.get(field) ?? { sum: 0, weight: 0 };
      sum.sum += number * weight; sum.weight += weight; group.sums.set(field, sum);
    }
    const rotation = value("rotation");
    if (Number.isFinite(rotation)) { group.rotationSin += Math.sin(rotation * Math.PI / 180) * weight; group.rotationCos += Math.cos(rotation * Math.PI / 180) * weight; }
    const density = value("peopleDensity");
    if (Number.isFinite(density)) { group.people.sum += density * area / 10.7639 * weight; group.people.weight += weight; }
    const roofArea = value("roofArea"), wallArea = value("wallArea"), windowArea = value("windowArea");
    const roofU = value("roofU"), wallU = value("wallU"), windowU = value("windowU");
    if ([roofArea, wallArea, windowArea, roofU, wallU, windowU].every(Number.isFinite)) {
      const uaPerArea = (roofArea * roofU + Math.max(0, wallArea - windowArea) * wallU + windowArea * windowU) * 10.7639 / area;
      group.envelope.sum += uaPerArea * weight; group.envelope.weight += weight;
    }
  };
  while (remaining > 0) {
    if (offset >= chunk.length) { const next = await reader.read(); if (next.done) break; chunk = next.value; offset = 0; }
    const count = Math.min(remaining, chunk.length - offset);
    pending += decoder.decode(chunk.subarray(offset, offset + count), { stream: true }); offset += count; remaining -= count;
    const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ""; lines.forEach(parseLine);
  }
  pending += decoder.decode(); if (pending) parseLine(pending);
  await reader.cancel();

  const toMean = (group: NonNullable<ReturnType<typeof results.get>>, field: keyof typeof META_FIELDS) => {
    const found = group.sums.get(field); return found && found.weight ? found.sum / found.weight : undefined;
  };
  const values: Record<string, { assumptions: Record<string, number>; representedWeight: number }> = {};
  for (const [type, group] of results) {
    const assumptions: Record<string, number> = {};
    const set = (target: string, field: keyof typeof META_FIELDS, transform: (v: number) => number = v => v) => { const mean = toMean(group, field); if (mean !== undefined && Number.isFinite(transform(mean))) assumptions[target] = transform(mean); };
    set("floorArea", "area", Math.round); set("startHour", "weekdayStart", Math.round); set("endHour", "weekdayHours", v => Math.round((toMean(group, "weekdayStart") ?? 7) + v));
    set("heatingF", "heatingSetpoint"); set("setbackHeatingF", "heatingDelta", v => (toMean(group, "heatingSetpoint") ?? 70) - v);
    set("coolingF", "coolingSetpoint"); set("setbackCoolingF", "coolingDelta", v => (toMean(group, "coolingSetpoint") ?? 75) + v);
    set("stories", "stories", Math.round); set("aspectRatio", "aspect", v => 1 / v); set("windowPercent", "windowRatio", v => v * 100); set("shgc", "shgc");
    set("roofU", "roofU"); set("wallU", "wallU"); set("solarAbsorptance", "roofAbsorptance");
    if (group.people.weight) assumptions.people = Math.round(group.people.sum / group.people.weight);
    if (group.envelope.weight) assumptions.envelopeUa = group.envelope.sum / group.envelope.weight;
    if (Math.hypot(group.rotationSin, group.rotationCos) > 0) assumptions.rotationDeg = (Math.atan2(group.rotationSin, group.rotationCos) * 180 / Math.PI + 360) % 360;
    values[type] = { assumptions, representedWeight: group.representedWeight };
  }
  CHARACTERISTICS_CACHE.set(countyFips, { values, expires: Date.now() + 86_400_000 });
  return values;
}

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

    if (query.get("characteristics") === "true") {
      const byType = await readWeightedCharacteristics(state, county.fips);
      const characteristic = byType[buildingType];
      if (!characteristic) return errorResponse(`Building characteristics are not available for ${buildingType} in ${county.name}.`, 404);
      return Response.json({ ...characteristic, county: county.name, countyFips: county.fips, buildingType }, { headers: { "Cache-Control": "public, max-age=86400" } });
    }

    const key = `${DATASET_ROOT}/upgrade=0/county=${county.fips}/up0-${county.fips.toLowerCase()}-${buildingType.toLowerCase()}.csv`;
    const data = await fetch(`${S3_BASE}${key.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(60_000) });
    if (!data.ok || !data.body) return errorResponse("The selected ComStock county profile could not be downloaded from OEDI.", data.status === 404 ? 404 : 502);
    return new Response(data.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="comstock-${state}-${county.fips}-${buildingType.toLowerCase()}-2018.csv"`, "Cache-Control": "public, max-age=86400" } });
  } catch {
    return errorResponse("ComStock county data could not be reached. Please retry in a moment.", 502);
  }
}
