import { parseCsv } from "./csv";
import { schoolCsv, type SchoolAssumptions, type SchoolRow } from "./school";
import type { SolarLocation } from "./solar";
import { EQUIPMENT_NAMES, validGasEfficiency, type EquipmentScenario } from "./equipment";
import { COOLING_MODELS, coolingPoint, type CoolingModel } from "./packaged-cooling";
import { heatingModelFor, heatingPoint, HEATING_BASIS, type HeatingModel } from "./packaged-heating";
import { airContext, mixAir } from "./mixed-air";

export const BTU_PER_KWH=3412.141633;
export const EQUIPMENT_MODEL_VERSION="equipment-mixed-air-2.0";
export type PackagedSelection={model:CoolingModel; heatingModel:HeatingModel; count:number; totalTons:number; supplyCfm:number; referenceCoolingBtuHr:number; referenceHeatingBtuHr:number; verifiedCoolingHours:number; unverifiedCoolingHours:number; verifiedHeatingHours:number; unverifiedHeatingHours:number; heatingAirflowApproximation:boolean; provisional:boolean; basis:string};
export type EquipmentHour={electricity:number|null;heatingElectricity:number|null;coolingElectricity:number|null;gasTherms:number|null;
  availableHeating:number|null;availableCooling:number|null;deliveredHeating:number|null;deliveredCooling:number|null;unmetHeating:number|null;unmetCooling:number|null;
  heatingCop:number|null;coolingCop:number|null;coolingShr:number|null;enteringWetBulbF:number|null;enteringDryBulbF:number|null;outdoorAirFraction:number|null;supplyCfm:number|null;status:string};
export type EquipmentResult={scenario:EquipmentScenario;selection:PackagedSelection|null;heatingCapacityBtuHr:number|null;error:string|null;rows:EquipmentHour[];
  summary:{electricity:number|null;gasTherms:number|null;heatingElectricity:number|null;coolingElectricity:number|null;completeHours:number;fullYear:boolean;
    unmetHeatingBtu:number|null;unmetCoolingBtu:number|null;unmetHeatingHours:number;unmetCoolingHours:number;unknownHeatingHours:number;unknownCoolingHours:number}};
const finite=(v:number|null|undefined):v is number=>typeof v==="number"&&Number.isFinite(v);
const validCooling=(r:SchoolRow)=>finite(r.sensibleCooling)&&finite(r.latentCooling)&&r.sensibleCooling<=0&&r.latentCooling<=0;
const needsCooling=(r:SchoolRow)=>validCooling(r)&&(r.sensibleCooling!<0||r.latentCooling!<0);

export function autosizePackaged(rows:SchoolRow[],school:SchoolAssumptions,efficiency:"standard"|"high"):PackagedSelection|null {
  const contexts=rows.map(r=>airContext(r,school));
  const loadHours=rows.map((r,i)=>({r,i})).filter(({r})=>needsCooling(r)).sort((a,b)=>a.r.sensibleCooling!+a.r.latentCooling!-b.r.sensibleCooling!-b.r.latentCooling!);
  const heatHours=rows.map((r,i)=>({r,i})).filter(({r})=>finite(r.heating)&&r.heating>0).sort((a,b)=>b.r.heating!-a.r.heating!);
  if (!loadHours.length&&!heatHours.length) return null;
  const peakVent=Math.max(0,...rows.map(r=>Number.isFinite(r.ventilationCfm)?r.ventilationCfm:0));
  const unknownLoads=rows.filter(r=>!validCooling(r)).length;
  const unknownHeat=rows.filter(r=>!finite(r.heating)||r.heating!<0).length;
  const candidates:PackagedSelection[]=[], fallback:PackagedSelection[]=[];
  for(const model of COOLING_MODELS.filter(m=>m.efficiency===efficiency)) {
    const heatingModel=heatingModelFor(model);if(!heatingModel)continue;
    const reference=coolingPoint(model,95,67,80)!;
    const minCount=Math.max(1,Math.ceil(peakVent/model.fixed_cfm));
    const referenceCount=Math.max(minCount,...loadHours.map(({r})=>Math.ceil(Math.max(-r.sensibleCooling!/(reference.capacityBtuHr*reference.shr),-r.latentCooling!/(reference.capacityBtuHr*(1-reference.shr))))),...heatHours.map(({r})=>Math.ceil(r.heating!/heatingModel.reference_capacity_Btu_hr)));
    const make=(count:number,verified:number,unknown:number,verifiedHeat:number,unverifiedHeat:number,basis:string):PackagedSelection=>({model,heatingModel,count,totalTons:count*model.nominal_tons,supplyCfm:count*model.fixed_cfm,
      referenceCoolingBtuHr:count*model.reference_capacity_Btu_hr,referenceHeatingBtuHr:count*heatingModel.reference_capacity_Btu_hr,verifiedCoolingHours:verified,unverifiedCoolingHours:unknown,
      verifiedHeatingHours:verifiedHeat,unverifiedHeatingHours:unverifiedHeat,heatingAirflowApproximation:heatHours.length>0,provisional:unknown+unverifiedHeat>0||heatHours.length>0,basis});
    fallback.push(make(referenceCount,0,loadHours.length+unknownLoads,0,heatHours.length+unknownHeat,"Reference-condition estimate only; operating-condition sizing could not be verified."));
    // Bound work for extreme inputs. Hitting the bound never yields a verified selection.
    const upper=Math.min(10000,Math.max(minCount+50,referenceCount*16));
    for(let count=minCount;count<=upper;count++) {
      const supply=count*model.fixed_cfm;let verified=0,unknown=unknownLoads,failed=false;
      for(const {r,i} of loadHours) {
        if(r.temperatureF===null||r.temperatureF<model.axis_ranges_F.outdoor_dry_bulb_F[0]||r.temperatureF>model.axis_ranges_F.outdoor_dry_bulb_F[1]){unknown++;continue;}
        const mixed=mixAir(contexts[i],supply),point=mixed?coolingPoint(model,r.temperatureF,mixed.wetF,mixed.dryF):null;
        if(!point){unknown++;continue;}
        verified++;
        const shortfall=Math.max(0,-r.sensibleCooling!-count*point.capacityBtuHr*point.shr)+Math.max(0,-r.latentCooling!-count*point.capacityBtuHr*(1-point.shr));
        if(shortfall>1){failed=true;break;}
      }
      if(failed)continue;
      let verifiedHeat=0,unverifiedHeat=unknownHeat;
      for(const {r,i} of heatHours){
        if(r.temperatureF===null||r.temperatureF<heatingModel.outdoor_range_F[0]||r.temperatureF>heatingModel.outdoor_range_F[1]){unverifiedHeat++;continue;}
        const mixed=mixAir(contexts[i],supply),point=mixed?heatingPoint(heatingModel,r.temperatureF,mixed.dryF):null;
        if(!point){unverifiedHeat++;continue;}
        verifiedHeat++;
        if(r.heating!-count*point.capacityBtuHr>1){failed=true;break;}
      }
      if(!failed&&verified+verifiedHeat>0){candidates.push(make(count,verified,unknown,verifiedHeat,unverifiedHeat,"Meets heating plus separate sensible/latent cooling loads at all verified catalog operating points; checks scheduled ventilation airflow."));break;}
    }
  }
  const order=(a:PackagedSelection,b:PackagedSelection)=>(b.verifiedCoolingHours+b.verifiedHeatingHours)-(a.verifiedCoolingHours+a.verifiedHeatingHours)||a.count-b.count||a.totalTons-b.totalTons;
  return candidates.sort(order)[0]??fallback.sort(order)[0]??null;
}

export function simulateEquipment(rows:SchoolRow[],school:SchoolAssumptions,scenario:EquipmentScenario,preparedSelection?:PackagedSelection|null):EquipmentResult {
  const packaged=scenario.heating==="heat-pump";
  const selection=packaged?(preparedSelection===undefined?autosizePackaged(rows,school,scenario.efficiency):preparedSelection):null;
  const peakHeat=rows.some(r=>finite(r.heating))?Math.max(0,...rows.map(r=>finite(r.heating)?r.heating:0)):null;
  const heatingCapacityBtuHr=packaged?selection?.referenceHeatingBtuHr??null:peakHeat;
  const error=scenario.heating==="gas"&&!validGasEfficiency(scenario.gasEfficiencyPercent)?"Enter natural-gas heating efficiency (AHUE / AFUE) above 0% and at or below 100%.":null;
  const output=rows.map((r):EquipmentHour=>{
    const issues:string[]=[];
    const mixed=selection?mixAir(airContext(r,school),selection.supplyCfm):null;
    const heatPoint=selection&&mixed&&r.temperatureF!==null?heatingPoint(selection.heatingModel,r.temperatureF,mixed.dryF):null;
    let heatingCop:number|null=null;
    let availableHeating:number|null=null,deliveredHeating:number|null=null,unmetHeating:number|null=null,heatingElectricity:number|null=null,gasTherms:number|null=null;
    if(!finite(r.heating)){issues.push("Missing building heating load.");}
    else if(packaged){
      gasTherms=0;
      if(heatPoint){availableHeating=selection!.count*heatPoint.capacityBtuHr;heatingCop=heatPoint.cop;}
      if(r.heating===0){deliveredHeating=0;unmetHeating=0;heatingElectricity=0;}
      else if(!selection)issues.push("No heating sizing basis; more valid load data are needed.");
      else if(!heatPoint)issues.push("Heating operating point is outside the supplied data or mixed-air inputs are unavailable.");
      else {
        deliveredHeating=Math.min(r.heating,availableHeating!);unmetHeating=Math.max(0,r.heating-deliveredHeating);
        // Ideal duty fraction: no additional cycling degradation, fan term or auxiliary heat.
        heatingElectricity=selection.count*heatPoint.powerKw*(deliveredHeating/availableHeating!);
        issues.push(HEATING_BASIS);
      }
    }
    else {
      availableHeating=heatingCapacityBtuHr;deliveredHeating=r.heating;unmetHeating=0;
      if(scenario.heating==="resistance"){heatingElectricity=r.heating/BTU_PER_KWH;gasTherms=0;}
      else {heatingElectricity=0;gasTherms=validGasEfficiency(scenario.gasEfficiencyPercent)?r.heating/(100000*scenario.gasEfficiencyPercent/100):null;if(gasTherms===null)issues.push(error!);}
    }
    if(!packaged&&gasTherms===null&&scenario.heating==="resistance")gasTherms=0;
    let availableCooling:number|null=packaged?null:0,deliveredCooling:number|null=null,unmetCooling:number|null=null,coolingShr:number|null=null,coolingElectricity:number|null=null;
    if(!validCooling(r)){issues.push("Missing building cooling load.");if(!packaged)coolingElectricity=0;}
    else if(!packaged){deliveredCooling=0;unmetCooling=-r.sensibleCooling!-r.latentCooling!;coolingElectricity=0;}
    else if(!needsCooling(r)){deliveredCooling=0;unmetCooling=0;coolingElectricity=0;}
    else if(!selection){issues.push("No cooling sizing basis; more valid cooling data are needed.");}
    else {
      const point=mixed&&r.temperatureF!==null?coolingPoint(selection.model,r.temperatureF,mixed.wetF,mixed.dryF):null;
      if(!point)issues.push("Cooling operating point is outside the supplied data or mixed-air inputs are unavailable.");
      else {
        availableCooling=selection.count*point.capacityBtuHr;coolingShr=point.shr;
        const sensible=-r.sensibleCooling!,latent=-r.latentCooling!;
        const need=Math.max(sensible>0?sensible/point.shr:0,latent>0?latent/(1-point.shr):0);
        deliveredCooling=Math.min(need,availableCooling);
        unmetCooling=Math.max(0,sensible-deliveredCooling*point.shr)+Math.max(0,latent-deliveredCooling*(1-point.shr));
        if(deliveredCooling>0)issues.push("Cooling COP data pending; cooling electricity is unavailable.");else coolingElectricity=0;
      }
    }
    const electricity=heatingElectricity!==null&&coolingElectricity!==null?heatingElectricity+coolingElectricity:null;
    return {electricity,heatingElectricity,coolingElectricity,gasTherms,availableHeating,availableCooling,deliveredHeating,deliveredCooling,unmetHeating,unmetCooling,
      heatingCop:scenario.heating==="resistance"&&finite(r.heating)&&r.heating>0?1:heatingCop,coolingCop:null,coolingShr,
      enteringWetBulbF:mixed?.wetF??null,enteringDryBulbF:mixed?.dryF??null,outdoorAirFraction:mixed?.outdoorFraction??null,supplyCfm:selection?.supplyCfm??null,
      status:issues.join(" ")||(packaged?"Calculated from supplied heating/cooling fits and mixed-air conditions.":"Heating-only system; cooling loads are not served.")};
  });
  const completeHours=output.filter(r=>finite(r.electricity)&&finite(r.gasTherms)).length;
  const sum=(key:"electricity"|"gasTherms"|"heatingElectricity"|"coolingElectricity"|"unmetHeating"|"unmetCooling")=>output.some(r=>finite(r[key]))?output.reduce((s,r)=>s+(r[key]??0),0):null;
  return {scenario,selection,heatingCapacityBtuHr,error,rows:output,summary:{electricity:sum("electricity"),gasTherms:sum("gasTherms"),heatingElectricity:sum("heatingElectricity"),coolingElectricity:sum("coolingElectricity"),completeHours,
    fullYear:completeHours===8760&&completeCalendar(rows),unmetHeatingBtu:sum("unmetHeating"),unmetCoolingBtu:sum("unmetCooling"),
    unmetHeatingHours:output.filter(r=>(r.unmetHeating??0)>1).length,unmetCoolingHours:output.filter(r=>(r.unmetCooling??0)>1).length,
    unknownHeatingHours:output.filter(r=>r.unmetHeating===null).length,unknownCoolingHours:output.filter(r=>r.unmetCooling===null).length}};
}
export function completeCalendar(rows:SchoolRow[]):boolean {
  return rows.length===8760&&new Set(rows.map(r=>`${r.year}-${r.month}-${r.day}-${r.hour}`)).size===8760&&rows.every(r=>{
    const d=new Date(Date.UTC(r.year,r.month-1,r.day,r.hour));return r.year===rows[0].year&&r.minute===0&&Number.isInteger(r.hour)&&r.hour>=0&&r.hour<24&&d.getUTCMonth()===r.month-1&&d.getUTCDate()===r.day&&!(r.month===2&&r.day===29);
  });
}
const line=(values:unknown[])=>values.map(v=>v==null?"":`"${String(v).replaceAll('"','""')}"`).join(",");
export function equipmentResultsCsv(rows:SchoolRow[],school:SchoolAssumptions,result:EquipmentResult,location:string,zone:string,site?:SolarLocation|null):string {
  const original=parseCsv(schoolCsv(rows,school,location,zone,site)),s=result.selection;
  const metadata={Equipment_model:EQUIPMENT_MODEL_VERSION,Scenario:result.scenario.name,Heating_equipment:EQUIPMENT_NAMES[result.scenario.heating],Scope:result.scenario.heating==="heat-pump"?"Heat pump: catalog heating capacity/power/COP and cooling capacity/SHR; cooling COP pending":"Heating only; no cooling installed",
    Gas_efficiency_percent:result.scenario.heating==="gas"?result.scenario.gasEfficiencyPercent:null,Unit_count:s?.count,Nominal_tons_per_unit:s?.model.nominal_tons,Total_nominal_tons:s?.totalTons,Supply_CFM:s?.supplyCfm,
    Catalog_model:s?.model.id,Autosizing_basis:s?.basis,Unverified_cooling_hours:s?.unverifiedCoolingHours,Cooling_fit_coefficients:s?JSON.stringify({capacity:s.model.capacity_coefficients,shrNumerator:s.model.shr_numerator_coefficients,referenceBtuHr:s.model.reference_capacity_Btu_hr}):null,
    Heating_table:s?.heatingModel.table,Heating_reference_capacity_BTU_hr:s?.referenceHeatingBtuHr,Heating_reference_condition:s?"47 F outdoor / 70 F entering dry bulb":null,Unverified_heating_hours:s?.unverifiedHeatingHours,
    Heating_fit_coefficients:s?JSON.stringify({capacity:s.heatingModel.capacity_coefficients,power:s.heatingModel.power_coefficients,referenceBtuHr:s.heatingModel.reference_capacity_Btu_hr,referencePowerKw:s.heatingModel.reference_power_kW,terms:"x=(outdoor_F-47)/40; y=(entering_DB_F-70)/20; [1,x,y,x^2,xy,y^2,x^3,x^2y,xy^2,y^3,x^4,x^3y,x^2y^2,xy^3,y^4]"}):null,
    Heating_basis:s?HEATING_BASIS:null,Heating_energy_basis:s?"COP = net heating BTU/hr / (3412.141633 * total input kW). Ideal duty fraction = delivered / available heating; one-hour kWh = installed total kW * duty fraction.":null,
    Mixing_basis:"Scheduled ventilation / catalog supply CFM; standard-volume dry-air approximation at 101325 Pa. Mix humidity ratio and enthalpy; solve mixed dry bulb and wet bulb. Infiltration excluded from mixer; retained in building loads.",
    Return_air_basis:"Zone dry bulb from clamped building free-float temperature; RH from building indoor RH target.",Pending:"Cooling COP not provided. No added fan energy/heat, defrost correction, auxiliary heat or reheat. Published heating curves already include fan and integrated defrost at their catalog basis."};
  const keys:(keyof EquipmentHour)[]=["electricity","heatingElectricity","coolingElectricity","gasTherms","availableHeating","availableCooling","deliveredHeating","deliveredCooling","unmetHeating","unmetCooling","heatingCop","coolingCop","coolingShr","enteringDryBulbF","enteringWetBulbF","outdoorAirFraction","supplyCfm","status"];
  const headers=["Equipment_electricity_kWh","Heating_electricity_kWh","Cooling_electricity_kWh","Gas_input_therms","Available_heating_BTU_hr","Available_gross_cooling_BTU_hr","Delivered_heating_BTU_hr","Delivered_gross_cooling_BTU_hr","Unmet_heating_BTU_hr","Unmet_cooling_BTU_hr","Heating_COP","Cooling_COP","Cooling_SHR","Mixed_entering_dry_bulb_F","Mixed_entering_wet_bulb_F","Outdoor_air_fraction","Supply_CFM","Equipment_status"];
  return [line([...original[0],...Object.keys(metadata)]),line([...original[1],...Object.values(metadata)]),"",line([...original[2],...headers]),...rows.map((_,i)=>line([...original[i+3],...keys.map(k=>result.rows[i][k])]))].join("\r\n");
}
export function equipmentComparisonCsv(results:EquipmentResult[]):string {
  return [line(["Scenario","Heating_equipment","Cooling_scope","Units","Nominal_tons_each","Total_nominal_tons","Heating_capacity_BTU_hr","Heating_capacity_basis","Sizing_provisional","Unverified_cooling_hours","Unverified_heating_hours","Heating_airflow_approximation","Electricity_kWh_available_hours","Gas_therms_available_hours","Complete_energy_hours","Full_year","Unmet_heating_BTU_available_hours","Unmet_cooling_BTU_available_hours"]),
    ...results.map(r=>line([r.scenario.name,EQUIPMENT_NAMES[r.scenario.heating],r.scenario.heating==="heat-pump"?"Packaged cooling":"No cooling installed",r.selection?.count,r.selection?.model.nominal_tons,r.selection?.totalTons,r.heatingCapacityBtuHr,r.scenario.heating==="heat-pump"?"47 F outdoor / 70 F entering DB, catalog nominal airflow":"Peak building heating load",r.selection?.provisional,r.selection?.unverifiedCoolingHours,r.selection?.unverifiedHeatingHours,r.selection?.heatingAirflowApproximation,r.summary.electricity,r.summary.gasTherms,r.summary.completeHours,r.summary.fullYear,r.summary.unmetHeatingBtu,r.summary.unmetCoolingBtu]))].join("\r\n");
}
