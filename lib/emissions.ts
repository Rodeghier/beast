import type { RtuResult } from "./rtu";
import type { EmissionRegion } from "./location-energy";

/** Inventory-style electricity CO2 only, using a fixed annual eGRID factor. */
export function electricityCo2(result: RtuResult | null | undefined, region: EmissionRegion | null | undefined): number | null {
  if (!result?.equipment || result.error || !region || !result.summary.completeHours || !Number.isFinite(region.kgCo2PerKwh) || region.kgCo2PerKwh < 0) return null;
  return result.summary.electricity * region.kgCo2PerKwh;
}
