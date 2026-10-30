/**
 * EMISSIONS MULTIPLICATION. Electricity uses kg CO2e/kWh; gas uses kg CO2e/therm.
 * The functions return kg CO2e. Annual scorecards convert kg to metric tonnes.
 * A zero-use fuel contributes zero even without a factor; positive use needs one.
 */

import type { EquipmentResult } from "./equipment-model";
import type { EmissionRegion, GasCombustion } from "./location-energy";
export function energyEmissions(electricity:number|null, gasTherms:number|null, region:EmissionRegion|null|undefined, gas:GasCombustion|null|undefined) {
  const valid=(n:number|null|undefined):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
  const electricCo2e=electricity===0?0:valid(electricity)&&valid(region?.kgCo2ePerKwh)?electricity*region.kgCo2ePerKwh:null;
  const gasCo2e=gasTherms===0?0:valid(gasTherms)&&valid(gas?.kgCo2ePerTherm)?gasTherms*gas.kgCo2ePerTherm:null;
  const total=electricCo2e===null||gasCo2e===null?null:electricCo2e+gasCo2e;
  return {electricCo2e,gasCo2e,co2e:total!==null&&Number.isFinite(total)?total:null};
}
export function totalCo2e(result:EquipmentResult|null|undefined,region:EmissionRegion|null|undefined,gas?:GasCombustion|null):number|null {
  if(!result||result.error||!result.summary.completeHours)return null;
  return energyEmissions(result.summary.electricity,result.summary.gasTherms,region,gas).co2e;
}
