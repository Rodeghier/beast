import { celsius, fahrenheit, humidityRatio, saturationPressure, type SchoolAssumptions, type SchoolRow } from "./school";

export const MIXING_PRESSURE_PA = 101325;
const saturatedRatio = (c: number) => { const p=saturationPressure(c); return p===null || p>=MIXING_PRESSURE_PA ? null : .621945*p/(MIXING_PRESSURE_PA-p); };
/** ASHRAE wet-bulb relations, adapted from PsychroLib (MIT; THIRD_PARTY_NOTICES.md). */
export function humidityRatioAtWetBulb(dryC: number, wetC: number): number | null {
  const ws=saturatedRatio(wetC);
  if (ws===null || !Number.isFinite(dryC) || wetC>dryC) return null;
  return wetC>=0 ? ((2501-2.326*wetC)*ws-1.006*(dryC-wetC))/(2501+1.86*dryC-4.186*wetC)
    : ((2830-.24*wetC)*ws-1.006*(dryC-wetC))/(2830+1.86*dryC-2.1*wetC);
}
export function wetBulbF(dryF: number, w: number): number | null {
  const dry=celsius(dryF), saturated=saturatedRatio(dry);
  if (!Number.isFinite(w) || w<0 || saturated===null || w>saturated+1e-10) return null;
  let low=-100, high=dry;
  for (let i=0;i<32;i++) {
    const middle=(low+high)/2, candidate=humidityRatioAtWetBulb(dry,middle);
    if (candidate===null) return null;
    if (candidate>w) high=middle; else low=middle;
  }
  return fahrenheit((low+high)/2);
}
export const enthalpy = (dryC: number,w: number) => 1.006*dryC+w*(2501+1.86*dryC);
export type AirContext = { outdoorF: number; outdoorW: number; outdoorH: number; returnF: number; returnW: number; returnH: number; ventilationCfm: number };
export function airContext(row: SchoolRow, school: SchoolAssumptions): AirContext | null {
  if (row.temperatureF===null || row.freeFloatF===null || !Number.isFinite(row.ventilationCfm) || row.ventilationCfm<0) return null;
  const outdoorW=humidityRatio(row.temperature,row.humidity), returnF=Math.min(row.coolingSetpointF,Math.max(row.heatingSetpointF,row.freeFloatF));
  const returnW=humidityRatio(celsius(returnF),school.indoorRh);
  if (outdoorW===null || returnW===null) return null;
  return {outdoorF:row.temperatureF,outdoorW,outdoorH:enthalpy(celsius(row.temperatureF),outdoorW),returnF,returnW,returnH:enthalpy(celsius(returnF),returnW),ventilationCfm:row.ventilationCfm};
}
export function mixAir(context: AirContext | null, supplyCfm: number) {
  if (!context || !Number.isFinite(supplyCfm) || supplyCfm<=0 || supplyCfm+1e-7<context.ventilationCfm) return null;
  const fraction=context.ventilationCfm/supplyCfm;
  const humidity=(1-fraction)*context.returnW+fraction*context.outdoorW;
  const h=(1-fraction)*context.returnH+fraction*context.outdoorH;
  const dryF=fahrenheit((h-2501*humidity)/(1.006+1.86*humidity));
  const wetF=wetBulbF(dryF,humidity);
  if (wetF===null) return null;
  return {dryF,wetF,humidityRatio:humidity,outdoorFraction:fraction,returnDryF:context.returnF,supplyCfm};
}
