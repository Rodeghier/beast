/**
 * BUILDING LOAD WORKSHEET. Start reading at DEFAULT_SCHOOL, then simulateSchool.
 * One input row is one hour of weather; one output row adds building thermal loads.
 * Thermal rates are BTU/hr. Stored cooling loads are negative; heating is positive.
 * This module does not calculate compressor, heater or fan electricity.
 * Reader map: docs/REPOSITORY_GUIDE.md sections 4 through 7.
 */

import type { ClimateRow } from "./csv";
import { COMSTOCK_CONSTRUCTION_SOURCE, FLOAT_GLASS_SOURCE, MATERIAL_PROPERTY_SOURCE, SUPERMARKET_ROOF_SOURCE, WOOD_FRAMING_SOURCE, envelopePreset, envelopePresetForProfile, type EnvelopeConstruction, type EnvelopeSurface } from "./envelope-construction";
import { AREAL_CAPACITY_TO_BTU_F_FT2, AREAL_CONDUCTANCE_TO_BTU_HR_F_FT2, INTERNAL_MASS_SOURCE, THERMAL_MASS_BASIS, thermalMassHour } from "./thermal-mass";
import { solarGains, type SolarLocation } from "./solar";

export const MODEL_VERSION = "building-solar-2.8";
export const BTU_PER_WH = 3.412141633;
const PRESSURE_PA = 101325;
export const SLAB_F2_OPTIONS = [
  { value: 0.73, label: "Uninsulated slab" },
  { value: 0.54, label: "R-5, 2' depth" },
  { value: 0.5, label: "R-5, 4' depth" },
  { value: 0.52, label: "R-10, 2' depth" },
  { value: 0.45, label: "R-10, 4' depth" },
  { value: 0.4, label: "R-15, 2' depth" },
  { value: 0.35, label: "R-15, 4' depth" },
  { value: 0.32, label: "R-20, 4' depth" },
] as const;

// Editable building assumptions. Numbers are engineering inputs; SCHOOL_FIELDS below
// adds labels, allowed ranges and units for the input form.
export const DEFAULT_SCHOOL = {
  floorAreaFt2: 150_000,
  coolingDesignPercent: 1, heatingDesignPercent: 99,
  heatingF: 70, coolingF: 75, setbackHeatingF: 60, setbackCoolingF: 85, indoorRh: 50,
  thermostatDeadbandF: 2,
  minimumCompressorOnMinutes: 20,
  people: 1200, startHour: 7, endHour: 17, weekendStartHour: 0, weekendEndHour: 0, summerPercent: 10,
  ceilingFt: 14, infiltrationAch: 0.15, slabF2: 0.73,
  ventilationPerson: 10, ventilationArea: 0.12,
  lightingW: 0.9, equipmentW: 0.6, sensiblePerson: 245, latentPerson: 155,
  stories: 2, aspectRatio: 2, rotationDeg: 0, windowPercent: 25, shgc: 0.35, shadeFactor: 1,
  interiorMassKjM2K: 0, interiorMassCouplingWm2K: 6,
  wallCapacityKjM2K: 0, roofCapacityKjM2K: 0, windowCapacityKjM2K: 0, slabCapacityKjM2K: 0,
  roofU: 0.04, wallU: 0.06, windowU: 0.50, roofSolarAbsorptance: 0.6, wallSolarAbsorptance: 0.6, outdoorFilm: 3, groundReflectance: 0.2,
};
const OPTIONAL_SCHOOL_FIELDS = [
  "weekendStartHour", "weekendEndHour", "windowU", "interiorMassKjM2K", "interiorMassCouplingWm2K",
  "wallCapacityKjM2K", "roofCapacityKjM2K", "windowCapacityKjM2K", "slabCapacityKjM2K",
] as const;
type AddedSchoolField = (typeof OPTIONAL_SCHOOL_FIELDS)[number];
export type SchoolAssumptions = Omit<typeof DEFAULT_SCHOOL, AddedSchoolField> & Partial<Pick<typeof DEFAULT_SCHOOL, AddedSchoolField>> & {
  construction?: EnvelopeConstruction;
  materialPresets?: Partial<Record<EnvelopeSurface, string>>;
  stockEnvelopeCoefficients?: Partial<Record<EnvelopeSurface, number>>;
  interiorMassSource?: string;
};
export type SchoolField = { key: keyof typeof DEFAULT_SCHOOL; label: string; unit: string; min: number; max: number; step: number; options?: { value: number; label: string }[] };

export const ENVELOPE_FIELDS = {
  wall: { label: "Opaque wall", coefficient: "wallU", capacity: "wallCapacityKjM2K" },
  roof: { label: "Roof", coefficient: "roofU", capacity: "roofCapacityKjM2K" },
  window: { label: "Window", coefficient: "windowU", capacity: "windowCapacityKjM2K" },
  slab: { label: "Slab", coefficient: "slabF2", capacity: "slabCapacityKjM2K" },
} as const;
export const ENVELOPE_SURFACES = Object.keys(ENVELOPE_FIELDS) as EnvelopeSurface[];

export function selectedEnvelopeProfile(a: SchoolAssumptions, surface: EnvelopeSurface) {
  const selection = a.materialPresets?.[surface];
  const imported = a.construction?.[surface];
  if (imported && (!selection || selection === "stock")) return imported;
  return envelopePreset(surface, selection).profile;
}

export function applyEnvelopePreset(a: SchoolAssumptions, surface: EnvelopeSurface, id: string): SchoolAssumptions {
  const fields = ENVELOPE_FIELDS[surface];
  const stock = id === "stock" ? a.construction?.[surface] : null;
  const preset = stock ? envelopePresetForProfile(surface, stock) : envelopePreset(surface, id);
  const capacity = stock?.arealHeatCapacityKjM2K ?? preset.profile.arealHeatCapacityKjM2K ?? 0;
  return { ...a, materialPresets: { ...a.materialPresets, [surface]: stock ? "stock" : preset.id },
    [fields.coefficient]: stock ? a.stockEnvelopeCoefficients?.[surface] ?? preset.coefficient : preset.coefficient,
    [fields.capacity]: Number(capacity.toPrecision(2)) };
}

export function applyEnvelopeDefaults(current: SchoolAssumptions, imported: Partial<SchoolAssumptions>): SchoolAssumptions {
  const stockEnvelopeCoefficients: Partial<Record<EnvelopeSurface, number>> = {};
  const next = { ...current, ...imported, materialPresets: {}, stockEnvelopeCoefficients };
  for (const surface of ENVELOPE_SURFACES) {
    const fields = ENVELOPE_FIELDS[surface];
    const stock = next.construction?.[surface];
    const preset = envelopePresetForProfile(surface, stock);
    next[fields.coefficient] = imported[fields.coefficient] ?? preset.coefficient;
    if (stock) stockEnvelopeCoefficients[surface] = next[fields.coefficient];
    const capacity = stock?.arealHeatCapacityKjM2K ?? preset.profile.arealHeatCapacityKjM2K ?? 0;
    next[fields.capacity] = Number(capacity.toPrecision(2));
  }
  return next;
}

export function comstockUsesSchoolSummerSchedule(buildingType: string): boolean {
  return buildingType === "PrimarySchool" || buildingType === "SecondarySchool";
}

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
    { key: "minimumCompressorOnMinutes", label: "Minimum compressor ON-time", unit: "minutes per hour; 0 disables cutoff", min: 0, max: 60, step: 1 },
    { key: "thermostatDeadbandF", label: "Thermostat deadband (+/-)", unit: "°F", min: 0, max: 5, step: 0.5 },
    { key: "heatingF", label: "Occupied heating setpoint", unit: "°F", min: 40, max: 85, step: 1 },
    { key: "coolingF", label: "Occupied cooling setpoint", unit: "°F", min: 60, max: 100, step: 1 },
    { key: "setbackHeatingF", label: "Unoccupied heating setpoint", unit: "°F", min: 35, max: 85, step: 1 },
    { key: "setbackCoolingF", label: "Unoccupied cooling setpoint", unit: "°F", min: 60, max: 110, step: 1 },
    { key: "indoorRh", label: "Maximum indoor RH", unit: "%", min: 20, max: 70, step: 1 },
  ] },
  { title: "Occupancy schedule", fields: [
    { key: "people", label: "Total people at full occupancy", unit: "people · all floors combined", min: 0, max: 10000, step: 1 },
    { key: "startHour", label: "Weekday occupied start", unit: "hour · 0–23", min: 0, max: 23, step: 1 },
    { key: "endHour", label: "Weekday occupied end (exclusive)", unit: "hour · 0–24", min: 0, max: 24, step: 1 },
    { key: "weekendStartHour", label: "Weekend occupied start", unit: "hour · 0–23", min: 0, max: 23, step: 1 },
    { key: "weekendEndHour", label: "Weekend occupied end (exclusive)", unit: "hour · 0–24", min: 0, max: 24, step: 1 },
    { key: "summerPercent", label: "June–August occupancy", unit: "% of full", min: 0, max: 100, step: 1 },
  ] },
  { title: "Envelope and outdoor air", fields: [
    { key: "slabF2", label: "Slab edge heat loss coefficient (F₂)", unit: "BTU/hr·ft·°F", min: 0.32, max: 0.73, step: 0.01, options: SLAB_F2_OPTIONS.map(option => ({ ...option })) },
    { key: "roofU", label: "Roof U-value", unit: "BTU/hr·ft²·°F", min: 0, max: 1, step: 0.01 },
    { key: "wallU", label: "Opaque wall U-value", unit: "BTU/hr·ft²·°F", min: 0, max: 1, step: 0.01 },
    { key: "windowU", label: "Window U-value", unit: "BTU/hr·ft²·°F", min: 0, max: 2, step: 0.01 },
    { key: "wallCapacityKjM2K", label: "Opaque wall heat capacity", unit: "kJ/(m²·K) of wall", min: 0, max: 2000, step: 1 },
    { key: "roofCapacityKjM2K", label: "Roof heat capacity", unit: "kJ/(m²·K) of roof", min: 0, max: 2000, step: 1 },
    { key: "windowCapacityKjM2K", label: "Window heat capacity", unit: "kJ/(m²·K) of glazing", min: 0, max: 2000, step: 1 },
    { key: "slabCapacityKjM2K", label: "Slab heat capacity", unit: "kJ/(m²·K) of ground floor", min: 0, max: 2000, step: 1 },
    { key: "interiorMassKjM2K", label: "Interior heat capacity", unit: "kJ/(m²·K) of conditioned floor", min: 0, max: 6000, step: 1 },
    { key: "interiorMassCouplingWm2K", label: "Interior-to-air conductance", unit: "W/(m²·K) of conditioned floor", min: 0, max: 200, step: 0.1 },
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
    { key: "roofSolarAbsorptance", label: "Roof solar absorptance", unit: "fraction", min: 0, max: 1, step: 0.05 },
    { key: "wallSolarAbsorptance", label: "Wall solar absorptance", unit: "fraction", min: 0, max: 1, step: 0.05 },
    { key: "outdoorFilm", label: "Exterior surface film coefficient", unit: "BTU/hr·ft²·°F", min: 1, max: 10, step: 0.1 },
    { key: "groundReflectance", label: "Ground solar reflectance", unit: "fraction", min: 0, max: 1, step: 0.05 },
  ] },
];

// Return null when the assumptions are valid, otherwise return a readable reason.
// This is an input check, not a calculation of equipment performance.
export function validateSchool(a: SchoolAssumptions): string | null {
  for (const field of SCHOOL_FIELDS.flatMap(g => g.fields)) {
    const optional = OPTIONAL_SCHOOL_FIELDS.some(key => key === field.key);
    const value = optional ? a[field.key] ?? DEFAULT_SCHOOL[field.key] : a[field.key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < field.min || value > field.max) return `${field.label} must be between ${field.min} and ${field.max}.`;
    if (field.options && !field.options.some(option => option.value === value)) return `Select a listed ${field.label.toLowerCase()}.`;
    if (["people", "startHour", "endHour", "weekendStartHour", "weekendEndHour", "stories"].includes(field.key) && !Number.isInteger(value)) return `${field.label} must be a whole number.`;
  }
  if (a.heatingF >= a.coolingF || a.setbackHeatingF >= a.setbackCoolingF) return "Each heating setpoint must be lower than its cooling setpoint.";
  if (a.setbackHeatingF > a.heatingF || a.setbackCoolingF < a.coolingF) return "Unoccupied heating must be at or below occupied heating, and unoccupied cooling at or above occupied cooling.";
  if (a.startHour === a.endHour && (a.weekendStartHour ?? DEFAULT_SCHOOL.weekendStartHour) === (a.weekendEndHour ?? DEFAULT_SCHOOL.weekendEndHour)) return "Enter occupied hours for weekdays or weekends.";
  return null;
}

export const fahrenheit = (c: number) => c * 9 / 5 + 32;
export const celsius = (f: number) => (f - 32) * 5 / 9;

export function envelopeUA(a: SchoolAssumptions): number {
  const roofArea = a.floorAreaFt2 / a.stories;
  const wallArea = slabPerimeterFt(a) * a.stories * a.ceilingFt;
  const windowArea = wallArea * a.windowPercent / 100;
  return a.roofU * roofArea + a.wallU * (wallArea - windowArea) + (a.windowU ?? DEFAULT_SCHOOL.windowU) * windowArea;
}

export function slabPerimeterFt(a: SchoolAssumptions): number {
  const footprint = a.floorAreaFt2 / a.stories;
  const length = Math.sqrt(footprint * a.aspectRatio), width = footprint / length;
  return 2 * (length + width);
}

export function slabUA(a: SchoolAssumptions): number {
  return a.slabF2 * slabPerimeterFt(a);
}

function occupiedHour(hour: number, [start, end]: readonly [number, number], [previousStart, previousEnd]: readonly [number, number]): boolean {
  const withinToday = hour >= start && (end < start || hour < end);
  const afterMidnight = previousEnd < previousStart && hour < previousEnd;
  return withinToday || afterMidnight;
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
  zoneF?: number; interiorMassF?: number;
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
  // Conductive UA covers the roof, opaque walls, windows and slab edge.
  // Geometry matches solarGains: equal floors and a rectangular footprint.
  const ua = envelopeUA(a) + slabUA(a);
  const roofArea = area / a.stories;
  const wallArea = slabPerimeterFt(a) * a.stories * a.ceilingFt;
  const glazing = a.windowPercent / 100;
  const interiorCoupling = a.interiorMassCouplingWm2K ?? DEFAULT_SCHOOL.interiorMassCouplingWm2K;
  const interiorCapacity = interiorCoupling > 0 ? (a.interiorMassKjM2K ?? 0) * area : 0;
  const indoorNodes = [
    { surface: "interior", capacity: interiorCapacity, conductance: interiorCoupling * area },
    // Use a fraction of the nominal ground slab capacity for hourly storage.
    { surface: "slab", capacity: 0.25 * (a.slabCapacityKjM2K ?? 0) * roofArea, conductance: 3 * roofArea },
  ].filter(node => node.capacity > 0).map(({surface, capacity, conductance}) => ({
    surface, capacity: capacity * AREAL_CAPACITY_TO_BTU_F_FT2,
    toZone: conductance * AREAL_CONDUCTANCE_TO_BTU_HR_F_FT2, toOutdoor: 0,
  }));
  const envelope = [
    { surface: "walls", area: wallArea * (1 - glazing), u: a.wallU, capacity: a.wallCapacityKjM2K ?? 0 },
    { surface: "roof", area: roofArea, u: a.roofU, capacity: a.roofCapacityKjM2K ?? 0 },
    { surface: "windows", area: wallArea * glazing, u: a.windowU ?? DEFAULT_SCHOOL.windowU, capacity: a.windowCapacityKjM2K ?? 0 },
  ];
  // The two resistances in series preserve the editable assembly U-value.
  const shellNodes = envelope.filter(e => e.capacity > 0 && e.area > 0 && e.u > 0).map(e => ({
    surface: e.surface, capacity: e.capacity * e.area * AREAL_CAPACITY_TO_BTU_F_FT2,
    toZone: 2 * e.u * e.area, toOutdoor: 2 * e.u * e.area,
  }));
  const nodes = designDay ? [] : [...indoorNodes, ...shellNodes];
  const modeledUa = nodes.reduce((sum, node) => sum + node.toOutdoor / 2, 0);
  let temperatures: number[] | undefined;
  let previousHour = NaN;
  const weekdayHours = [a.startHour, a.endHour] as const;
  const weekendHours = [a.weekendStartHour ?? DEFAULT_SCHOOL.weekendStartHour, a.weekendEndHour ?? DEFAULT_SCHOOL.weekendEndHour] as const;
  const week = [weekendHours, weekdayHours, weekdayHours, weekdayHours, weekdayHours, weekdayHours, weekendHours];
  return rows.map(row => {
    // Use the CSV's calendar directly. Date.UTC avoids shifting weekdays in
    // a visitor's browser time zone; the source excludes daylight saving time.
    const day = new Date(Date.UTC(row.year, row.month - 1, row.day)).getUTCDay();
    // Design sizing checks all occupied hours across weekday and weekend periods.
    const scheduled = designDay
      ? occupiedHour(row.hour, weekdayHours, weekdayHours) || occupiedHour(row.hour, weekendHours, weekendHours)
      : occupiedHour(row.hour, week[day], week[(day + 6) % 7]);
    // fraction is the occupancy fraction, not a compressor duty fraction.
    // It drives people, ventilation and internal-gain schedules for this hour.
    const fraction = scheduled ? (row.month >= 6 && row.month <= 8 ? a.summerPercent / 100 : 1) : 0;
    const occupied = fraction > 0;
    const occupants = a.people * fraction;
    const ventilation = occupied ? occupants * a.ventilationPerson + area * a.ventilationArea : 0;
    const outdoorAirCfm = infiltration + ventilation;
    // The annual calculation uses the deadband. Design sizing uses the entered temperatures.
    const band = designDay ? 0 : a.thermostatDeadbandF;
    const heatSetpoint = (designDay === "heating" ? a.heatingF : occupied ? a.heatingF : a.setbackHeatingF) - band;
    const coolSetpoint = (occupied ? a.coolingF : a.setbackCoolingF) + band;
    const tempF = row.temperature !== null && Number.isFinite(row.temperature) && row.temperature >= -100 && row.temperature <= 100 ? fahrenheit(row.temperature) : null;
    // Slab edge conduction follows Q = F2 * exposed perimeter * (Tin - Tout).
    // Therefore F2 * perimeter is added as a conductance alongside envelope UA.
    // heatTransfer is K = envelope UA + slab UA + 1.08 * outdoor-air CFM.
    const heatTransfer = ua + 1.08 * outdoorAirCfm;
    const solar = solarGains(row, a, area, site);
    // Initialize dependent results as null. If temperature or solar data are missing,
    // return this record instead of treating an unknown load as zero.
    const outdoorW = humidityRatio(row.temperature, row.humidity);
    const base: SchoolRow = { ...row, temperatureF: tempF, wetBulbF: tempF === null || outdoorW === null ? null : wetBulbF(tempF, outdoorW), sensibleCooling: null, latentCooling: null, totalCooling: null, heating: null, occupied, occupants, outdoorAirCfm,
      ventilationCfm: ventilation, infiltrationCfm: infiltration, heatBalance: null, coolBalance: null, heatTransfer, freeFloatF: null, heatingSetpointF: heatSetpoint, coolingSetpointF: coolSetpoint,
      solarGain: solar.total, windowSolarGain: solar.windows, opaqueSolarGain: solar.opaque, solarStatus: solar.status };
    if (tempF === null || solar.total === null) {
      temperatures = undefined;
      return base;
    }
    // Unoccupied lighting is 10% and equipment is 25% of full power. These electrical
    // inputs become sensible heat here; their electricity is not billed in HVAC totals.
    const lighting = area * a.lightingW * (0.10 + 0.90 * fraction) * BTU_PER_WH;
    const equipment = area * a.equipmentW * (0.25 + 0.75 * fraction) * BTU_PER_WH;
    // Winter sizing does not rely on solar or internal gains to meet the load.
    const gains = designDay === "heating" ? 0 : lighting + equipment + occupants * a.sensiblePerson + solar.total;
    let heatBalance = heatTransfer * (heatSetpoint - tempF) - gains;
    let coolBalance = heatTransfer * (tempF - coolSetpoint) + gains;
    let freeFloatF = heatTransfer > 0 ? tempF + gains / heatTransfer : (heatSetpoint + coolSetpoint) / 2;
    let effectiveUa = heatTransfer;
    let interiorMassF: number | undefined;
    if (nodes.length) {
      const hour = Date.UTC(row.year, row.month - 1, row.day, row.hour, row.minute) / 3600000;
      const interiorGains = indoorNodes.length ? (solar.windows ?? 0) + 0.5 * (lighting + equipment + occupants * a.sensiblePerson) : 0;
      // Opaque solar is expressed at the zone side of assembly U. Double it when
      // applied at the midpoint, so the steady heat flow into the zone is unchanged.
      const forcing = nodes.map(node => ({ outdoorF: tempF,
        heat: node.surface === indoorNodes[0]?.surface ? interiorGains
          : node.surface === "walls" ? 2 * (solar.walls ?? 0) : node.surface === "roof" ? 2 * (solar.roof ?? 0) : 0,
      }));
      const delayedOpaqueGains = nodes.reduce((sum, node, i) => sum + (node.toOutdoor > 0 ? forcing[i].heat / 2 : 0), 0);
      if (!temperatures || hour - previousHour !== 1) {
        const initialZone = Math.min(coolSetpoint, Math.max(heatSetpoint, freeFloatF));
        temperatures = nodes.map(node => node.toOutdoor === 0 ? initialZone : (initialZone + tempF) / 2);
      }
      const solved = thermalMassHour(nodes, temperatures, forcing, Math.max(0, heatTransfer - modeledUa), tempF,
        gains - interiorGains - delayedOpaqueGains, heatSetpoint, coolSetpoint);
      ({ heatBalance, coolBalance, freeFloatF, heatTransfer: effectiveUa, temperatures } = solved);
      if (interiorCapacity > 0) interiorMassF = temperatures[0];
      previousHour = hour;
    }
    const sensible = Math.max(0, coolBalance);
    const heating = Math.max(0, heatBalance);
    const zoneF = Math.min(coolSetpoint, Math.max(heatSetpoint, freeFloatF));
    // Calculate moisture demand separately. The 0.68 coefficient uses CFM and grains/lb;
    // 7000 converts humidity ratio from lb/lb to grains/lb before that multiplication.
    const indoorW = humidityRatio(celsius(zoneF), a.indoorRh)!;
    const latent = outdoorW === null ? null : Math.max(0, 0.68 * outdoorAirCfm * 7000 * (outdoorW - indoorW) + occupants * a.latentPerson);
    return { ...base, sensibleCooling: sensible === 0 ? 0 : -sensible, latentCooling: latent === null ? null : latent === 0 ? 0 : -latent,
      totalCooling: latent === null ? null : sensible + latent === 0 ? 0 : -(sensible + latent), heating,
      heatBalance, coolBalance, heatTransfer: effectiveUa, freeFloatF, zoneF, interiorMassF };
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
  const wallArea = slabPerimeterFt(a) * a.stories * a.ceilingFt;
  const windowArea = wallArea * a.windowPercent / 100;
  const opaqueWallArea = wallArea - windowArea;
  const windowU = a.windowU ?? DEFAULT_SCHOOL.windowU;
  const construction = a.construction;
  const metadata: Record<string, string | number> = {
    Model: MODEL_VERSION, Location: location, Time: zone, Floor_area_ft2: a.floorAreaFt2,
    Number_of_floors: a.stories, Building_footprint_ft2: a.floorAreaFt2 / a.stories,
    Conditioned_volume_ft3: a.floorAreaFt2 * a.ceilingFt,
    Basis: "Illustrative single-zone hourly load estimate; cooling negative; heating positive; total cooling includes sensible cooling",
    Thermal_mass_method: THERMAL_MASS_BASIS,
    Interior_mass_default_source: a.interiorMassSource ?? "",
    ComStock_internal_mass_area_ratio: construction?.interiorMassAreaRatio ?? "",
    Interior_mass_reference: INTERNAL_MASS_SOURCE,
    Schedule: "Weekday and weekend occupied periods; June-August occupancy factor; no holidays; fixed local standard time; no Feb 29",
    Thermostat_deadband_F: a.thermostatDeadbandF,
    Thermostat_control: "Annual sensible loads use heating setpoint minus deadband and cooling setpoint plus deadband, including setbacks; humidity control remains active; design sizing uses entered setpoints without this allowance. Hourly loads do not resolve starts or minimum off-times.",
    Solar_method: "Sup3rCC DHI/DNI/GHI W/m2; NOAA solar position at hourly midpoint; vertical walls use DNI projection + DHI/2 + ground reflectance x GHI/2; horizontal roof uses GHI; glazing SHGC and sol-air forcing; enabled heat storage delays sensible gains",
    Solar_latitude: site?.latitude ?? "", Solar_longitude: site?.longitude ?? "", Solar_UTC_offset: site?.utcOffset ?? "",
    Envelope_UA_BTU_hr_F: envelopeUA(a), Slab_F2_BTU_hr_ft_F: a.slabF2,
    Opaque_wall_area_ft2: opaqueWallArea,
    Wall_U_BTU_hr_ft2_F: a.wallU, Roof_U_BTU_hr_ft2_F: a.roofU,
    Window_area_ft2: windowArea,
    Window_U_BTU_hr_ft2_F: windowU,
    Wall_UA_BTU_hr_F: a.wallU * opaqueWallArea,
    Roof_UA_BTU_hr_F: a.roofU * a.floorAreaFt2 / a.stories,
    Window_UA_BTU_hr_F: windowU * windowArea,
    Slab_perimeter_ft: slabPerimeterFt(a), Slab_UA_BTU_hr_F: slabUA(a),
    Total_conductive_UA_BTU_hr_F: envelopeUA(a) + slabUA(a),
    Limitations: "Single zone; no equipment losses, heat recovery, economizer, fan heat, reheat or humidification in building loads; standard sea-level air; envelope UA sums roof, opaque wall and window U-values times their respective areas; sky longwave exchange is not modeled separately; slab edge conduction uses F2 times exposed perimeter times indoor-to-outdoor temperature difference",
    Dew_point: "ASHRAE ice/water saturation convention; frost point below freezing; blank at RH=0 or missing input",
    Wet_bulb: "ASHRAE wet-bulb relations at 101325 Pa from dry bulb and RH; blank for missing or invalid input",
    ...Object.fromEntries(SCHOOL_FIELDS.flatMap(g => g.fields.map(f => [`${f.label} (${f.unit})`, a[f.key] ?? DEFAULT_SCHOOL[f.key]]))),
    ...(construction && {
      ComStock_construction_type: construction.buildingType,
      ComStock_construction_county: construction.county,
      ComStock_construction_state: construction.state,
      Construction_reference: COMSTOCK_CONSTRUCTION_SOURCE,
      Construction_grocery_roof_reference: construction.buildingType === "Grocery" ? SUPERMARKET_ROOF_SOURCE : "",
    }),
    ...Object.fromEntries(ENVELOPE_SURFACES.flatMap(surface => {
      const profile = selectedEnvelopeProfile(a, surface);
      const key = surface[0].toUpperCase() + surface.slice(1);
      return [
        [`${key}_construction`, profile.label],
        [`${key}_construction_basis`, profile.source],
        [`${key}_construction_share`, profile.share ?? ""],
        [`${key}_nominal_heat_capacity_kJ_m2_K`, profile.arealHeatCapacityKjM2K ?? ""],
        [`${key}_representative_mass_layers`, JSON.stringify(profile.layers)],
      ];
    })),
    Construction_material_references: `${MATERIAL_PROPERTY_SOURCE} | ${WOOD_FRAMING_SOURCE} | ${FLOAT_GLASS_SOURCE}`,
    Construction_heat_capacity_basis: "Representative layer density times specific heat times thickness times area fraction. The model uses the editable capacities, with 25% of the ground slab capacity coupled to the zone.",
  };
  const escape = (v: unknown) => v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const precision = (v: number | null) => v === null ? null : Number(v.toFixed(4));
  return [line(Object.keys(metadata)), line(Object.values(metadata)), "",
    line(["Date", "Time_local", "Air_temperature_F", "Wet_bulb_F", "Sensible_cooling_BTU_hr", "Latent_cooling_BTU_hr", "Total_cooling_BTU_hr", "Heating_BTU_hr", "Occupied", "Occupants", "Outdoor_air_including_infiltration_CFM", "DHI_W_m2", "DNI_W_m2", "GHI_W_m2", "Solar_gain_BTU_hr", "Window_solar_gain_BTU_hr", "Opaque_solar_gain_BTU_hr", "Solar_status", "Zone_temperature_F", "Interior_mass_temperature_F"]),
    ...rows.map(r => line([dateLabel(r), timeLabel(r), precision(r.temperatureF), precision(r.wetBulbF), precision(r.sensibleCooling), precision(r.latentCooling), precision(r.totalCooling), precision(r.heating), r.occupied ? "Yes" : "No", r.occupants, precision(r.outdoorAirCfm), r.dhi, r.dni, r.ghi, precision(r.solarGain), precision(r.windowSolarGain), precision(r.opaqueSolarGain), r.solarStatus, precision(r.zoneF ?? null), precision(r.interiorMassF ?? null)])),
  ].join("\r\n");
}
