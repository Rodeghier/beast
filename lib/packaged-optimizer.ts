/** Mixed integer sizing. For a fixed installed airflow, mixed entering air is
 * known and each catalog unit contributes linear sensible/latent/heating output.
 * Enumerate attainable airflows and solve integer unit counts at each airflow.
 * This avoids assuming all units have the same size, or freezing mixed air at
 * the conditions of a different bank. The primary objective is unit count.
 */
import { solve, type Model, type Constraint } from "yalps";
import { COOLING_MODELS } from "./packaged-cooling";
import { heatingModelFor } from "./packaged-heating";
import { matchesStagePreference } from "./precedent-stages";
import { unitRatingFor } from "./unit-ratings";
import { airContext, mixAir } from "./mixed-air";
import { operatingCoolingPoint, operatingHeatingPoint } from "./curve-evaluation";
import type { SchoolAssumptions, SchoolRow } from "./school";
import type { CurveRangeMode, EquipmentStage, HeatingEquipment } from "./equipment";
import { bankRatings, type DesignLoading, type PackagedSelection } from "./packaged-bank";

const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const validCooling=(r:SchoolRow)=>finite(r.sensibleCooling)&&finite(r.latentCooling)&&r.sensibleCooling<=0&&r.latentCooling<=0;
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
const better=(a:PackagedSelection,b:PackagedSelection|null)=>!b||a.count<b.count||a.count===b.count&&a.totalTons<b.totalTons-1e-7;
export function optimizePackagedBank(input:SchoolRow[],school:SchoolAssumptions,efficiency:"standard"|"high",heating:HeatingEquipment="heat-pump",rangeMode:CurveRangeMode="bounded",stage:EquipmentStage="automatic"):PackagedSelection|null {
  // Equivalent design states need only one constraint, irrespective of timestamp.
  const unique=new Map<string,SchoolRow>(),multiplicity=new Map<string,number>();
  for(const r of input.filter(r=>r.occupied)){const key=JSON.stringify([r.temperature,r.humidity,r.temperatureF,r.freeFloatF,r.heatingSetpointF,r.coolingSetpointF,r.ventilationCfm,r.heating,r.sensibleCooling,r.latentCooling,r.coolBalance]);unique.set(key,r);multiplicity.set(key,(multiplicity.get(key)??0)+1);}
  const weights=[...unique.keys()].map(key=>multiplicity.get(key)!);
  const rows=[...unique.values()],contexts=rows.map(r=>airContext(r,school));
  if(!rows.length)return null;
  const models=COOLING_MODELS.filter(m=>m.efficiency===efficiency&&matchesStagePreference(m.efficiency,m.nominal_tons,stage)&&unitRatingFor(m)&&heatingModelFor(m)).sort((a,b)=>b.nominal_tons-a.nominal_tons);
  if(!models.length)return null;
  const peakVent=Math.max(0,...rows.map(r=>finite(r.ventilationCfm)?r.ventilationCfm:0));
  const quantum=models.map(m=>m.fixed_cfm).reduce(gcd),maxAir=Math.max(...models.map(m=>m.fixed_cfm));
  const minAir=Math.min(...models.map(m=>m.fixed_cfm));
  const sameAirPerTon=models.every(m=>Math.abs(m.fixed_cfm/m.nominal_tons-models[0].fixed_cfm/models[0].nominal_tons)<1e-7);
  const groupsFor=(counts:number[])=>models.flatMap((model,i)=>counts[i]>0?[{model,heatingModel:heatingModelFor(model)!,count:counts[i]}]:[]);
  // Each check describes one physical requirement. Unknown contributions cause
  // that selected bank's entire check to be ignored, never treated as zero output.
  const coefficients=(supply:number)=>rows.flatMap((r,i)=>{
    const mixed=mixAir(contexts[i],supply),checks:{key:string;need:number;values:(number|null)[];kind:"cooling"|"heating";estimated:boolean[]}[]=[];
    if(validCooling(r)){
      const points=models.map(m=>mixed&&finite(r.temperatureF)?operatingCoolingPoint(m,r.temperatureF,mixed.wetF,mixed.dryF,rangeMode):null);
      const fan=models.map(m=>unitRatingFor(m)!.inferred_supply_fan_heat_Btu_hr);
      const balance=finite(r.coolBalance)?r.coolBalance:-r.sensibleCooling!;
      // Cooling need can be created by fans on a heating/ventilation call.
      const calling=r.occupied||r.heating!>0||r.ventilationCfm>0||r.sensibleCooling!<0||r.latentCooling!<0;
      if(calling){
        checks.push({key:`s${i}`,need:balance,values:points.map((p,j)=>p?p.capacityBtuHr*p.shr-fan[j]:null),kind:"cooling",estimated:points.map(p=>p?.boundaryEstimate??false)});
        checks.push({key:`l${i}`,need:-r.latentCooling!,values:points.map(p=>p?p.capacityBtuHr*(1-p.shr):null),kind:"cooling",estimated:points.map(p=>p?.boundaryEstimate??false)});
      }
    }else checks.push({key:`s${i}`,need:NaN,values:models.map(()=>null),kind:"cooling",estimated:models.map(()=>false)});
    if(heating==="heat-pump"&&(!finite(r.heating)||r.heating>0)){
      const points=models.map(m=>mixed&&finite(r.temperatureF)?operatingHeatingPoint(heatingModelFor(m)!,r.temperatureF,mixed.dryF,rangeMode):null);
      checks.push({key:`h${i}`,need:r.heating??NaN,values:points.map(p=>p?.capacityBtuHr??null),kind:"heating",estimated:points.map(p=>p?.boundaryEstimate??false)});
    }
    return checks;
  });
  const cache=new Map<number,ReturnType<typeof coefficients>>();
  const at=(supply:number)=>{let table=cache.get(supply);if(!table){table=coefficients(supply);cache.set(supply,table);}return table;};
  const evaluate=(counts:number[]):PackagedSelection|null=>{
    const groups=groupsFor(counts),count=counts.reduce((s,n)=>s+n,0),supply=groups.reduce((s,g)=>s+g.count*g.model.fixed_cfm,0);
    if(!count)return null;
    const rating=bankRatings(groups)!;
    const designLoading:DesignLoading={heating:null,sensibleCooling:null,latentCooling:null,ventilation:peakVent/supply};
    const coverage={verifiedCoolingHours:0,estimatedCoolingHours:0,unverifiedCoolingHours:0,verifiedHeatingHours:0,estimatedHeatingHours:0,unverifiedHeatingHours:0};
    const coolingHours=new Map<number,"verified"|"estimated"|"unknown">();
    for(const check of at(supply)){
      const index=Number(check.key.slice(1)),r=rows[index];
      // Do not require cooling performance during an hour with no cooling need.
      if(check.kind==="cooling"&&validCooling(r)&&Math.max(0,(r.coolBalance??-r.sensibleCooling!)+rating.fanHeat)===0&&r.latentCooling===0)continue;
      const unknown=!finite(check.need)||check.values.some((v,i)=>counts[i]>0&&v===null);
      const estimated=check.estimated.some((v,i)=>counts[i]>0&&v);
      const available=check.values.reduce<number>((s,v,i)=>s+counts[i]*(v??0),0);
      // Heating is diagnostic only: the cooling-selected bank is never enlarged
      // to meet winter heat or a minimum ventilation airflow.
      if(check.kind==="cooling"&&!unknown&&available<check.need-1)return null;
      if(check.kind==="cooling"&&!unknown){
        // The aggregate zone is divided into fixed nominal-tonnage shares.
        // A group cannot borrow spare capacity from units serving other zones.
        const tons=groups.reduce((s,g)=>s+g.count*g.model.nominal_tons,0);
        const sensible=check.key[0]==="s",need=Math.max(0,check.need+(sensible?rating.fanHeat:0));
        if(models.some((m,i)=>counts[i]>0&&
          counts[i]*(check.values[i]!+(sensible?unitRatingFor(m)!.inferred_supply_fan_heat_Btu_hr:0))<need*counts[i]*m.nominal_tons/tons-1))return null;
      }
      if(!unknown){
        const key=check.kind==="heating"?"heating":check.key[0]==="s"?"sensibleCooling":"latentCooling";
        const need=key==="sensibleCooling"?Math.max(0,check.need+rating.fanHeat):Math.max(0,check.need);
        const capacity=key==="sensibleCooling"?available+rating.fanHeat:available;
        const ratio=need===0?0:capacity>0?need/capacity:null;
        if(ratio!==null)designLoading[key]=Math.max(designLoading[key]??0,ratio);
      }
      if(check.kind==="cooling"){
        const previous=coolingHours.get(index);
        coolingHours.set(index,unknown||previous==="unknown"?"unknown":estimated||previous==="estimated"?"estimated":"verified");
      }else if(unknown)coverage.unverifiedHeatingHours+=weights[index];else if(estimated)coverage.estimatedHeatingHours+=weights[index];else coverage.verifiedHeatingHours+=weights[index];
    }
    for(const [index,status] of coolingHours)if(status==="unknown")coverage.unverifiedCoolingHours+=weights[index];else if(status==="estimated")coverage.estimatedCoolingHours+=weights[index];else coverage.verifiedCoolingHours+=weights[index];
    return {groups,count,totalTons:groups.reduce((s,g)=>s+g.count*g.model.nominal_tons,0),supplyCfm:supply,
      referenceCoolingBtuHr:groups.reduce((s,g)=>s+g.count*g.model.reference_capacity_Btu_hr,0),referenceHeatingBtuHr:groups.reduce((s,g)=>s+g.count*g.heatingModel.reference_capacity_Btu_hr,0),
      ...coverage,designLoading,rangeMode,heatingAirflowApproximation:heating==="heat-pump",includesHeatPumpHeating:heating==="heat-pump",provisional:true,optimizationComplete:true,
      basis:"Occupied ASHRAE design hours; seasonal occupancy applied. Size for sensible and latent cooling only. Heating and ventilation airflow are diagnostic, never sizing constraints. Minimize total unit count, then installed nominal tonnage. Unavailable cooling design checks are ignored."};
  };
  // Obtain a feasible incumbent from each homogeneous bank. Starting with large
  // units keeps the later mixed-integer search compact for large buildings.
  let best:PackagedSelection|null=null;
  for(let j=0;j<models.length;j++){
    const minimum=1;
    for(let n=minimum;n<=Math.min(10000,best?.count??10000);n++){
      const counts=models.map((_,i)=>i===j?n:0),candidate=evaluate(counts);
      if(candidate){if(better(candidate,best))best=candidate;break;}
    }
  }
  if(!best)return null;
  let complete=true;
  const start=Date.now();
  // With at most the incumbent's unit count, no better bank can have airflow
  // exceeding count * largest-unit airflow. Every attainable airflow is an
  // integer multiple of the catalog airflow GCD (240 CFM in the current data).
  for(let supply=minAir;supply<=best.count*maxAir;supply+=quantum){
    if(Date.now()-start>15000){complete=false;break;}
    const constraints:Record<string,Constraint>={air:{equal:supply/quantum},count:{min:1,max:best.count}};
    const variables:Record<string,Record<string,number>>=Object.fromEntries(models.map((m,i)=>[`u${i}`,{air:m.fixed_cfm/quantum,count:1,tons:m.nominal_tons}]));
    for(const check of at(supply)){
      if(check.kind!=="cooling")continue;
      if(!finite(check.need))continue;
      // At fixed airflow, total tons is known for this catalog. Reject sizes
      // that cannot meet their assigned zone share even with the smallest fan
      // heat per CFM. Final evaluation uses the selected bank's actual fan heat.
      // Unknown checks retain the existing whole-check exclusion policy.
      if(sameAirPerTon&&check.values.every(v=>v!==null)){
        const tons=supply*models[0].nominal_tons/models[0].fixed_cfm,sensible=check.key[0]==="s";
        const minFan=sensible?supply*Math.min(...models.map(m=>unitRatingFor(m)!.inferred_supply_fan_heat_Btu_hr/m.fixed_cfm)):0;
        const need=Math.max(0,check.need+minFan);
        models.forEach((m,i)=>{
          const gross=check.values[i]!+(sensible?unitRatingFor(m)!.inferred_supply_fan_heat_Btu_hr:0);
          if(gross*tons/m.nominal_tons<need-1){constraints[`excluded${i}`]={max:0};variables[`u${i}`][`excluded${i}`]=1;}
        });
      }
      constraints[check.key]={min:(check.need-1)/12000};
      // A selected unknown unit relaxes this whole check. M exceeds the demand
      // plus the greatest possible negative contribution from the other units.
      const bigM=Math.abs(check.need)/12000+best.count*Math.max(1,...check.values.map(v=>Math.abs(v??0)/12000))+1;
      check.values.forEach((v,i)=>variables[`u${i}`][check.key]=v===null?bigM:v/12000);
    }
    const model:Model={direction:"minimize",objective:"count",constraints,variables};
    const relaxed=solve(model);
    if(relaxed.status!=="optimal"){if(relaxed.status!=="infeasible")complete=false;continue;}
    if(Math.ceil(relaxed.result-1e-7)>best.count)continue;
    if(sameAirPerTon&&Math.ceil(relaxed.result-1e-7)===best.count&&supply>=best.supplyCfm)continue;
    let solution=solve({...model,integers:true},{timeout:150,maxIterations:32768});
    if(solution.status!=="optimal"&&solution.status!=="infeasible")complete=false;
    if(!Number.isFinite(solution.result))continue;
    // Current catalog airflow is 480 CFM/ton, so fixed airflow fixes tonnage.
    // Retain the secondary objective if future catalogs use different ratios.
    if(!sameAirPerTon&&solution.status==="optimal"){
      solution=solve({...model,objective:"tons",constraints:{...constraints,count:{equal:Math.round(solution.result)}},integers:true},{timeout:150});
      if(solution.status!=="optimal")complete=false;
      if(!Number.isFinite(solution.result))continue;
    }
    const counts=models.map((_,i)=>Math.round(solution.variables.find(([key])=>key===`u${i}`)?.[1]??0));
    const candidate=evaluate(counts);
    if(!candidate)complete=false;
    if(candidate&&better(candidate,best))best=candidate;
  }
  // A bounded search never presents an unproved optimum as a guaranteed minimum.
  best.optimizationComplete=complete;
  if(!complete)best.basis+=" Search limit reached; this is the best bank meeting available checks found, not a proven minimum.";
  return best;
}
