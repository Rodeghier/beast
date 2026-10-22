import catalog from "./data/precedent-cooling.json";

export type CoolingModel = typeof catalog.models[number];
export const COOLING_MODELS = catalog.models;
export const COOLING_SOURCE = catalog.source;
/** Gross catalog capacity and SHR at the model's fixed maximum airflow. */
export function coolingPoint(model: CoolingModel, outdoorF: number, enteringWetBulbF: number, enteringDryBulbF: number) {
  const input = [outdoorF, enteringWetBulbF, enteringDryBulbF];
  if (!input.every(Number.isFinite) || model.valid_domain_halfspaces.some(([a,b,c,d]) => a*outdoorF+b*enteringWetBulbF+c*enteringDryBulbF+d > 1e-7)) return null;
  const x=(outdoorF-95)/20, y=(enteringWetBulbF-67)/6, z=(enteringDryBulbF-80)/10;
  const terms=[1,x,y,z,x*x,x*y,x*z,y*y,y*z,z*z];
  const normalized=model.capacity_coefficients.reduce((sum,c,i) => sum+c*terms[i],0);
  const numerator=model.shr_numerator_coefficients.reduce((sum,b,i) => sum+b*terms[i],0);
  if (!(normalized>0) || !Number.isFinite(normalized) || !Number.isFinite(numerator)) return null;
  return { capacityBtuHr: normalized*model.reference_capacity_Btu_hr, normalized, shr: Math.min(1,Math.max(0,numerator/normalized)) };
}
