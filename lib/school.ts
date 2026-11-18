/**
 * BUILDING LOAD WORKSHEET. Start reading at DEFAULT_SCHOOL, then simulateSchool.
 * One input row is one hour of weather; one output row adds building thermal loads.
 * Thermal rates are BTU/hr. Stored cooling loads are negative; heating is positive.
 * This module does not calculate compressor, heater or fan electricity.
 * Reader map: docs/REPOSITORY_GUIDE.md sections 4 through 7.
 */

import type { ClimateRow } from "./csv";
import { solarGains, type SolarLocation } from "./solar";

export const MODEL_VERSION = "building-solar-2.4";
export const BTU_PER_WH = 3.412141633;
const PRESSURE_PA = 101325;

// Editable building assumptions. Numbers are engineering inputs; SCHOOL_FIELDS below
// adds labels, allowed ranges and units for the input form.
export const DEFAULT_SCHOOL = {
  floorAreaFt2: 150_000,
  coolingDesignPercent: 1, heatingDesignPercent: 99,
  heatingF: 70, coolingF: 75, setbackHeatingF: 60, setbackCoolingF: 85, indoorRh: 50,
  thermostatDeadbandF: 2,
  minimumCompressorLoadPercent: 5,
  people: 1200, startHour: 7, endHour: 17, summerPercent: 10,
  ceilingFt: 14, infiltrationAch: 0.15,
  ventilationPerson: 10, ventilationArea: 0.12,
  lightingW: 0.9, equipmentW: 0.6, sensiblePerson: 245, latentPerson: 155,
  stories: 2, aspectRatio: 2, rotationDeg: 0, windowPercent: 25, shgc: 0.35, shadeFactor: 1,
  roofU: 0.04, wallU: 0.06, solarAbsorptance: 0.6, outdoorFilm: 3, groundReflectance: 0.2,
};
export type SchoolAssumptions = typeof DEFAULT_SCHOOL;
export type SchoolField = { key: keyof SchoolAssumptions; label: string; unit: string; min: number; max: number; step: number; options?: { value: number; label: string }[] };
export const SCHOOL_FIELDS: { title: string; fields: SchoolField[] }[] = [
  { title: "ASHRAE design sizing", fields: [
    { key: "coolingDesignPercent", label: "Cooling design condition", unit: "% annual exceedance", min: 0.4, max: 2, step: 0.1, options: [{value:0.4,label:"0.4%"},{value:1,label:"1%"},{value:2,label:"2%"}] },
    { key: "heatingDesignPercent", label: "Heating design condition", unit: "% annual cumulative frequency", min: 99, max: 99.6, step: 0.1, options: [{value:99,label:"99%"},{value:99.6,label:"99.6%"}] },
  ] },
  { title: "Building size and geometry", fields: [
    { key: "floorAreaFt2", label: "Total conditioned floor area", unit: "ft² · all floors combined", min: 1, max: 10_000_000, step: 1 },
    { key: "stories", label: "Number of floors", unit: "equal floor areas", min: 1, max: 30, step: 1 },
    { key: "ceilingFt", label: "Conditioned height per floor", unit: "ft", min: 6, max: 40, step: 0.5 },
    { key: "aspectRatio", label: "Plan length / width", unit: "length runs east–west at 0° rotation", min: 0.2, max: 5, step: 0.1 },
    { key: "rotationDeg", label: "Building rotation", unit: "degrees clockwise from north-facing façade", min: 0, max: 360, step: 5 },
  ] },
  { title: "Indoor conditions", fields: [
    { key: "minimumCompressorLoadPercent", label: "Minimum compressor load", unit: "% of hourly available capacity; 0 disables cutoff", min: 0, max: 100, step: 1 },
    { key: "thermostatDeadbandF", label: "Thermostat deadband (+/-)", unit: "°F", min: 0, max: 5, step: 0.5 },
    { key: "heatingF", label: "Occupied heating setpoint", unit: "°F", min: 40, max: 85, step: 1 },
    { key: "coolingF", label: "Occupied cooling setpoint", unit: "°F", min: 60, max: 100, step: 1 },
    { key: "setbackHeatingF", label: "Unoccupied heating setpoint", unit: "°F", min: 35, max: 85, step: 1 },
    { key: "setbackCoolingF", label: "Unoccupied cooling setpoint", unit: "°F", min: 60, max: 110, step: 1 },
    { key: "indoorRh", label: "Maximum indoor RH", unit: "%", min: 20, max: 70, step: 1 },
  ] },
  { title: "Occupancy schedule · Monday–Friday", fields: [
    { key: "people", label: "Total people at full occupancy", unit: "people · all floors combined", min: 0, max: 10000, step: 1 },
    { key: "startHour", label: "Occupied hours start", unit: "hour · 0–23", min: 0, max: 23, step: 1 },
    { key: "endHour", label: "Occupied hours end (exclusive)", unit: "hour · 1–24", min: 1, max: 24, step: 1 },
    { key: "summerPercent", label: "June–August occupancy", unit: "% of full", min: 0, max: 100, step: 1 },
  ] },
  { title: "Envelope and outdoor air", fields: [
    { key: "infiltrationAch", label: "Infiltration (all hours)", unit: "air changes/hr", min: 0, max: 3, step: 0.01 },
    { key: "ventilationPerson", label: "Outdoor air per occupant", unit: "CFM/person", min: 0, max: 50, step: 0.5 },
    { key: "ventilationArea", label: "Outdoor air per floor area", unit: "CFM/ft²", min: 0, max: 1, step: 0.01 },
  ] },
  { title: "Internal heat gains", fields: [
    { key: "lightingW", label: "Full lighting power", unit: "W/ft²", min: 0, max: 5, step: 0.1 },
    { key: "equipmentW", label: "Full equipment power", unit: "W/ft²", min: 0, max: 10, step: 0.1 },
    { key: "sensiblePerson", label: "Sensible heat per occupant", unit: "BTU/hr·person", min: 0, max: 1000, step: 5 },
    { key: "latentPerson", label: "Latent heat per occupant", unit: "BTU/hr·person", min: 0, max: 1000, step: 5 },
  ] },
  { title: "Solar gains · rectangular building", fields: [
    { key: "windowPercent", label: "Window-to-wall area", unit: "% on each façade", min: 0, max: 95, step: 1 },
    { key: "shgc", label: "Glazing SHGC", unit: "fraction of incident solar gain", min: 0, max: 1, step: 0.01 },
    { key: "shadeFactor", label: "Window solar multiplier", unit: "0 = fully shaded; 1 = unshaded", min: 0, max: 1, step: 0.05 },
    { key: "roofU", label: "Roof U-value", unit: "BTU/hr·ft²·°F", min: 0, max: 1, step: 0.01 },
    { key: "wallU", label: "Opaque wall U-value", unit: "BTU/hr·ft²·°F", min: 0, max: 1, step: 0.01 },
    { key: "solarAbsorptance", label: "Roof / wall solar absorptance", unit: "fraction", min: 0, max: 1, step: 0.05 },
    { key: "outdoorFilm", label: "Exterior surface film coefficient", unit: "BTU/hr·ft²·°F", min: 1, max: 10, step: 0.1 },
    { key: "groundReflectance", label: "Ground solar reflectance", unit: "fraction", min: 0, max: 1, step: 0.05 },
  ] },
];

// Return null when the assumptions are valid, otherwise return a readable reason.
// This is an input check, not a calculation of equipment performance.
export function validateSchool(a: SchoolAssumptions): string | null {
  for (const field of SCHOOL_FIELDS.flatMap(g => g.fields)) {
    const value = a[field.key];
    if (!Number.isFinite(value) || value < field.min || value > field.max) return `${field.label} must be between ${field.min} and ${field.max}.`;
    if (field.options && !field.options.some(option => option.value === value)) return `Select a listed ${field.label.toLowerCase()}.`;
    if (["people", "startHour", "endHour", "stories"].includes(field.key) && !Number.isInteger(value)) return `${field.label} must be a whole number.`;
  }
  if (a.heatingF >= a.coolingF || a.setbackHeatingF >= a.setbackCoolingF) return "Each heating setpoint must be lower than its cooling setpoint.";
  if (a.setbackHeatingF > a.heatingF || a.setbackCoolingF < a.coolingF) return "Unoccupied heating must be at or below occupied heating, and unoccupied cooling at or above occupied cooling.";
  if (a.startHour >= a.endHour) return "The occupied start hour must be earlier than the end hour.";
  return null;
}

export const fahrenheit = (c: number) => c * 9 / 5 + 32;
export const celsius = (f: number) => (f - 32) * 5 / 9;

export function envelopeUA(a: SchoolAssumptions): number {
  const footprint = a.floorAreaFt2 / a.stories;
  const length = Math.sqrt(footprint * a.aspectRatio), width = footprint / length;
  const roofArea = footprint;
  const opaqueWallArea = 2 * (length + width) * a.stories * a.ceilingFt * (1 - a.windowPercent / 100);
  return a.roofU * roofArea + a.wallU * opaqueWallArea;
}

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

export function humidityRatio(c: number | null, rh: number | null): number | null {
  const pv = vaporPressure(c, rh);
  return pv === null || pv >= PRESSURE_PA ? null : 0.621945 * pv / (PRESSURE_PA - pv);
}

const saturatedRatio = (c: number) => { const p=saturationPressure(c); return p===null || p>=PRESSURE_PA ? null : .621945*p/(PRESSURE_PA-p); };
/** ASHRAE wet-bulb relations, adapted from PsychroLib (MIT; THIRD_PARTY_NOTICES.md). */
export function humidityRatioAtWetBulb(dryC: number, wetC: number): number | null {
  const ws=saturatedRatio(wetC);
  if (ws===null || !Number.isFinite(dryC) || wetC>dryC) return null;
  return wetC>=0 ? ((2501-2.326*wetC)*ws-1.006*(dryC-wetC))/(2501+1.86*dryC-4.186*wetC)
    : ((2830-.24*wetC)*ws-1.006*(dryC-wetC))/(2830+1.86*dryC-2.1*wetC);
}
// Invert the humidity-ratio relation by bisection. Wet bulb is bounded by dry bulb;
// supersaturated/invalid inputs return null. Wet bulbs are not averaged directly.
export function wetBulbF(dryF: number, w: number): number | null {
  if (!Number.isFinite(dryF)) return null;
  const dry=celsius(dryF), saturated=saturatedRatio(dry);
  if (!Number.isFinite(w) || w<0 || saturated===null || w>saturated+1e-10) return null;
  let low=-100, high=dry;
  for (let i=0;i<32;i++) {
    const middle=(low+high)/2, candidate=humidityRatioAtWetBulb(dry,middle);
    if (candidate===null) return null;
    if (candidate>w) high=middle; else low=middle;
  }
  return fahrenheit((low+high)/2);
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateLabel = (r: ClimateRow) => `${r.year}-${pad(r.month)}-${pad(r.day)}`;
export const timeLabel = (r: ClimateRow) => `${pad(r.hour)}:${pad(r.minute)}`;

// An enriched hourly weather record. The & operator combines the ClimateRow fields
// with the calculated fields below, similar to adding keys to a Python dict.
export type SchoolRow = ClimateRow & {
  temperatureF: number | null; wetBulbF: number | null;
  sensibleCooling: number | null; latentCooling: number | null; totalCooling: number | null; heating: number | null;
  occupied: boolean; occupants: number; outdoorAirCfm: number;
  ventilationCfm: number; infiltrationCfm: number;
  heatBalance: number | null; coolBalance: number | null; heatTransfer: number;
  freeFloatF: number | null; heatingSetpointF: number; coolingSetpointF: number;
  solarGain: number | null; windowSolarGain: number | null; opaqueSolarGain: number | null; solarStatus: string;
};

// Main building calculation: rows.map(...) produces one SchoolRow per weather hour.
// a is the assumptions object; site holds the dataset coordinates and UTC offset.
export function simulateSchool(rows: ClimateRow[], a: SchoolAssumptions, site?: SolarLocation | null, designDay?: "heating" | "cooling"): SchoolRow[] {
  const error = validateSchool(a); if (error) throw new Error(error);
  // Area already includes every floor. Multiplying by height per floor gives
  // total conditioned volume; multiplying by stories again would double count.
  const area = a.floorAreaFt2;
  const infiltration = a.infiltrationAch * area * a.ceilingFt / 60;
  // Calculate conductive envelope UA from the same roof and opaque-wall
  // U-values used by the solar model. Geometry matches solarGains: equal
  // floor plates, a rectangular footprint, and glazing spread over façades.
  const ua = envelopeUA(a);
  return rows.map(row => {
    // Use the CSV's calendar directly. Date.UTC avoids shifting weekdays in
    // a visitor's browser time zone; the source excludes daylight saving time.
    const weekday = new Date(Date.UTC(row.year, row.month - 1, row.day)).getUTCDay();
    const schoolHour = (Boolean(designDay) || weekday > 0 && weekday < 6) && row.hour >= a.startHour && row.hour < a.endHour;
    // fraction is the occupancy fraction, not a compressor duty fraction.
    // It drives people, ventilation and internal-gain schedules for this hour.
    // Design days represent a scheduled working day and use the same seasonal
    // occupancy reduction as annual operation. Sizing later excludes empty hours.
    const fraction = schoolHour ? (row.month >= 6 && row.month <= 8 ? a.summerPercent / 100 : 1) : 0;
    const occupied = fraction > 0;
    const occupants = a.people * fraction;
    const ventilation = occupied ? occupants * a.ventilationPerson + area * a.ventilationArea : 0;
    const outdoorAirCfm = infiltration + ventilation;
    // Hourly steady-state allowance, not subhourly ON/OFF hysteresis. Preserve
    // entered design temperatures so this control allowance cannot undersize units.
    const band = designDay ? 0 : a.thermostatDeadbandF;
    const heatSetpoint = (designDay === "heating" ? a.heatingF : occupied ? a.heatingF : a.setbackHeatingF) - band;
    const coolSetpoint = (occupied ? a.coolingF : a.setbackCoolingF) + band;
    const tempF = row.temperature !== null && Number.isFinite(row.temperature) && row.temperature >= -100 && row.temperature <= 100 ? fahrenheit(row.temperature) : null;
    // heatTransfer is K = UA + 1.08 * outdoor-air CFM [BTU/hr/F].
    // Both infiltration and scheduled ventilation belong in this building balance.
    const heatTransfer = ua + 1.08 * outdoorAirCfm;
    const solar = solarGains(row, a, area, site);
    // Initialize dependent results as null. If temperature or solar data are missing,
    // return this record instead of treating an unknown load as zero.
    const outdoorW = humidityRatio(row.temperature, row.humidity);
    const base: SchoolRow = { ...row, temperatureF: tempF, wetBulbF: tempF === null || outdoorW === null ? null : wetBulbF(tempF, outdoorW), sensibleCooling: null, latentCooling: null, totalCooling: null, heating: null, occupied, occupants, outdoorAirCfm,
      ventilationCfm: ventilation, infiltrationCfm: infiltration, heatBalance: null, coolBalance: null, heatTransfer, freeFloatF: null, heatingSetpointF: heatSetpoint, coolingSetpointF: coolSetpoint,
      solarGain: solar.total, windowSolarGain: solar.windows, opaqueSolarGain: solar.opaque, solarStatus: solar.status };
    if (tempF === null || solar.total === null) return base;
    // Unoccupied lighting is 10% and equipment is 25% of full power. These electrical
    // inputs become sensible heat here; their electricity is not billed in HVAC totals.
    const lighting = area * a.lightingW * (0.10 + 0.90 * fraction) * BTU_PER_WH;
    const equipment = area * a.equipmentW * (0.25 + 0.75 * fraction) * BTU_PER_WH;
    // Winter sizing does not rely on solar or internal gains to meet the load.
    const gains = designDay === "heating" ? 0 : lighting + equipment + occupants * a.sensiblePerson + solar.total;
    // These expressions are the familiar steady-state heat balance, clipped at zero.
    // Cooling is negated only when the result is stored at the return statement.
    const sensible = Math.max(0, heatTransfer * (tempF - coolSetpoint) + gains);
    const heating = Math.max(0, heatTransfer * (heatSetpoint - tempF) - gains);
    // A thermostat deadband: estimate the equilibrium zone temperature, then
    // clamp to the active heating/cooling setpoints for the humidity target.
    const zoneF = Math.min(coolSetpoint, Math.max(heatSetpoint, tempF + gains / heatTransfer));
    // Calculate moisture demand separately. The 0.68 coefficient uses CFM and grains/lb;
    // 7000 converts humidity ratio from lb/lb to grains/lb before that multiplication.
    const indoorW = humidityRatio(celsius(zoneF), a.indoorRh)!;
    const latent = outdoorW === null ? null : Math.max(0, 0.68 * outdoorAirCfm * 7000 * (outdoorW - indoorW) + occupants * a.latentPerson);
    return { ...base, sensibleCooling: sensible === 0 ? 0 : -sensible, latentCooling: latent === null ? null : latent === 0 ? 0 : -latent,
      totalCooling: latent === null ? null : sensible + latent === 0 ? 0 : -(sensible + latent), heating,
      heatBalance: heatTransfer * (heatSetpoint - tempF) - gains, coolBalance: heatTransfer * (tempF - coolSetpoint) + gains, freeFloatF: tempF + gains / heatTransfer };
  });
}

// Reduce the hourly list to heating/cooling peaks and daily plot values.
// A negative cooling peak is the most negative record, not the largest number.
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

// Write assumptions/metadata first, then the hourly table. Formatting to four
// decimal places happens only in the export, not in the load calculations.
export function schoolCsv(rows: SchoolRow[], a: SchoolAssumptions, location: string, zone: string, site?: SolarLocation | null): string {
  const metadata: Record<string, string | number> = {
    Model: MODEL_VERSION, Location: location, Time: zone, Floor_area_ft2: a.floorAreaFt2,
    Number_of_floors: a.stories, Building_footprint_ft2: a.floorAreaFt2 / a.stories,
    Conditioned_volume_ft3: a.floorAreaFt2 * a.ceilingFt,
    Basis: "Illustrative single-zone hourly steady-state load estimate; cooling negative; heating positive; total cooling includes sensible cooling",
    Schedule: "Mon-Fri; June-Aug reduced occupancy; no holidays; fixed local standard time; no Feb 29",
    Thermostat_deadband_F: a.thermostatDeadbandF,
    Thermostat_control: "Annual sensible loads use heating setpoint minus deadband and cooling setpoint plus deadband, including setbacks; humidity control remains active; design sizing uses entered setpoints without this allowance. Hourly steady-state model does not resolve starts, minimum run/off times or temperature hysteresis.",
    Solar_method: "Sup3rCC DHI/DNI/GHI W/m2; NOAA solar position at hourly midpoint; vertical walls use DNI projection + DHI/2 + ground reflectance x GHI/2; horizontal roof uses GHI; glazing SHGC and steady-state sol-air correction; no thermal lag or longwave sky correction",
    Solar_latitude: site?.latitude ?? "", Solar_longitude: site?.longitude ?? "", Solar_UTC_offset: site?.utcOffset ?? "",
    Envelope_UA_BTU_hr_F: envelopeUA(a),
    Limitations: "No thermal mass, warm-up, zoning, equipment losses, heat recovery, economizer, fan heat, reheat or humidification in building loads; standard sea-level air; envelope conduction UA is calculated from roof and opaque-wall U-values and modeled geometry; windows are excluded from conductive UA",
    Dew_point: "ASHRAE ice/water saturation convention; frost point below freezing; blank at RH=0 or missing input",
    Wet_bulb: "ASHRAE wet-bulb relations at 101325 Pa from dry bulb and RH; blank for missing or invalid input",
    ...Object.fromEntries(SCHOOL_FIELDS.flatMap(g => g.fields.map(f => [`${f.label} (${f.unit})`, a[f.key]]))),
  };
  const escape = (v: unknown) => v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const precision = (v: number | null) => v === null ? null : Number(v.toFixed(4));
  return [line(Object.keys(metadata)), line(Object.values(metadata)), "",
    line(["Date", "Time_local", "Air_temperature_F", "Wet_bulb_F", "Sensible_cooling_BTU_hr", "Latent_cooling_BTU_hr", "Total_cooling_BTU_hr", "Heating_BTU_hr", "Occupied", "Occupants", "Outdoor_air_including_infiltration_CFM", "DHI_W_m2", "DNI_W_m2", "GHI_W_m2", "Solar_gain_BTU_hr", "Window_solar_gain_BTU_hr", "Opaque_solar_gain_BTU_hr", "Solar_status"]),
    ...rows.map(r => line([dateLabel(r), timeLabel(r), precision(r.temperatureF), precision(r.wetBulbF), precision(r.sensibleCooling), precision(r.latentCooling), precision(r.totalCooling), precision(r.heating), r.occupied ? "Yes" : "No", r.occupants, precision(r.outdoorAirCfm), r.dhi, r.dni, r.ghi, precision(r.solarGain), precision(r.windowSolarGain), precision(r.opaqueSolarGain), r.solarStatus])),
  ].join("\r\n");
}
