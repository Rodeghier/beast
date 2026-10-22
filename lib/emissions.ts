import type { CurveResult } from "./curve-model";
import type { EmissionRegion } from "./location-energy";

/** kg CO2e for the electricity calculated from the user's curves. */
export function energyEmissions(electricity: number | null, region: EmissionRegion | null | undefined) {
  const factor = region?.kgCo2ePerKwh;
  const value = electricity !== null && Number.isFinite(electricity) && electricity >= 0 && typeof factor === "number" && Number.isFinite(factor) && factor >= 0 ? electricity * factor : null;
  const co2e = value !== null && Number.isFinite(value) ? value : null;
  return { electricCo2e: co2e, co2e };
}
export function totalCo2e(result: CurveResult | null | undefined, region: EmissionRegion | null | undefined): number | null {
  if (!result || result.error || !result.summary.completeHours) return null;
  return energyEmissions(result.summary.electricity, region).co2e;
}
