/** Variable-flow cooling uses the Precedent fit or the IntelliPak capacity table.
 * Temperatures may be bounded by scenario policy; airflow never extrapolates. */
import data from "./data/precedent-airflow-cooling.json";
import type { CoolingModel } from "./packaged-cooling";
import type { CurveRangeMode } from "./equipment";
import { operatingCoolingPoint } from "./curve-evaluation";
import { axisLimits } from "./intellipak-performance";

export const AIRFLOW_COOLING_FIT=data;
const domains=new WeakMap<CoolingModel,CoolingModel>();
export function airflowCoolingModel(model:CoolingModel){
  return data.models.find(m=>m.efficiency===model.efficiency&&m.nominal_tons===model.nominal_tons)??null;
}
export function coolingAirflowRange(model:CoolingModel):[number,number]|null {
  if(model.intellipak)return axisLimits(model.intellipak.cfm);
  const fit=airflowCoolingModel(model);if(!fit)return null;
  return axisLimits(fit.airflows_cfm);
}
export function airflowTerms(outdoorF:number,wetF:number,dryF:number,cfmPerTon:number){
  const x=(outdoorF-95)/20,y=(wetF-67)/6,z=(dryF-80)/10,f=(cfmPerTon-480)/180;
  return [1,x,y,z,f,x*x,x*y,x*z,x*f,y*y,y*z,y*f,z*z,z*f,f*f];
}
export function airflowCoolingPoint(model:CoolingModel,outdoorF:number,wetF:number,dryF:number,cfm:number,mode:CurveRangeMode="bounded"){
  const range=coolingAirflowRange(model);
  if(!range||!Number.isFinite(cfm)||cfm<range[0]-1e-7||cfm>range[1]+1e-7)return null;
  if(model.intellipak){
    const point=operatingCoolingPoint(model,outdoorF,wetF,dryF,mode,Math.max(range[0],Math.min(range[1],cfm)));
    return point && {...point,cfm};
  }
  const fit=airflowCoolingModel(model);
  if(!fit)return null;
  let domain=domains.get(model);
  if(!domain){domain={...model,axis_ranges_F:fit.axis_ranges_F,valid_domain_halfspaces:fit.valid_domain_halfspaces};domains.set(model,domain);}
  const point=operatingCoolingPoint(domain,outdoorF,wetF,dryF,mode);if(!point)return null;
  const terms=airflowTerms(point.curveOutdoorF,point.curveWetF,point.curveDryF,cfm/model.nominal_tons);
  const normalized=data.capacity_coefficients.reduce((s,c,i)=>s+c*terms[i],0);
  const numerator=fit.shr_numerator_coefficients.reduce((s,c,i)=>s+c*terms[i],0);
  if(!(normalized>0)||!Number.isFinite(numerator))return null;
  const capacityBtuHr=fit.reference_capacity_Btu_hr*normalized;
  const shr=Math.min(1,Math.max(0,numerator/normalized));
  return {capacityBtuHr,normalized,shr,cfm,boundaryEstimate:point.boundaryEstimate,
    curveOutdoorF:point.curveOutdoorF,curveWetF:point.curveWetF,curveDryF:point.curveDryF};
}
