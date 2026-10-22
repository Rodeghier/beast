import { parseCsv } from "./csv";
import { schoolCsv, type SchoolRow, type SchoolAssumptions } from "./school";
import type { SolarLocation } from "./solar";
import { curveValue, missingCurves, parseCurves, type CurveScenario } from "./performance-curves";

export const BTU_PER_KWH = 3412.141633;
export const CURVE_MODEL_VERSION = "user-curves-1.0";
export type CurveHour = {
  electricity: number | null; heatingElectricity: number | null; coolingElectricity: number | null;
  availableHeating: number | null; availableCooling: number | null; deliveredHeating: number | null; deliveredCooling: number | null;
  unmetHeating: number | null; unmetCooling: number | null; heatingCop: number | null; coolingCop: number | null; coolingShr: number | null; enteringWetBulbF: number | null; status: string;
};
export type CurveResult = { scenario: CurveScenario; referenceHeating: number | null; referenceCooling: number | null; error: string | null; rows: CurveHour[];
  summary: { electricity: number | null; heatingElectricity: number | null; coolingElectricity: number | null; completeHours: number; fullYear: boolean;
    unmetHeatingBtu: number | null; unmetCoolingBtu: number | null; unmetHeatingHours: number; unmetCoolingHours: number; } };
const blank = (status: string): CurveHour => ({ electricity: null, heatingElectricity: null, coolingElectricity: null, availableHeating: null, availableCooling: null,
  deliveredHeating: null, deliveredCooling: null, unmetHeating: null, unmetCooling: null, heatingCop: null, coolingCop: null, coolingShr: null, enteringWetBulbF: null, status });
export const operatingHourKey = (r: {year: number; month: number; day: number; hour: number; minute: number}) => `${r.year}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")} ${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`;

export function parseEnteringWetBulbCsv(csv: string): Record<string, number> {
  const data = parseCsv(csv), output: Record<string, number> = {};
  if (data[0]?.join(",") !== "Date,Time,Entering_wet_bulb_F") throw new Error("Use the headers Date,Time,Entering_wet_bulb_F.");
  for (const row of data.slice(1).filter(r => r.some(v => v.trim()))) {
    const [date, time, raw] = row, value = Number(raw);
    if (row.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:00$/.test(time) || !raw.trim() || !Number.isFinite(value)) throw new Error("Each row needs YYYY-MM-DD,HH:00 and a finite entering wet-bulb temperature in °F.");
    const stamp = new Date(`${date}T${time}:00Z`);
    if (!Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0, 16) !== `${date}T${time}` || date.slice(5) === "02-29") throw new Error("Use valid local standard-time dates and hours, excluding February 29.");
    const key = `${date} ${time}`;
    if (Object.hasOwn(output, key)) throw new Error(`Duplicate entering wet-bulb hour: ${key}.`);
    output[key] = value;
  }
  if (!Object.keys(output).length) throw new Error("The entering wet-bulb file contains no hourly values.");
  return output;
}
const validLoad = (r: SchoolRow) => [r.temperatureF, r.heating, r.sensibleCooling, r.latentCooling, r.totalCooling].every(v => v !== null && Number.isFinite(v));

export function simulateCurves(rows: SchoolRow[], scenario: CurveScenario): CurveResult {
  let error: string | null = null;
  try { parseCurves(scenario.curves); } catch (cause) { error = cause instanceof Error ? cause.message : "Invalid curves."; }
  if (!error) { const missing = missingCurves(scenario.curves); if (missing.length) error = `Awaiting curves: ${missing.join(", ")}.`; }
  if (!error && !Number.isFinite(scenario.enteringWetBulbF) && !Object.keys(scenario.hourlyEnteringWetBulbF ?? {}).length) error = "Awaiting entering wet-bulb operating conditions.";
  const loads = rows.filter(validLoad);
  // Dimensional reference comes solely from the building loads, never an equipment rating.
  const referenceHeating = loads.length ? Math.max(0, ...loads.map(r => r.heating!)) : null;
  const referenceCooling = loads.length ? Math.max(0, ...loads.map(r => -r.totalCooling!)) : null;
  const output = rows.map(row => {
    const wb = scenario.hourlyEnteringWetBulbF?.[operatingHourKey(row)] ?? scenario.enteringWetBulbF;
    const unavailable = (status: string) => ({ ...blank(status), enteringWetBulbF: wb !== null && Number.isFinite(wb) ? wb : null });
    if (error) return unavailable(error);
    if (!validLoad(row)) return unavailable("Missing weather or building load input.");
    const t = row.temperatureF!, heat = row.heating!, sensible = -row.sensibleCooling!, latent = -row.latentCooling!;
    if (wb === null || !Number.isFinite(wb)) return blank("Missing entering wet-bulb operating condition.");
    const hc = curveValue(scenario.curves.heating.capacity, t, wb), hcop = curveValue(scenario.curves.heating.cop, t, wb);
    const cc = curveValue(scenario.curves.cooling.capacity, t, wb), ccop = curveValue(scenario.curves.cooling.cop, t, wb), shr = curveValue(scenario.curves.cooling.shr, t, wb);
    // A curve is needed only during the corresponding mode's load call.
    if (heat > 0 && (hc === null || hcop === null) || (sensible > 0 || latent > 0) && (cc === null || ccop === null || shr === null)) return unavailable("Outdoor dry-bulb or entering wet-bulb temperature is outside a required curve domain.");
    const availableHeating = hc === null ? null : referenceHeating! * hc, availableCooling = cc === null ? null : referenceCooling! * cc;
    const deliveredHeating = heat > 0 ? Math.min(heat, availableHeating!) : 0;
    const requirement = (sensible > 0 || latent > 0) ? Math.max(sensible > 0 ? sensible / shr! : 0, latent > 0 ? latent / (1 - shr!) : 0) : 0;
    const deliveredCooling = requirement > 0 ? Math.min(requirement, availableCooling!) : 0;
    const unmetCooling = Math.max(0, sensible - deliveredCooling * (shr ?? 0)) + Math.max(0, latent - deliveredCooling * (1 - (shr ?? 0)));
    const heatingElectricity = heat > 0 ? deliveredHeating / BTU_PER_KWH / hcop! : 0;
    const coolingElectricity = deliveredCooling > 0 ? deliveredCooling / BTU_PER_KWH / ccop! : 0;
    if ([availableHeating, availableCooling, deliveredHeating, deliveredCooling, unmetCooling, heatingElectricity + coolingElectricity].some(v => v !== null && !Number.isFinite(v))) return unavailable("Curve calculation exceeds the supported numeric range.");
    return { electricity: heatingElectricity + coolingElectricity, heatingElectricity, coolingElectricity, availableHeating, availableCooling,
      deliveredHeating, deliveredCooling, unmetHeating: heat - deliveredHeating, unmetCooling, heatingCop: heat > 0 ? hcop : null,
      coolingCop: requirement > 0 ? ccop : null, coolingShr: requirement > 0 ? shr : null, enteringWetBulbF: wb, status: "Calculated from supplied curves." };
  });
  const completeHours = output.filter(r => r.electricity !== null).length;
  const sum = (key: "electricity" | "heatingElectricity" | "coolingElectricity" | "unmetHeating" | "unmetCooling") => completeHours ? output.reduce((s, r) => s + (r[key] ?? 0), 0) : null;
  const unique = new Set(rows.map(r => `${r.year}-${r.month}-${r.day}-${r.hour}-${r.minute}`));
  return { scenario, referenceHeating, referenceCooling, error, rows: output, summary: { electricity: sum("electricity"), heatingElectricity: sum("heatingElectricity"), coolingElectricity: sum("coolingElectricity"),
    unmetHeatingBtu: sum("unmetHeating"), unmetCoolingBtu: sum("unmetCooling"), unmetHeatingHours: output.filter(r => (r.unmetHeating ?? 0) > 1).length,
    unmetCoolingHours: output.filter(r => (r.unmetCooling ?? 0) > 1).length, completeHours,
    fullYear: rows.length === 8760 && completeHours === 8760 && unique.size === 8760 && new Set(rows.map(r => r.year)).size === 1 && rows.every(r => {
      const date = new Date(Date.UTC(r.year, r.month - 1, r.day, r.hour));
      return r.minute === 0 && Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23 && date.getUTCMonth() === r.month - 1 && date.getUTCDate() === r.day && !(r.month === 2 && r.day === 29);
    }) } };
}

const line = (values: unknown[]) => values.map(v => v == null ? "" : `"${String(v).replaceAll('"', '""')}"`).join(",");
export function curveResultsCsv(rows: SchoolRow[], school: SchoolAssumptions, result: CurveResult, location: string, zone: string, site?: SolarLocation | null): string {
  const original = parseCsv(schoolCsv(rows, school, location, zone, site));
  const metadata = { Curve_model: CURVE_MODEL_VERSION, Curve_scenario: result.scenario.name, Curves_json: JSON.stringify(result.scenario.curves),
    Reference_heating_BTU_hr: result.referenceHeating, Reference_cooling_BTU_hr: result.referenceCooling,
    Reference_basis: "Peaks of valid building loads in the selected dataset; no equipment rating or sizing factor.",
    Electricity_scope: "Delivered heating / supplied heating COP + gross cooling / supplied cooling COP, converted to kWh for one-hour records; no other equipment energy modeled.",
    Entering_wet_bulb_fixed_F: result.scenario.enteringWetBulbF, Entering_wet_bulb_basis: "User-supplied hourly temperatures; optional explicit fixed fallback. Not inferred from outdoor air or equipment mixing.",
    Curve_policy: "Bilinear interpolation within supplied outdoor dry-bulb and entering wet-bulb domains; missing curves or required out-of-domain inputs remain blank.", Curve_status: result.error ?? "Supplied curves" };
  const keys: (keyof CurveHour)[] = ["electricity", "heatingElectricity", "coolingElectricity", "availableHeating", "availableCooling", "deliveredHeating", "deliveredCooling", "unmetHeating", "unmetCooling", "heatingCop", "coolingCop", "coolingShr", "enteringWetBulbF", "status"];
  const headers = ["Curve_electricity_kWh", "Heating_electricity_kWh", "Cooling_electricity_kWh", "Available_heating_BTU_hr", "Available_cooling_BTU_hr", "Delivered_heating_BTU_hr", "Delivered_gross_cooling_BTU_hr", "Unmet_heating_BTU_hr", "Unmet_cooling_BTU_hr", "Heating_COP", "Cooling_COP", "Cooling_SHR", "Entering_wet_bulb_F", "Curve_status"];
  return [line([...original[0], ...Object.keys(metadata)]), line([...original[1], ...Object.values(metadata)]), "", line([...original[2], ...headers]), ...rows.map((_, i) => line([...original[i + 3], ...keys.map(k => result.rows[i][k])]))].join("\r\n");
}
export function curveComparisonCsv(results: CurveResult[]): string {
  return [line(["Scenario", "Curve_model", "Curve_status", "Electricity_kWh_available_hours", "Valid_hours", "Full_year", "Unmet_heating_BTU", "Unmet_cooling_BTU"]),
    ...results.map(r => line([r.scenario.name, CURVE_MODEL_VERSION, r.error ?? "Supplied curves", r.summary.electricity, r.summary.completeHours, r.summary.fullYear, r.summary.unmetHeatingBtu, r.summary.unmetCoolingBtu]))].join("\r\n");
}
