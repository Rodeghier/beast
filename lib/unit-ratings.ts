import data from "./data/precedent-unit-ratings.json";
import type { CoolingModel } from "./packaged-cooling";
export const UNIT_RATINGS=data.models;
export const UNIT_RATING_SOURCE=data.source;
export const COOLING_POWER_BASIS="Nominal cooling system power is constant at full output. Supply-fan power/heat is inferred from gross minus AHRI net capacity, held at the rating value, and not adjusted to maximum airflow. These are provisional screening estimates.";
export function unitRatingFor(model: Pick<CoolingModel,"nominal_tons"|"efficiency">) {
  return UNIT_RATINGS.find(r=>r.efficiency===model.efficiency&&r.nominal_tons===model.nominal_tons)??null;
}
