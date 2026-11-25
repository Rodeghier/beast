/**
 * COOLING CURVE EVALUATOR. Uses stored Precedent fits or IntelliPak tables.
 * Inputs: outdoor DB, entering WB and entering DB in F, and IntelliPak airflow.
 * Outputs: gross unit capacity in BTU/hr and dimensionless SHR.
 * This strict evaluator returns null outside the accepted data domain. The
 * operating policy is applied separately in curve-evaluation.ts.
 */

import catalog from "./data/precedent-cooling.json";
import shared from "./data/shared-cooling-capacity.json";
import { axisLimits, INTELLIPAK_COOLING_TABLES, intellipakCooling, intellipakCoolingTable } from "./intellipak-performance";

export type CoolingModel = Pick<typeof catalog.models[number],
  "table"|"id"|"nominal_tons"|"efficiency"|"fixed_cfm"|"reference_capacity_MBh"|"reference_capacity_Btu_hr"|
  "axis_ranges_F"|"valid_domain_halfspaces"|"capacity_coefficients"|"shr_numerator_coefficients"> & {
  capacityCurveId?:string;shr_capacity_coefficients?:number[];intellipak?:typeof INTELLIPAK_COOLING_TABLES[number];
};
export const SOURCE_COOLING_MODELS = catalog.models;
export const SHARED_COOLING_CAPACITY = shared;
// The source Precedent fits retain their pooled capacity and individual SHR.
const runtime=(model:typeof catalog.models[number]):CoolingModel=>({...model,
  capacity_coefficients:shared.capacity_coefficients,capacityCurveId:shared.id,
  // Preserve the supplied SHR fit. Its original denominator must not change
  // merely because total capacity is now represented by a pooled curve.
  shr_capacity_coefficients:model.capacity_coefficients});
export const COOLING_MODELS:CoolingModel[] = [
  ...catalog.models.map(runtime),
  ...INTELLIPAK_COOLING_TABLES.map(table=>{
    const { tons, efficiency } = table;
    const fixed_cfm = axisLimits(table.cfm)[1];
    const reference = intellipakCooling(table,95,67,80,fixed_cfm)!;
    return {
      id:`heat-pump-${efficiency}-${tons}ton`,table:table.table,
      nominal_tons:tons,efficiency,fixed_cfm,reference_capacity_MBh:reference.capacityBtuHr/1000,
      reference_capacity_Btu_hr:reference.capacityBtuHr,
      axis_ranges_F:{
        outdoor_dry_bulb_F:axisLimits(table.outdoorF),
        entering_wet_bulb_F:axisLimits(table.wetF),
        entering_dry_bulb_F:axisLimits(table.dryF),
      },
      capacityCurveId:`intellipak-table-${table.table}`,intellipak:table,
      valid_domain_halfspaces:[],capacity_coefficients:[],shr_numerator_coefficients:[],
    };
  }),
];
export const COOLING_SOURCE = catalog.source;
/** Gross catalog capacity and SHR at maximum airflow by default. */
export function coolingPoint(model: CoolingModel, outdoorF: number, enteringWetBulbF: number, enteringDryBulbF: number, cfm = model.fixed_cfm) {
  if (model.intellipak) {
    const point = intellipakCooling(model.intellipak,outdoorF,enteringWetBulbF,enteringDryBulbF,cfm);
    return point && {...point, normalized:point.capacityBtuHr/model.reference_capacity_Btu_hr};
  }
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
