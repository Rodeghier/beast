/** Public provider data only. API credentials never belong in these types. */
export type ProviderStatus = "ok" | "missing_key" | "error";
export type RateTier = { max: number | null; rate: number | null; adjustment: number | null; sell: number | null; unit: string | null };
export type ElectricTariff = {
  id: string; name: string; utility: string; url: string | null; sourceUrl: string | null;
  description: string; approved: boolean | null; isDefault: boolean | null;
  effectiveDate: number | null; endDate: number | null; serviceType: string | null; sector: string;
  energyRates: RateTier[][] | null; demandRates: RateTier[][] | null; flatDemandRates: RateTier[][] | null;
  energyWeekdaySchedule: number[][] | null; energyWeekendSchedule: number[][] | null;
  demandWeekdaySchedule: number[][] | null; demandWeekendSchedule: number[][] | null;
  flatDemandMonths: number[] | null; fuelAdjustmentsMonthly: number[] | null;
  fixedCharge: number | null; fixedChargeUnits: string | null;
  minimumCharge: number | null; minimumChargeUnits: string | null;
  demandWindowMinutes: number | null; demandRateUnits: string | null; flatDemandUnits: string | null;
  eligibility: { minKw: number | null; maxKw: number | null; minKwh: number | null; maxKwh: number | null; demandUnits: string | null; voltageMinimum: number | null; voltageMaximum: number | null; voltageCategory: string | null; phaseWiring: string | null };
  unsupportedClauses: string[]; notes: string[];
};
export type EmissionRegion = { code: string; name: string; year: number; kgCo2PerKwh: number; lbCo2PerMwh: number };
export type ElectricityContext = { status: ProviderStatus; message: string; tariffs: ElectricTariff[]; sourceUrl: string };
export type GasContext = { status: ProviderStatus; message: string; prices: { period: string; dollarsPerMcf: number }[]; sourceUrl: string; state: string };
export type GasCombustion = { kgCo2PerTherm: number; thermsPerMcf: number; sourceUrl: string; year: number };
// EPA 2025 Hub, Table 1: 53.06 kg CO2/MMBtu; HHV 0.001026 MMBtu/scf.
export const EPA_NATURAL_GAS: GasCombustion = { kgCo2PerTherm: 5.306, thermsPerMcf: 10.26, year: 2025, sourceUrl: "https://www.epa.gov/system/files/documents/2025-01/ghg-emission-factors-hub-2025.pdf" };
export type EmissionsContext = { naturalGas: GasCombustion; status: ProviderStatus; message: string; regions: EmissionRegion[]; utilities: { id: string; name: string; subregion: string }[]; method: "zip" | "coordinates"; sourceUrl: string };
export type LocationEnergyContext = { electricity: ElectricityContext; gas: GasContext; emissions: EmissionsContext; retrievedAt: string };
export const ELECTRICITY_SOURCE = "https://apps.openei.org/services/doc/rest/util_rates/?version=8";
export const GAS_SOURCE = "https://www.eia.gov/dnav/ng/ng_pri_sum_a_EPG0_PCS_DMcf_m.htm";
export const EMISSIONS_SOURCE = "https://www.epa.gov/egrid/summary-data";

type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => v !== null && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {};
export function finiteNumber(v: unknown): number | null {
  if (typeof v !== "number" && (typeof v !== "string" || !v.trim())) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
const text = (v: unknown, max = 5000): string => typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max) : "";
const optionalText = (v: unknown): string | null => text(v) || null;
const bool = (v: unknown): boolean | null => typeof v === "boolean" ? v : null;
export function publicUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2000) return null;
  try {
    const u = new URL(v);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) return null;
    for (const key of u.searchParams.keys()) if (/key|token|secret|password|signature/i.test(key)) return null;
    return u.href;
  } catch { return null; }
}

export function parseRateTiers(v: unknown): RateTier[][] | null {
  if (!Array.isArray(v) || !v.length || v.length > 100) return null;
  if (v.some(p => !Array.isArray(p) || !p.length || p.length > 100 || p.some(t => !t || typeof t !== "object" || Array.isArray(t)))) return null;
  return v.map(p => p.map((tier: unknown) => { const t = record(tier); return { max: finiteNumber(t.max), rate: finiteNumber(t.rate), adjustment: finiteNumber(t.adj), sell: finiteNumber(t.sell), unit: optionalText(t.unit) }; }));
}
export function parseSchedule(v: unknown, periods: number): number[][] | null {
  if (!Array.isArray(v) || v.length !== 12 || periods < 1) return null;
  if (v.some(month => !Array.isArray(month) || month.length !== 24 || month.some(p => !Number.isInteger(p) || p < 0 || p >= periods))) return null;
  return v.map(month => [...month]);
}
const months = (v: unknown, periods: number): number[] | null => Array.isArray(v) && v.length === 12 && v.every(p => Number.isInteger(p) && p >= 0 && p < periods) ? [...v] : null;
const numericMonths = (v: unknown): number[] | null => Array.isArray(v) && v.length === 12 && v.every(n => finiteNumber(n) !== null) ? v.map(n => finiteNumber(n)!) : null;
const meaningful = (v: unknown): boolean => Array.isArray(v) ? v.some(meaningful) : v && typeof v === "object" ? Object.values(v).some(meaningful) : typeof v === "number" ? v !== 0 : typeof v === "string" ? !!v.trim() && v.trim() !== "0" : v === true;

/** Keep rate candidates separate; no implicit tariff or service-provider choice. */
export function parseElectricTariffs(payload: unknown, effectiveOn = Date.now() / 1000): ElectricTariff[] {
  const items = record(payload).items;
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: ElectricTariff[] = [];
  for (const raw of items) {
    const r = record(raw), id = text(r.label, 100), sector = text(r.sector, 50);
    if (!id || seen.has(id) || sector !== "Commercial") continue;
    const effectiveDate = finiteNumber(r.startdate), endDate = finiteNumber(r.enddate);
    if ((effectiveDate !== null && effectiveDate > effectiveOn) || (endDate !== null && endDate < effectiveOn)) continue;
    const energyRates = parseRateTiers(r.energyratestructure), demandRates = parseRateTiers(r.demandratestructure), flatDemandRates = parseRateTiers(r.flatdemandstructure);
    const energyWeekdaySchedule = parseSchedule(r.energyweekdayschedule, energyRates?.length || 0), energyWeekendSchedule = parseSchedule(r.energyweekendschedule, energyRates?.length || 0);
    const demandWeekdaySchedule = parseSchedule(r.demandweekdayschedule, demandRates?.length || 0), demandWeekendSchedule = parseSchedule(r.demandweekendschedule, demandRates?.length || 0);
    const flatDemandMonths = months(r.flatdemandmonths, flatDemandRates?.length || 0);
    const unsupportedClauses: string[] = [];
    const malformedNumber = (v: unknown) => v !== undefined && v !== null && finiteNumber(v) === null;
    if ([r.fixedchargefirstmeter, r.mincharge, r.demandwindow].some(malformedNumber)) unsupportedClauses.push("Invalid charge or demand-window value");
    for (const structure of [r.energyratestructure, r.demandratestructure, r.flatdemandstructure]) {
      if (Array.isArray(structure) && structure.some(period => Array.isArray(period) && period.some(rawTier => {
        const tier = record(rawTier);
        return [tier.max, tier.rate, tier.adj].some(malformedNumber);
      }))) unsupportedClauses.push("Invalid numeric tier data");
    }
    if ([r.lookbackMonths, r.lookbackPercent, r.lookbackRange].some(meaningful)) unsupportedClauses.push("Demand ratchet / historical lookback");
    if ([r.coincidentratestructure, r.coincidentrateschedule, r.coincidentschedule].some(meaningful)) unsupportedClauses.push("Coincident peak demand");
    if (meaningful(r.demandreactivepowercharge)) unsupportedClauses.push("Reactive power charge");
    if ([r.demandrateunit, r.flatdemandunit].some(v => typeof v === "string" && v !== "kW")) unsupportedClauses.push("Demand units other than monthly kW");
    if (energyRates?.some(p => p.some(t => t.unit && t.unit !== "kWh"))) unsupportedClauses.push("Energy tier units other than kWh");
    if ([r.energyattrs, r.demandattrs, r.fixedattrs].some(meaningful)) unsupportedClauses.push("Additional tariff attributes");
    if (meaningful(r.fixedchargeeaaddl)) unsupportedClauses.push("Additional-meter fixed charges");
    if (r.fixedchargefirstmeter !== undefined && !["$/day", "$/month", "$/year"].includes(String(r.fixedchargeunits)) || r.mincharge !== undefined && !["$/day", "$/month", "$/year"].includes(String(r.minchargeunits))) unsupportedClauses.push("Missing or unsupported fixed/minimum-charge units");
    if (r.fueladjustmentsmonthly !== undefined && !numericMonths(r.fueladjustmentsmonthly)) unsupportedClauses.push("Invalid monthly fuel adjustments");
    if (meaningful(r.dgrules)) unsupportedClauses.push("Distributed-generation export compensation");
    if (r.energyratestructure && !energyRates || r.demandratestructure && !demandRates || r.flatdemandstructure && !flatDemandRates) unsupportedClauses.push("Invalid or unsupported rate structure");
    if (energyRates && (!energyWeekdaySchedule || !energyWeekendSchedule) || demandRates && (!demandWeekdaySchedule || !demandWeekendSchedule) || flatDemandRates && !flatDemandMonths) unsupportedClauses.push("Missing or invalid period schedule");
    if ([energyRates, demandRates, flatDemandRates].some(s => s?.some(p => p.some(t => t.rate === null && t.adjustment === null)))) unsupportedClauses.push("Missing tier price");
    const notes = [r.basicinformationcomments, r.energycomments, r.demandcomments].map(v => text(v)).filter(Boolean);
    if (!energyRates) notes.push("No energy price structure supplied; check whether this is a delivery-only tariff.");
    if (effectiveDate === null) notes.push("Tariff effective date was not supplied.");
    out.push({ id, name: text(r.name, 300) || id, utility: text(r.utility, 300), url: publicUrl(r.uri), sourceUrl: publicUrl(r.source) || publicUrl(r.sourceparent), description: text(r.description), approved: bool(r.approved), isDefault: bool(r.is_default), effectiveDate, endDate, serviceType: optionalText(r.servicetype), sector,
      energyRates, demandRates, flatDemandRates, energyWeekdaySchedule, energyWeekendSchedule, demandWeekdaySchedule, demandWeekendSchedule, flatDemandMonths, fuelAdjustmentsMonthly: numericMonths(r.fueladjustmentsmonthly),
      fixedCharge: finiteNumber(r.fixedchargefirstmeter), fixedChargeUnits: optionalText(r.fixedchargeunits), minimumCharge: finiteNumber(r.mincharge), minimumChargeUnits: optionalText(r.minchargeunits), demandWindowMinutes: finiteNumber(r.demandwindow), demandRateUnits: optionalText(r.demandrateunit), flatDemandUnits: optionalText(r.flatdemandunit),
      eligibility: { minKw: finiteNumber(r.peakkwcapacitymin), maxKw: finiteNumber(r.peakkwcapacitymax), minKwh: finiteNumber(r.peakkwhusagemin), maxKwh: finiteNumber(r.peakkwhusagemax), demandUnits: optionalText(r.demandunits), voltageMinimum: finiteNumber(r.voltageminimum), voltageMaximum: finiteNumber(r.voltagemaximum), voltageCategory: optionalText(r.voltagecategory), phaseWiring: optionalText(r.phasewiring) }, unsupportedClauses, notes });
    seen.add(id);
  }
  return out.sort((a, b) => a.utility.localeCompare(b.utility) || a.name.localeCompare(b.name));
}

export function parseGasPrices(payload: unknown, state: string): GasContext["prices"] {
  const values = record(record(payload).response).data;
  if (!Array.isArray(values)) return [];
  const byPeriod = new Map<string, number>();
  for (const raw of values) {
    const r = record(raw), period = text(r.period), value = finiteNumber(r.value);
    if (r.duoarea !== `S${state}` || r.process !== "PCS" || r.units !== "$/MCF" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || value === null || value < 0) continue;
    byPeriod.set(period, value);
  }
  return [...byPeriod].sort(([a], [b]) => b.localeCompare(a)).slice(0, 12).map(([period, dollarsPerMcf]) => ({ period, dollarsPerMcf }));
}

export type GeoGeometry = { type: string; coordinates: number[][][] | number[][][][] };
export type EgridData = { regions: (EmissionRegion & { geometry: GeoGeometry })[] };
/** Utility tuples are [EIA ID, provider name, subregion, state]. */
export type EgridZipData = { utilities: string[][]; zips: Record<string, number[]> };
const pointInRing = (x: number, y: number, ring: number[][]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (Math.abs((x - xi) * (yj - yi) - (y - yi) * (xj - xi)) < 1e-10 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export function pointInGeometry(latitude: number, longitude: number, geometry: GeoGeometry): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates as number[][][]] : geometry.type === "MultiPolygon" ? geometry.coordinates as number[][][][] : [];
  return polygons.some(p => p.length > 0 && pointInRing(longitude, latitude, p[0]) && !p.slice(1).some(hole => pointInRing(longitude, latitude, hole)));
}
export function resolveEmissions(latitude: number, longitude: number, state: string, zip: string | null, data: EgridData, zipData: EgridZipData): EmissionsContext {
  let regions = data.regions.filter(r => pointInGeometry(latitude, longitude, r.geometry));
  let utilities: EmissionsContext["utilities"] = [];
  let message = "Approximate subregion candidates from the selected city coordinates. Confirm the electricity provider or enter the building ZIP code; service territories can overlap.";
  if (zip) {
    const tuples = (zipData.zips[zip] || []).map(i => zipData.utilities[i]).filter(u => u && u[3] === state);
    if (!tuples.length) return { status: "error", message: "No EPA utility mapping was found for this ZIP and state. Check the ZIP, or clear it to use city-coordinate candidates.", regions: [], utilities: [], method: "zip", naturalGas: EPA_NATURAL_GAS, sourceUrl: EMISSIONS_SOURCE };
    utilities = tuples.map(u => ({ id: u[0], name: u[1], subregion: u[2] }));
    const codes = new Set(utilities.map(u => u.subregion));
    regions = data.regions.filter(r => codes.has(r.code));
    message = "EPA ZIP and electricity-provider candidates. Confirm the provider for the building; a ZIP can have multiple service territories.";
  }
  if (!regions.length) message = "No EPA subregion could be resolved from these coordinates. Enter a US building ZIP code to look up electricity-provider candidates.";
  if (regions.length > 1) message += " Multiple subregions match; select the applicable provider/subregion.";
  message += " Factors are annual average electricity CO₂ from eGRID2023, not hourly or future-year projections; natural gas combustion is separate.";
  return { status: regions.length ? "ok" : "error", message, regions: regions.map(({ geometry: _, ...region }) => region), utilities, method: zip ? "zip" : "coordinates", naturalGas: EPA_NATURAL_GAS, sourceUrl: EMISSIONS_SOURCE };
}
