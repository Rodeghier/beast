import type { EquipmentStage } from "./equipment";

/** Trane Precedent WSK/WHK catalog stage capacities as a fraction of full output. */
const STAGES:Record<"standard"|"high",Record<number,number[]>>={
  standard:{3:[1],4:[1],5:[1],6:[.34,.66,1],7.5:[.33,.67,1],8.5:[.32,.68,1],10:[.28,.72,1],12.5:[.32,.68,1],15:[.33,.67,1],17.5:[.33,.67,1],20:[.24,.36,.64,1],25:[.25,.37,.63,1]},
  high:{3:[.67,1],4:[.67,1],5:[.67,1],6:[.34,.66,1],7.5:[.33,.67,1],8.5:[.32,.68,1],10:[.28,.72,1],12.5:[.32,.68,1],15:[.33,.67,1],17.5:[.33,.67,1],20:[.24,.36,.64,1],25:[.25,.37,.63,1]},
};

export function compressorStages(efficiency:"standard"|"high",nominalTons:number):number[] {
  return STAGES[efficiency][nominalTons]??[];
}

export function matchesStagePreference(efficiency:"standard"|"high",nominalTons:number,preference:EquipmentStage):boolean {
  if(preference==="automatic")return true;
  if(preference==="variable")return false;
  const count=compressorStages(efficiency,nominalTons).length;
  return preference==="single"?count===1:count>1;
}
