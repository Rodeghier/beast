import { CYCLING_DEGRADATION_COEFFICIENT, type StageOperation } from "./equipment-staging";

type GroupOperation={model:string;count:number;staging:StageOperation};
/** Readouts retain each size group's profile rather than averaging distinct stages.
 * Minutes are per unit in one hour, including degradation-adjusted compressor runtime. */
export function hourlyOperation(groups:GroupOperation[]) {
  const stage:string[]=[],onMinutes:string[]=[],derate:string[]=[];
  for(const {model,count,staging:op} of groups){
    const prefix=groups.length>1?`${count} × ${model}: `:"";
    const partial=op.partialUnits??(op.partialUnitLoadFraction>0?1:0);
    const profiles:{count:number;times:number[];plf:number}[]=[];
    if(op.fullUnits)profiles.push({count:op.fullUnits,times:op.stageLevels.map((_,i)=>i===op.stageLevels.length-1?1:0),plf:1});
    if(partial)profiles.push({count:partial,times:op.partialUnitStageTimes,plf:op.belowMinimumStage?1-CYCLING_DEGRADATION_COEFFICIENT*(1-op.partialUnitLoadFraction/op.stageLevels[0]):1});
    if(op.idleUnits)profiles.push({count:op.idleUnits,times:op.stageLevels.map(()=>0),plf:1});
    for(const profile of profiles){
      const label=prefix+(profiles.length>1?`${profile.count} units: `:"");
      const active=profile.times.map((time,i)=>time>1e-9?`Stage ${i+1} (${(op.stageLevels[i]*100).toFixed(1)}%; ${(time*60).toFixed(1)} min)`:null).filter(Boolean);
      stage.push(label+(active.join(" / ")||"Off"));
      onMinutes.push(label+(profile.times.reduce((sum,t)=>sum+t,0)*60).toFixed(1));
      derate.push(label+profile.plf.toFixed(4));
    }
  }
  return {stage:stage.join("; "),onMinutes:onMinutes.join("; "),derate:derate.join("; ")};
}
