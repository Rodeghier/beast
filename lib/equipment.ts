export type HeatingEquipment = "heat-pump" | "gas" | "resistance";
export type EquipmentScenario = { name: string; heating: HeatingEquipment; efficiency: "standard" | "high"; gasEfficiencyPercent: number | null };
export const EQUIPMENT_NAMES: Record<HeatingEquipment, string> = { "heat-pump": "Rooftop Packaged Heat Pump", gas: "Natural Gas", resistance: "Electric Resistance" };
export const newScenario = (name: string, heating: HeatingEquipment = "heat-pump"): EquipmentScenario => ({ name, heating, efficiency: "standard", gasEfficiencyPercent: null });
export function validGasEfficiency(percent: number | null): percent is number { return typeof percent === "number" && Number.isFinite(percent) && percent > 0 && percent <= 100; }
