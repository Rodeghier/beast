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
const CHARACTERISTICS_CACHE = new Map<string, { expires: number; values: Record<string, { assumptions: Record<string, number> }> }>();

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
  roofAbsorptance: "out.params.average_roof_absorptance",
  peopleDensity: "out.params.occupant_density_ppl_per_m_2..people_per_m2",
} as const;

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

  const results = new Map<string, { sums: Map<string, { sum: number; weight: number }>; peopleSum: number; peopleWeight: number; rotationSin: number; rotationCos: number; representedWeight: number }>();
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
    const weight = value("weight");
    if (!type || !Number.isFinite(weight) || weight <= 0 || !Number.isFinite(value("area")) || value("area") <= 0) return;
    let group = results.get(type);
    if (!group) { group = { sums: new Map(), peopleSum: 0, peopleWeight: 0, rotationSin: 0, rotationCos: 0, representedWeight: 0 }; results.set(type, group); }
    group.representedWeight += weight;
    for (const field of Object.keys(META_FIELDS) as (keyof typeof META_FIELDS)[]) {
      if (["type", "weight", "peopleDensity", "rotation"].includes(field)) continue;
      const number = value(field);
      if (!Number.isFinite(number) || number === 999) continue;
      const sum = group.sums.get(field) ?? { sum: 0, weight: 0 };
      sum.sum += number * weight; sum.weight += weight; group.sums.set(field, sum);
    }
    const density = value("peopleDensity");
    if (Number.isFinite(density)) { group.peopleSum += density * value("area") / 10.7639 * weight; group.peopleWeight += weight; }
    const rotation = value("rotation");
    if (Number.isFinite(rotation)) { group.rotationSin += Math.sin(rotation * Math.PI / 180) * weight; group.rotationCos += Math.cos(rotation * Math.PI / 180) * weight; }
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
  const values: Record<string, { assumptions: Record<string, number> }> = {};
  for (const [type, group] of results) {
    const assumptions: Record<string, number> = {};
    const set = (target: string, field: keyof typeof META_FIELDS, transform: (v: number) => number = v => v) => { const mean = toMean(group, field); if (mean !== undefined && Number.isFinite(transform(mean))) assumptions[target] = transform(mean); };
    set("floorAreaFt2", "area", Math.round);
    const weekdayStart = toMean(group, "weekdayStart"), weekdayHours = toMean(group, "weekdayHours");
    if (weekdayStart !== undefined && weekdayHours !== undefined) {
      assumptions.startHour = Math.round(weekdayStart); assumptions.endHour = Math.round(weekdayStart + weekdayHours);
    }
    if (group.peopleWeight) assumptions.people = Math.round(group.peopleSum / group.peopleWeight);
    if (Math.hypot(group.rotationSin, group.rotationCos) > 0) assumptions.rotationDeg = (Math.atan2(group.rotationSin, group.rotationCos) * 180 / Math.PI + 360) % 360;
    const heatingSetpoint = toMean(group, "heatingSetpoint"), heatingDelta = toMean(group, "heatingDelta");
    if (heatingSetpoint !== undefined) assumptions.heatingF = heatingSetpoint;
    if (heatingSetpoint !== undefined && heatingDelta !== undefined) assumptions.setbackHeatingF = heatingSetpoint - heatingDelta;
    const coolingSetpoint = toMean(group, "coolingSetpoint"), coolingDelta = toMean(group, "coolingDelta");
    if (coolingSetpoint !== undefined) assumptions.coolingF = coolingSetpoint;
    if (coolingSetpoint !== undefined && coolingDelta !== undefined) assumptions.setbackCoolingF = coolingSetpoint + coolingDelta;
    set("stories", "stories", Math.round); set("aspectRatio", "aspect", v => 1 / v); set("windowPercent", "windowRatio", v => v * 100); set("shgc", "shgc");
    set("roofU", "roofU"); set("wallU", "wallU"); set("roofSolarAbsorptance", "roofAbsorptance");
    // Only send fields that exist in SchoolAssumptions and pass its input bounds.
    for (const key of Object.keys(assumptions)) {
      const value = assumptions[key];
      const bounds: Record<string, [number, number]> = {
        floorAreaFt2: [1, 10_000_000], startHour: [0, 23], endHour: [1, 24], people: [0, 10_000], rotationDeg: [0, 360],
        heatingF: [40, 85], setbackHeatingF: [35, 85], coolingF: [60, 100], setbackCoolingF: [60, 110],
        stories: [1, 30], aspectRatio: [0.2, 5], windowPercent: [0, 95], shgc: [0, 1], roofU: [0, 1], wallU: [0, 1], roofSolarAbsorptance: [0, 1],
      };
      const range = bounds[key];
      if (!range || !Number.isFinite(value) || value < range[0] || value > range[1]) delete assumptions[key];
    }
    if (assumptions.startHour === undefined || assumptions.endHour === undefined || assumptions.startHour >= assumptions.endHour) {
      delete assumptions.startHour; delete assumptions.endHour;
    }
    if (assumptions.heatingF !== undefined && assumptions.coolingF !== undefined && assumptions.heatingF >= assumptions.coolingF) {
      delete assumptions.heatingF; delete assumptions.coolingF; delete assumptions.setbackHeatingF; delete assumptions.setbackCoolingF;
    }
    if (assumptions.heatingF !== undefined && assumptions.setbackHeatingF !== undefined && assumptions.setbackHeatingF > assumptions.heatingF) delete assumptions.setbackHeatingF;
    if (assumptions.coolingF !== undefined && assumptions.setbackCoolingF !== undefined && assumptions.setbackCoolingF < assumptions.coolingF) delete assumptions.setbackCoolingF;
    values[type] = { assumptions };
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
    const normalizeCounty = (value: string) => value.toLowerCase().replace(/^(city and county of|county of)\s+/i, "").replace(/\s+(county|parish|borough|census area|municipality)$/i, "").replace(/[^a-z0-9]/g, "");
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
      return Response.json({ assumptions: characteristic.assumptions, county: county.name, countyFips: county.fips, buildingType }, { headers: { "Cache-Control": "public, max-age=86400" } });
    }

    return errorResponse("Request the selected type's mapped building characteristics.", 400);
  } catch {
    return errorResponse("ComStock county data could not be reached. Please retry in a moment.", 502);
  }
}
