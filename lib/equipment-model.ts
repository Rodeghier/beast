/**
 * EQUIPMENT SELECTION AND HOURLY ENERGY. This is the main equipment worksheet.
 * Read fanAdjustedLoads -> autosizePackaged -> simulateEquipment -> CSV exports.
 * SchoolRow supplies thermal demands; PackagedSelection supplies size/count;
 * EquipmentHour supplies delivered/unmet loads, kWh and therms for one hour.
 * null means unavailable, never a substitute for zero. All installed values
 * include unit count; curve evaluators and nominal ratings are per unit.
 * See docs/REPOSITORY_GUIDE.md sections 8 through 12 for a worked trace.
 */

import { parseCsv } from "./csv";
import { schoolCsv, type SchoolAssumptions, type SchoolRow } from "./school";
import type { SolarLocation } from "./solar";
import { coolingFor, coolingEquipmentName, curveRangeMode, scenarioName, EQUIPMENT_NAMES, validGasEfficiency, type EquipmentScenario, type HeatingEquipment, type CurveRangeMode, type EquipmentStage, type BoilerFuel } from "./equipment";
import { COOLING_MODELS, coolingPoint, type CoolingModel } from "./packaged-cooling";
import { heatingModelFor, HEATING_BASIS, type HeatingModel } from "./packaged-heating";
import { operatingCoolingPoint, operatingHeatingPoint, CURVE_RANGE_BASIS } from "./curve-evaluation";
import { airContext, mixAir } from "./mixed-air";
import { unitRatingFor, COOLING_POWER_BASIS } from "./unit-ratings";
import { compressorStages, matchesStagePreference } from "./precedent-stages";
import { boilerModelFor, calculateNoncondensingOnOffBoilerHour, calculateRatedBoilerHour, cble4dRatingForPeakLoad, cble4dFuelRatingFor } from "./boiler-model";
import type { BoilerFuelUnit } from "./boiler-model";

export const BTU_PER_KWH=3412.141633;
export const AIR_COOLED_CHILLER_KW_PER_TON=0.6;
export const CYCLING_DEGRADATION_COEFFICIENT=0.15;
export const EQUIPMENT_MODEL_VERSION="equipment-mixed-air-13.0";
// Selection is an installed combination, not a single unit. Reference capacities
// are summed across units; source/estimated/unavailable hour counts describe coverage.
export type PackagedSelection={model:CoolingModel; heatingModel:HeatingModel; count:number; totalTons:number; supplyCfm:number; referenceCoolingBtuHr:number; referenceHeatingBtuHr:number; verifiedCoolingHours:number; estimatedCoolingHours:number; unverifiedCoolingHours:number; verifiedHeatingHours:number; estimatedHeatingHours:number; unverifiedHeatingHours:number; rangeMode:CurveRangeMode; heatingAirflowApproximation:boolean; includesHeatPumpHeating:boolean; provisional:boolean; basis:string};
// Every row is one hour. electricity fields are kWh for that hour; fanHeat and
// capacity/delivered/unmet fields are BTU/hr. COP and SHR are dimensionless.
export type EquipmentHour={electricity:number|null;heatingElectricity:number|null;coolingElectricity:number|null;fanElectricity:number|null;fanHeat:number|null;gasTherms:number|null;boilerFuelConsumption:number|null;boilerFuelUnit:BoilerFuelUnit|null;boilerFuelInputBtu:number|null;
  boilerPartLoadRatio:number|null;boilerRuntimeFraction:number|null;
  availableHeating:number|null;availableCooling:number|null;deliveredHeating:number|null;deliveredCooling:number|null;unmetHeating:number|null;unmetCooling:number|null;
  heatingCop:number|null;coolingCop:number|null;coolingOperatingCop:number|null;coolingShr:number|null;enteringWetBulbF:number|null;enteringDryBulbF:number|null;outdoorAirFraction:number|null;supplyCfm:number|null;
  heatingBoundaryEstimate:boolean;coolingBoundaryEstimate:boolean;heatingCurveOutdoorF:number|null;heatingCurveDryF:number|null;coolingCurveOutdoorF:number|null;coolingCurveWetF:number|null;coolingCurveDryF:number|null;status:string};
export type EquipmentResult={scenario:EquipmentScenario;selection:PackagedSelection|null;heatingCapacityBtuHr:number|null;coolingCapacityTons:number|null;error:string|null;rows:EquipmentHour[];
  summary:{electricity:number|null;gasTherms:number|null;boilerFuelConsumption:number|null;boilerFuelUnit:BoilerFuelUnit|null;boilerFuelInputBtu:number|null;heatingElectricity:number|null;coolingElectricity:number|null;fanElectricity:number|null;completeHours:number;fullYear:boolean;
    unmetHeatingBtu:number|null;unmetCoolingBtu:number|null;unmetHeatingHours:number;unmetCoolingHours:number;unknownHeatingHours:number;unknownCoolingHours:number;estimatedHeatingHours:number;estimatedCoolingHours:number;heatingCyclingSharePercent:number|null;coolingCyclingSharePercent:number|null}};
const finite=(v:number|null|undefined):v is number=>typeof v==="number"&&Number.isFinite(v);
/** Converts steady-state part-load ratio to compressor runtime fraction using PLF=1-Cd(1-PLR). */
export function cyclingRuntimeFraction(partLoadRatio:number,cd=CYCLING_DEGRADATION_COEFFICIENT):number {
  const plr=Math.min(1,Math.max(0,partLoadRatio));
  const plf=1-cd*(1-plr);
  return plf>0?Math.min(1,plr/plf):0;
}
/** Estimated input-power fraction for staged units. Below minimum stage, cycle
 * that stage with Cd. Between stages, time-share adjacent catalog stages; stage
 * power is provisionally proportional to stage capacity. */
export function stagedPowerFraction(partLoadRatio:number,stages:number[],cd=CYCLING_DEGRADATION_COEFFICIENT):number {
  const plr=Math.min(1,Math.max(0,partLoadRatio));
  if(!stages.length)return cyclingRuntimeFraction(plr,cd);
  const minimum=stages[0];
  if(plr<minimum){
    const minimumStagePlr=minimum>0?plr/minimum:0;
    return minimum*cyclingRuntimeFraction(minimumStagePlr,cd);
  }
  for(let i=1;i<stages.length;i++)if(plr<=stages[i]){
    const low=stages[i-1],high=stages[i];
    // Time-share adjacent capacity stages to represent the hourly-average load.
    // With provisional power proportional to capacity, average input fraction = PLR.
    return high>low?plr:low;
  }
  return 1;
}
const validCooling=(r:SchoolRow)=>finite(r.sensibleCooling)&&finite(r.latentCooling)&&r.sensibleCooling<=0&&r.latentCooling<=0;
const needsCooling=(r:SchoolRow)=>validCooling(r)&&(r.sensibleCooling!<0||r.latentCooling!<0);
/** Full-hour supply-fan operation on a heating, cooling or scheduled ventilation call. */
export const fanRuns=(r:SchoolRow)=>r.ventilationCfm>0||(finite(r.heating)&&r.heating>0)||needsCooling(r);
// Convert stored cooling signs into positive equipment demands, then credit fan
// heat against heating and add it to the signed sensible cooling balance.
export function fanAdjustedLoads(r:SchoolRow,fanHeat:number) {
  const heat=finite(r.heating)?Math.max(0,r.heating-fanHeat):null;
  // The signed balance retains thermostat deadband during fan-only ventilation.
  const sensible=validCooling(r)?Math.max(0,(finite(r.coolBalance)?r.coolBalance:-r.sensibleCooling!)+fanHeat):null;
  return {heat,sensible,latent:validCooling(r)?-r.latentCooling!:null};
}

// Enumerate catalog sizes and integer unit counts. Each candidate changes supply
// airflow, so mixed entering conditions must be recalculated before capacity checks.
// The objective is fewer unavailable checks, then fewer units, then fewer nominal tons.
export function autosizePackaged(rows:SchoolRow[],school:SchoolAssumptions,efficiency:"standard"|"high",heating:HeatingEquipment="heat-pump",rangeMode:CurveRangeMode="bounded",stage:EquipmentStage="automatic"):PackagedSelection|null {
  // Cache air-property inputs, and check the largest demands first. A candidate
  // that fails an early peak can be rejected without evaluating the remaining hours.
  const contexts=rows.map(r=>airContext(r,school));
  const loadHours=rows.map((r,i)=>({r,i})).filter(({r})=>validCooling(r)&&fanRuns(r)).sort((a,b)=>a.r.sensibleCooling!+a.r.latentCooling!-b.r.sensibleCooling!-b.r.latentCooling!);
  const heatHours=heating==="heat-pump"?rows.map((r,i)=>({r,i})).filter(({r})=>finite(r.heating)&&r.heating>0).sort((a,b)=>b.r.heating!-a.r.heating!):[];
  if (!rows.some(fanRuns)) return null;
  const peakVent=Math.max(0,...rows.map(r=>Number.isFinite(r.ventilationCfm)?r.ventilationCfm:0));
  const unknownLoads=rows.filter(r=>!validCooling(r)).length;
  const unknownHeat=heating==="heat-pump"?rows.filter(r=>!finite(r.heating)||r.heating!<0).length:0;
  const candidates:PackagedSelection[]=[], fallback:PackagedSelection[]=[];
  for(const model of COOLING_MODELS.filter(m=>m.efficiency===efficiency&&matchesStagePreference(m.efficiency,m.nominal_tons,stage))) {
    const heatingModel=heatingModelFor(model);if(!heatingModel)continue;
    const reference=coolingPoint(model,95,67,80)!;
    const rating=unitRatingFor(model),unitFan=rating?.inferred_supply_fan_heat_Btu_hr??0;
    const minCount=Math.max(1,Math.ceil(peakVent/model.fixed_cfm));
    // Reference-condition capacity estimates a search scale, not the final answer.
    // Heating, sensible cooling, latent cooling and ventilation can set different minima.
    const referenceCount=Math.max(minCount,...loadHours.map(({r})=>Math.ceil(Math.max(-r.sensibleCooling!/Math.max(1,reference.capacityBtuHr*reference.shr-unitFan),-r.latentCooling!/(reference.capacityBtuHr*(1-reference.shr))))),...heatHours.map(({r})=>Math.ceil(r.heating!/heatingModel.reference_capacity_Btu_hr)));
    const make=(count:number,verified:number,estimated:number,unknown:number,verifiedHeat:number,estimatedHeat:number,unverifiedHeat:number,basis:string):PackagedSelection=>({model,heatingModel,count,totalTons:count*model.nominal_tons,supplyCfm:count*model.fixed_cfm,
      referenceCoolingBtuHr:count*model.reference_capacity_Btu_hr,referenceHeatingBtuHr:count*heatingModel.reference_capacity_Btu_hr,verifiedCoolingHours:verified,unverifiedCoolingHours:unknown,
      estimatedCoolingHours:estimated,verifiedHeatingHours:verifiedHeat,estimatedHeatingHours:estimatedHeat,unverifiedHeatingHours:unverifiedHeat,rangeMode,heatingAirflowApproximation:heatHours.length>0,includesHeatPumpHeating:heating==="heat-pump",provisional:true,basis});
    const fallbackCoolingHours=loadHours.filter(({r})=>{const load=fanAdjustedLoads(r,referenceCount*unitFan);return load.sensible!>0||load.latent!>0;}).length;
    fallback.push(make(referenceCount,0,0,fallbackCoolingHours+unknownLoads,0,0,heatHours.length+unknownHeat,"Reference-condition sizing only; operating-condition capacity checks did not produce a passing selection."));
    if(!rating&&!heatHours.length)continue;
    // Bound work for extreme inputs. Hitting the bound never yields a verified selection.
    const upper=Math.min(10000,Math.max(minCount+50,referenceCount*16));
    for(let count=minCount;count<=upper;count++) {
      const supply=count*model.fixed_cfm;let verified=0,estimated=0,unknown=unknownLoads,failed=false;
      // Cooling pass: fan-adjusted sensible and latent demand must each fit their
      // respective portions of gross coil capacity. Total capacity alone is insufficient.
      for(const {r,i} of loadHours) {
        const loads=fanAdjustedLoads(r,count*unitFan);
        if(loads.sensible===0&&loads.latent===0)continue;
        if(!rating){unknown++;continue;}
        const mixed=mixAir(contexts[i],supply),point=mixed&&finite(r.temperatureF)?operatingCoolingPoint(model,r.temperatureF,mixed.wetF,mixed.dryF,rangeMode):null;
        if(!point){unknown++;continue;}
        if(point.boundaryEstimate)estimated++;else verified++;
        const shortfall=Math.max(0,loads.sensible!-count*point.capacityBtuHr*point.shr)+Math.max(0,loads.latent!-count*point.capacityBtuHr*(1-point.shr));
        if(shortfall>1){failed=true;break;}
      }
      if(failed)continue;
      let verifiedHeat=0,estimatedHeat=0,unverifiedHeat=unknownHeat;
      // Heating pass is used only for heat-pump heating. Gas/resistance heater sizes
      // are calculated separately after supply-fan heat has reduced the building demand.
      for(const {r,i} of heatHours){
        const mixed=mixAir(contexts[i],supply),point=mixed&&finite(r.temperatureF)?operatingHeatingPoint(heatingModel,r.temperatureF,mixed.dryF,rangeMode):null;
        if(!point){unverifiedHeat++;continue;}
        if(point.boundaryEstimate)estimatedHeat++;else verifiedHeat++;
        if(r.heating!-count*point.capacityBtuHr>1){failed=true;break;}
      }
      if(!failed&&(verified+estimated+verifiedHeat+estimatedHeat>0||!loadHours.some(({r})=>needsCooling(r))&&!heatHours.length)){candidates.push(make(count,verified,estimated,unknown,verifiedHeat,estimatedHeat,unverifiedHeat,heating==="heat-pump"?"Checks net heating, fan-adjusted sensible/latent cooling and scheduled ventilation using the selected temperature-range policy.":"Cooling and ventilation selection with fan heat; separate gas/resistance heater sized to peak load after fan heat credit."));break;}
    }
  }
  // Fan heat can create extra cooling calls. Ranking by the number of evaluated
  // calls would reward a larger fan for adding loads; compare missing checks instead.
  const missing=(s:PackagedSelection)=>s.unverifiedCoolingHours+s.unverifiedHeatingHours;
  const order=(a:PackagedSelection,b:PackagedSelection)=>missing(a)-missing(b)||a.count-b.count||a.totalTons-b.totalTons;
  return candidates.sort(order)[0]??fallback.sort(order)[0]??null;
}

// Apply one installed selection to all hours. preparedSelection allows the UI
// to reuse a sizing result; undefined requests sizing, while explicit null does not.
export function simulateEquipment(rows:SchoolRow[],school:SchoolAssumptions,scenario:EquipmentScenario,preparedSelection?:PackagedSelection|null):EquipmentResult {
  const packaged=scenario.heating==="heat-pump",coolingEquipment=coolingFor(scenario),hasCooling=coolingEquipment!==null,hasPackagedCooling=coolingEquipment==="heat-pump";
  const rangeMode=curveRangeMode(scenario);
  const selection=hasPackagedCooling?(preparedSelection===undefined?autosizePackaged(rows,school,scenario.efficiency,scenario.heating,rangeMode,scenario.stage):preparedSelection):null;
  const rating=selection?unitRatingFor(selection.model):null;
  const ratedFanHeat=selection&&rating?selection.count*rating.inferred_supply_fan_heat_Btu_hr:coolingEquipment==="air-cooled-chiller"?0:null;
  const ratedFanKw=selection&&rating?selection.count*rating.inferred_supply_fan_power_kW:coolingEquipment==="air-cooled-chiller"?0:null;
  // Small gas/resistance heater capacity is the largest remaining heating demand
  // after fan heat. Large gas boiler capacity uses the selected CBLE-4D rating.
  const peakHeat=rows.some(r=>finite(r.heating))?Math.max(0,...rows.map(r=>finite(r.heating)?Math.max(0,r.heating-(ratedFanHeat??0)):0)):null;
  const boilerModel=scenario.heating==="gas"?boilerModelFor(scenario.boilerSizeClass??"small"):null;
  const largeBoilerRating=boilerModel?.sizeClass==="large"?cble4dRatingForPeakLoad(peakHeat):null;
  const heatingCapacityBtuHr=packaged?selection?.referenceHeatingBtuHr??null:largeBoilerRating?.ratedOutputBtuHr??peakHeat;
  const peakCoolingBtuHr=rows.reduce((peak,r)=>validCooling(r)?Math.max(peak,-r.sensibleCooling!-r.latentCooling!):peak,0);
  const coolingCapacityTons=coolingEquipment==="air-cooled-chiller"?peakCoolingBtuHr/12000:null;
  const boilerEfficiencyLabel=boilerModel?.efficiencyMetric??"boiler efficiency";
  const error=!hasCooling?"Choose cooling equipment (required).":scenario.heating==="gas"&&boilerModel?.sizeClass==="small"&&!validGasEfficiency(scenario.gasEfficiencyPercent)?`Enter boiler ${boilerEfficiencyLabel} above 0% and at or below 100%.`:scenario.heating==="gas"&&boilerModel?.sizeClass==="large"&&scenario.boilerFiringMode==="modulating"?"Modulating CBLE-4D performance data is not available yet.":coolingEquipment==="heat-pump"&&scenario.stage==="variable"?"Variable-speed heat-pump performance data is not available yet.":coolingEquipment==="heat-pump"&&selection===null?`No equipment models are available for the selected ${scenario.stage==="single"?"single-stage":"multi-stage"} option and efficiency family.`:null;
  const stageFractions=selection?compressorStages(scenario.efficiency,selection.model.nominal_tons):[];
  const minimumStage=stageFractions[0]??1;
  let heatingCyclingCallHours=0,heatingBelowMinimumHours=0,coolingCyclingCallHours=0,coolingBelowMinimumHours=0;
  // Hourly worksheet starts here. issues collects text explaining assumptions or
  // unavailable dependent values; it is exported with the numeric results.
  const output=rows.map((r):EquipmentHour=>{
    const issues:string[]=[];
    const runs=fanRuns(r);
    let fanElectricity:number|null=runs?ratedFanKw:0,fanHeat:number|null=runs?ratedFanHeat:0;
    const mixed=selection?mixAir(airContext(r,school),selection.supplyCfm):null;
    const hp=packaged&&r.heating!==null&&r.heating>0&&selection&&mixed&&finite(r.temperatureF)?operatingHeatingPoint(selection.heatingModel,r.temperatureF,mixed.dryF,rangeMode):null;
    const adjusted=fanHeat===null?null:fanAdjustedLoads(r,fanHeat);
    let availableHeating:number|null=null,deliveredHeating:number|null=null,unmetHeating:number|null=null,heatingElectricity:number|null=null,gasTherms:number|null=packaged||scenario.heating==="resistance"?0:null,boilerFuelConsumption:number|null=packaged||scenario.heating==="resistance"?0:null,boilerFuelUnit:BoilerFuelUnit|null=scenario.heating==="gas"?(scenario.boilerSizeClass==="large"?scenario.boilerFuel==="propane"?"ft³":scenario.boilerFuel==="light-oil"?"gal":"therms":"therms"):null,boilerFuelInputBtu:number|null=packaged||scenario.heating==="resistance"?0:null,heatingCop:number|null=null,boilerPartLoadRatio:number|null=null,boilerRuntimeFraction:number|null=null;
    if(!finite(r.heating))issues.push("Missing building heating load.");
    else if(packaged){
      if(hp){availableHeating=selection!.count*hp.capacityBtuHr;heatingCop=hp.cop;}
      if(r.heating===0) {heatingElectricity=0;deliveredHeating=0;unmetHeating=0;}
      else if(!hp)issues.push("Heating operating point is outside the supplied data or mixed-air inputs are unavailable.");
      else if(rating&&adjusted&&ratedFanKw!==null&&ratedFanHeat!==null){
        // Heating catalog output/input already include fan effects. Remove the inferred
        // fan components to get coil-only capacity/power, duty-scale those, then count the
        // full-hour operating fan exactly once in the building heat and electrical balance.
        const coilCapacity=Math.max(0,availableHeating!-ratedFanHeat),coilNeed=adjusted.heat!;
        const deliveredCoil=Math.min(coilNeed,coilCapacity),duty=coilCapacity>0?deliveredCoil/coilCapacity:0;
        if(coilNeed>0&&coilCapacity>0){heatingCyclingCallHours++;if(duty<minimumStage-1e-9)heatingBelowMinimumHours++;}
        const stages=compressorStages(scenario.efficiency,selection!.model.nominal_tons);
        const powerFraction=stagedPowerFraction(duty,stages);
        const nonfanPower=selection!.count*hp.powerKw-ratedFanKw;
        if(nonfanPower<0)issues.push("Inferred supply-fan input exceeds catalog heating power; heating electricity unavailable.");
        else heatingElectricity=nonfanPower*powerFraction;
        deliveredHeating=Math.min(r.heating,deliveredCoil+fanHeat!);unmetHeating=Math.max(0,r.heating-deliveredHeating);
        issues.push(HEATING_BASIS);
        if(stages.length>1)issues.push("Multi-stage heating input is estimated proportional to catalog stage capacity; cycling degradation applies below minimum stage.");
        if(hp.boundaryEstimate)issues.push("Heating uses estimated performance at the nearest supplied temperature boundary.");
      }else issues.push("Heating electricity requires the selected unit's separate supply-fan estimate.");
    }else if(adjusted&&finite(adjusted.heat)){
      availableHeating=heatingCapacityBtuHr;
      // For gas/resistance, cap heater delivery at its selected output. Gas efficiency
      // converts delivered heater heat to therms; resistance converts it directly to kWh.
      const heaterOutput=Math.min(adjusted.heat,heatingCapacityBtuHr??0);
      deliveredHeating=Math.min(r.heating,heaterOutput+fanHeat!);unmetHeating=Math.max(0,r.heating-deliveredHeating);
      if(scenario.heating==="resistance"){heatingElectricity=heaterOutput/BTU_PER_KWH;heatingCop=r.heating>0?1:null;}
      else {
        heatingElectricity=0;
        const boiler=boilerModel?.sizeClass==="large"
          ?calculateRatedBoilerHour(adjusted.heat,largeBoilerRating,scenario.boilerFuel??"natural-gas",1)
          :calculateNoncondensingOnOffBoilerHour(adjusted.heat,heatingCapacityBtuHr,scenario.gasEfficiencyPercent,1,boilerModel?.partLoadEfficiencyMultiplier??1);
        boilerPartLoadRatio=boiler.partLoadRatio;boilerRuntimeFraction=boiler.runtimeFraction;gasTherms=boiler.gasTherms;boilerFuelConsumption=boiler.fuelConsumption;boilerFuelUnit=boiler.fuelUnit;boilerFuelInputBtu=boiler.fuelInputBtu;
        if(boiler.runtimeFraction!==null&&boiler.runtimeFraction>0){heatingCyclingCallHours++;if(boiler.runtimeFraction<1-1e-9)heatingBelowMinimumHours++;}
        issues.push(boilerModel?.sizeClass==="large"
          ?`${boilerModel.label}: selected ${largeBoilerRating?.horsepower??"unavailable"} HP rating by peak heating demand. ${scenario.boilerFuel??"natural-gas"} use is the listed manufacturer rate multiplied by hourly runtime. Part-load fuel consumption is not separately rated.`
          :`${boilerModel?.label}: ${boilerEfficiencyLabel} is applied as a constant effective hourly efficiency. Part-load and return-water effects, standby fuel loss and boiler auxiliary electricity remain placeholders pending manufacturer data.`);
      }
    }else issues.push("Heating energy requires the selected cooling unit's supply-fan data.");
    let availableCooling:number|null=null,deliveredCooling:number|null=null,unmetCooling:number|null=null,coolingShr:number|null=null,coolingElectricity:number|null=null,coolingCop:number|null=null,coolingOperatingCop:number|null=null;
    const coolingCall=adjusted&&(adjusted.sensible!>0||adjusted.latent!>0);
    const cold=coolingCall&&mixed&&selection&&finite(r.temperatureF)?operatingCoolingPoint(selection.model,r.temperatureF,mixed.wetF,mixed.dryF,rangeMode):null;
    if(!hasCooling)issues.push("Choose cooling equipment (required).");
    else if(coolingEquipment==="air-cooled-chiller"){
      if(!validCooling(r))issues.push("Missing building cooling load.");
      else if(adjusted){
        const sensible=adjusted.sensible!,latent=adjusted.latent!,need=sensible+latent;
        availableCooling=(coolingCapacityTons??0)*12000;
        deliveredCooling=Math.min(need,availableCooling);
        unmetCooling=Math.max(0,need-deliveredCooling);
        coolingElectricity=deliveredCooling/12000*AIR_COOLED_CHILLER_KW_PER_TON;
        if(need>0)coolingCyclingCallHours++;
        issues.push(`Air-cooled chiller placeholder: ${AIR_COOLED_CHILLER_KW_PER_TON.toFixed(1)} kW/ton; nominal capacity is autosized to peak hourly total cooling load. Separate air-handler fan and pump electricity are excluded.`);
      }else issues.push("Chiller cooling energy requires valid cooling loads.");
    }
    else if(!validCooling(r))issues.push("Missing building cooling load.");
    else {
      if(cold&&selection){availableCooling=selection.count*cold.capacityBtuHr;coolingShr=cold.shr;}
      if(adjusted&&adjusted.sensible===0&&adjusted.latent===0){coolingElectricity=0;deliveredCooling=0;unmetCooling=0;}
      else if(!rating||!adjusted)issues.push("Nominal cooling power or supply-fan rating is unavailable for the selected unit; dependent cooling results unavailable.");
      else if(!cold||!selection)issues.push("Cooling operating point is outside the supplied data or mixed-air inputs are unavailable.");
      else{
        const sensible=adjusted.sensible!,latent=adjusted.latent!;
        // Choose duty from the more demanding sensible or latent requirement. The
        // compressor duty cannot exceed 1; excess component demands become unmet loads.
        const need=Math.max(sensible>0?sensible/cold.shr:0,latent>0?latent/(1-cold.shr):0);
        const duty=Math.min(1,need/availableCooling!);
        if(duty>0){coolingCyclingCallHours++;if(duty<minimumStage-1e-9)coolingBelowMinimumHours++;}
        deliveredCooling=availableCooling!*duty;
        unmetCooling=Math.max(0,sensible-deliveredCooling*cold.shr)+Math.max(0,latent-deliveredCooling*(1-cold.shr));
        const stages=compressorStages(scenario.efficiency,selection.model.nominal_tons);
        coolingElectricity=selection.count*rating.cooling_non_supply_fan_power_kW*stagedPowerFraction(duty,stages);
        if(stages.length>1)issues.push("Multi-stage cooling input is estimated proportional to catalog stage capacity; cycling degradation applies below minimum stage.");
        // Full-output COP uses available net cooling and nominal total kW. Operating COP
        // uses actual delivered net cooling and duty-scaled cooling plus full-hour fan kWh.
        coolingCop=Math.max(0,availableCooling!-ratedFanHeat!)/(BTU_PER_KWH*selection.count*rating.cooling_system_power_kW);
        const modeElectricity=coolingElectricity+fanElectricity!;
        coolingOperatingCop=modeElectricity>0?Math.max(0,deliveredCooling-fanHeat!)/(BTU_PER_KWH*modeElectricity):null;
        issues.push(COOLING_POWER_BASIS);
        if(cold.boundaryEstimate)issues.push("Cooling uses estimated performance at the nearest supplied temperature boundary.");
      }
    }
    if(runs&&rating&&!issues.includes(COOLING_POWER_BASIS))issues.push(COOLING_POWER_BASIS);
    if(error)issues.push(error);
    // If any required electrical component is unknown, total electricity stays null.
    // Do not replace these nulls with zero to force a complete annual result.
    const electricity=hasCooling&&heatingElectricity!==null&&coolingElectricity!==null&&fanElectricity!==null?heatingElectricity+coolingElectricity+fanElectricity:null;
    return {electricity,heatingElectricity,coolingElectricity,fanElectricity,fanHeat,gasTherms,boilerFuelConsumption,boilerFuelUnit,boilerFuelInputBtu,boilerPartLoadRatio,boilerRuntimeFraction,availableHeating,availableCooling,deliveredHeating,deliveredCooling,unmetHeating,unmetCooling,heatingCop,coolingCop,coolingOperatingCop,coolingShr,
      enteringWetBulbF:mixed?.wetF??null,enteringDryBulbF:mixed?.dryF??null,outdoorAirFraction:mixed?.outdoorFraction??null,supplyCfm:selection?.supplyCfm??null,
      heatingBoundaryEstimate:hp?.boundaryEstimate??false,coolingBoundaryEstimate:cold?.boundaryEstimate??false,heatingCurveOutdoorF:hp?.curveOutdoorF??null,heatingCurveDryF:hp?.curveDryF??null,
      coolingCurveOutdoorF:cold?.curveOutdoorF??null,coolingCurveWetF:cold?.curveWetF??null,coolingCurveDryF:cold?.curveDryF??null,status:issues.join(" ")||"Calculated from selected heating/cooling equipment and supply-fan balance."};
  });
  // Available-hour component sums can have different coverage. Annual totals are
  // allowed only when all required energy records and the calendar are complete.
  const completeHours=output.filter(r=>finite(r.electricity)&&finite(r.gasTherms)&&finite(r.boilerFuelConsumption)&&finite(r.boilerFuelInputBtu)).length;
  const sum=(key:"electricity"|"gasTherms"|"boilerFuelConsumption"|"boilerFuelInputBtu"|"heatingElectricity"|"coolingElectricity"|"fanElectricity"|"unmetHeating"|"unmetCooling")=>output.some(r=>finite(r[key]))?output.reduce((s,r)=>s+(r[key]??0),0):null;
  return {scenario,selection,heatingCapacityBtuHr,coolingCapacityTons,error,rows:output,summary:{electricity:sum("electricity"),gasTherms:sum("gasTherms"),boilerFuelConsumption:sum("boilerFuelConsumption"),boilerFuelUnit:output.find(r=>r.boilerFuelUnit)?.boilerFuelUnit??null,boilerFuelInputBtu:sum("boilerFuelInputBtu"),heatingElectricity:sum("heatingElectricity"),coolingElectricity:sum("coolingElectricity"),fanElectricity:sum("fanElectricity"),completeHours,fullYear:!error&&completeHours===8760&&completeCalendar(rows),unmetHeatingBtu:sum("unmetHeating"),unmetCoolingBtu:sum("unmetCooling"),unmetHeatingHours:output.filter(r=>(r.unmetHeating??0)>1).length,unmetCoolingHours:output.filter(r=>(r.unmetCooling??0)>1).length,unknownHeatingHours:output.filter(r=>r.unmetHeating===null).length,unknownCoolingHours:output.filter(r=>r.unmetCooling===null).length,estimatedHeatingHours:output.filter(r=>r.heatingBoundaryEstimate).length,estimatedCoolingHours:output.filter(r=>r.coolingBoundaryEstimate).length,heatingCyclingSharePercent:heatingCyclingCallHours?100*heatingBelowMinimumHours/heatingCyclingCallHours:null,coolingCyclingSharePercent:coolingCyclingCallHours?100*coolingBelowMinimumHours/coolingCyclingCallHours:null}};
}
// Require 8760 unique hourly timestamps in one year, with no February 29.
// A matching record count alone would not catch duplicate or invalid timestamps.
export function completeCalendar(rows:SchoolRow[]):boolean {
  return rows.length===8760&&new Set(rows.map(r=>`${r.year}-${r.month}-${r.day}-${r.hour}`)).size===8760&&rows.every(r=>{
    const d=new Date(Date.UTC(r.year,r.month-1,r.day,r.hour));return r.year===rows[0].year&&r.minute===0&&Number.isInteger(r.hour)&&r.hour>=0&&r.hour<24&&d.getUTCMonth()===r.month-1&&d.getUTCDate()===r.day&&!(r.month===2&&r.day===29);
  });
}
const line=(values:unknown[])=>values.map(v=>v==null?"":`"${String(v).replaceAll('"','""')}"`).join(",");
// Append equipment data to the building CSV. keys and headers must remain in
// the same order; add an output to both lists when extending the export.
export function equipmentResultsCsv(rows:SchoolRow[],school:SchoolAssumptions,result:EquipmentResult,location:string,zone:string,site?:SolarLocation|null):string {
  const original=parseCsv(schoolCsv(rows,school,location,zone,site)),s=result.selection,rating=s?unitRatingFor(s.model):null;
  const boiler=result.scenario.heating==="gas"?boilerModelFor(result.scenario.boilerSizeClass??"small"):null;
  const boilerRating=boiler?.sizeClass==="large"?cble4dRatingForPeakLoad(result.heatingCapacityBtuHr):null;
  const metadata={Equipment_model:EQUIPMENT_MODEL_VERSION,Scenario:scenarioName(result.scenario),Heating_equipment:EQUIPMENT_NAMES[result.scenario.heating],Cooling_equipment:coolingEquipmentName(result.scenario),Boiler_size_class:boiler?.sizeClass??null,Boiler_model:boiler?.id??null,Boiler_fuel:boiler?.sizeClass==="large"?result.scenario.boilerFuel:null,Boiler_firing_mode:boiler?.sizeClass==="large"?result.scenario.boilerFiringMode:null,Boiler_efficiency_metric:boiler?.efficiencyMetric??null,Boiler_AFUE_percent:boiler?.efficiencyMetric==="AFUE"?result.scenario.gasEfficiencyPercent:null,Boiler_thermal_efficiency_percent:null,Boiler_capacity_basis:boiler?.sizeClass==="large"?"Smallest CBLE-4D rated hot-water output meeting peak hourly heating demand after fan heat credit":boiler?"Peak hourly heating demand after fan heat credit":null,Boiler_rated_size_HP:boilerRating?.horsepower??null,Boiler_rated_output_BTU_hr:boilerRating?.ratedOutputBtuHr??null,Boiler_rated_fuel_rate:boilerRating?cble4dFuelRatingFor(boilerRating,result.scenario.boilerFuel??"natural-gas").consumptionPerHour:null,Boiler_rated_fuel_unit:boilerRating?cble4dFuelRatingFor(boilerRating,result.scenario.boilerFuel??"natural-gas").unit:null,Boiler_return_water_temperature_F:boiler?.returnWaterTemperatureF??null,Boiler_minimum_return_water_temperature_F:boiler?.minimumReturnWaterTemperatureF??null,Boiler_standby_fuel_input_BTU_hr:boiler?.standbyFuelInputBtuPerHr??null,Boiler_auxiliary_electric_kW:boiler?.auxiliaryElectricPowerKw??null,Boiler_part_load_efficiency_multiplier:boiler?.partLoadEfficiencyMultiplier??null,Chiller_capacity_tons:result.coolingCapacityTons,Chiller_efficiency_kW_per_ton:coolingFor(result.scenario)==="air-cooled-chiller"?AIR_COOLED_CHILLER_KW_PER_TON:null,Stage_preference:result.scenario.stage,Heating_cycling_share_percent:result.summary.heatingCyclingSharePercent,Cooling_cycling_share_percent:result.summary.coolingCyclingSharePercent,Scope:coolingFor(result.scenario)==="air-cooled-chiller"?"Chiller cooling at flat kW/ton; separate air-handler fan and pump electricity excluded":result.scenario.heating==="heat-pump"?"Heat pump heating and cooling with catalog fan/power balance":boiler?.sizeClass==="large"?`CBLE-4D boiler heating using listed ${result.scenario.boilerFuel??"natural-gas"} consumption/hour`:boiler?`Small non-condensing on/off natural-gas boiler; user-entered ${boiler.efficiencyMetric}`:"Selected heater with heat-pump cooling and separate supply fan",
    Nominal_cooling_system_kW_per_unit:rating?.cooling_system_power_kW,Inferred_supply_fan_kW_per_unit:rating?.inferred_supply_fan_power_kW,Inferred_supply_fan_heat_BTU_hr_per_unit:rating?.inferred_supply_fan_heat_Btu_hr,Unit_count:s?.count,Nominal_tons_per_unit:s?.model.nominal_tons,Total_nominal_tons:s?.totalTons,Supply_CFM:s?.supplyCfm,
    Catalog_model:s?.model.id,Autosizing_basis:s?.basis,Curve_range_mode:curveRangeMode(result.scenario),Curve_range_basis:CURVE_RANGE_BASIS,Source_checked_cooling_hours:s?.verifiedCoolingHours,Boundary_estimated_cooling_hours:result.summary.estimatedCoolingHours,Unverified_cooling_hours:s?.unverifiedCoolingHours,Cooling_fit_coefficients:s?JSON.stringify({capacity:s.model.capacity_coefficients,shrNumerator:s.model.shr_numerator_coefficients,referenceBtuHr:s.model.reference_capacity_Btu_hr}):null,
    Heating_table:result.scenario.heating==="heat-pump"?s?.heatingModel.table:null,Heating_reference_capacity_BTU_hr:result.scenario.heating==="heat-pump"?s?.referenceHeatingBtuHr:null,Heating_reference_condition:s&&result.scenario.heating==="heat-pump"?"47 F outdoor / 70 F entering dry bulb":null,Source_checked_heating_hours:s?.verifiedHeatingHours,Boundary_estimated_heating_hours:result.summary.estimatedHeatingHours,Unverified_heating_hours:s?.unverifiedHeatingHours,
    Heating_fit_coefficients:s&&result.scenario.heating==="heat-pump"?JSON.stringify({capacity:s.heatingModel.capacity_coefficients,power:s.heatingModel.power_coefficients,referenceBtuHr:s.heatingModel.reference_capacity_Btu_hr,referencePowerKw:s.heatingModel.reference_power_kW,terms:"x=(outdoor_F-47)/40; y=(entering_DB_F-70)/20; [1,x,y,x^2,xy,y^2,x^3,x^2y,xy^2,y^3,x^4,x^3y,x^2y^2,xy^3,y^4]"}):null,
    Heating_basis:s&&result.scenario.heating==="heat-pump"?HEATING_BASIS:null,Heating_energy_basis:boiler?.sizeClass==="large"?"Select CBLE-4D size by peak heating output after fan-heat credit. Hourly selected-fuel consumption = rated manufacturer consumption/hour x hourly runtime fraction; runtime fraction = delivered output / rated output. No building heating loads are recalculated.":boiler?`On/off runtime = boiler PLR. Fuel uses user-entered ${boiler.efficiencyMetric}; no separate part-load/cycling efficiency correction is applied.`:s?"Supply fan runs on heat/cool/ventilation calls. Credit fan heat before heater demand; HP coil capacity/input exclude the inferred fan component before duty scaling. Sum coil heating, non-supply-fan cooling and supply-fan electricity exactly once.":null,
    Mixing_basis:"Scheduled ventilation / catalog supply CFM; standard-volume dry-air approximation at 101325 Pa. Mix humidity ratio and enthalpy; solve mixed dry bulb and wet bulb. Infiltration excluded from mixer; retained in building loads.",
    Return_air_basis:"Zone dry bulb from clamped building free-float temperature; RH from building indoor RH target.",Cooling_power_basis:COOLING_POWER_BASIS,Fan_operation:"Full-hour fan on any heating/cooling/ventilation call. Fan heat enters signed sensible balance and reduces heating coil demand. Heating/cooling kWh exclude separately counted supply fan. Fan proxy is inferred from each model family’s supplied ratings.",Pending:"No off-rating power/fan correction, auxiliary heat, reheat or additional defrost term is supplied."};
  const keys:(keyof EquipmentHour)[]=["electricity","heatingElectricity","coolingElectricity","fanElectricity","fanHeat","gasTherms","boilerFuelConsumption","boilerFuelUnit","boilerFuelInputBtu","boilerPartLoadRatio","boilerRuntimeFraction","availableHeating","availableCooling","deliveredHeating","deliveredCooling","unmetHeating","unmetCooling","heatingCop","coolingCop","coolingOperatingCop","coolingShr","enteringDryBulbF","enteringWetBulbF","outdoorAirFraction","supplyCfm","heatingBoundaryEstimate","coolingBoundaryEstimate","heatingCurveOutdoorF","heatingCurveDryF","coolingCurveOutdoorF","coolingCurveWetF","coolingCurveDryF","status"];
  const headers=["Equipment_electricity_kWh","Heating_coil_electricity_excluding_supply_fan_kWh","Cooling_electricity_excluding_supply_fan_kWh","Supply_fan_electricity_kWh","Supply_fan_heat_BTU_hr","Gas_input_therms","Selected_boiler_fuel_consumption_native_units","Selected_boiler_fuel_unit","Selected_boiler_fuel_input_BTU","Boiler_part_load_ratio","Boiler_runtime_fraction","Available_heating_BTU_hr","Available_gross_cooling_BTU_hr","Delivered_heating_BTU_hr","Delivered_gross_cooling_BTU_hr","Unmet_heating_BTU_hr","Unmet_cooling_BTU_hr","Heating_COP","Full_output_net_cooling_COP","Operating_net_cooling_COP","Cooling_SHR","Mixed_entering_dry_bulb_F","Mixed_entering_wet_bulb_F","Outdoor_air_fraction","Supply_CFM","Heating_boundary_estimate","Cooling_boundary_estimate","Heating_curve_outdoor_F","Heating_curve_entering_DB_F","Cooling_curve_outdoor_F","Cooling_curve_entering_WB_F","Cooling_curve_entering_DB_F","Equipment_status"];
  return [line([...original[0],...Object.keys(metadata)]),line([...original[1],...Object.values(metadata)]),"",line([...original[2],...headers]),...rows.map((_,i)=>line([...original[i+3],...keys.map(k=>result.rows[i][k])]))].join("\r\n");
}
export function equipmentComparisonCsv(results:EquipmentResult[]):string {
  return [line(["Scenario","Heating_equipment","Boiler_size_class","Boiler_fuel","Boiler_firing_mode","Boiler_efficiency_metric","Cooling_scope","Units","Nominal_tons_each","Total_nominal_tons","Heating_capacity_BTU_hr","Heating_capacity_basis","Sizing_provisional","Unverified_cooling_hours","Unverified_heating_hours","Heating_airflow_approximation","Electricity_kWh_available_hours","Supply_fan_kWh_available_hours","Gas_therms_available_hours","Boiler_fuel_quantity_available_hours","Boiler_fuel_unit","Boiler_fuel_input_BTU_available_hours","Complete_energy_hours","Full_year","Unmet_heating_BTU_available_hours","Unmet_cooling_BTU_available_hours","Curve_range_mode","Boundary_estimated_heating_hours","Boundary_estimated_cooling_hours","Stage_preference","Heating_cycling_share_percent","Cooling_cycling_share_percent"]),
    ...results.map(r=>{const boiler=r.scenario.heating==="gas"?boilerModelFor(r.scenario.boilerSizeClass??"small"):null;return line([scenarioName(r.scenario),EQUIPMENT_NAMES[r.scenario.heating],boiler?.sizeClass,boiler?.sizeClass==="large"?r.scenario.boilerFuel:null,boiler?.sizeClass==="large"?r.scenario.boilerFiringMode:null,boiler?.efficiencyMetric,coolingEquipmentName(r.scenario),r.selection?.count,r.selection?.model.nominal_tons,r.selection?.totalTons,r.heatingCapacityBtuHr,r.scenario.heating==="heat-pump"?"47 F outdoor / 70 F entering DB, catalog nominal airflow":"Peak heater output after fan heat credit",r.selection?.provisional,r.selection?.unverifiedCoolingHours,r.selection?.unverifiedHeatingHours,r.selection?.heatingAirflowApproximation,r.summary.electricity,r.summary.fanElectricity,r.summary.gasTherms,r.summary.boilerFuelConsumption,r.summary.boilerFuelUnit,r.summary.boilerFuelInputBtu,r.summary.completeHours,r.summary.fullYear,r.summary.unmetHeatingBtu,r.summary.unmetCoolingBtu,curveRangeMode(r.scenario),r.summary.estimatedHeatingHours,r.summary.estimatedCoolingHours,r.scenario.stage,r.summary.heatingCyclingSharePercent,r.summary.coolingCyclingSharePercent]);})].join("\r\n");
}
