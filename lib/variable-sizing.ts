/** Recheck design sizing with all-airflow coil fits, fan HP limits, minimum OA
 * and sensible/latent demand. Retain mixed-bank seeds; examine homogeneous
 * alternatives in unit-count/tonnage order. This nonlinear search is bounded
 * and does not claim the old linear optimizer's proof of global optimality. */
import { optimizePackagedBank } from "./packaged-optimizer";
import { COOLING_MODELS } from "./packaged-cooling";
import { heatingModelFor } from "./packaged-heating";
import { matchesStagePreference } from "./precedent-stages";
import { solveVariableAirside } from "./variable-airside";
import { variableFanModel } from "./variable-fan";
import type { SchoolRow, SchoolAssumptions } from "./school";
import type { CurveRangeMode, EquipmentStage, HeatingEquipment } from "./equipment";
import type { PackagedGroup, PackagedSelection } from "./packaged-bank";
import { bankHeating } from "./packaged-bank";
import { airContext, mixAir } from "./mixed-air";

export function optimizeVariablePackagedBank(rows:SchoolRow[],school:SchoolAssumptions,efficiency:"standard"|"high",heating:HeatingEquipment="heat-pump",rangeMode:CurveRangeMode="bounded",stage:EquipmentStage="automatic",airflowMode:"variable"|"fixed"="variable"):PackagedSelection|null {
  const seed=optimizePackagedBank(rows,school,efficiency,heating,rangeMode,stage);if(!seed)return null;
  const states=new Map<string,{row:SchoolRow;weight:number}>();
  for(const row of rows.filter(r=>r.occupied)){
    const key=JSON.stringify([row.temperature,row.humidity,row.coolBalance,row.heating,row.latentCooling,row.ventilationCfm,row.occupants]);
    const previous=states.get(key);if(previous)previous.weight++;else states.set(key,{row,weight:1});
  }
  const design=[...states.values()].map(s=>s.row),weights=[...states.values()].map(s=>s.weight);
  const peakVent=Math.max(0,...design.map(r=>r.ventilationCfm));
  const peakCool=Math.max(0,...design.map(r=>-(r.totalCooling??0)));
  const better=(a:PackagedSelection,b:PackagedSelection|null)=>!b||a.count<b.count||a.count===b.count&&a.totalTons<b.totalTons;
  const evaluate=(groups:PackagedGroup[]):PackagedSelection|null=>{
    const count=groups.reduce((s,g)=>s+g.count,0),totalTons=groups.reduce((s,g)=>s+g.count*g.model.nominal_tons,0);
    const maxAir=groups.reduce((s,g)=>{const fan=variableFanModel(g.model);return s+g.count*(fan?(airflowMode==="fixed"?Math.min(fan.referenceCfm,fan.maxCfm):fan.maxCfm):0);},0);
    const referenceCoolingBtuHr=groups.reduce((s,g)=>s+g.count*g.model.reference_capacity_Btu_hr,0);
    if(maxAir<peakVent-1e-7||referenceCoolingBtuHr<peakCool/2)return null;
    const points=design.map(r=>solveVariableAirside(groups,r,school,rangeMode,true,{airflowMode}));
    if(points.some(p=>p&&(p.unmet>1||p.unmetVentilationCfm>1e-6)))return null;
    const known=points.filter(p=>p!==null);
    const estimated=points.reduce((s,p,i)=>s+(p?.boundaryEstimate?weights[i]:0),0),unknown=points.reduce((s,p,i)=>s+(p===null?weights[i]:0),0);
    let verifiedHeatingHours=0,estimatedHeatingHours=0,unverifiedHeatingHours=0,heatingLoading:number|null=null;
    if(heating==="heat-pump")design.forEach((r,i)=>{
      if(r.heating===0)return;
      const mixed=points[i]?mixAir(airContext(r,school),points[i]!.cfm):null;
      const heat=mixed&&r.temperatureF!==null?bankHeating(groups,r.temperatureF,mixed.dryF,rangeMode):null;
      if(!heat||r.heating===null)unverifiedHeatingHours+=weights[i];
      else {if(heat.boundaryEstimate)estimatedHeatingHours+=weights[i];else verifiedHeatingHours+=weights[i];heatingLoading=Math.max(heatingLoading??0,r.heating/heat.capacity);}
    });
    return {...seed,groups,count,totalTons,supplyCfm:maxAir,referenceCoolingBtuHr,
      referenceHeatingBtuHr:groups.reduce((s,g)=>s+g.count*g.heatingModel.reference_capacity_Btu_hr,0),
      verifiedCoolingHours:points.reduce((s,p,i)=>s+(p?.called?weights[i]:0),0)-estimated,estimatedCoolingHours:estimated,unverifiedCoolingHours:unknown,
      verifiedHeatingHours,estimatedHeatingHours,unverifiedHeatingHours,
      optimizationComplete:false,designLoading:{heating:heatingLoading,
        sensibleCooling:known.length?Math.max(...known.flatMap(p=>p.details.map(d=>d.availableSensible>0?d.sensibleNeed/d.availableSensible:0))):null,
        latentCooling:known.length?Math.max(...known.flatMap(p=>p.details.map(d=>d.availableLatent>0?d.latentNeed/d.availableLatent:0))):null,ventilation:peakVent/maxAir},
      basis:"Occupied ASHRAE design hours; airflow-dependent catalog cooling capacity and SHR, fan HP/CFM limits, ventilation and sensible/latent loads. Supply temperature is a calculated output, not a sizing target. Heating remains diagnostic. Mixed-bank seed plus homogeneous alternatives; fewest units then lowest nominal tons among evaluated feasible banks. Nonlinear search is bounded; global optimality is not proven. Unknown curve checks remain flagged and excluded."};
  };
  let best=evaluate(seed.groups);
  for(let extra=1;!best&&extra<=32;extra++)best=evaluate(seed.groups.map(g=>({...g,count:g.count+extra})));
  const models=COOLING_MODELS.filter(m=>m.efficiency===efficiency&&matchesStagePreference(m.efficiency,m.nominal_tons,stage)).sort((a,b)=>b.nominal_tons-a.nominal_tons);
  const start=Date.now();
  for(const model of models){
    if(Date.now()-start>15000)break;
    const fan=variableFanModel(model),heatingModel=heatingModelFor(model);if(!fan||!heatingModel)continue;
    const minimum=Math.max(1,Math.ceil(peakVent/fan.maxCfm));
    const maximum=best?.count??Math.min(1000,Math.max(minimum,seed.count*8));
    for(let count=minimum;count<=maximum;count++){
      if(best&&count===best.count&&model.nominal_tons*count>=best.totalTons)break;
      const candidate=evaluate([{model,heatingModel,count}]);
      if(candidate){if(better(candidate,best))best=candidate;break;}
      if(Date.now()-start>15000)break;
    }
  }
  return best;
}
