/**
 * COOLING CURVE EVALUATOR. Reads fitted coefficients from JSON; it does not fit
 * curves during a simulation. Inputs: outdoor DB, entering WB and entering DB in F.
 * Outputs: gross unit capacity in BTU/hr and dimensionless SHR.
 * This strict evaluator returns null outside the accepted data domain. The
 * operating policy is applied separately in curve-evaluation.ts.
 */

import catalog from "./data/precedent-cooling.json";
import shared from "./data/shared-cooling-capacity.json";
import { EXTENDED_UNIT_TONS } from "./catalog-sizes";

export type CoolingModel = typeof catalog.models[number] & {
  capacityCurveId?:string;shr_capacity_coefficients?:number[];scaledFromNominalTons?:number;
};
export const SOURCE_COOLING_MODELS = catalog.models;
export const SHARED_COOLING_CAPACITY = shared;
// Keep original fits as provenance. Every runtime model uses exactly the same
// normalized capacity polynomial; Qref still supplies the unit's size scale.
const runtime=(model:typeof catalog.models[number]):CoolingModel=>({...model,
  capacity_coefficients:shared.capacity_coefficients,capacityCurveId:shared.id,
  // Preserve the supplied SHR fit. Its original denominator must not change
  // merely because total capacity is now represented by a pooled curve.
  shr_capacity_coefficients:model.capacity_coefficients});
export const COOLING_MODELS:CoolingModel[] = [
  ...catalog.models.map(runtime),
  ...(["standard","high"] as const).flatMap(efficiency=>EXTENDED_UNIT_TONS.map(tons=>{
    const base=catalog.models.find(m=>m.efficiency===efficiency&&m.nominal_tons===25)!;
    return runtime({...base,id:`heat-pump-${efficiency}-${tons}ton`,nominal_tons:tons,
      fixed_cfm:base.fixed_cfm*tons/25,reference_capacity_MBh:base.reference_capacity_MBh*tons/25,
      reference_capacity_Btu_hr:base.reference_capacity_Btu_hr*tons/25}) as CoolingModel;
  })).map(m=>({...m,scaledFromNominalTons:25})),
];
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
  // SHR retains its source numerator and denominator; changing the runtime
  // total-capacity polynomial must not inadvertently refit sensible fraction.
  const normalized=model.capacity_coefficients.reduce((sum,c,i) => sum+c*terms[i],0);
  const numerator=model.shr_numerator_coefficients.reduce((sum,b,i) => sum+b*terms[i],0);
  if (!(normalized>0) || !Number.isFinite(normalized) || !Number.isFinite(numerator)) return null;
  const shrDenominator=(model.shr_capacity_coefficients??model.capacity_coefficients).reduce((sum,c,i)=>sum+c*terms[i],0);
  if(!(shrDenominator>0))return null;
  return { capacityBtuHr: normalized*model.reference_capacity_Btu_hr, normalized, shr: Math.min(1,Math.max(0,numerator/shrDenominator)) };
}
