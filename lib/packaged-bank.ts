/** A bank may contain several catalog sizes. Each group retains its own curves,
 * rating, fan estimate and compressor stages. Shared mixed air represents the
 * existing single-zone air-handler model; this is not a duct/zoning simulation. */
import type { CoolingModel } from "./packaged-cooling";
import type { HeatingModel } from "./packaged-heating";
import type { CurveRangeMode } from "./equipment";
import { unitRatingFor } from "./unit-ratings";
import { operatingCoolingPoint, operatingHeatingPoint } from "./curve-evaluation";
import { compressorStages } from "./precedent-stages";
import { stagedSystemOperation } from "./equipment-staging";

export type PackagedGroup={model:CoolingModel;heatingModel:HeatingModel;count:number};
export type DesignLoading={heating:number|null;sensibleCooling:number|null;latentCooling:number|null;ventilation:number|null};
export type PackagedSelection={groups:PackagedGroup[];count:number;totalTons:number;supplyCfm:number;referenceCoolingBtuHr:number;referenceHeatingBtuHr:number;
  verifiedCoolingHours:number;estimatedCoolingHours:number;unverifiedCoolingHours:number;verifiedHeatingHours:number;estimatedHeatingHours:number;unverifiedHeatingHours:number;
  rangeMode:CurveRangeMode;heatingAirflowApproximation:boolean;includesHeatPumpHeating:boolean;provisional:boolean;basis:string;optimizationComplete:boolean;designLoading:DesignLoading};

export const selectionGroupsLabel=(s:Pick<PackagedSelection,"groups">)=>s.groups.map(g=>`${g.count} × ${g.model.nominal_tons} ton`).join(" + ");
export function bankRatings(groups:PackagedGroup[]) {
  const records=groups.map(g=>({g,r:unitRatingFor(g.model)}));
  if(records.some(({r})=>!r))return null;
  const sum=(key:"inferred_supply_fan_heat_Btu_hr"|"inferred_supply_fan_power_kW"|"cooling_system_power_kW"|"cooling_non_supply_fan_power_kW")=>records.reduce((s,{g,r})=>s+g.count*r![key],0);
  return {fanHeat:sum("inferred_supply_fan_heat_Btu_hr"),fanKw:sum("inferred_supply_fan_power_kW"),coolingSystemKw:sum("cooling_system_power_kW"),coolingNonfanKw:sum("cooling_non_supply_fan_power_kW")};
}
// A single aggregate evaluated temperature is meaningful only when every group
// used that same temperature. Detailed group conditions are exported separately.
const common=(values:number[])=>values.every(v=>Math.abs(v-values[0])<1e-7)?values[0]:null;
export function bankCooling(groups:PackagedGroup[],outdoor:number,wet:number,dry:number,mode:CurveRangeMode) {
  const evaluated=[...groups].sort((a,b)=>b.model.nominal_tons-a.model.nominal_tons).map(g=>({g,rating:unitRatingFor(g.model)!,point:operatingCoolingPoint(g.model,outdoor,wet,dry,mode)!}));
  if(evaluated.some(({point,rating})=>!point||!rating))return null;
  const capacity=evaluated.reduce((s,{g,point})=>s+g.count*point.capacityBtuHr,0);
  const sensible=evaluated.reduce((s,{g,point})=>s+g.count*point.capacityBtuHr*point.shr,0);
  return {evaluated,capacity,sensible,latent:capacity-sensible,shr:capacity>0?sensible/capacity:0,boundaryEstimate:evaluated.some(v=>v.point.boundaryEstimate),
    curveOutdoorF:common(evaluated.map(v=>v.point.curveOutdoorF)),curveWetF:common(evaluated.map(v=>v.point.curveWetF)),curveDryF:common(evaluated.map(v=>v.point.curveDryF))};
}
export function bankHeating(groups:PackagedGroup[],outdoor:number,dry:number,mode:CurveRangeMode) {
  const evaluated=[...groups].sort((a,b)=>b.model.nominal_tons-a.model.nominal_tons).map(g=>({g,rating:unitRatingFor(g.model)!,point:operatingHeatingPoint(g.heatingModel,outdoor,dry,mode)!}));
  if(evaluated.some(({point,rating})=>!point||!rating))return null;
  const capacity=evaluated.reduce((s,{g,point})=>s+g.count*point.capacityBtuHr,0),powerKw=evaluated.reduce((s,{g,point})=>s+g.count*point.powerKw,0);
  return {evaluated,capacity,powerKw,cop:powerKw>0?capacity/(3412.141633*powerKw):null,boundaryEstimate:evaluated.some(v=>v.point.boundaryEstimate),
    curveOutdoorF:common(evaluated.map(v=>v.point.curveOutdoorF)),curveDryF:common(evaluated.map(v=>v.point.curveDryF))};
}
/** Deterministic lead/lag: larger units first; stage/cycle the residual within
 * each size group. Fans retain the existing full-hour bank operation on calls. */
export function dispatchHeating(bank:NonNullable<ReturnType<typeof bankHeating>>,need:number) {
  let remaining=Math.max(0,need),electricity=0,delivered=0,belowMinimumStage=false;
  const details=bank.evaluated.map(({g,rating,point})=>{
    const capacity=Math.max(0,point.capacityBtuHr-rating.inferred_supply_fan_heat_Btu_hr);
    const served=Math.min(remaining,g.count*capacity),op=stagedSystemOperation(served,capacity,g.count,compressorStages(g.model.efficiency as "standard"|"high",g.model.nominal_tons));
    remaining-=served;delivered+=served;electricity+=(point.powerKw-rating.inferred_supply_fan_power_kW)*op.powerEquivalentUnits;belowMinimumStage ||=op.belowMinimumStage;
    return {model:g.model.id,count:g.count,heating:point,heatingPowerEquivalentUnits:op.powerEquivalentUnits,staging:op};
  });
  return {delivered,electricity:bank.evaluated.some(v=>v.point.powerKw<v.rating.inferred_supply_fan_power_kW)?null:electricity,belowMinimumStage,details};
}
export function dispatchCooling(bank:NonNullable<ReturnType<typeof bankCooling>>,sensible:number,latent:number) {
  let s=Math.max(0,sensible),l=Math.max(0,latent),electricity=0,delivered=0,belowMinimumStage=false;
  const details=bank.evaluated.map(({g,rating,point})=>{
    const need=Math.max(s>0?s/point.shr:0,l>0?l/(1-point.shr):0),served=Math.min(need,g.count*point.capacityBtuHr);
    const op=stagedSystemOperation(served,point.capacityBtuHr,g.count,compressorStages(g.model.efficiency as "standard"|"high",g.model.nominal_tons));
    s=Math.max(0,s-served*point.shr);l=Math.max(0,l-served*(1-point.shr));
    electricity+=rating.cooling_non_supply_fan_power_kW*op.powerEquivalentUnits;delivered+=served;belowMinimumStage ||=op.belowMinimumStage;
    return {model:g.model.id,count:g.count,cooling:point,coolingPowerEquivalentUnits:op.powerEquivalentUnits,staging:op};
  });
  return {delivered,electricity,unmet:s+l,belowMinimumStage,details};
}
