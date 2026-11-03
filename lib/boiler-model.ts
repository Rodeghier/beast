import CBLE4DHotWaterRatings from "./data/cleaver-brooks-cble-4d-hot-water-ratings.json";
import type { BoilerFuel } from "./equipment";

export type BoilerFuelUnit = "therms" | "ft³" | "gal";
export type CBLE4DFuelRating = { consumptionPerHour: number; unit: BoilerFuelUnit; inputBtuPerHour: number };

/** Small units use user-entered AFUE. Large units use CBLE-4D rated output and
 * the manufacturer's listed fuel consumption/hour directly. */

export const SMALL_NONCONDENSING_ON_OFF_BOILER = {
  id: "natural-gas-hot-water-non-condensing-on-off",
  label: "Small non-condensing natural-gas hot-water boiler (on/off)",
  sizeClass: "small" as const,
  efficiencyMetric: "AFUE" as const,
  firingMode: "on-off" as const,
  condensing: false as const,
  // These are intentionally unset until a selected manufacturer/model provides them.
  returnWaterTemperatureF: null as number | null,
  minimumReturnWaterTemperatureF: null as number | null,
  standbyFuelInputBtuPerHr: null as number | null,
  auxiliaryElectricPowerKw: null as number | null,
  // AFUE already includes seasonal cycling effects; do not apply a second cycling derate.
  partLoadEfficiencyMultiplier: 1,
} as const;

export const LARGE_NONCONDENSING_ON_OFF_BOILER = {
  id: "cleaver-brooks-cble-4d-hot-water-on-off",
  label: "Cleaver-Brooks CBLE-4D non-condensing hot-water boiler (on/off)",
  sizeClass: "large" as const,
  efficiencyMetric: "Manufacturer rated fuel consumption" as const,
  firingMode: "on-off" as const,
  condensing: false as const,
  returnWaterTemperatureF: null as number | null,
  minimumReturnWaterTemperatureF: null as number | null,
  standbyFuelInputBtuPerHr: null as number | null,
  auxiliaryElectricPowerKw: null as number | null,
  // Large-model fuel input comes directly from the rated therms/hour table.
  partLoadEfficiencyMultiplier: null as number | null,
} as const;

export const CBLE_4D_HOT_WATER_RATINGS = CBLE4DHotWaterRatings;
export type CBLE4DBoilerRating = (typeof CBLE_4D_HOT_WATER_RATINGS)[number];

/** Autosize to the smallest listed CBLE-4D output that meets the peak load. */
export function cble4dRatingForPeakLoad(peakLoadBtuHr: number | null): CBLE4DBoilerRating | null {
  if (typeof peakLoadBtuHr !== "number" || !Number.isFinite(peakLoadBtuHr) || peakLoadBtuHr < 0) return null;
  return CBLE_4D_HOT_WATER_RATINGS.find((rating) => rating.ratedOutputBtuHr >= peakLoadBtuHr)
    ?? CBLE_4D_HOT_WATER_RATINGS[CBLE_4D_HOT_WATER_RATINGS.length - 1];
}

export const boilerModelFor = (sizeClass: "small" | "large") =>
  sizeClass === "large" ? LARGE_NONCONDENSING_ON_OFF_BOILER : SMALL_NONCONDENSING_ON_OFF_BOILER;

export type OnOffBoilerHour = {
  capacityBtuHr: number | null;
  deliveredOutputBtuHr: number | null;
  partLoadRatio: number | null;
  runtimeFraction: number | null;
  gasTherms: number | null;
  fuelConsumption: number | null;
  fuelUnit: BoilerFuelUnit | null;
  fuelInputBtu: number | null;
};

/** Manufacturer table consumption rate and listed fuel heat-content basis. */
export function cble4dFuelRatingFor(rating: CBLE4DBoilerRating, fuel: BoilerFuel): CBLE4DFuelRating {
  if (fuel === "propane") return { consumptionPerHour: rating.propaneCubicFeetPerHr, unit: "ft³", inputBtuPerHour: rating.propaneCubicFeetPerHr * 2550 };
  if (fuel === "light-oil") return { consumptionPerHour: rating.lightOilGalPerHr, unit: "gal", inputBtuPerHour: rating.lightOilGalPerHr * 140_000 };
  return { consumptionPerHour: rating.naturalGasThermsPerHr, unit: "therms", inputBtuPerHour: rating.naturalGasThermsPerHr * 100_000 };
}

/** Calculates full-fire runtime and fuel for one hourly timestep. */
export function calculateNoncondensingOnOffBoilerHour(
  loadBtuHr: number | null,
  capacityBtuHr: number | null,
  efficiencyPercent: number | null,
  durationHours = 1,
  partLoadEfficiencyMultiplier = 1,
): OnOffBoilerHour {
  if (typeof loadBtuHr !== "number" || !Number.isFinite(loadBtuHr) || loadBtuHr < 0 ||
      typeof capacityBtuHr !== "number" || !Number.isFinite(capacityBtuHr) || capacityBtuHr < 0 ||
      typeof efficiencyPercent !== "number" || !Number.isFinite(efficiencyPercent) || efficiencyPercent <= 0 || efficiencyPercent > 100 ||
      !Number.isFinite(partLoadEfficiencyMultiplier) || partLoadEfficiencyMultiplier <= 0 ||
      !Number.isFinite(durationHours) || durationHours < 0 || (capacityBtuHr === 0 && loadBtuHr > 0)) {
    return { capacityBtuHr, deliveredOutputBtuHr: null, partLoadRatio: null, runtimeFraction: null, gasTherms: null, fuelConsumption: null, fuelUnit: "therms", fuelInputBtu: null };
  }

  if (capacityBtuHr === 0) return { capacityBtuHr, deliveredOutputBtuHr: 0, partLoadRatio: 0, runtimeFraction: 0, gasTherms: 0, fuelConsumption: 0, fuelUnit: "therms", fuelInputBtu: 0 };

  const deliveredOutputBtuHr = Math.min(loadBtuHr, capacityBtuHr);
  const partLoadRatio = deliveredOutputBtuHr / capacityBtuHr;
  const runtimeFraction = partLoadRatio;
  const efficiency = efficiencyPercent / 100;
  // One therm = 100,000 Btu. Runtime scales the boiler's full-fire input.
  // This equals delivered output / efficiency when the placeholder multiplier is 1.
  const gasTherms = capacityBtuHr * runtimeFraction * durationHours /
    (100_000 * efficiency * partLoadEfficiencyMultiplier);

  return { capacityBtuHr, deliveredOutputBtuHr, partLoadRatio, runtimeFraction, gasTherms, fuelConsumption: gasTherms, fuelUnit: "therms", fuelInputBtu: gasTherms * 100_000 };
}

/** Uses the selected rating's listed output and therms/hour without converting
 * the table into a user-entered efficiency. Runtime is hourly output / rating. */
export function calculateRatedBoilerHour(
  loadBtuHr: number | null,
  rating: CBLE4DBoilerRating | null,
  fuel: BoilerFuel = "natural-gas",
  durationHours = 1,
): OnOffBoilerHour {
  const capacityBtuHr = rating?.ratedOutputBtuHr ?? null;
  const fuelRating = rating ? cble4dFuelRatingFor(rating, fuel) : null;
  if (typeof loadBtuHr !== "number" || !Number.isFinite(loadBtuHr) || loadBtuHr < 0 ||
      !rating || !Number.isFinite(rating.ratedOutputBtuHr) || rating.ratedOutputBtuHr <= 0 ||
      !fuelRating || !Number.isFinite(fuelRating.consumptionPerHour) || fuelRating.consumptionPerHour < 0 ||
      !Number.isFinite(durationHours) || durationHours < 0) {
    return { capacityBtuHr, deliveredOutputBtuHr: null, partLoadRatio: null, runtimeFraction: null, gasTherms: null, fuelConsumption: null, fuelUnit: fuelRating?.unit??null, fuelInputBtu: null };
  }
  const deliveredOutputBtuHr = Math.min(loadBtuHr, rating.ratedOutputBtuHr);
  const partLoadRatio = deliveredOutputBtuHr / rating.ratedOutputBtuHr;
  const fuelConsumption = fuelRating.consumptionPerHour * partLoadRatio * durationHours;
  const gasTherms = fuel === "natural-gas" ? fuelConsumption : 0;
  return {
    capacityBtuHr,
    deliveredOutputBtuHr,
    partLoadRatio,
    runtimeFraction: partLoadRatio,
    gasTherms,
    fuelConsumption,
    fuelUnit: fuelRating.unit,
    fuelInputBtu: fuelRating.inputBtuPerHour * partLoadRatio * durationHours,
  };
}
