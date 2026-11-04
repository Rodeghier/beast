/** Compressor staging and cycling helpers, shared by single-size and mixed-size banks. */
export const CYCLING_DEGRADATION_COEFFICIENT=0.15;
/** Converts steady-state part-load ratio to compressor runtime fraction using PLF=1-Cd(1-PLR). */
export function cyclingRuntimeFraction(partLoadRatio:number,cd=CYCLING_DEGRADATION_COEFFICIENT):number {
  const plr=Math.min(1,Math.max(0,partLoadRatio));
  const plf=1-cd*(1-plr);
  return plf>0?Math.min(1,plr/plf):0;
}
/** Estimated input-power fraction for staged units. Below minimum stage, cycle
 * that stage with Cd. Between stages, time-share adjacent catalog stages; stage
 * power is provisionally proportional to stage capacity. */
export function stagedPowerFraction(partLoadRatio:number,stages:number[],cd=CYCLING_DEGRADATION_COEFFICIENT):number {
  const plr=Math.min(1,Math.max(0,partLoadRatio));
  if(!stages.length)return cyclingRuntimeFraction(plr,cd);
  const minimum=stages[0];
  if(plr<minimum){
    const minimumStagePlr=minimum>0?plr/minimum:0;
    return minimum*cyclingRuntimeFraction(minimumStagePlr,cd);
  }
  for(let i=1;i<stages.length;i++)if(plr<=stages[i]){
    const low=stages[i-1],high=stages[i];
    // Time-share adjacent capacity stages to represent the hourly-average load.
    // With provisional power proportional to capacity, average input fraction = PLR.
    return high>low?plr:low;
  }
  return 1;
}
/** Fractions of an hourly interval spent at each catalog stage. Below minimum
 * stage, on-time includes the existing cycling-degradation factor. Between
 * stages the model time-shares adjacent stages with no compressor off-time.
 * These are hourly time totals, not cycle periods or a sequence of starts. */
export function stageTimeFractions(partLoadRatio:number,stages:number[],cd=CYCLING_DEGRADATION_COEFFICIENT):number[] {
  const levels=stages.length?stages:[1],times=levels.map(()=>0),plr=Math.min(1,Math.max(0,partLoadRatio));
  if(!Number.isFinite(plr)||plr===0)return times;
  if(plr<levels[0]){times[0]=cyclingRuntimeFraction(plr/levels[0],cd);return times;}
  for(let i=1;i<levels.length;i++)if(plr<=levels[i]){
    const span=levels[i]-levels[i-1];
    times[i]=span>0?(plr-levels[i-1])/span:0;times[i-1]=1-times[i];return times;
  }
  times[times.length-1]=1;return times;
}
export type StageOperation={
  unitCount:number;fullUnits:number;idleUnits:number;stageLevels:number[];
  partialUnitLoadFraction:number;partialUnitStageTimes:number[];partialUnitRuntimeFraction:number;
  powerEquivalentUnits:number;belowMinimumStage:boolean;
};
/** Lead/lag identical units: full units, at most one partially loaded unit, and
 * the remaining idle units. Unit positions are fixed within each size group. */
export function stagedSystemOperation(loadBtuHr:number,unitCapacityBtuHr:number,unitCount:number,stages:number[],cd=CYCLING_DEGRADATION_COEFFICIENT):StageOperation {
  const stageLevels=stages.length?[...stages]:[1],count=Number.isInteger(unitCount)&&unitCount>0?unitCount:0;
  const idle:StageOperation={unitCount:count,fullUnits:0,idleUnits:count,stageLevels,partialUnitLoadFraction:0,partialUnitStageTimes:stageLevels.map(()=>0),partialUnitRuntimeFraction:0,powerEquivalentUnits:0,belowMinimumStage:false};
  if(!Number.isFinite(loadBtuHr)||loadBtuHr<=0||!Number.isFinite(unitCapacityBtuHr)||unitCapacityBtuHr<=0||!count)return idle;
  const served=Math.min(loadBtuHr,unitCapacityBtuHr*unitCount);
  const fullUnits=Math.min(unitCount,Math.floor(served/unitCapacityBtuHr));
  let residual=served-fullUnits*unitCapacityBtuHr;
  if(residual<unitCapacityBtuHr*1e-9)residual=0;
  if(fullUnits===unitCount)residual=0;
  const residualPlr=residual/unitCapacityBtuHr,minimumStage=stageLevels[0];
  const partialUnitStageTimes=stageTimeFractions(residualPlr,stageLevels,cd);
  return {unitCount:count,fullUnits,idleUnits:count-fullUnits-(residualPlr>0?1:0),stageLevels,partialUnitLoadFraction:residualPlr,partialUnitStageTimes,
    partialUnitRuntimeFraction:partialUnitStageTimes.reduce((s,t)=>s+t,0),
    powerEquivalentUnits:fullUnits+(residualPlr>0?stagedPowerFraction(residualPlr,stageLevels,cd):0),belowMinimumStage:residualPlr>0&&residualPlr<minimumStage-1e-9};
}
