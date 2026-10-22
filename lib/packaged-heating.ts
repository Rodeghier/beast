import catalog from "./data/precedent-heating.json";
import type { CoolingModel } from "./packaged-cooling";

export type HeatingModel = typeof catalog.models[number];
export const HEATING_MODELS = catalog.models;
export const HEATING_SOURCE = catalog.source;
export const HEATING_BASIS = "Heating uses published nominal-airflow, integrated net capacity and total power at 70% outdoor RH. Mixed air uses maximum cooling airflow; an airflow/fan correction was not supplied. This is a screening approximation.";

export function heatingModelFor(model: Pick<CoolingModel,"nominal_tons"|"efficiency">): HeatingModel | null {
  return HEATING_MODELS.find(h=>h.nominal_tons===model.nominal_tons&&(h.efficiency===model.efficiency||h.efficiency==="shared"))??null;
}
/** Catalog net heating and total electrical power, including the table's fan/defrost basis. */
export function heatingPoint(model: HeatingModel, outdoorF: number, enteringDryBulbF: number) {
  if (![outdoorF,enteringDryBulbF].every(Number.isFinite)||outdoorF<model.outdoor_range_F[0]||outdoorF>model.outdoor_range_F[1]||enteringDryBulbF<model.entering_dry_bulb_range_F[0]||enteringDryBulbF>model.entering_dry_bulb_range_F[1]) return null;
  const x=(outdoorF-47)/40,y=(enteringDryBulbF-70)/20;
  const terms=catalog.term_powers.map(([i,j])=>x**i*y**j);
  const normalized=model.capacity_coefficients.reduce((sum,c,i)=>sum+c*terms[i],0);
  const powerNormalized=model.power_coefficients.reduce((sum,c,i)=>sum+c*terms[i],0);
  const capacityBtuHr=normalized*model.reference_capacity_Btu_hr,powerKw=powerNormalized*model.reference_power_kW;
  if (!(capacityBtuHr>0)||!(powerKw>0)||!Number.isFinite(capacityBtuHr)||!Number.isFinite(powerKw)) return null;
  return {capacityBtuHr,powerKw,cop:capacityBtuHr/(3412.141633*powerKw),normalized,powerNormalized};
}
