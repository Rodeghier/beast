/**
 * NOMINAL POWER AND FAN LOOKUP. Finds a rating by size and efficiency family.
 * The JSON contains published total cooling kW and an inferred supply-fan
 * component. Fan kW is not added on top of total system kW; equipment-model.ts
 * separates the components before applying coil duty.
 */

import data from "./data/precedent-unit-ratings.json";
import type { CoolingModel } from "./packaged-cooling";
export const UNIT_RATINGS=data.models;
export const UNIT_RATING_SOURCE=data.source;
export const COOLING_POWER_BASIS="Nominal cooling system power is constant at full output. Supply-fan power/heat is inferred from gross minus AHRI net capacity, held at the rating value, and not adjusted to maximum airflow. These are provisional screening estimates.";
export function unitRatingFor(model: Pick<CoolingModel,"nominal_tons"|"efficiency">) {
  return UNIT_RATINGS.find(r=>r.efficiency===model.efficiency&&r.nominal_tons===model.nominal_tons)??null;
}
