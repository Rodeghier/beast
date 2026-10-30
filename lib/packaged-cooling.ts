/**
 * COOLING CURVE EVALUATOR. Reads fitted coefficients from JSON; it does not fit
 * curves during a simulation. Inputs: outdoor DB, entering WB and entering DB in F.
 * Outputs: gross unit capacity in BTU/hr and dimensionless SHR.
 * This strict evaluator returns null outside the accepted data domain. The
 * operating policy is applied separately in curve-evaluation.ts.
 */

import catalog from "./data/precedent-cooling.json";

export type CoolingModel = typeof catalog.models[number];
export const COOLING_MODELS = catalog.models;
export const COOLING_SOURCE = catalog.source;
/** Gross catalog capacity and SHR at the model's fixed maximum airflow. */
export function coolingPoint(model: CoolingModel, outdoorF: number, enteringWetBulbF: number, enteringDryBulbF: number) {
  const input = [outdoorF, enteringWetBulbF, enteringDryBulbF];
  if (!input.every(Number.isFinite) || model.valid_domain_halfspaces.some(([a,b,c,d]) => a*outdoorF+b*enteringWetBulbF+c*enteringDryBulbF+d > 1e-7)) return null;
  // Normalize the three temperatures so the polynomial terms have convenient scales.
  // At 95/67/80 F, x=y=z=0 and normalized capacity equals the anchored coefficient 1.
  const x=(outdoorF-95)/20, y=(enteringWetBulbF-67)/6, z=(enteringDryBulbF-80)/10;
  const terms=[1,x,y,z,x*x,x*y,x*z,y*y,y*z,z*z];
  // reduce(...) is a dot product: sum(coefficient[i] * term[i]).
  // The SHR numerator uses the first four terms; division by capacity gives final SHR.
  const normalized=model.capacity_coefficients.reduce((sum,c,i) => sum+c*terms[i],0);
  const numerator=model.shr_numerator_coefficients.reduce((sum,b,i) => sum+b*terms[i],0);
  if (!(normalized>0) || !Number.isFinite(normalized) || !Number.isFinite(numerator)) return null;
  return { capacityBtuHr: normalized*model.reference_capacity_Btu_hr, normalized, shr: Math.min(1,Math.max(0,numerator/normalized)) };
}
