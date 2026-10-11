export type PerformanceFamily = "standard" | "lab" | "variable" | "cold";
export type HeatingType = PerformanceFamily | "gas" | "resistance";
export type CoolingType = "standard" | "lab" | "variable";
export type SystemChoice = { heating: HeatingType; cooling: CoolingType; lockoutF: number };
export const DEFAULT_SYSTEM: SystemChoice = { heating: "standard", cooling: "standard", lockoutF: 0 };
export const ALTERNATIVE_SYSTEM: SystemChoice = { heating: "gas", cooling: "standard", lockoutF: 0 };
export const COMSTOCK_COMMIT = "f25ac375311acb2448b4ee1665a8680e92abd24b";
const base = `https://github.com/NatLabRockies/ComStock/blob/${COMSTOCK_COMMIT}/resources/measures/upgrade_hvac_add_heat_pump_rtu/`;
export const FAMILIES = {
  standard: { name: "Standard heat pump", file: "performance_maps_hprtu_std.json", description: "Commercial standard-performance maps. Highest cooling stage and single heating stage, with cycling.", coolingReferenceCfm: 404, heatingReferenceCfm: 420 },
  lab: { name: "Lab-data heat pump", file: "performance_maps_hprtu_lab_data.json", description: "NLR's alternative laboratory-informed capacity and efficiency maps. Full-output CAV operation.", coolingReferenceCfm: 404, heatingReferenceCfm: 420 },
  variable: { name: "High-performance HP · CAV", file: "performance_maps_hprtu_variable_speed.json", description: "Highest-stage curves from NLR's variable-speed family, operated with full-output cycling and CAV fans. Modulation savings are not included.", coolingReferenceCfm: 365, heatingReferenceCfm: 411 },
  cold: { name: "Cold-climate HP · concept", file: "performance_map_CCHP_spec_2027.json", description: "Hypothetical 2027 challenge specification, not a product. High heating stage; boost allowed at 17°F and below. Full-output cycling with CAV fans.", coolingReferenceCfm: 365, heatingReferenceCfm: 411 },
} as const;
export const familySource = (family: PerformanceFamily) => base + "resources/" + FAMILIES[family].file;
export const FURNACE_SOURCE = `https://github.com/NatLabRockies/ComStock/blob/${COMSTOCK_COMMIT}/documentation/reference_doc/tables/furnace_eff_table.tex`;
export const RESISTANCE_SOURCE = "https://docs.nlr.gov/docs/fy24osti/86601.pdf";
export const HEATING_OPTIONS: { id: HeatingType; name: string; description: string; source: string }[] = [
  ...Object.entries(FAMILIES).map(([id, f]) => ({ id: id as PerformanceFamily, name: f.name, description: f.description, source: familySource(id as PerformanceFamily) })),
  { id: "gas", name: "Gas furnace · 80%", description: "ComStock baseline gas-coil efficiency: 80%. Heating bank sized separately to the year's peak coil heat need with no margin, in 10,000 BTU/hr per-unit output increments. Gas is reported in therms.", source: FURNACE_SOURCE },
  { id: "resistance", name: "Electric resistance · COP 1", description: "ComStock electric-coil model: COP 1. Heating bank sized separately to peak coil heat need with no margin, in 10,000 BTU/hr per-unit output increments.", source: RESISTANCE_SOURCE },
];
export const COOLING_OPTIONS: { id: CoolingType; name: string; description: string }[] = [
  { id: "standard", name: "Standard DX cooling", description: "Highest cooling stage from the standard HP-RTU family." },
  { id: "lab", name: "Lab-data DX cooling", description: "Highest cooling stage from the laboratory-informed HP-RTU family." },
  { id: "variable", name: "High-performance DX · CAV", description: "Highest cooling stage from the variable-speed family; also used by the cold-climate concept. Full-output cycling." },
];
export function isHeatPump(type: HeatingType): type is PerformanceFamily { return type !== "gas" && type !== "resistance"; }
export const heatingName = (id: HeatingType) => HEATING_OPTIONS.find(o => o.id === id)!.name;
export const coolingName = (id: CoolingType) => COOLING_OPTIONS.find(o => o.id === id)!.name;
export function validateSystem(system: SystemChoice): string | null {
  if (!HEATING_OPTIONS.some(o => o.id === system.heating) || !COOLING_OPTIONS.some(o => o.id === system.cooling)) return "Select supported heating and cooling equipment.";
  if (!Number.isFinite(system.lockoutF) || system.lockoutF < -15 || system.lockoutF > 40) return "Heat-pump lockout must be between −15°F and 40°F.";
  return null;
}
