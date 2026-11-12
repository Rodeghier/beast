/** Unit-level stage and on/off histograms. Compressed identical-unit profiles avoid
 * expanding thousands of installed units into individual hourly arrays.
 * A unit-hour is one unit observed for one hour; stage times can be fractional.
 */
import type { EquipmentResult, EquipmentHour } from "./equipment-model";
import { coolingFor } from "./equipment";
import { compressorStages } from "./precedent-stages";
import { CYCLING_DEGRADATION_COEFFICIENT, type StageOperation } from "./equipment-staging";
import type { UtilizationMode } from "./equipment-utilization";

export type OperationScope="operating"|"all"|"unit";
export type OperationSource={id:string;label:string;count:number;stages:number[];kind:"compressor"|"burner"};
export type OperationOptions={scope?:OperationScope;groupId?:string;unit?:number};
export type OperationDistribution={source:OperationSource|null;reason:string|null;
  stages:{label:string;unitHours:number;percent:number}[];
  minutes:{range:string;on:number;off:number}[];
  includedUnitHours:number;onUnitHours:number;offUnitHours:number;cyclingUnitHours:number;
  cyclingOnMinutes:number;cyclingOffMinutes:number;idleUnitHoursExcluded:number;knownClockHours:number;unavailableClockHours:number;
};
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const close=(a:number,b:number)=>Math.abs(a-b)<1e-7;

export function operationSources(result:EquipmentResult|undefined,mode:UtilizationMode):{sources:OperationSource[];reason:string|null} {
  if(!result)return {sources:[],reason:"Select equipment and load results to view operation."};
  if(mode==="heating"&&result.scenario.heating==="gas")return {sources:[{id:"boiler",label:"Selected boiler",count:1,stages:[1],kind:"burner"}],reason:null};
  if(mode==="heating"&&result.scenario.heating==="resistance")return {sources:[],reason:"Resistance heat uses proportional electrical input in this model. Element stages and switching times have not been supplied; use the capacity and power view."};
  if(mode==="cooling"&&coolingFor(result.scenario)==="air-cooled-chiller")return {sources:[],reason:"The chiller placeholder has no compressor staging or cycling data. Use the capacity and power view."};
  const sources=result.selection?.groups.map(g=>({id:g.model.id,label:`${g.count} × ${g.model.nominal_tons} ton units`,count:g.count,
    stages:compressorStages(g.model.efficiency as "standard"|"high",g.model.nominal_tons),kind:"compressor" as const}))??[];
  return {sources,reason:sources.length?null:"No selected unit bank is available for stage analysis."};
}

function validOperation(value:unknown,source:OperationSource):value is StageOperation {
  if(!value||typeof value!=="object")return false;
  const op=value as StageOperation;
  const partialUnits=op.partialUnits??(op.partialUnitLoadFraction>0?1:0);
  return op.unitCount===source.count&&Number.isInteger(op.fullUnits)&&op.fullUnits>=0&&Number.isInteger(op.idleUnits)&&op.idleUnits>=0
    &&Number.isInteger(partialUnits)&&partialUnits>=0&&(op.partialUnitLoadFraction>0?partialUnits>0:partialUnits===0)
    &&finite(op.partialUnitLoadFraction)&&op.partialUnitLoadFraction>=0&&op.partialUnitLoadFraction<=1
    &&op.fullUnits+op.idleUnits+partialUnits===source.count
    &&Array.isArray(op.stageLevels)&&op.stageLevels.length===source.stages.length&&op.stageLevels.every((v,i)=>close(v,source.stages[i]))
    &&Array.isArray(op.partialUnitStageTimes)&&op.partialUnitStageTimes.length===source.stages.length
    &&op.partialUnitStageTimes.every(v=>finite(v)&&v>=0&&v<=1)&&finite(op.partialUnitRuntimeFraction)
    &&op.partialUnitRuntimeFraction>=0&&op.partialUnitRuntimeFraction<=1+1e-7
    &&close(op.partialUnitStageTimes.reduce((s,t)=>s+t,0),op.partialUnitRuntimeFraction)
    &&(op.partialUnitLoadFraction>0||close(op.partialUnitRuntimeFraction,0));
}
function idleOperation(source:OperationSource):StageOperation {
  return {unitCount:source.count,fullUnits:0,idleUnits:source.count,stageLevels:source.stages,partialUnitLoadFraction:0,
    partialUnitStageTimes:source.stages.map(()=>0),partialUnitRuntimeFraction:0,powerEquivalentUnits:0,belowMinimumStage:false};
}
function operationForHour(row:EquipmentHour,source:OperationSource,mode:UtilizationMode):StageOperation|null {
  if(source.kind==="burner"){
    const runtime=row.boilerRuntimeFraction;
    if(!finite(runtime)||runtime<0||runtime>1)return null;
    if(runtime===0)return idleOperation(source);
    const partial=runtime<1;
    return {unitCount:1,fullUnits:partial?0:1,idleUnits:0,stageLevels:[1],partialUnitLoadFraction:partial?runtime:0,
      partialUnitStageTimes:[partial?runtime:0],partialUnitRuntimeFraction:partial?runtime:0,powerEquivalentUnits:runtime,belowMinimumStage:partial};
  }
  const electricity=mode==="cooling"?row.coolingElectricity:row.heatingElectricity;
  if(!finite(electricity)||electricity<0)return null;
  if(electricity===0)return idleOperation(source); // A known idle compressor needs no curve evaluation.
  try {
    const detail=row.groupPerformance?JSON.parse(row.groupPerformance):null;
    const groups=detail?.[mode];
    const op=Array.isArray(groups)?groups.find(g=>g.model===source.id)?.staging:null;
    return validOperation(op,source)?op:null;
  }catch{return null;}
}

/** Flat numeric CSV readouts from the same validated profiles as the histograms.
 * Keep mixed-size groups separate: stage numbers can mean different capacities.
 * Minutes are per unit (unit-count means for legacy lead/lag group records). */
export function equipmentOperationCsv(result:EquipmentResult) {
  const groups=(["heating","cooling"] as const).flatMap(mode=>{
    const sources=operationSources(result,mode).sources;
    return (sources.length?sources:[null]).map((source,i)=>({mode,source,
      prefix:`${mode==="heating"?"Heating":"Cooling"}${sources.length>1?`_group_${i+1}`:""}`}));
  });
  const headers=groups.flatMap(({source,prefix})=>[
    `${prefix}_model`,`${prefix}_unit_count`,
    ...(source?.stages??[]).flatMap((_,i)=>[`${prefix}_stage_${i+1}_capacity_percent`,`${prefix}_stage_${i+1}_minutes_per_unit`]),
    `${prefix}_on_minutes_per_unit`,`${prefix}_off_minutes_per_unit`,`${prefix}_runtime_fraction`,`${prefix}_cycling_PLF`,
  ]);
  const values=(row:EquipmentHour)=>groups.flatMap(({mode,source})=>{
    const op=source&&!result.error?operationForHour(row,source,mode):null;
    const stageValues=(source?.stages??[]).flatMap((level,i)=>{
      if(!op)return [level*100,null];
      const partial=op.partialUnits??(op.partialUnitLoadFraction>0?1:0);
      const fullTime=i===op.stageLevels.length-1?op.fullUnits:0;
      return [level*100,60*(fullTime+partial*op.partialUnitStageTimes[i])/op.unitCount];
    });
    if(!op)return [source?.id??null,source?.count??null,...stageValues,null,null,null,null];
    const partial=op.partialUnits??(op.partialUnitLoadFraction>0?1:0);
    const runtime=Math.min(1,Math.max(0,(op.fullUnits+partial*op.partialUnitRuntimeFraction)/op.unitCount));
    const partialPlf=source!.kind==="compressor"&&op.belowMinimumStage
      ?1-CYCLING_DEGRADATION_COEFFICIENT*(1-op.partialUnitLoadFraction/op.stageLevels[0]):1;
    const plf=1-partial*(1-partialPlf)/op.unitCount;
    return [source!.id,source!.count,...stageValues,60*runtime,60*(1-runtime),runtime,plf];
  });
  return {headers,values};
}
const minuteBin=(minutes:number)=>minutes<=1e-7?0:Math.min(6,Math.max(1,Math.ceil((minutes-1e-7)/10)));

export function equipmentOperation(result:EquipmentResult|undefined,mode:UtilizationMode,options:OperationOptions={}):OperationDistribution {
  const available=operationSources(result,mode),source=available.sources.find(s=>s.id===options.groupId)??available.sources[0]??null;
  const output:OperationDistribution={source,reason:available.reason,stages:[],minutes:[{range:"0",on:0,off:0},...Array.from({length:6},(_,i)=>({range:`${i*10}–${(i+1)*10}`,on:0,off:0}))],
    includedUnitHours:0,onUnitHours:0,offUnitHours:0,cyclingUnitHours:0,cyclingOnMinutes:0,cyclingOffMinutes:0,idleUnitHoursExcluded:0,knownClockHours:0,unavailableClockHours:0};
  if(!source||!result)return output;
  if(!source.stages.length){output.reason="Catalog stage levels are unavailable for this selection.";return output;}
  const scope=options.scope??"operating",unit=options.unit??1;
  if(scope==="unit"&&(!Number.isInteger(unit)||unit<1||unit>source.count)){output.reason=`Choose a unit from 1 to ${source.count}.`;return output;}
  output.stages=[{label:"Off",unitHours:0,percent:0},...source.stages.map((stage,i)=>({label:source.kind==="burner"?"Full firing":`Stage ${i+1} (${Number((stage*100).toFixed(1))}%)`,unitHours:0,percent:0}))];
  const add=(count:number,times:number[],called:boolean)=>{
    if(!count)return;
    if(scope==="operating"&&!called){output.idleUnitHoursExcluded+=count;return;}
    const runtime=Math.min(1,Math.max(0,times.reduce((s,t)=>s+t,0))),off=1-runtime;
    output.includedUnitHours+=count;output.onUnitHours+=count*runtime;output.offUnitHours+=count*off;
    output.stages[0].unitHours+=count*off;times.forEach((time,i)=>output.stages[i+1].unitHours+=count*time);
    output.minutes[minuteBin(runtime*60)].on+=count;output.minutes[minuteBin(off*60)].off+=count;
    if(called&&runtime>0&&runtime<1-1e-7){output.cyclingUnitHours+=count;output.cyclingOnMinutes+=count*runtime*60;output.cyclingOffMinutes+=count*off*60;}
  };
  for(const row of result.rows){
    const op=result.error?null:operationForHour(row,source,mode);
    if(!op){output.unavailableClockHours++;continue;}
    output.knownClockHours++;
    const full=source.stages.map((_,i)=>i===source.stages.length-1?1:0),idle=source.stages.map(()=>0);
    if(scope==="unit"){
      if(unit<=op.fullUnits)add(1,full,true);
      else if(op.partialUnitLoadFraction>0&&unit<=op.fullUnits+(op.partialUnits??1))add(1,op.partialUnitStageTimes,true);
      else add(1,idle,false);
    }else{
      add(op.fullUnits,full,true);
      if(op.partialUnitLoadFraction>0)add(op.partialUnits??1,op.partialUnitStageTimes,true);
      add(op.idleUnits,idle,false);
    }
  }
  for(const stage of output.stages)stage.percent=output.includedUnitHours?100*stage.unitHours/output.includedUnitHours:0;
  return output;
}
