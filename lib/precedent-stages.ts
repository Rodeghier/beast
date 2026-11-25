import type { EquipmentStage, HeatingEquipment } from "./equipment";
import type { CoolingModel } from "./packaged-cooling";
import { intellipakCoolingTable } from "./intellipak-performance";
import { zonedModulatingOperation, zonedSystemOperation } from "./equipment-staging";

/** Trane Precedent WSK/WHK catalog stage capacities as a fraction of full output. */
const STAGES:Record<"standard"|"high",Record<number,number[]>>={
  standard:{3:[1],4:[1],5:[1],6:[.34,.66,1],7.5:[.33,.67,1],8.5:[.32,.68,1],10:[.28,.72,1],12.5:[.32,.68,1],15:[.33,.67,1],17.5:[.33,.67,1],20:[.24,.36,.64,1],25:[.25,.37,.63,1]},
  high:{3:[.67,1],4:[.67,1],5:[.67,1],6:[.34,.66,1],7.5:[.33,.67,1],8.5:[.32,.68,1],10:[.28,.72,1],12.5:[.32,.68,1],15:[.33,.67,1],17.5:[.33,.67,1],20:[.24,.36,.64,1],25:[.25,.37,.63,1]},
};

/** IntelliPak RT-PRC121H-EN General Data tables 21, 22 and 24. */
const INTELLIPAK_STAGES: typeof STAGES = {
  standard: {30:[.21,.39,.61,.79,1],40:[.24,.48,.74,1],50:[.23,.46,.73,1],
    55:[.23,.48,.74,1],60:[.24,.48,.72,1],70:[.23,.46,.69,1],75:[.21,.42,.71,1],
    90:[.25,.50,.75,1],105:[.22,.45,.72,1],115:[.21,.47,.74,1],130:[.23,.46,.73,1]},
  high: {30:[.23,.38,.62,.77,1],40:[.23,.46,.73,1],50:[.22,.48,.74,1],
    55:[.24,.48,.73,1],60:[.23,.46,.73,1],70:[.25,.50,.75,1],75:[.20,.46,.73,1],
    90:[.25,.50,.75,1]},
};

export function isEflex(efficiency: string): boolean {
  return efficiency === "eflex" || efficiency === "eflex-heat-pump";
}

/** The General Data gives unit-level modulation from 15% to 100%. Heating
 * uses the eFlex control basis for all models served by its capacity tables. */
export function minimumModulatingCapacity(model: CoolingModel, mode: "heating"|"cooling"): number | null {
  return model.intellipak && (mode === "heating" || isEflex(model.efficiency)) ? .15 : null;
}

export function compressorStages(efficiency:string,nominalTons:number):number[] {
  if(efficiency!=="standard"&&efficiency!=="high")return [];
  return STAGES[efficiency][nominalTons]??INTELLIPAK_STAGES[efficiency][nominalTons]??[];
}

export function packagedCompressorOperation(model:CoolingModel,mode:"heating"|"cooling",load:number,capacity:number,count:number) {
  const minimum=minimumModulatingCapacity(model,mode);
  return minimum===null
    ?zonedSystemOperation(load,capacity,count,compressorStages(model.efficiency,model.nominal_tons))
    :zonedModulatingOperation(load,capacity,count,minimum);
}

export function matchesStagePreference(efficiency:string,nominalTons:number,preference:EquipmentStage):boolean {
  if(preference==="automatic")return true;
  if(preference==="variable")return isEflex(efficiency);
  const count=compressorStages(efficiency,nominalTons).length;
  return preference==="single"?count===1:count>1;
}

/** Use the reversible eFlex cooling table when the catalog has one for a heat-pump scenario. */
export function matchesPackagedScenario(model:CoolingModel,efficiency:"standard"|"high",preference:EquipmentStage,heating:HeatingEquipment):boolean {
  if(preference==="variable"){
    const heatPumpTable=heating==="heat-pump"&&intellipakCoolingTable(model.nominal_tons,"eflex-heat-pump");
    return model.efficiency===(heatPumpTable?"eflex-heat-pump":"eflex");
  }
  return model.efficiency===efficiency&&matchesStagePreference(efficiency,model.nominal_tons,preference);
}
