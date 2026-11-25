/**
 * HEATING CURVE EVALUATOR. Matches a cooling unit to its heating table, then
 * evaluates net heating capacity and total input power at the catalog basis.
 * Inputs are outdoor DB and entering DB in F; outputs are BTU/hr, kW and COP.
 * The catalog heating power already includes its supply-fan component.
 */

import catalog from "./data/precedent-heating.json";
import type { CoolingModel } from "./packaged-cooling";
import { axisLimits, intellipakCoolingTable, intellipakHeating, intellipakHeatingTables } from "./intellipak-performance";

export type HeatingModel = typeof catalog.models[number] & {
  intellipak?: { tables:number[]; referenceCfm:number; scaledFromTons?:number; powerOutdoorRangeF:number[] };
};
export const HEATING_MODELS = catalog.models;
export const HEATING_SOURCE = catalog.source;
export const HEATING_BASIS = "Heating is evaluated at reference airflow and 70% outdoor RH. Mixed-air temperature follows the selected supply airflow. Precedent uses integrated net capacity and total power. IntelliPak uses fan-inclusive eFlex capacity and estimated power based on 25-ton Precedent. The rating fan proxy is removed before adding modeled fan input/heat.";

// Some heating tables are shared by the two efficiency families. Match size and
// either the exact family or the table marked shared; missing matches return null.
export function heatingModelFor(model: Pick<CoolingModel,"nominal_tons"|"efficiency">): HeatingModel | null {
  const { nominal_tons:tons, efficiency } = model;
  const match=HEATING_MODELS.find(h=>h.nominal_tons===tons&&(h.efficiency===efficiency||h.efficiency==="shared"));
  if(match)return match;
  const coolingTable = intellipakCoolingTable(tons,efficiency);
  const powerProxy = HEATING_MODELS.find(h=>h.nominal_tons===25&&(h.efficiency===efficiency||h.efficiency==="shared"));
  if(!coolingTable || !powerProxy)return null;
  const [lower,upper] = intellipakHeatingTables(tons);
  const referenceCfm = axisLimits(coolingTable.cfm)[1];
  return {
    ...powerProxy,id:`heating-intellipak-${efficiency}-${tons}ton`,nominal_tons:tons,table:lower.table,
    outdoor_range_F:axisLimits(lower.outdoorF),entering_dry_bulb_range_F:axisLimits(lower.dryF),
    reference_capacity_Btu_hr:intellipakHeating(tons,47,70,referenceCfm),
    reference_power_kW:powerProxy.reference_power_kW*tons/25,
    capacity_coefficients:[],
    intellipak:{tables:lower===upper?[lower.table]:[lower.table,upper.table],referenceCfm,
      scaledFromTons:tons>upper.tons?upper.tons:undefined,powerOutdoorRangeF:powerProxy.outdoor_range_F},
  };
}
/** Catalog net heating and total electrical power, including the table's fan/defrost basis. */
export function heatingPoint(model: HeatingModel, outdoorF: number, enteringDryBulbF: number) {
  if (![outdoorF,enteringDryBulbF].every(Number.isFinite)||outdoorF<model.outdoor_range_F[0]||outdoorF>model.outdoor_range_F[1]||enteringDryBulbF<model.entering_dry_bulb_range_F[0]||enteringDryBulbF>model.entering_dry_bulb_range_F[1]) return null;
  const powerDomain=model.intellipak?.powerOutdoorRangeF;
  const powerOutdoorF=powerDomain?Math.max(powerDomain[0],Math.min(powerDomain[1],outdoorF)):outdoorF;
  const x=(powerOutdoorF-47)/40,y=(enteringDryBulbF-70)/20;
  // term_powers lists the x/y exponents in coefficient order. Python equivalent:
  // terms = [x**i * y**j for i, j in term_powers].
  const terms=catalog.term_powers.map(([i,j])=>x**i*y**j);
  const powerNormalized=model.power_coefficients.reduce((sum,c,i)=>sum+c*terms[i],0);
  // Undo normalization with the per-unit catalog reference values. COP is net heat
  // divided by total electrical input, with BTU/hr converted to kW.
  const capacityBtuHr=model.intellipak
    ?intellipakHeating(model.nominal_tons,outdoorF,enteringDryBulbF,model.intellipak.referenceCfm)
    :model.capacity_coefficients.reduce((sum,c,i)=>sum+c*terms[i],0)*model.reference_capacity_Btu_hr;
  const powerKw=powerNormalized*model.reference_power_kW;
  if (!(capacityBtuHr>0)||!(powerKw>0)||!Number.isFinite(capacityBtuHr)||!Number.isFinite(powerKw)) return null;
  return {capacityBtuHr,powerKw,cop:capacityBtuHr/(3412.141633*powerKw),normalized:capacityBtuHr/model.reference_capacity_Btu_hr,powerNormalized};
}
