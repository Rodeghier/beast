import type { ClimateRow } from "./csv";

export const SCHOOL_AREA = 150_000;
export const MODEL_VERSION = "school-heat-balance-1.0";
export const BTU_PER_WH = 3.412141633;
const PRESSURE_PA = 101325;

export const DEFAULT_SCHOOL = {
  heatingF: 70, coolingF: 75, setbackHeatingF: 60, setbackCoolingF: 85, indoorRh: 50,
  people: 1200, startHour: 7, endHour: 17, summerPercent: 10,
  envelopeUa: 0.10, ceilingFt: 14, infiltrationAch: 0.15,
  ventilationPerson: 10, ventilationArea: 0.12,
  lightingW: 0.9, equipmentW: 0.6, sensiblePerson: 245, latentPerson: 155,
  solarPeak: 4,
};
export type SchoolAssumptions = typeof DEFAULT_SCHOOL;
export type SchoolField = { key: keyof SchoolAssumptions; label: string; unit: string; min: number; max: number; step: number };
export const SCHOOL_FIELDS: { title: string; fields: SchoolField[] }[] = [
  { title: "Indoor conditions", fields: [
    { key: "heatingF", label: "Occupied heating setpoint", unit: "°F", min: 40, max: 85, step: 1 },
    { key: "coolingF", label: "Occupied cooling setpoint", unit: "°F", min: 60, max: 100, step: 1 },
    { key: "setbackHeatingF", label: "Unoccupied heating setpoint", unit: "°F", min: 35, max: 85, step: 1 },
    { key: "setbackCoolingF", label: "Unoccupied cooling setpoint", unit: "°F", min: 60, max: 110, step: 1 },
    { key: "indoorRh", label: "Maximum indoor RH", unit: "%", min: 20, max: 70, step: 1 },
  ] },
  { title: "School schedule · Monday–Friday", fields: [
    { key: "people", label: "Students + staff at full occupancy", unit: "people", min: 0, max: 10000, step: 1 },
    { key: "startHour", label: "Occupied hours start", unit: "hour · 0–23", min: 0, max: 23, step: 1 },
    { key: "endHour", label: "Occupied hours end (exclusive)", unit: "hour · 1–24", min: 1, max: 24, step: 1 },
    { key: "summerPercent", label: "June–August occupancy", unit: "% of full", min: 0, max: 100, step: 1 },
  ] },
  { title: "Envelope and outdoor air", fields: [
    { key: "envelopeUa", label: "Envelope UA / floor area", unit: "BTU/hr·ft²·°F", min: 0.001, max: 2, step: 0.001 },
    { key: "ceilingFt", label: "Average conditioned height", unit: "ft", min: 6, max: 40, step: 0.5 },
    { key: "infiltrationAch", label: "Infiltration (all hours)", unit: "air changes/hr", min: 0, max: 3, step: 0.01 },
    { key: "ventilationPerson", label: "Outdoor air per occupant", unit: "CFM/person", min: 0, max: 50, step: 0.5 },
    { key: "ventilationArea", label: "Outdoor air per floor area", unit: "CFM/ft²", min: 0, max: 1, step: 0.01 },
  ] },
  { title: "Internal and solar heat gains", fields: [
    { key: "lightingW", label: "Full lighting power", unit: "W/ft²", min: 0, max: 5, step: 0.1 },
    { key: "equipmentW", label: "Full equipment power", unit: "W/ft²", min: 0, max: 10, step: 0.1 },
    { key: "sensiblePerson", label: "Sensible heat per occupant", unit: "BTU/hr·person", min: 0, max: 1000, step: 5 },
    { key: "latentPerson", label: "Latent heat per occupant", unit: "BTU/hr·person", min: 0, max: 1000, step: 5 },
    { key: "solarPeak", label: "Assumed peak solar gain / floor area", unit: "BTU/hr·ft²", min: 0, max: 30, step: 0.5 },
  ] },
];

export function validateSchool(a: SchoolAssumptions): string | null {
  for (const field of SCHOOL_FIELDS.flatMap(g => g.fields)) {
    const value = a[field.key];
    if (!Number.isFinite(value) || value < field.min || value > field.max) return `${field.label} must be between ${field.min} and ${field.max}.`;
    if (["people", "startHour", "endHour"].includes(field.key) && !Number.isInteger(value)) return `${field.label} must be a whole number.`;
  }
  if (a.heatingF >= a.coolingF || a.setbackHeatingF >= a.setbackCoolingF) return "Each heating setpoint must be lower than its cooling setpoint.";
  if (a.setbackHeatingF > a.heatingF || a.setbackCoolingF < a.coolingF) return "Unoccupied heating must be at or below occupied heating, and unoccupied cooling at or above occupied cooling.";
  if (a.startHour >= a.endHour) return "The occupied start hour must be earlier than the end hour.";
  return null;
}

export const fahrenheit = (c: number) => c * 9 / 5 + 32;
export const celsius = (f: number) => (f - 32) * 5 / 9;

// ASHRAE Fundamentals saturation pressure equations, SI coefficients as
// documented by PsychroLib. Ice below the triple point; water above it.
// See THIRD_PARTY_NOTICES.md for the PsychroLib license.
export function saturationPressure(c: number): number | null {
  if (!Number.isFinite(c) || c < -100 || c > 200) return null;
  const t = c + 273.15;
  const logP = c <= 0.01
    ? -5674.5359 / t + 6.3925247 - 0.009677843 * t + 6.2215701e-7 * t ** 2 + 2.0747825e-9 * t ** 3 - 9.484024e-13 * t ** 4 + 4.1635019 * Math.log(t)
    : -5800.2206 / t + 1.3914993 - 0.048640239 * t + 4.1764768e-5 * t ** 2 - 1.4452093e-8 * t ** 3 + 6.5459673 * Math.log(t);
  return Math.exp(logP);
}

function vaporPressure(c: number | null, rh: number | null): number | null {
  if (c === null || rh === null || !Number.isFinite(rh) || rh < 0 || rh > 100) return null;
  const saturation = saturationPressure(c);
  return saturation === null ? null : saturation * rh / 100;
}

export function dewPointF(c: number | null, rh: number | null): number | null {
  const pv = vaporPressure(c, rh);
  // RH=0 has no finite dew point. Do not invent a value or clamp low humidity.
  if (pv === null || pv <= 0 || c === null || pv < saturationPressure(-100)!) return null;
  if (rh === 100) return fahrenheit(c);
  let low = -100, high = c;
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    if (saturationPressure(mid)! > pv) high = mid; else low = mid;
  }
  return fahrenheit((low + high) / 2);
}

export function humidityRatio(c: number | null, rh: number | null): number | null {
  const pv = vaporPressure(c, rh);
  return pv === null || pv >= PRESSURE_PA ? null : 0.621945 * pv / (PRESSURE_PA - pv);
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateLabel = (r: ClimateRow) => `${r.year}-${pad(r.month)}-${pad(r.day)}`;
export const timeLabel = (r: ClimateRow) => `${pad(r.hour)}:${pad(r.minute)}`;

export type SchoolRow = ClimateRow & {
  temperatureF: number | null; dewPointF: number | null;
  sensibleCooling: number | null; latentCooling: number | null; totalCooling: number | null; heating: number | null;
  occupied: boolean; occupants: number; outdoorAirCfm: number;
  ventilationCfm: number; infiltrationCfm: number;
  heatBalance: number | null; coolBalance: number | null; heatTransfer: number;
  freeFloatF: number | null; heatingSetpointF: number; coolingSetpointF: number;
};

export function simulateSchool(rows: ClimateRow[], a: SchoolAssumptions): SchoolRow[] {
  const error = validateSchool(a); if (error) throw new Error(error);
  const infiltration = a.infiltrationAch * SCHOOL_AREA * a.ceilingFt / 60;
  const ua = a.envelopeUa * SCHOOL_AREA;
  return rows.map(row => {
    // Use the CSV's calendar directly. Date.UTC avoids shifting weekdays in
    // a visitor's browser time zone; the source excludes daylight saving time.
    const weekday = new Date(Date.UTC(row.year, row.month - 1, row.day)).getUTCDay();
    const schoolHour = weekday > 0 && weekday < 6 && row.hour >= a.startHour && row.hour < a.endHour;
    const fraction = schoolHour ? (row.month >= 6 && row.month <= 8 ? a.summerPercent / 100 : 1) : 0;
    const occupied = fraction > 0;
    const occupants = a.people * fraction;
    const ventilation = occupied ? occupants * a.ventilationPerson + SCHOOL_AREA * a.ventilationArea : 0;
    const outdoorAirCfm = infiltration + ventilation;
    const heatSetpoint = occupied ? a.heatingF : a.setbackHeatingF;
    const coolSetpoint = occupied ? a.coolingF : a.setbackCoolingF;
    const tempF = row.temperature !== null && Number.isFinite(row.temperature) && row.temperature >= -100 && row.temperature <= 100 ? fahrenheit(row.temperature) : null;
    const heatTransfer = ua + 1.08 * outdoorAirCfm;
    const base: SchoolRow = { ...row, temperatureF: tempF, dewPointF: dewPointF(row.temperature, row.humidity), sensibleCooling: null, latentCooling: null, totalCooling: null, heating: null, occupied, occupants, outdoorAirCfm,
      ventilationCfm: ventilation, infiltrationCfm: infiltration, heatBalance: null, coolBalance: null, heatTransfer, freeFloatF: null, heatingSetpointF: heatSetpoint, coolingSetpointF: coolSetpoint };
    if (tempF === null) return base;
    const lighting = SCHOOL_AREA * a.lightingW * (0.10 + 0.90 * fraction) * BTU_PER_WH;
    const equipment = SCHOOL_AREA * a.equipmentW * (0.25 + 0.75 * fraction) * BTU_PER_WH;
    // User-specified solar allowance, not measured irradiance. Average of the
    // sine profile over each hourly bin (06:00–18:00 local standard time).
    const from = Math.max(6, row.hour), to = Math.min(18, row.hour + 1);
    const solarFraction = to > from ? 12 / Math.PI * (Math.cos(Math.PI * (from - 6) / 12) - Math.cos(Math.PI * (to - 6) / 12)) : 0;
    const solar = SCHOOL_AREA * a.solarPeak * solarFraction;
    const gains = lighting + equipment + occupants * a.sensiblePerson + solar;
    const sensible = Math.max(0, heatTransfer * (tempF - coolSetpoint) + gains);
    const heating = Math.max(0, heatTransfer * (heatSetpoint - tempF) - gains);
    // A thermostat deadband: estimate the equilibrium zone temperature, then
    // clamp to the active heating/cooling setpoints for the humidity target.
    const zoneF = Math.min(coolSetpoint, Math.max(heatSetpoint, tempF + gains / heatTransfer));
    const outdoorW = humidityRatio(row.temperature, row.humidity);
    const indoorW = humidityRatio(celsius(zoneF), a.indoorRh)!;
    const latent = outdoorW === null ? null : Math.max(0, 0.68 * outdoorAirCfm * 7000 * (outdoorW - indoorW) + occupants * a.latentPerson);
    return { ...base, sensibleCooling: sensible === 0 ? 0 : -sensible, latentCooling: latent === null ? null : latent === 0 ? 0 : -latent,
      totalCooling: latent === null ? null : sensible + latent === 0 ? 0 : -(sensible + latent), heating,
      heatBalance: heatTransfer * (heatSetpoint - tempF) - gains, coolBalance: heatTransfer * (tempF - coolSetpoint) + gains, freeFloatF: tempF + gains / heatTransfer };
  });
}

export function summarizeLoads(rows: SchoolRow[]) {
  type Peak = { value: number; timestamp: string } | null;
  let sensible: Peak = null, total: Peak = null, heating: Peak = null;
  const daily = new Map<string, { date: string; sensibleCooling: number | null; totalCooling: number | null; heating: number | null }>();
  let completeHours = 0;
  for (const row of rows) {
    const date = dateLabel(row), timestamp = `${date} ${timeLabel(row)}`;
    if (row.sensibleCooling !== null && (sensible === null || row.sensibleCooling < sensible.value)) sensible = { value: row.sensibleCooling, timestamp };
    if (row.totalCooling !== null && (total === null || row.totalCooling < total.value)) total = { value: row.totalCooling, timestamp };
    if (row.heating !== null && (heating === null || row.heating > heating.value)) heating = { value: row.heating, timestamp };
    if (row.totalCooling !== null && row.heating !== null) completeHours++;
    const point = daily.get(date) || { date, sensibleCooling: null, totalCooling: null, heating: null };
    for (const key of ["sensibleCooling", "totalCooling", "heating"] as const) {
      const value = row[key];
      if (value !== null) point[key] = point[key] === null ? value : key === "heating" ? Math.max(point[key]!, value) : Math.min(point[key]!, value);
    }
    daily.set(date, point);
  }
  return { sensible, total, heating, daily: [...daily.values()], completeHours };
}

export function schoolCsv(rows: SchoolRow[], a: SchoolAssumptions, location: string, zone: string): string {
  const metadata: Record<string, string | number> = {
    Model: MODEL_VERSION, Location: location, Time: zone, Floor_area_ft2: SCHOOL_AREA,
    Basis: "Illustrative single-zone hourly steady-state load estimate; cooling negative; heating positive; total cooling includes sensible cooling",
    Schedule: "Mon-Fri; June-Aug reduced occupancy; no holidays; fixed local standard time; no Feb 29",
    Limitations: "Assumed solar profile; no thermal mass, warm-up, zoning, equipment losses, heat recovery, economizer, fan heat, reheat or humidification; standard sea-level air",
    Dew_point: "ASHRAE ice/water saturation convention; frost point below freezing; blank at RH=0 or missing input",
    ...Object.fromEntries(SCHOOL_FIELDS.flatMap(g => g.fields.map(f => [`${f.label} (${f.unit})`, a[f.key]]))),
  };
  const escape = (v: unknown) => v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const precision = (v: number | null) => v === null ? null : Number(v.toFixed(4));
  return [line(Object.keys(metadata)), line(Object.values(metadata)), "",
    line(["Date", "Time_local", "Air_temperature_F", "Dew_point_F", "Sensible_cooling_BTU_hr", "Latent_cooling_BTU_hr", "Total_cooling_BTU_hr", "Heating_BTU_hr", "Occupied", "Occupants", "Outdoor_air_including_infiltration_CFM"]),
    ...rows.map(r => line([dateLabel(r), timeLabel(r), precision(r.temperatureF), precision(r.dewPointF), precision(r.sensibleCooling), precision(r.latentCooling), precision(r.totalCooling), precision(r.heating), r.occupied ? "Yes" : "No", r.occupants, precision(r.outdoorAirCfm)])),
  ].join("\r\n");
}
