/**
 * EQUIPMENT INPUT DEFINITIONS. Type declarations describe allowed choices,
 * like checking the keys and possible values of a Python dictionary.
 * The combination name is derived from heating and cooling choices.
 * No building loads or hourly energy are calculated here.
 */

export type HeatingEquipment = "heat-pump" | "gas" | "resistance";
export type CoolingEquipment = "heat-pump";
export type CurveRangeMode = "bounded" | "strict";
export type EquipmentScenario = { heating: HeatingEquipment; cooling: CoolingEquipment | null; efficiency: "standard" | "high"; gasEfficiencyPercent: number | null; rangeMode?: CurveRangeMode };
export const curveRangeMode = (scenario: EquipmentScenario): CurveRangeMode => scenario.rangeMode ?? "bounded";
export const EQUIPMENT_NAMES: Record<HeatingEquipment, string> = { "heat-pump": "Rooftop Packaged Heat Pump", gas: "Natural Gas", resistance: "Electric Resistance" };
export const coolingFor = (scenario: EquipmentScenario): CoolingEquipment | null => scenario.heating==="heat-pump"?"heat-pump":scenario.cooling??null;
export const scenarioName = (scenario: EquipmentScenario): string => `${coolingFor(scenario)?"Heat Pump Cooling":"Cooling Required"} + ${scenario.heating==="heat-pump"?"Heat Pump":EQUIPMENT_NAMES[scenario.heating]} Heating`;
export const newScenario = (heating: HeatingEquipment = "heat-pump"): EquipmentScenario => ({ heating, cooling: heating==="heat-pump"?"heat-pump":null, efficiency: "standard", gasEfficiencyPercent: null, rangeMode: "bounded" });
export function validGasEfficiency(percent: number | null): percent is number { return typeof percent === "number" && Number.isFinite(percent) && percent > 0 && percent <= 100; }
