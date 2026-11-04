/**
 * HOURLY LOAD DISTRIBUTIONS. Read the existing simulation outputs; do not size
 * equipment again. Percentages refer to the entire installed bank of units.
 * Thermal capacity and input power both exclude the separately reported supply
 * fan. Cooling capacity is gross coil output. Heating capacity is heater/coil
 * output, with the supply-fan heat removed from the delivered building heat.
 * One row is one hour, so its kWh is numerically its average kW during that hour.
 * These are hourly averages, not instantaneous stage positions or start counts.
 */
import { AIR_COOLED_CHILLER_KW_PER_TON, BTU_PER_KWH, type EquipmentResult } from "./equipment-model";
import { coolingFor } from "./equipment";
import { unitRatingFor } from "./unit-ratings";

export type UtilizationMode = "heating" | "cooling";
export type UtilizationSamples = { capacity: (number | null)[]; power: (number | null)[] };
export type UtilizationBin = { range: string; hours: number; percentOfHours: number };
export type UtilizationDistribution = {
  bins: UtilizationBin[]; plottedHours: number; missingHours: number; zeroHours: number;
};
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

function percent(used: number | null | undefined, full: number | null | undefined): number | null {
  if (!finite(used) || used < 0) return null;
  // A known zero output is still known when no operating-point denominator was
  // evaluated (the simulation intentionally skips idle heat-pump curve calls).
  if (used === 0) return 0;
  return finite(full) && full > 0 ? used / full * 100 : null;
}

export function equipmentUtilization(result: EquipmentResult, mode: UtilizationMode): UtilizationSamples {
  const capacity: (number | null)[] = [], power: (number | null)[] = [];
  const selection = result.selection;
  const rating = selection ? unitRatingFor(selection.model) : null;
  const fanKw = selection && rating ? selection.count * rating.inferred_supply_fan_power_kW : null;
  const coolingFullKw = coolingFor(result.scenario) === "air-cooled-chiller"
    ? result.coolingCapacityTons === null ? null : result.coolingCapacityTons * AIR_COOLED_CHILLER_KW_PER_TON
    : selection && rating ? selection.count * rating.cooling_non_supply_fan_power_kW : null;

  for (const row of result.rows) {
    // An invalid/unsupported selection is not an idle system. Its samples must
    // remain unavailable even if some component fields happen to contain zero.
    if (result.error) { capacity.push(null); power.push(null); continue; }
    if (mode === "cooling") {
      capacity.push(percent(row.deliveredCooling, row.availableCooling));
      power.push(percent(row.coolingElectricity, coolingFullKw));
    } else if (result.scenario.heating === "gas") {
      // Boiler PLR is delivered heater output / selected rated output. Runtime
      // scales full-fire fuel input for every supported fuel, with no unit mixing.
      capacity.push(percent(row.boilerPartLoadRatio, 1));
      power.push(percent(row.boilerRuntimeFraction, 1));
    } else {
      const delivered = finite(row.deliveredHeating) && finite(row.fanHeat)
        ? Math.max(0, row.deliveredHeating - row.fanHeat) : null;
      const fullCapacity = result.scenario.heating === "heat-pump"
        ? finite(row.availableHeating) && finite(row.fanHeat) ? Math.max(0, row.availableHeating - row.fanHeat) : null
        : result.heatingCapacityBtuHr;
      // Heat-pump COP describes full net catalog output and total input. Recover
      // installed full input, then remove the fan already counted separately.
      const fullKw = result.scenario.heating === "heat-pump"
        ? finite(row.availableHeating) && finite(row.heatingCop) && row.heatingCop > 0 && fanKw !== null
          ? row.availableHeating / (BTU_PER_KWH * row.heatingCop) - fanKw : null
        : finite(fullCapacity) ? fullCapacity / BTU_PER_KWH : null;
      capacity.push(percent(delivered, fullCapacity));
      power.push(percent(row.heatingElectricity, fullKw));
    }
  }
  return { capacity, power };
}

/** Bins are [0], (0,10], (10,20], ... (90,100], (100,infinity).
 * Missing/negative/nonfinite values are excluded, never plotted as zero.
 * Each chart normalizes its shares to its own included, known hours. */
export function utilizationDistribution(values: (number | null)[], includeZero = false): UtilizationDistribution {
  const bins: UtilizationBin[] = [
    { range: "0%", hours: 0, percentOfHours: 0 },
    ...Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}–${(i + 1) * 10}%`, hours: 0, percentOfHours: 0 })),
    { range: ">100%", hours: 0, percentOfHours: 0 },
  ];
  let plottedHours = 0, missingHours = 0, zeroHours = 0;
  for (const value of values) {
    if (!finite(value) || value < 0) { missingHours++; continue; }
    if (value === 0) { zeroHours++; if (!includeZero) continue; }
    // A tiny arithmetic tolerance keeps 10.000000000000002 in the 0–10% bin.
    const index = value === 0 ? 0 : value > 100 + 1e-7 ? 11 : Math.max(1, Math.ceil((Math.min(100, value) - 1e-7) / 10));
    bins[index].hours++; plottedHours++;
  }
  for (const bin of bins) bin.percentOfHours = plottedHours ? bin.hours / plottedHours * 100 : 0;
  return { bins, plottedHours, missingHours, zeroHours };
}
