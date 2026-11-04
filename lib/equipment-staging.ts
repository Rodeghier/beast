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
/** Lead/lag identical units: bring whole units on in sequence, then stage the
 * final unit. Only a residual below one unit's minimum stage is compressor cycling. */
export function stagedSystemOperation(loadBtuHr:number,unitCapacityBtuHr:number,unitCount:number,stages:number[],cd=CYCLING_DEGRADATION_COEFFICIENT):{powerEquivalentUnits:number;belowMinimumStage:boolean} {
  if(!Number.isFinite(loadBtuHr)||loadBtuHr<=0||!Number.isFinite(unitCapacityBtuHr)||unitCapacityBtuHr<=0||!Number.isInteger(unitCount)||unitCount<=0)return {powerEquivalentUnits:0,belowMinimumStage:false};
  const served=Math.min(loadBtuHr,unitCapacityBtuHr*unitCount);
  const fullUnits=Math.min(unitCount,Math.floor(served/unitCapacityBtuHr));
  let residual=served-fullUnits*unitCapacityBtuHr;
  if(residual<unitCapacityBtuHr*1e-9)residual=0;
  if(fullUnits===unitCount)residual=0;
  const residualPlr=residual/unitCapacityBtuHr,minimumStage=stages[0]??1;
  return {powerEquivalentUnits:fullUnits+(residualPlr>0?stagedPowerFraction(residualPlr,stages,cd):0),belowMinimumStage:residualPlr>0&&residualPlr<minimumStage-1e-9};
}
