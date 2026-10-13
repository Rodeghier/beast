import type { RtuResult } from "./rtu";
import type { EmissionRegion, GasCombustion } from "./location-energy";

/** kg CO2e: electricity generation plus on-site gas combustion; no price dependency. */
export function energyEmissions(electricity: number | null, gasTherms: number | null, region: EmissionRegion | null | undefined, gas: GasCombustion | null | undefined) {
  const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const electricFactor = region?.kgCo2ePerKwh, gasFactor = gas?.kgCo2ePerTherm;
  const electricCo2e = valid(electricity) && valid(electricFactor) ? electricity * electricFactor : null;
  const gasCo2e = gasTherms === 0 ? 0 : valid(gasTherms) && valid(gasFactor) ? gasTherms * gasFactor : null;
  return { electricCo2e, gasCo2e, co2e: electricCo2e === null || gasCo2e === null ? null : electricCo2e + gasCo2e };
}

export function totalCo2e(result: RtuResult | null | undefined, region: EmissionRegion | null | undefined, gas: GasCombustion | null | undefined): number | null {
  if (!result?.equipment || result.error || !result.summary.completeHours) return null;
  return energyEmissions(result.summary.electricity, result.summary.gasTherms, region, gas).co2e;
}
