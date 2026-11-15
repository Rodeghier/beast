/** Standard-motor limits from the user-supplied fan-performance table. High
 * static motors are excluded. HP is a shaft-output ceiling, not operating kW.
 * The rating-derived fan kW at AHRI CFM anchors a provisional cubic system curve. */
import type { CoolingModel } from "./packaged-cooling";
import { unitRatingFor } from "./unit-ratings";

export const FAN_MOTOR_EFFICIENCY=.90;
export const FAN_DRIVE_EFFICIENCY=.97;
export const MINIMUM_FAN_FLOW_FRACTION=.20;
export const VARIABLE_FAN_BASIS="Standard motors only; supplied maximum HP/RPM and 480 CFM/ton limits. Fan kW is anchored to gross-minus-net rating heat at AHRI airflow and varies with CFM cubed. Shaft HP ceiling uses assumed 90% motor and 97% drive efficiency. Maximum achievable CFM is reduced when the reference cubic curve reaches the HP ceiling. All fan input is assumed to heat the supply air. Ventilation-only minimum is 20% of maximum; compressor flow stays inside source 300–480 CFM/ton. Duct static reset and part-load motor efficiencies are not supplied. 3-ton standard uses 0.75 HP (non-575 V); larger proxy units scale 25-ton assemblies.";
export function standardFanLimit(model:Pick<CoolingModel,"nominal_tons"|"efficiency">){
  const tons=Math.min(25,model.nominal_tons),scale=model.nominal_tons>25?model.nominal_tons/25:1;
  const hp=tons===3&&model.efficiency==="standard"?.75:tons<=5&&model.efficiency==="standard"?1:tons<10?2.9:tons===10&&model.efficiency==="standard"?2.9:tons<=12.5?4.2:5.8;
  const rpm=tons<=5&&model.efficiency==="standard"?1200:hp===4.2?1940:1850;
  return {maxHp:hp*scale,maxRpm:rpm,maxCatalogCfm:480*model.nominal_tons};
}
export function variableFanModel(model:CoolingModel){
  const rating=unitRatingFor(model);if(!rating||!(rating.ahri_cfm>0)||!(rating.inferred_supply_fan_power_kW>0))return null;
  const limit=standardFanLimit(model);
  const maxElectricalKw=limit.maxHp*.745699872/(FAN_MOTOR_EFFICIENCY*FAN_DRIVE_EFFICIENCY);
  const maxCfm=Math.min(limit.maxCatalogCfm,rating.ahri_cfm*Math.cbrt(maxElectricalKw/rating.inferred_supply_fan_power_kW));
  const power=(cfm:number)=>cfm>=0&&cfm<=maxCfm+1e-6?rating.inferred_supply_fan_power_kW*(cfm/rating.ahri_cfm)**3:null;
  return {...limit,maxElectricalKw,maxCfm,referenceCfm:rating.ahri_cfm,referenceKw:rating.inferred_supply_fan_power_kW,power};
}
