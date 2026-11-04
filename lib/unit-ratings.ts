/**
 * NOMINAL POWER AND FAN LOOKUP. Finds a rating by size and efficiency family.
 * The JSON contains published total cooling kW and an inferred supply-fan
 * component. Fan kW is not added on top of total system kW; equipment-model.ts
 * separates the components before applying coil duty.
 */

import data from "./data/precedent-unit-ratings.json";
import type { CoolingModel } from "./packaged-cooling";
import { EXTENDED_UNIT_TONS } from "./catalog-sizes";
type UnitRating=typeof data.models[number] & {scaledFromNominalTons?:number};
export const UNIT_RATINGS=data.models;
export const UNIT_RATING_SOURCE=data.source;
export const COOLING_POWER_BASIS="Nominal cooling system power is constant at full output. Supply-fan power/heat is inferred from gross minus AHRI net capacity, held at the rating value, and not adjusted to maximum airflow. These are provisional screening estimates.";
export function unitRatingFor(model: Pick<CoolingModel,"nominal_tons"|"efficiency">):UnitRating|null {
  const match=UNIT_RATINGS.find(r=>r.efficiency===model.efficiency&&r.nominal_tons===model.nominal_tons);
  if(match)return match;
  if(!EXTENDED_UNIT_TONS.includes(model.nominal_tons))return null;
  const base=UNIT_RATINGS.find(r=>r.efficiency===model.efficiency&&r.nominal_tons===25);
  if(!base)return null;
  const scale=model.nominal_tons/25;
  // Scale thermal/electrical quantities together, preserving reference COP and
  // the fan decomposition. Source table/motor fields describe the proxy only.
  return {...base,nominal_tons:model.nominal_tons,model:`scaled-${model.efficiency}-${model.nominal_tons}ton`,
    nominal_cfm:base.nominal_cfm*scale,ahri_cfm:base.ahri_cfm*scale,
    rated_gross_cooling_Btu_hr:base.rated_gross_cooling_Btu_hr*scale,rated_net_cooling_Btu_hr:base.rated_net_cooling_Btu_hr*scale,
    cooling_system_power_kW:base.cooling_system_power_kW*scale,inferred_supply_fan_heat_Btu_hr:base.inferred_supply_fan_heat_Btu_hr*scale,
    inferred_supply_fan_power_kW:base.inferred_supply_fan_power_kW*scale,cooling_non_supply_fan_power_kW:base.cooling_non_supply_fan_power_kW*scale,
    scaledFromNominalTons:25};
}
