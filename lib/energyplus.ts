import catalog from "./data/energyplus/catalog.json";

export type EnergyPlusId = `energyplus-${string}`;
export type EnergyPlusCurve = { name: string; type: string; coefficients: number[]; minX: number | null; maxX: number | null; minY: number | null; maxY: number | null; minOutput: number | null; maxOutput: number | null };
export type EnergyPlusProfile = {
  id: string; name: string; mode: string; objectType: string; source: string; file: string;
  capacityW: number; basisCapacityW: number; basisRatingName: string; basisRatingType: string; capacityRatio: number; cop: number; airflowM3s: number; cfmPerTon: number; shr: number | null; minimumOutdoorC: number | null;
  curves: { capacityTemperature: EnergyPlusCurve; capacityFlow: EnergyPlusCurve; eirTemperature: EnergyPlusCurve; eirFlow: EnergyPlusCurve; partLoad: EnergyPlusCurve };
};
export const ENERGYPLUS_VERSION = catalog.version;
export const ENERGYPLUS_COMMIT = catalog.commit;
export const ENERGYPLUS_PROFILES: EnergyPlusProfile[] = catalog.profiles;
const profiles = new Map(ENERGYPLUS_PROFILES.map(p => [p.id, p]));
export const energyPlusProfile = (id: string) => profiles.get(id);

export function evaluateEnergyPlusCurve(curve: EnergyPlusCurve, inputX: number, inputY = 0) {
  const bound = (v: number, lo: number | null, hi: number | null) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v));
  const x = bound(inputX, curve.minX, curve.maxX), y = bound(inputY, curve.minY, curve.maxY), c = curve.coefficients;
  let value = c[0] + c[1] * x;
  if (curve.type !== "Curve:Linear") value += c[2] * x * x;
  if (curve.type === "Curve:Cubic") value += c[3] * x * x * x;
  else if (curve.type === "Curve:Biquadratic") value += c[3] * y + c[4] * y * y + c[5] * x * y;
  else if (curve.type !== "Curve:Linear" && curve.type !== "Curve:Quadratic") throw new Error(`Unsupported EnergyPlus curve form: ${curve.type}`);
  return { value: bound(value, curve.minOutput, curve.maxOutput), bounded: Math.abs(inputX - x) > 0.01 || Math.abs(inputY - y) > 0.01 };
}

export function energyPlusFactors(profile: EnergyPlusProfile, enteringC: number, outdoorC: number, cfmPerTon: number) {
  const c = profile.curves, flow = cfmPerTon / profile.cfmPerTon;
  // EnergyPlus heating univariate temperature curves use OUTDOOR dry bulb.
  // Biquadratic curves use entering dry bulb (x), outdoor dry bulb (y).
  const temperature = (curve: EnergyPlusCurve) => profile.mode === "heating" && curve.type !== "Curve:Biquadratic"
    ? evaluateEnergyPlusCurve(curve, outdoorC) : evaluateEnergyPlusCurve(curve, enteringC, outdoorC);
  const capT = temperature(c.capacityTemperature), capF = evaluateEnergyPlusCurve(c.capacityFlow, flow);
  const eirT = temperature(c.eirTemperature), eirF = evaluateEnergyPlusCurve(c.eirFlow, flow);
  return { capacity: profile.capacityRatio * capT.value * capF.value, eir: eirT.value * eirF.value,
    bounded: capT.bounded || capF.bounded || eirT.bounded || eirF.bounded };
}
