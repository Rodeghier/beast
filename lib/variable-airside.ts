/** Hourly variable-airflow air balance. Outdoor air is part of total supply;
 * return air is the remainder. Zone heat/moisture balances exclude mechanical
 * ventilation here because the mixed-air coil balance already conditions it.
 * Fan heat is downstream of cooling. Reheat is solved separately from primary heat. */
import type { PackagedGroup } from "./packaged-bank";
import { mhgrhPoint } from "./mhgrh";
import type { CurveRangeMode } from "./equipment";
import { celsius, humidityRatio, type SchoolAssumptions, type SchoolRow } from "./school";
import { airContext, mixAir } from "./mixed-air";
import { airflowCoolingPoint, coolingAirflowRange } from "./airflow-cooling";
import { variableFanModel, MINIMUM_FAN_FLOW_FRACTION } from "./variable-fan";
import { unitRatingFor } from "./unit-ratings";
import { compressorStages } from "./precedent-stages";
import { zonedSystemOperation, belowMinimumOnTime, compressorOnMinutes } from "./equipment-staging";

const BTU_PER_KWH=3412.141633,SENSIBLE=1.08,LATENT=.68*7000;
export const MINIMUM_COIL_LEAVING_F=45;
export const VARIABLE_AIRSIDE_BASIS="Supply CFM includes outdoor air plus return air; infiltration is excluded from the mixer. Each equipment group serves its nominal-tonnage share. Search supported airflow for sensible/moisture demand and ventilation while respecting fan HP and CFM limits. Cooling follows sensible and latent loads, with no fixed supply-temperature target or dew-point threshold. Coil leaving and final supply dry-bulb temperatures are calculated outputs exported for user analysis. Coil leaving DB is limited to >=45 F; unmet moisture demand is reported. Reheat addresses excess sensible cooling from serving the loads. Fan heat is added downstream of cooling. Zone balances remove mechanical ventilation before the coil mixer adds it once. Compressor stages retain the provisional proportional-power and cycling model.";
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const saturated=(f:number)=>humidityRatio(celsius(f),100)!;
const almost=(v:number)=>Math.abs(v)<1e-6?0:v;

/** Preserve total sensible+latent energy and reject impossible supersaturated
 * leaving states. Constant standard-air coefficients match the building model. */
export function leavingAirState(dryF:number,w:number,cfm:number,cooling:number,shr:number){
  let dry=dryF-cooling*shr/(SENSIBLE*cfm),humidity=w-cooling*(1-shr)/(LATENT*cfm);
  if(humidity<0){humidity=0;dry=dryF-(cooling-LATENT*cfm*w)/(SENSIBLE*cfm);}
  if(humidity>saturated(dry)){
    const target=SENSIBLE*dryF+LATENT*w-cooling/cfm;
    let low=-100,high=dryF;
    for(let i=0;i<32;i++){const mid=(low+high)/2;if(SENSIBLE*mid+LATENT*saturated(mid)>target)high=mid;else low=mid;}
    dry=(low+high)/2;humidity=Math.min(w,saturated(dry));
  }
  return {dryF:dry,humidityRatio:humidity,sensible:SENSIBLE*cfm*(dryF-dry),latent:LATENT*cfm*(w-humidity)};
}

/** Solve against the final physical air state, after the saturation correction.
 * A linear Q/SHR estimate alone can miss sensible or latent demand
 * with unused capacity, or use too much cooling and therefore extra reheat. */
export function coolingForAirState(dryF:number,w:number,cfm:number,capacity:number,shr:number,
  sensibleNeed:number,latentNeed:number){
  const stateAt=(q:number)=>leavingAirState(dryF,w,cfm,q,shr);
  const meets=(state:ReturnType<typeof stateAt>)=>state.sensible>=sensibleNeed-1e-7
    &&state.latent>=latentNeed-1e-7;
  let deliverableCapacity=capacity,full=stateAt(capacity);
  if(capacity>0&&full.dryF<MINIMUM_COIL_LEAVING_F){
    let low=0,high=capacity;
    for(let i=0;i<26;i++){const q=(low+high)/2;if(stateAt(q).dryF<MINIMUM_COIL_LEAVING_F)high=q;else low=q;}
    deliverableCapacity=low;full=stateAt(deliverableCapacity);
  }
  const required=Math.max(sensibleNeed>0?sensibleNeed/Math.max(shr,1e-10):0,
    latentNeed>0?latentNeed/Math.max(1-shr,1e-10):0);
  let delivered=Math.min(required,deliverableCapacity),leaving=stateAt(delivered);
  if(!meets(full)){
    delivered=deliverableCapacity;leaving=full;
  }else{
    const linear=Math.abs(leaving.sensible-delivered*shr)<1e-6
      &&Math.abs(leaving.latent-delivered*(1-shr))<1e-6;
    if(!meets(leaving)||!linear){
      let low=meets(leaving)?0:delivered,high=meets(leaving)?delivered:deliverableCapacity;
      for(let i=0;i<26;i++){const q=(low+high)/2;if(meets(stateAt(q)))high=q;else low=q;}
      delivered=high;leaving=stateAt(delivered);
    }
  }
  return {required:meets(full)?delivered:null,linearRequired:required,delivered,leaving,deliverableCapacity,availableSensible:full.sensible,availableLatent:full.latent};
}

export type AirsideOptions={airflowMode?:"variable"|"fixed";minimumOnMinutes?:number};
function solveGroup(group:PackagedGroup,row:SchoolRow,school:SchoolAssumptions,share:number,mode:CurveRangeMode,runs:boolean,options:AirsideOptions){
  const fan=variableFanModel(group.model),range=coolingAirflowRange(group.model),rating=unitRatingFor(group.model),context=airContext(row,school);
  if(!fan||!range||!rating||!context||!finite(row.coolBalance)||!finite(row.latentCooling)||!finite(row.heating))return null;
  const count=group.count,vent=Math.max(0,row.ventilationCfm*share),zone=context.returnF;
  const totalSensible=almost((row.coolBalance+row.heatTransfer*(row.coolingSetpointF-zone))*share);
  const zoneSensible=totalSensible-SENSIBLE*vent*(context.outdoorF-zone);
  const zoneLatent=(row.occupants*school.latentPerson+LATENT*row.infiltrationCfm*(context.outdoorW-context.returnW))*share;
  const maxCfm=fan.maxCfm*count;
  const heatingCfm=Math.max(0,-totalSensible)/(SENSIBLE*30);
  const minimum=runs?Math.min(maxCfm,Math.max(vent,maxCfm*MINIMUM_FAN_FLOW_FRACTION,heatingCfm)):0;
  const stages=compressorStages(group.model.efficiency as "standard"|"high",group.model.nominal_tons);
  const evaluate=(cfm:number)=>{
    const fanKw=fan.power(cfm/count)!*count,fanHeat=fanKw*BTU_PER_KWH;
    const localContext={...context,ventilationCfm:vent};
    const mixed=cfm>0?mixAir(localContext,cfm):null;
    if(!mixed)return null;
    // Demand for the airflow actually admitted. Ventilation shortfall is
    // reported separately; unserved outdoor air is never assumed to be mixed.
    const admitted=Math.min(vent,cfm);
    const sensibleNeed=Math.max(0,zoneSensible+SENSIBLE*admitted*(context.outdoorF-zone)+fanHeat);
    const latentNeed=Math.max(0,zoneLatent+LATENT*admitted*(context.outdoorW-context.returnW));
    const desiredSupplyF=zone-zoneSensible/(SENSIBLE*cfm);
    const called=sensibleNeed>1e-6||latentNeed>1e-6;
    const point=called?airflowCoolingPoint(group.model,context.outdoorF,mixed.wetF,mixed.dryF,cfm/count,mode):null;
    if(called&&!point)return null;
    const capacity=(point?.capacityBtuHr??0)*count,shr=point?.shr??1;
    const {required,linearRequired,delivered:requestedCoolingBtuHr,deliverableCapacity,availableSensible,availableLatent}=coolingForAirState(
      mixed.dryF,mixed.humidityRatio,cfm,capacity,shr,sensibleNeed,latentNeed);
    // Apply the annual cutoff to the feasible output AFTER the physical-state
    // solve, for each airflow candidate. Recompute every dependent quantity from
    // the OFF state; otherwise latent removal and reheat could survive lockout.
    const requestedOperation=zonedSystemOperation(requestedCoolingBtuHr,point?.capacityBtuHr??0,count,stages);
    const minimumRuntimeLockout=belowMinimumOnTime(requestedOperation,options.minimumOnMinutes??0),requestedOnMinutesPerUnit=compressorOnMinutes(requestedOperation);
    const delivered=minimumRuntimeLockout?0:requestedCoolingBtuHr;
    const leaving=leavingAirState(mixed.dryF,mixed.humidityRatio,cfm,delivered,shr);
    const dehumidifying=leaving.latent>1e-6;
    const operation=zonedSystemOperation(delivered,point?.capacityBtuHr??0,count,stages);
    const electricity=rating.cooling_non_supply_fan_power_kW*operation.powerEquivalentUnits;
    const beforeReheatF=leaving.dryF+fanHeat/(SENSIBLE*cfm);
    const requiredPostCoilHeat=Math.max(0,SENSIBLE*cfm*(desiredSupplyF-beforeReheatF));
    const primaryHeatNeed=Math.max(0,-totalSensible-fanHeat);
    const reheatNeed=Math.max(0,requiredPostCoilHeat-primaryHeatNeed);
    const unmetSensible=Math.max(0,sensibleNeed-leaving.sensible),unmetLatent=Math.max(0,latentNeed-leaving.latent);
    const missingOutdoor=Math.max(0,vent-cfm);
    const unmet=unmetSensible+unmetLatent;
    // Rank by load recovery and ventilation, then compressor and fan power.
    const recovery=delivered>0?mhgrhPoint(group.model,context.outdoorF,mixed.wetF,mixed.dryF,cfm/count,mode):null;
    const recoveryCapacity=recovery?Math.min(recovery.maxBtuHr*(operation.fullUnits+(operation.partialUnits??0)*operation.partialUnitRuntimeFraction),delivered+electricity*BTU_PER_KWH):0;
    const reheatShortfall=Math.max(0,reheatNeed-recoveryCapacity);
    const penalty=unmet+missingOutdoor*1000+reheatShortfall;
    const score=penalty*1000+electricity+fanKw;
    return {model:group.model.id,count,share,cfm,returnCfm:Math.max(0,cfm-vent),outdoorCfm:admitted,
      fanKw,fanHeat,fanMaxHp:fan.maxHp*count,fanMaxRpm:fan.maxRpm,maxCfm,mixed,
      cooling:point,capacity,shr,deliverableCapacity,availableSensible,availableLatent,sensibleNeed,latentNeed,required,linearRequired,delivered,deliveredSensible:leaving.sensible,deliveredLatent:leaving.latent,
      electricity,staging:operation,called,minimumRuntimeLockout,requestedOnMinutesPerUnit,requestedCoolingBtuHr,recovery,recoveryCapacity,coilLeavingF:leaving.dryF,supplyHumidityRatio:leaving.humidityRatio,
      desiredSupplyF,beforeReheatF,dehumidifying,primaryHeatNeed,reheatNeed,requiredPostCoilHeat,
      unmet,unmetSensible,unmetLatent,unmetVentilationCfm:missingOutdoor,score};
  };
  if(!runs){
    // No fan or conditioning call: do not request source curves at zero CFM.
    return {model:group.model.id,count,share,cfm:0,returnCfm:0,outdoorCfm:0,fanKw:0,fanHeat:0,
      fanMaxHp:fan.maxHp*count,fanMaxRpm:fan.maxRpm,maxCfm,mixed:null,cooling:null,capacity:0,shr:1,deliverableCapacity:0,availableSensible:0,availableLatent:0,
      sensibleNeed:0,latentNeed:0,required:0,linearRequired:0,delivered:0,deliveredSensible:0,deliveredLatent:0,electricity:0,recovery:null,recoveryCapacity:0,
      staging:zonedSystemOperation(0,1,count,stages),called:false,minimumRuntimeLockout:false,requestedOnMinutesPerUnit:0,requestedCoolingBtuHr:0,coilLeavingF:zone,supplyHumidityRatio:context.returnW,
      desiredSupplyF:zone,beforeReheatF:zone,dehumidifying:false,primaryHeatNeed:0,reheatNeed:0,requiredPostCoilHeat:0,
      unmet:0,unmetSensible:0,unmetLatent:0,unmetVentilationCfm:0,score:0};
  }
  if(options.airflowMode==="fixed")return evaluate(Math.min(fan.referenceCfm,fan.maxCfm)*count);
  const sourceMin=range[0]*count;
  const candidates=new Set<number>([minimum,maxCfm,Math.max(minimum,Math.min(maxCfm,sourceMin)),
    ...[300,330,360,380,400,420,440,460,480].map(perTon=>Math.max(minimum,Math.min(maxCfm,perTon*group.model.nominal_tons*count)))]);
  let best:ReturnType<typeof evaluate>=null;
  for(const cfm of candidates){if(cfm<=0)continue;const candidate=evaluate(cfm);if(candidate&&(!best||candidate.score<best.score))best=candidate;}
  return best;
}

export type VariableAirside=NonNullable<ReturnType<typeof solveVariableAirside>>;
export function solveVariableAirside(groups:PackagedGroup[],row:SchoolRow,school:SchoolAssumptions,mode:CurveRangeMode,runs=true,options:AirsideOptions={}){
  const tons=groups.reduce((s,g)=>s+g.count*g.model.nominal_tons,0);if(!(tons>0))return null;
  const details=groups.map(g=>solveGroup(g,row,school,g.count*g.model.nominal_tons/tons,mode,runs,options));
  if(details.some(d=>!d))return null;
  const known=details.map(d=>d!);
  const sum=(key:"cfm"|"returnCfm"|"outdoorCfm"|"fanKw"|"fanHeat"|"capacity"|"deliverableCapacity"|"availableSensible"|"availableLatent"|"delivered"|"deliveredSensible"|"deliveredLatent"|"electricity"|"primaryHeatNeed"|"reheatNeed"|"unmet"|"unmetLatent"|"unmetVentilationCfm"|"maxCfm")=>known.reduce((s,d)=>s+d[key],0);
  const cfm=sum("cfm"),weighted=(key:"coilLeavingF"|"beforeReheatF"|"desiredSupplyF"|"supplyHumidityRatio")=>cfm>0?known.reduce((s,d)=>s+d[key]*d.cfm,0)/cfm:null;
  const pointGroups=known.filter(d=>d.cooling);
  const common=(key:"curveOutdoorF"|"curveWetF"|"curveDryF")=>pointGroups.length&&pointGroups.every(d=>Math.abs(d.cooling![key]-pointGroups[0].cooling![key])<1e-7)?pointGroups[0].cooling![key]:null;
  return {details:known,cfm,returnCfm:sum("returnCfm"),outdoorCfm:sum("outdoorCfm"),maxCfm:sum("maxCfm"),
    fanKw:sum("fanKw"),fanHeat:sum("fanHeat"),capacity:sum("capacity"),required:known.every(d=>d.required!==null)?known.reduce((s,d)=>s+d.required!,0):null,
    deliverableCapacity:sum("deliverableCapacity"),availableSensible:sum("availableSensible"),availableLatent:sum("availableLatent"),
    sourceShr:sum("capacity")>0?known.reduce((s,d)=>s+d.capacity*d.shr,0)/sum("capacity"):null,
    delivered:sum("delivered"),deliveredSensible:sum("deliveredSensible"),deliveredLatent:sum("deliveredLatent"),
    electricity:sum("electricity"),primaryHeatNeed:sum("primaryHeatNeed"),reheatNeed:sum("reheatNeed"),
    unmet:sum("unmet"),unmetLatent:sum("unmetLatent"),unmetVentilationCfm:sum("unmetVentilationCfm"),
    coilLeavingF:weighted("coilLeavingF"),beforeReheatF:weighted("beforeReheatF"),desiredSupplyF:weighted("desiredSupplyF"),supplyHumidityRatio:weighted("supplyHumidityRatio"),
    dehumidifying:known.some(d=>d.dehumidifying),called:known.some(d=>d.called),belowMinimumStage:known.some(d=>d.staging.belowMinimumStage),
    boundaryEstimate:known.some(d=>d.cooling?.boundaryEstimate),curveOutdoorF:common("curveOutdoorF"),curveWetF:common("curveWetF"),curveDryF:common("curveDryF")};
}
