/**
 * ASHRAE DESIGN-DAY LOADS. Design days size equipment; the downloaded hourly
 * weather still drives annual energy and unmet loads. No annual maxima or
 * single-year temperature percentiles enter this sizing calculation.
 * Published DB/WB/DP and daily range are Celsius. Generated rows use the same
 * standard-pressure psychrometric basis as the existing building/mixed-air model.
 */
import type { ClimateRow } from "./csv";
import { fahrenheit, humidityRatio, saturationPressure, simulateSchool, type SchoolAssumptions, type SchoolRow } from "./school";
import { humidityRatioAtWetBulb, MIXING_PRESSURE_PA } from "./mixed-air";
import { sunVector, type SolarLocation } from "./solar";

export type DesignPoint = { month:number; day:number; dryC:number; rangeC:number; humidityType:string; humidityC:number; tauB:number; tauD:number };
export type DesignStation = { id:string; name:string; state:string; latitude:number; longitude:number; utcOffset:number; elevationM:number; pressurePa:number;
  heating:Record<string,{month:number;day:number;dryC:number}>; cooling:Record<string,Record<"dryBulb"|"wetBulb"|"dewPoint",DesignPoint>> };
export type DesignStationChoice = DesignStation & { distanceKm:number };
export type DesignSource = { edition:number; title:string; url:string; downloadUrl:string; sha256:string; stationCount:number; excludedStationCount:number };
export type DesignSizing = { rows:SchoolRow[]; basis:string; metadata:Record<string,string|number>; error:string|null };
export type DesignConditionResponse = { source:DesignSource; stations:DesignStationChoice[] };

// EnergyPlus WeatherManager::DefaultTempRangeMult, ASHRAE HOF chapter 14.
// Values represent hour-ending 1..24. BEAST's hour 0 is the first hourly interval.
export const DESIGN_DRY_BULB_MULTIPLIERS = [0.88,0.92,0.95,0.98,1,0.98,0.91,0.74,0.55,0.38,0.23,0.13,0.05,0,0,0.06,0.14,0.24,0.39,0.50,0.59,0.68,0.75,0.82];
const REFERENCE_YEAR = 2001; // Fixed non-leap calendar; design sizing is independent of annual weather year.

/** ASHRAE 2017 revised clear-sky tau model; irradiance in W/m². Solar position
 * uses the existing hourly-midpoint NOAA implementation. 2017 optical depths
 * require the 2017 exponents even though the older source DDY calls it ASHRAETau.
 * Reference: EnergyPlus Engineering Reference, Climate Calculations. */
export function designSolar(row:ClimateRow,site:SolarLocation,tauB:number,tauD:number) {
  const up=sunVector(row,site).up;
  if(up<=0)return {dhi:0,dni:0,ghi:0};
  const altitude=Math.asin(Math.min(1,up))*180/Math.PI;
  const mass=1/(up+0.50572*(altitude+6.07995)**-1.6364);
  const day=(Date.UTC(row.year,row.month-1,row.day)-Date.UTC(row.year,0,0))/86400000;
  const extraterrestrial=1367*(1+0.033*Math.cos(2*Math.PI*day/365));
  const ab=1.454-0.406*tauB-0.268*tauD+0.021*tauB*tauD;
  const ad=0.507+0.205*tauB-0.080*tauD-0.190*tauB*tauD;
  const dni=extraterrestrial*Math.exp(-tauB*mass**ab),dhi=extraterrestrial*Math.exp(-tauD*mass**ad);
  return {dni,dhi,ghi:dni*up+dhi};
}

/** Create a cooling-day profile at constant humidity ratio, capped at saturation
 * at night, as for EnergyPlus DDY Wetbulb/Dewpoint humidity types. */
export function designCoolingWeather(point:DesignPoint,site:SolarLocation):ClimateRow[] {
  const w=point.humidityType==="Dewpoint"?humidityRatio(point.humidityC,100):humidityRatioAtWetBulb(point.dryC,point.humidityC);
  if(w===null||!Number.isFinite(w)||w<0)throw new Error("The station's design humidity condition is invalid.");
  const vapor=MIXING_PRESSURE_PA*w/(0.621945+w);
  return DESIGN_DRY_BULB_MULTIPLIERS.map((multiplier,hour)=>{
    const temperature=point.dryC-point.rangeC*multiplier;
    const saturation=saturationPressure(temperature);
    if(saturation===null)throw new Error("The station's design temperature is invalid.");
    const row:ClimateRow={year:REFERENCE_YEAR,month:point.month,day:point.day,hour,minute:0,temperature,
      humidity:Math.min(100,Math.max(0,100*vapor/saturation)),dhi:0,dni:0,ghi:0};
    return {...row,...designSolar(row,site,point.tauB,point.tauD)};
  });
}

export function buildDesignSizing(station:DesignStationChoice|undefined,school:SchoolAssumptions,source:DesignSource|undefined,coordinates:{latitude:number;longitude:number}):DesignSizing {
  const basis=`ASHRAE ${source?.edition??""}: ${school.coolingDesignPercent}% cooling / ${school.heatingDesignPercent}% heating design days`;
  const unavailable=(error:string):DesignSizing=>({rows:[],basis,metadata:{Sizing_basis:basis},error});
  if(!station||!source)return unavailable("ASHRAE design-day conditions are required to size equipment at this location.");
  const cooling=station.cooling[String(school.coolingDesignPercent)],heating=station.heating[String(school.heatingDesignPercent)];
  if(!cooling||!heating)return unavailable("The selected station does not supply these ASHRAE design conditions.");
  const site:SolarLocation={...coordinates,utcOffset:station.utcOffset};
  try {
    const winter:ClimateRow[]=Array.from({length:24},(_,hour)=>({year:REFERENCE_YEAR,month:heating.month,day:heating.day,hour,minute:0,temperature:heating.dryC,humidity:100,dhi:0,dni:0,ghi:0}));
    const heatingRows=simulateSchool(winter,school,site,"heating").map(row=>({...row,sensibleCooling:0,latentCooling:0,totalCooling:0}));
    const coolingRows=(["dryBulb","wetBulb","dewPoint"] as const).flatMap(kind=>simulateSchool(designCoolingWeather(cooling[kind],site),school,site,"cooling").map(row=>({...row,heating:0})));
    const rows=[...heatingRows,...coolingRows].filter(row=>row.occupied);
    if(!rows.length)return unavailable("No occupied design hours are available under the selected occupancy schedule.");
    const peak=(key:"heating"|"sensibleCooling"|"latentCooling"|"totalCooling")=>Math.max(0,...rows.map(row=>Math.abs(row[key]??0)));
    return {rows,basis,error:null,metadata:{Sizing_basis:basis,ASHRAE_edition:source.edition,Design_station:station.name,Design_station_state:station.state,Design_station_WMO:station.id,
      Design_station_distance_km:station.distanceKm,Design_station_latitude:station.latitude,Design_station_longitude:station.longitude,Design_station_elevation_m:station.elevationM,
      Design_source:source.url,Design_source_SHA256:source.sha256,Heating_design_percent:school.heatingDesignPercent,Heating_design_DB_F:fahrenheit(heating.dryC),
      Cooling_design_percent:school.coolingDesignPercent,Cooling_design_DB_F:fahrenheit(cooling.dryBulb.dryC),Cooling_design_MCWB_F:fahrenheit(cooling.dryBulb.humidityC),
      Cooling_WB_design_WB_F:fahrenheit(cooling.wetBulb.humidityC),Cooling_WB_design_MCDB_F:fahrenheit(cooling.wetBulb.dryC),
      Cooling_DP_design_DP_F:fahrenheit(cooling.dewPoint.humidityC),Cooling_DP_design_MCDB_F:fahrenheit(cooling.dewPoint.dryC),
      Design_heating_load_BTU_hr:peak("heating"),Design_sensible_cooling_load_BTU_hr:peak("sensibleCooling"),Design_latent_cooling_load_BTU_hr:peak("latentCooling"),Design_total_cooling_load_BTU_hr:peak("totalCooling"),
      Design_schedule:"Occupied design hours only; existing June-August occupancy reduction applies to people, ventilation and scheduled gains; winter uses occupied heating setpoint and no internal/solar gain credit; annual schedules are unchanged",
      Design_weather_basis:"24-hour default ASHRAE/EnergyPlus DB profile; constant humidity ratio capped at saturation; DB/MCWB, WB/MCDB and DP/MCDB cooling days; ASHRAETau2017 clear-sky solar; existing standard-pressure psychrometrics",
      Design_annual_relationship:"Installed sizes are fixed from design days. Annual weather determines energy, capacity utilization and unmet loads; annual extreme hours do not resize equipment."}};
  }catch(cause){return unavailable(cause instanceof Error?cause.message:"ASHRAE design loads could not be calculated.");}
}
