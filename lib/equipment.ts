/**
 * EQUIPMENT INPUT DEFINITIONS. Type declarations describe allowed choices,
 * like checking the keys and possible values of a Python dictionary.
 * The combination name is derived from heating and cooling choices.
 * No building loads or hourly energy are calculated here.
 */

export type HeatingEquipment = "heat-pump" | "gas" | "resistance";
export type CoolingEquipment = "heat-pump" | "air-cooled-chiller";
export type CurveRangeMode = "bounded" | "strict";
export type EquipmentStage = "automatic" | "single" | "multi" | "variable";
export type BoilerSizeClass = "small" | "large";
export type BoilerFuel = "natural-gas" | "propane" | "light-oil";
export type BoilerFiringMode = "on-off" | "modulating";
export type EquipmentScenario = { heating: HeatingEquipment; cooling: CoolingEquipment | null; efficiency: "standard" | "high"; stage: EquipmentStage; boilerSizeClass: BoilerSizeClass; boilerFuel: BoilerFuel; boilerFiringMode: BoilerFiringMode; gasEfficiencyPercent: number | null; rangeMode?: CurveRangeMode };
export const curveRangeMode = (scenario: EquipmentScenario): CurveRangeMode => scenario.rangeMode ?? "bounded";
export const EQUIPMENT_NAMES: Record<HeatingEquipment, string> = { "heat-pump": "Rooftop Packaged Heat Pump", gas: "Natural Gas", resistance: "Electric Resistance" };
export const COOLING_NAMES:Record<CoolingEquipment,string>={"heat-pump":"Rooftop Packaged Heat Pump","air-cooled-chiller":"Air-cooled chiller (placeholder)"};
export const coolingFor = (scenario: EquipmentScenario): CoolingEquipment | null => scenario.cooling??(scenario.heating==="heat-pump"?"heat-pump":null);
export const coolingEquipmentName=(scenario:EquipmentScenario):string=>{const cooling=coolingFor(scenario);return cooling?COOLING_NAMES[cooling]:"Cooling Required";};
export const BOILER_FUEL_NAMES:Record<BoilerFuel,string>={"natural-gas":"Natural gas",propane:"Propane","light-oil":"No. 2 light oil"};
export const scenarioName = (scenario: EquipmentScenario): string => `${coolingFor(scenario)==="heat-pump"?"Heat Pump":coolingFor(scenario)==="air-cooled-chiller"?"Air-cooled Chiller":"Cooling Required"} Cooling + ${scenario.heating==="heat-pump"?"Heat Pump":scenario.heating==="gas"&&scenario.boilerSizeClass==="large"?`Large Commercial Non-Condensing Boiler (${BOILER_FUEL_NAMES[scenario.boilerFuel??"natural-gas"]}, ${(scenario.boilerFiringMode??"on-off")==="on-off"?"On/off":"Modulating"})`:scenario.heating==="gas"&&scenario.boilerSizeClass==="small"?"Small Non-Condensing Boiler":EQUIPMENT_NAMES[scenario.heating]} Heating`;
export const newScenario = (heating: HeatingEquipment = "heat-pump"): EquipmentScenario => ({ heating, cooling: heating==="heat-pump"?"heat-pump":null, efficiency: "standard", stage: "automatic", boilerSizeClass: "small", boilerFuel: "natural-gas", boilerFiringMode: "on-off", gasEfficiencyPercent: null, rangeMode: "bounded" });
export function validGasEfficiency(percent: number | null): percent is number { return typeof percent === "number" && Number.isFinite(percent) && percent > 0 && percent <= 100; }
