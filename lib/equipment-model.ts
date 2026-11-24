/**
 * EQUIPMENT SELECTION AND HOURLY ENERGY. This is the main equipment worksheet.
 * Read fanAdjustedLoads -> autosizePackaged -> simulateEquipment -> CSV exports.
 * SchoolRow supplies thermal demands; PackagedSelection supplies size/count;
 * EquipmentHour supplies delivered/unmet loads, kWh and therms for one hour.
 * null means unavailable, never a substitute for zero. All installed values
 * include unit count; curve evaluators and nominal ratings are per unit.
 * See docs/REPOSITORY_GUIDE.md sections 8 through 12 for a worked trace.
 */

import { hourlyOperation } from "./hourly-operation";
import { equipmentOperationCsv } from "./equipment-operation";
import { parseCsv } from "./csv";
import { schoolCsv, type SchoolAssumptions, type SchoolRow } from "./school";
import type { SolarLocation } from "./solar";
import { coolingFor, coolingEquipmentName, curveRangeMode, scenarioName, EQUIPMENT_NAMES, validGasEfficiency, validateBackup, type EquipmentScenario } from "./equipment";
import { HEATING_BASIS } from "./packaged-heating";
import { CURVE_RANGE_BASIS } from "./curve-evaluation";
import { airContext, mixAir } from "./mixed-air";
import { unitRatingFor, COOLING_POWER_BASIS } from "./unit-ratings";
import { compressorStages } from "./precedent-stages";
import { boilerModelFor, calculateNoncondensingOnOffBoilerHour, calculateRatedBoilerHour, cble4dRatingForPeakLoad, cble4dFuelRatingFor } from "./boiler-model";
import type { BoilerFuelUnit } from "./boiler-model";
import type { DesignSizing } from "./design-sizing";

export const BTU_PER_KWH=3412.141633;
export const AIR_COOLED_CHILLER_KW_PER_TON=0.6;
export { CYCLING_DEGRADATION_COEFFICIENT, cyclingRuntimeFraction, stagedPowerFraction, stagedSystemOperation } from "./equipment-staging";
export const EQUIPMENT_MODEL_VERSION="equipment-mhgrh-21.3";
export type { PackagedSelection } from "./packaged-bank";
import { bankRatings, bankCooling, bankHeating, dispatchCooling, dispatchHeating, selectionGroupsLabel, type PackagedSelection } from "./packaged-bank";
import { optimizePackagedBank } from "./packaged-optimizer";
import { SHARED_COOLING_CAPACITY } from "./packaged-cooling";
import { LARGE_UNIT_BASIS } from "./catalog-sizes";
import { solveVariableAirside, VARIABLE_AIRSIDE_BASIS } from "./variable-airside";
import { optimizeVariablePackagedBank } from "./variable-sizing";
import { VARIABLE_FAN_BASIS } from "./variable-fan";
import { MHGRH_BASIS } from "./mhgrh";
import { AIRFLOW_COOLING_FIT } from "./airflow-cooling";
// Every row is one hour. electricity fields are kWh for that hour; fanHeat and
// capacity/delivered/unmet fields are BTU/hr. COP and SHR are dimensionless.
export type EquipmentHour={mhgrhAvailableBtuHr:number|null;mhgrhBoundaryEstimate:boolean;returnAirCfm:number|null;actualOutdoorAirCfm:number|null;coilLeavingDryF:number|null;supplyDryF:number|null;supplyHumidityRatio:number|null;dehumidificationActive:boolean;unmetLatentBtuHr:number|null;reheatNeed:number|null;reheatDelivered:number|null;reheatElectricity:number|null;reheatGasTherms:number|null;unmetReheat:number|null;heatingCompressorElectricity:number|null;backupActive:boolean;backupHeatingElectricity:number|null;backupGasTherms:number|null;backupDeliveredHeating:number|null;electricity:number|null;heatingElectricity:number|null;coolingElectricity:number|null;fanElectricity:number|null;fanHeat:number|null;gasTherms:number|null;boilerFuelConsumption:number|null;boilerFuelUnit:BoilerFuelUnit|null;boilerFuelInputBtu:number|null;
  heatingStage:string|null;heatingOnMinutes:string|null;heatingDerate:string|null;coolingStage:string|null;coolingOnMinutes:string|null;coolingDerate:string|null;fanOnMinutes:number|null;
  boilerPartLoadRatio:number|null;boilerRuntimeFraction:number|null;
  availableHeating:number|null;availableCooling:number|null;deliveredHeating:number|null;deliveredCooling:number|null;unmetHeating:number|null;unmetCooling:number|null;
  heatingCop:number|null;coolingCop:number|null;coolingOperatingCop:number|null;coolingShr:number|null;coolingOperatingShr:number|null;deliverableCooling:number|null;availableSensibleCooling:number|null;availableLatentCooling:number|null;enteringWetBulbF:number|null;enteringDryBulbF:number|null;outdoorAirFraction:number|null;supplyCfm:number|null;unmetVentilationCfm:number|null;
  heatingBoundaryEstimate:boolean;coolingBoundaryEstimate:boolean;heatingCurveOutdoorF:number|null;heatingCurveDryF:number|null;coolingCurveOutdoorF:number|null;coolingCurveWetF:number|null;coolingCurveDryF:number|null;groupPerformance:string|null;status:string};
export type EquipmentResult={scenario:EquipmentScenario;selection:PackagedSelection|null;sizing:DesignSizing|null;heatingCapacityBtuHr:number|null;backupHeatingCapacityBtuHr:number|null;reheatCapacityBtuHr:number|null;coolingCapacityTons:number|null;error:string|null;rows:EquipmentHour[];
  summary:{reheatElectricity:number|null;reheatGasTherms:number|null;reheatBtu:number|null;unmetReheatBtu:number|null;unmetReheatHours:number;electricity:number|null;gasTherms:number|null;boilerFuelConsumption:number|null;boilerFuelUnit:BoilerFuelUnit|null;boilerFuelInputBtu:number|null;heatingElectricity:number|null;coolingElectricity:number|null;fanElectricity:number|null;completeHours:number;fullYear:boolean;
    unmetHeatingBtu:number|null;unmetCoolingBtu:number|null;unmetHeatingHours:number;unmetCoolingHours:number;unknownHeatingHours:number;unknownCoolingHours:number;estimatedHeatingHours:number;estimatedCoolingHours:number;heatingCyclingSharePercent:number|null;coolingCyclingSharePercent:number|null}};
const finite=(v:number|null|undefined):v is number=>typeof v==="number"&&Number.isFinite(v);
const validCooling=(r:SchoolRow)=>finite(r.sensibleCooling)&&finite(r.latentCooling)&&r.sensibleCooling<=0&&r.latentCooling<=0;
const needsCooling=(r:SchoolRow)=>validCooling(r)&&(r.sensibleCooling!<0||r.latentCooling!<0);
/** All zone-unit fans run through scheduled occupied operation, even without a
 * compressor call. Unoccupied heating/cooling calls can also start all fans. */
export const fanRuns=(r:SchoolRow)=>r.occupied||r.ventilationCfm>0||(finite(r.heating)&&r.heating>0)||needsCooling(r);
// Convert stored cooling signs into positive equipment demands, then credit fan
// heat against heating and add it to the signed sensible cooling balance.
export function fanAdjustedLoads(r:SchoolRow,fanHeat:number) {
  const heat=finite(r.heating)?Math.max(0,r.heating-fanHeat):null;
  // The signed balance retains thermostat deadband during fan-only ventilation.
  const sensible=validCooling(r)?Math.max(0,(finite(r.coolBalance)?r.coolBalance:-r.sensibleCooling!)+fanHeat):null;
  return {heat,sensible,latent:validCooling(r)?-r.latentCooling!:null};
}

/** Select a bank of mixed catalog sizes. Only occupied design hours determine size. */
export const autosizePackaged=optimizePackagedBank;

// An undefined selection requests sizing; explicit null skips it.
export function simulateEquipment(rows:SchoolRow[],school:SchoolAssumptions,scenario:EquipmentScenario,preparedSelection?:PackagedSelection|null,sizing?:DesignSizing):EquipmentResult {
  return simulateEquipmentModel(rows,school,scenario,preparedSelection,sizing,false);
}

/** Fixed-rating worksheet used for reference calculations without reheat. */
export function simulateFixedAirflowReference(rows:SchoolRow[],school:SchoolAssumptions,scenario:EquipmentScenario,preparedSelection?:PackagedSelection|null,sizing?:DesignSizing):EquipmentResult {
  return simulateEquipmentModel(rows,school,{...scenario,airflowMode:"fixed"},preparedSelection,sizing,true);
}

function simulateEquipmentModel(rows:SchoolRow[],school:SchoolAssumptions,scenario:EquipmentScenario,preparedSelection:PackagedSelection|null|undefined,sizing:DesignSizing|undefined,referenceAirside:boolean):EquipmentResult {
  const packaged=scenario.heating==="heat-pump",coolingEquipment=coolingFor(scenario),hasCooling=coolingEquipment!==null,hasPackagedCooling=coolingEquipment==="heat-pump";
  const rangeMode=curveRangeMode(scenario);
  const variableAirflow=hasPackagedCooling&&!referenceAirside;
  const airsideOptions={minimumOnMinutes:school.minimumCompressorOnMinutes,airflowMode:scenario.airflowMode};
  // Sizing and annual simulation have separate inputs. Never fall back to the
  // annual peak when design data are unavailable, even for boilers or chillers.
  const sizingError=!sizing?"ASHRAE design-day conditions are required to size equipment.":sizing.error||(!sizing.rows.some(r=>r.occupied)?"No occupied design-day loads are available for sizing.":null);
  const designRows=sizingError?[]:sizing!.rows.filter(r=>r.occupied);
  const selection=hasPackagedCooling&&!sizingError?(preparedSelection===undefined?(variableAirflow?optimizeVariablePackagedBank(designRows,school,scenario.efficiency,scenario.heating,rangeMode,scenario.stage,scenario.airflowMode):autosizePackaged(designRows,school,scenario.efficiency,scenario.heating,rangeMode,scenario.stage)):preparedSelection):null;
  const rating=selection?bankRatings(selection.groups):null;
  const ratedFanHeat=selection&&rating?rating.fanHeat:coolingEquipment==="air-cooled-chiller"?0:null;
  const ratedFanKw=selection&&rating?rating.fanKw:coolingEquipment==="air-cooled-chiller"?0:null;
  // Small gas/resistance heater capacity is the largest design-day heating demand
  // after fan heat. Large gas boiler capacity uses the selected CBLE-4D rating.
  const designAir=variableAirflow&&selection?designRows.map(r=>solveVariableAirside(selection.groups,r,school,rangeMode,fanRuns(r),{...airsideOptions,minimumOnMinutes:0})):[];
  const peakHeat=designRows.some(r=>finite(r.heating))?Math.max(0,...designRows.map((r,i)=>finite(r.heating)?Math.max(0,r.heating-(variableAirflow?designAir[i]?.fanHeat??0:ratedFanHeat??0)):0)):null;
  const reheatCapacityBtuHr=variableAirflow&&selection?Math.max(0,...designAir.map((p,i)=>p?p.reheatNeed+(packaged&&p.delivered>0&&!(finite(designRows[i].temperatureF)&&finite(scenario.backupSwitchoverF)&&designRows[i].temperatureF!<=scenario.backupSwitchoverF)?p.primaryHeatNeed:0):0)):null;
  const backupError=validateBackup(scenario);
  const backupHeatingCapacityBtuHr=packaged?peakHeat:null;
  const boilerModel=scenario.heating==="gas"?boilerModelFor(scenario.boilerSizeClass??"small"):null;
  const largeBoilerRating=boilerModel?.sizeClass==="large"?cble4dRatingForPeakLoad(peakHeat):null;
  // Scenarios saved before the thermal efficiency input used the manufacturer fuel rate.
  const usesRatedBoilerFuelRate=boilerModel?.sizeClass==="large"&&scenario.largeBoilerEfficiencyPercent===undefined;
  const boilerEfficiencyPercent=boilerModel?.sizeClass==="large"?scenario.largeBoilerEfficiencyPercent:scenario.gasEfficiencyPercent;
  const heatingCapacityBtuHr=packaged?selection?.referenceHeatingBtuHr??null:largeBoilerRating?.ratedOutputBtuHr??peakHeat;
  const peakCoolingBtuHr=designRows.reduce((peak,r)=>validCooling(r)?Math.max(peak,-r.sensibleCooling!-r.latentCooling!):peak,0);
  const coolingCapacityTons=coolingEquipment==="air-cooled-chiller"&&!sizingError?peakCoolingBtuHr/12000:null;
  const boilerEfficiencyLabel=boilerModel?.sizeClass==="large"?"thermal efficiency":"AFUE";
  const boilerEfficiencyError=boilerModel&&!usesRatedBoilerFuelRate&&!validGasEfficiency(boilerEfficiencyPercent??null)
    ?`Enter boiler ${boilerEfficiencyLabel} above 0% and at or below 100%.`:null;
  const configurationError=(!hasCooling?"Choose cooling equipment (required).":boilerEfficiencyError)||
    (boilerModel?.sizeClass==="large"&&scenario.boilerFiringMode==="modulating"?"Modulating CBLE-4D performance data is not available yet.":coolingEquipment==="heat-pump"&&scenario.stage==="variable"?"Variable-speed heat-pump performance data is not available yet.":coolingEquipment==="heat-pump"&&selection===null?`No equipment models are available for the selected ${scenario.stage==="single"?"single-stage":"multi-stage"} option and efficiency family.`:null);
  const error=sizingError||backupError||configurationError;
  let heatingCyclingCallHours=0,heatingBelowMinimumHours=0,coolingCyclingCallHours=0,coolingBelowMinimumHours=0;
  // Hourly worksheet starts here. issues collects text explaining assumptions or
  // unavailable dependent values; it is exported with the numeric results.
  const output=rows.map((r):EquipmentHour=>{
    const issues:string[]=[];
    let heatingOperation:ReturnType<typeof hourlyOperation>|null=null,coolingOperation:ReturnType<typeof hourlyOperation>|null=null;
    let groupPerformance:string|null=null;
    let heatingGroupPerformance:unknown=null;
    const runs=fanRuns(r);
    const airside=variableAirflow&&selection?solveVariableAirside(selection.groups,r,school,rangeMode,runs,airsideOptions):null;
    const fanElectricity:number|null=variableAirflow?airside?.fanKw??null:runs?ratedFanKw:0,fanHeat:number|null=variableAirflow?airside?.fanHeat??null:runs?ratedFanHeat:0;
    const mixed=selection?mixAir(airContext(r,school),variableAirflow?airside?.cfm??0:selection.supplyCfm):null;
    const unmetVentilationCfm=variableAirflow?airside?.unmetVentilationCfm??null:selection&&finite(r.ventilationCfm)?Math.max(0,r.ventilationCfm-selection.supplyCfm):null;
    if(unmetVentilationCfm!==null&&unmetVentilationCfm>0)issues.push("Requested ventilation exceeds installed supply airflow. Mixed air is capped at 100% outdoor air; building thermal loads retain the requested ventilation. Equipment is not resized for airflow.");
    const backupActive=packaged&&!backupError&&finite(r.temperatureF)&&r.temperatureF<=scenario.backupSwitchoverF!;
    let backupHeatingElectricity:number|null=0,backupGasTherms:number|null=0,backupDeliveredHeating:number|null=0;
    const coolingReheatReplacesHp=packaged&&!backupActive&&!!airside&&airside.delivered>0&&airside.primaryHeatNeed>0;
    const hp=packaged&&!backupActive&&!coolingReheatReplacesHp&&r.heating!==null&&r.heating>0&&selection&&mixed&&finite(r.temperatureF)?bankHeating(selection.groups,r.temperatureF,mixed.dryF,rangeMode):null;
    const adjusted=fanHeat===null?null:fanAdjustedLoads(r,fanHeat);
    let availableHeating:number|null=null,deliveredHeating:number|null=null,unmetHeating:number|null=null,heatingElectricity:number|null=null,gasTherms:number|null=packaged||scenario.heating==="resistance"?0:null,boilerFuelConsumption:number|null=packaged||scenario.heating==="resistance"?0:null,boilerFuelUnit:BoilerFuelUnit|null=scenario.heating==="gas"||packaged&&scenario.backupHeating==="gas"?"therms":null,boilerFuelInputBtu:number|null=packaged||scenario.heating==="resistance"?0:null,heatingCop:number|null=null,boilerPartLoadRatio:number|null=null,boilerRuntimeFraction:number|null=null;
    if(packaged&&backupError){
      backupHeatingElectricity=null;backupGasTherms=null;backupDeliveredHeating=null;
      gasTherms=null;boilerFuelConsumption=null;boilerFuelInputBtu=null;
      issues.push(backupError);
    }else if(!finite(r.heating)){
      issues.push("Missing building heating load.");
      if(backupActive){backupHeatingElectricity=null;backupGasTherms=null;backupDeliveredHeating=null;gasTherms=null;boilerFuelConsumption=null;boilerFuelInputBtu=null;}
    }else if(backupActive){
      if(adjusted&&finite(adjusted.heat)&&backupHeatingCapacityBtuHr!==null){
        const output=Math.min(adjusted.heat,backupHeatingCapacityBtuHr);
        availableHeating=backupHeatingCapacityBtuHr;
        deliveredHeating=Math.min(r.heating,output+fanHeat!);
        unmetHeating=Math.max(0,r.heating-deliveredHeating);
        backupDeliveredHeating=output;
        heatingElectricity=scenario.backupHeating==="resistance"?output/BTU_PER_KWH:0;
        backupHeatingElectricity=heatingElectricity;
        backupGasTherms=scenario.backupHeating==="gas"?output/(100000*scenario.backupGasEfficiencyPercent!/100):0;
        gasTherms=backupGasTherms;boilerFuelConsumption=backupGasTherms;boilerFuelInputBtu=backupGasTherms*100000;
        heatingCop=scenario.backupHeating==="resistance"&&output>0?1:null;
        issues.push("Backup heat replaces heat-pump heating at or below the user-entered outdoor switchover temperature. Backup output is sized to ASHRAE design heating demand after fan heat credit; energy is included in heating totals.");
      }else{
        backupHeatingElectricity=null;backupGasTherms=null;backupDeliveredHeating=null;gasTherms=null;boilerFuelConsumption=null;boilerFuelInputBtu=null;
        issues.push("Backup heating requires design capacity and supply-fan data.");
      }
    }else if(coolingReheatReplacesHp){
      heatingElectricity=0;deliveredHeating=Math.min(r.heating,fanHeat!);unmetHeating=Math.max(0,r.heating-deliveredHeating);
      issues.push("Heat-pump compressors are cooling for dehumidification. Available MHGRH recovery can also serve the remaining heating demand.");
    }else if(packaged){
      if(hp){availableHeating=variableAirflow&&rating&&fanHeat!==null?hp.capacity-rating.fanHeat+fanHeat:hp.capacity;heatingCop=variableAirflow&&rating&&fanElectricity!==null?availableHeating/(BTU_PER_KWH*(hp.powerKw-rating.fanKw+fanElectricity)):hp.cop;}
      if(r.heating===0) {heatingElectricity=0;deliveredHeating=0;unmetHeating=0;}
      else if(!hp)issues.push("Heating operating point is outside the supplied data or mixed-air inputs are unavailable.");
      else if(rating&&adjusted&&ratedFanKw!==null&&ratedFanHeat!==null){
        // Each size keeps its own coil capacity, power and compressor stages.
        const coilNeed=adjusted.heat!,operation=dispatchHeating(hp,coilNeed,school.minimumCompressorOnMinutes);
        if(operation.details.some(d=>d.minimumRuntimeLockout))issues.push(`Heating compressors held off when calculated ON-time is below ${school.minimumCompressorOnMinutes} minutes per hour; suppressed load is reported unmet.`);
        if(operation.delivered>0){heatingCyclingCallHours++;if(operation.belowMinimumStage)heatingBelowMinimumHours++;}
        heatingElectricity=operation.electricity;
        if(heatingElectricity!==null)heatingOperation=hourlyOperation(operation.details);
        if(heatingElectricity===null)issues.push("Inferred supply-fan input exceeds catalog heating power; heating electricity unavailable.");
        deliveredHeating=Math.min(r.heating,operation.delivered+fanHeat!);unmetHeating=Math.max(0,r.heating-deliveredHeating);
        heatingGroupPerformance=operation.details;groupPerformance=JSON.stringify({heating:operation.details});
        issues.push(HEATING_BASIS);
        if(selection!.groups.some(g=>compressorStages(g.model.efficiency as "standard"|"high",g.model.nominal_tons).length>1))issues.push("Multi-stage heating input is estimated proportional to catalog stage capacity; cycling degradation applies below minimum stage.");
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
        const boiler=usesRatedBoilerFuelRate
          ?calculateRatedBoilerHour(adjusted.heat,largeBoilerRating,scenario.boilerFuel??"natural-gas",1)
          :calculateNoncondensingOnOffBoilerHour(adjusted.heat,heatingCapacityBtuHr,boilerEfficiencyPercent??null,1,boilerModel?.partLoadEfficiencyMultiplier??1);
        boilerPartLoadRatio=boiler.partLoadRatio;boilerRuntimeFraction=boiler.runtimeFraction;gasTherms=boiler.gasTherms;boilerFuelConsumption=boiler.fuelConsumption;boilerFuelUnit=boiler.fuelUnit;boilerFuelInputBtu=boiler.fuelInputBtu;
        if(boiler.runtimeFraction!==null&&boiler.runtimeFraction>0){heatingCyclingCallHours++;if(boiler.runtimeFraction<1-1e-9)heatingBelowMinimumHours++;}
        if(largeBoilerRating)issues.push(`Selected the ${largeBoilerRating.horsepower} HP CBLE-4D output rating by ASHRAE design heating demand.`);
        issues.push(usesRatedBoilerFuelRate
          ?`${boilerModel.label}: natural-gas use is the listed manufacturer rate multiplied by hourly runtime. Part-load fuel consumption is not separately rated.`
          :`${boilerModel?.label}: ${boilerEfficiencyLabel} is applied as a constant effective hourly efficiency. Part-load and return-water effects, standby fuel loss and boiler auxiliary electricity remain placeholders pending manufacturer data.`);
      }
    }else issues.push("Heating energy requires the selected cooling unit's supply-fan data.");
    let availableCooling:number|null=null,deliveredCooling:number|null=null,unmetCooling:number|null=null,coolingShr:number|null=null,coolingOperatingShr:number|null=null,deliverableCooling:number|null=null,availableSensibleCooling:number|null=null,availableLatentCooling:number|null=null,coolingElectricity:number|null=null,coolingCop:number|null=null,coolingOperatingCop:number|null=null;
    const coolingCall=adjusted&&(adjusted.sensible!>0||adjusted.latent!>0);
    const cold=!variableAirflow&&coolingCall&&mixed&&selection&&finite(r.temperatureF)?bankCooling(selection.groups,r.temperatureF,mixed.wetF,mixed.dryF,rangeMode):null;
    if(!hasCooling)issues.push("Choose cooling equipment (required).");
    else if(variableAirflow){
      if(airside&&rating){
        availableCooling=airside.capacity;deliveredCooling=airside.delivered;unmetCooling=airside.unmet;
        coolingElectricity=airside.electricity;coolingShr=airside.sourceShr;coolingOperatingShr=airside.delivered>0?airside.deliveredSensible/airside.delivered:null;
        deliverableCooling=airside.deliverableCapacity;availableSensibleCooling=airside.availableSensible;availableLatentCooling=airside.availableLatent;
        coolingOperation=hourlyOperation(airside.details);
        groupPerformance=JSON.stringify({heating:heatingGroupPerformance,cooling:airside.details});
        if(airside.details.some(d=>d.minimumRuntimeLockout))issues.push(`Cooling compressors held off when calculated ON-time is below ${school.minimumCompressorOnMinutes} minutes per hour; suppressed sensible/latent load is reported unmet.`);
        if(airside.delivered>0){coolingCyclingCallHours++;if(airside.belowMinimumStage)coolingBelowMinimumHours++;}
        coolingCop=availableCooling>0?Math.max(0,availableCooling-fanHeat!)/(BTU_PER_KWH*(rating.coolingNonfanKw+fanElectricity!)):null;
        coolingOperatingCop=coolingElectricity+fanElectricity!>0?Math.max(0,deliveredCooling-fanHeat!)/(BTU_PER_KWH*(coolingElectricity+fanElectricity!)):null;
        issues.push(VARIABLE_AIRSIDE_BASIS);
        if(airside.boundaryEstimate)issues.push("Cooling temperatures use bounded source estimates; airflow remains inside the recovered catalog range.");
      }else issues.push("Variable-airflow cooling requires valid weather, heat/moisture loads and supported airflow performance.");
    }
    else if(coolingEquipment==="air-cooled-chiller"){
      if(sizingError)issues.push(sizingError);
      else if(!validCooling(r))issues.push("Missing building cooling load.");
      else if(adjusted){
        const sensible=adjusted.sensible!,latent=adjusted.latent!,need=sensible+latent;
        availableCooling=(coolingCapacityTons??0)*12000;
        deliveredCooling=Math.min(need,availableCooling);
        unmetCooling=Math.max(0,need-deliveredCooling);
        coolingElectricity=deliveredCooling/12000*AIR_COOLED_CHILLER_KW_PER_TON;
        if(need>0)coolingCyclingCallHours++;
        issues.push(`Air-cooled chiller placeholder: ${AIR_COOLED_CHILLER_KW_PER_TON.toFixed(1)} kW/ton; nominal capacity is autosized to ASHRAE design total cooling load. Separate air-handler fan and pump electricity are excluded.`);
      }else issues.push("Chiller cooling energy requires valid cooling loads.");
    }
    else if(!validCooling(r))issues.push("Missing building cooling load.");
    else {
      if(cold&&selection){availableCooling=cold.capacity;coolingShr=cold.shr;}
      if(adjusted&&adjusted.sensible===0&&adjusted.latent===0){coolingElectricity=0;deliveredCooling=0;unmetCooling=0;}
      else if(!rating||!adjusted)issues.push("Nominal cooling power or supply-fan rating is unavailable for the selected unit; dependent cooling results unavailable.");
      else if(!cold||!selection)issues.push("Cooling operating point is outside the supplied data or mixed-air inputs are unavailable.");
      else{
        const sensible=adjusted.sensible!,latent=adjusted.latent!;
        const operation=dispatchCooling(cold,sensible,latent,school.minimumCompressorOnMinutes);
        if(operation.details.some(d=>d.minimumRuntimeLockout))issues.push(`Cooling compressors held off when calculated ON-time is below ${school.minimumCompressorOnMinutes} minutes per hour; suppressed sensible/latent load is reported unmet.`);
        if(operation.delivered>0){coolingCyclingCallHours++;if(operation.belowMinimumStage)coolingBelowMinimumHours++;}
        deliveredCooling=operation.delivered;unmetCooling=operation.unmet;coolingElectricity=operation.electricity;
        coolingOperation=hourlyOperation(operation.details);
        groupPerformance=JSON.stringify({heating:heatingGroupPerformance,cooling:operation.details});
        if(selection.groups.some(g=>compressorStages(g.model.efficiency as "standard"|"high",g.model.nominal_tons).length>1))issues.push("Multi-stage cooling input is estimated proportional to catalog stage capacity; cycling degradation applies below minimum stage.");
        coolingCop=Math.max(0,availableCooling!-ratedFanHeat!)/(BTU_PER_KWH*rating.coolingSystemKw);
        const modeElectricity=coolingElectricity+fanElectricity!;
        coolingOperatingCop=modeElectricity>0?Math.max(0,deliveredCooling-fanHeat!)/(BTU_PER_KWH*modeElectricity):null;
        issues.push(COOLING_POWER_BASIS);
        if(cold.boundaryEstimate)issues.push("Cooling uses estimated performance at the nearest supplied temperature boundary.");
      }
    }
    const heatingCompressorElectricity=packaged&&!backupActive?heatingElectricity:0;
    const primaryDeliveredOutput=deliveredHeating!==null&&fanHeat!==null?Math.max(0,deliveredHeating-fanHeat):null;
    let reheatNeed:number|null=0,reheatDelivered:number|null=0,reheatElectricity:number|null=0,reheatGasTherms:number|null=0,unmetReheat:number|null=0,supplyDryF:number|null=null;
    if(variableAirflow){
      if(airside){
        reheatNeed=airside.reheatNeed+(coolingReheatReplacesHp?airside.primaryHeatNeed:0);
        const recoverable=airside.details.reduce((s,d)=>s+Math.min(d.recoveryCapacity,d.reheatNeed+(coolingReheatReplacesHp?d.primaryHeatNeed:0)),0);
        reheatDelivered=Math.min(reheatNeed,recoverable);
        unmetReheat=Math.max(0,reheatNeed-reheatDelivered);
        issues.push(MHGRH_BASIS);
        if(airside.details.some(d=>d.recovery?.boundaryEstimate))issues.push("MHGRH uses bounded temperature estimates outside its supplied table range.");
        if(airside.details.some(d=>d.delivered>0&&!d.recovery))issues.push("MHGRH performance unavailable at this operating point; no recovered reheat is credited.");
        if(coolingReheatReplacesHp&&finite(r.heating)&&fanHeat!==null){
          const usefulHeat=Math.max(0,reheatDelivered-airside.reheatNeed);
          deliveredHeating=Math.min(r.heating,fanHeat+usefulHeat);unmetHeating=Math.max(0,r.heating-deliveredHeating);
        }
        supplyDryF=airside.cfm>0&&airside.beforeReheatF!==null&&primaryDeliveredOutput!==null?airside.beforeReheatF+(primaryDeliveredOutput+reheatDelivered)/(1.08*airside.cfm):null;
        if(unmetReheat>1)issues.push("MHGRH recovery cannot meet reheat demand; residual overcooling is reported separately.");
      }else {reheatNeed=null;reheatDelivered=null;reheatElectricity=null;reheatGasTherms=null;unmetReheat=null;}
    }
    if(runs&&rating)issues.push(variableAirflow?VARIABLE_FAN_BASIS:COOLING_POWER_BASIS);
    if(error)issues.push(error);
    // If any required electrical component is unknown, total electricity stays null.
    // Do not replace these nulls with zero to force a complete annual result.
    const electricity=hasCooling&&heatingElectricity!==null&&coolingElectricity!==null&&fanElectricity!==null?heatingElectricity+coolingElectricity+fanElectricity:null;
    const idle={stage:"Off",onMinutes:"0.0",derate:"1.0000"};
    if(!error){
      if((heatingCompressorElectricity===0||backupActive&&heatingElectricity!==null)&&scenario.heating==="heat-pump")heatingOperation=idle;
      if(coolingElectricity===0&&hasPackagedCooling)coolingOperation=idle;
      if(scenario.heating==="gas"&&boilerRuntimeFraction!==null)heatingOperation={stage:boilerRuntimeFraction>0?"Full firing":"Off",onMinutes:(60*boilerRuntimeFraction).toFixed(1),derate:"1.0000"};
    }else {heatingOperation=null;coolingOperation=null;}
    return {mhgrhAvailableBtuHr:variableAirflow?airside?.details.reduce((s,d)=>s+d.recoveryCapacity,0)??null:0,mhgrhBoundaryEstimate:!!airside?.details.some(d=>d.recovery?.boundaryEstimate),returnAirCfm:variableAirflow?airside?.returnCfm??null:selection?Math.max(0,selection.supplyCfm-r.ventilationCfm):null,
      actualOutdoorAirCfm:variableAirflow?airside?.outdoorCfm??null:selection?Math.min(r.ventilationCfm,selection.supplyCfm):null,
      coilLeavingDryF:airside?.coilLeavingF??null,supplyDryF,supplyHumidityRatio:airside?.supplyHumidityRatio??null,
      dehumidificationActive:airside?.dehumidifying??false,unmetLatentBtuHr:variableAirflow?airside?.unmetLatent??null:0,
      reheatNeed,reheatDelivered,reheatElectricity,reheatGasTherms,unmetReheat,heatingCompressorElectricity,
      backupActive,backupHeatingElectricity,backupGasTherms,backupDeliveredHeating,heatingStage:heatingOperation?.stage??null,heatingOnMinutes:heatingOperation?.onMinutes??null,heatingDerate:heatingOperation?.derate??null,
      coolingStage:coolingOperation?.stage??null,coolingOnMinutes:coolingOperation?.onMinutes??null,coolingDerate:coolingOperation?.derate??null,fanOnMinutes:fanElectricity===null?null:runs&&ratedFanKw!==0?60:0,
      electricity,heatingElectricity,coolingElectricity,fanElectricity,fanHeat,gasTherms,boilerFuelConsumption,boilerFuelUnit,boilerFuelInputBtu,boilerPartLoadRatio,boilerRuntimeFraction,availableHeating,availableCooling,deliveredHeating,deliveredCooling,unmetHeating,unmetCooling,heatingCop,coolingCop,coolingOperatingCop,coolingShr,coolingOperatingShr,deliverableCooling,availableSensibleCooling,availableLatentCooling,
      enteringWetBulbF:mixed?.wetF??null,enteringDryBulbF:mixed?.dryF??null,outdoorAirFraction:mixed?.outdoorFraction??null,supplyCfm:variableAirflow?airside?.cfm??null:selection?.supplyCfm??null,unmetVentilationCfm,
      heatingBoundaryEstimate:hp?.boundaryEstimate??false,coolingBoundaryEstimate:variableAirflow?airside?.boundaryEstimate??false:cold?.boundaryEstimate??false,heatingCurveOutdoorF:hp?.curveOutdoorF??null,heatingCurveDryF:hp?.curveDryF??null,
      coolingCurveOutdoorF:variableAirflow?airside?.curveOutdoorF??null:cold?.curveOutdoorF??null,coolingCurveWetF:variableAirflow?airside?.curveWetF??null:cold?.curveWetF??null,coolingCurveDryF:variableAirflow?airside?.curveDryF??null:cold?.curveDryF??null,groupPerformance,status:issues.join(" ")||"Calculated from selected heating/cooling equipment and supply-fan balance."};
  });
  // Available-hour component sums can have different coverage. Annual totals are
  // allowed only when all required energy records and the calendar are complete.
  const completeHours=output.filter(r=>finite(r.electricity)&&finite(r.gasTherms)&&finite(r.boilerFuelConsumption)&&finite(r.boilerFuelInputBtu)).length;
  const sum=(key:"electricity"|"gasTherms"|"boilerFuelConsumption"|"boilerFuelInputBtu"|"heatingElectricity"|"coolingElectricity"|"fanElectricity"|"unmetHeating"|"unmetCooling"|"reheatElectricity"|"reheatGasTherms"|"reheatDelivered"|"unmetReheat")=>output.some(r=>finite(r[key]))?output.reduce((s,r)=>s+(r[key]??0),0):null;
  return {scenario,selection,sizing:sizing??null,heatingCapacityBtuHr,backupHeatingCapacityBtuHr,reheatCapacityBtuHr,coolingCapacityTons,error,rows:output,summary:{reheatElectricity:sum("reheatElectricity"),reheatGasTherms:sum("reheatGasTherms"),reheatBtu:sum("reheatDelivered"),unmetReheatBtu:sum("unmetReheat"),unmetReheatHours:output.filter(r=>(r.unmetReheat??0)>1).length,electricity:sum("electricity"),gasTherms:sum("gasTherms"),boilerFuelConsumption:sum("boilerFuelConsumption"),boilerFuelUnit:output.find(r=>r.boilerFuelUnit)?.boilerFuelUnit??null,boilerFuelInputBtu:sum("boilerFuelInputBtu"),heatingElectricity:sum("heatingElectricity"),coolingElectricity:sum("coolingElectricity"),fanElectricity:sum("fanElectricity"),completeHours,fullYear:!error&&completeHours===8760&&completeCalendar(rows),unmetHeatingBtu:sum("unmetHeating"),unmetCoolingBtu:sum("unmetCooling"),unmetHeatingHours:output.filter(r=>(r.unmetHeating??0)>1).length,unmetCoolingHours:output.filter(r=>(r.unmetCooling??0)>1).length,unknownHeatingHours:output.filter(r=>r.unmetHeating===null).length,unknownCoolingHours:output.filter(r=>r.unmetCooling===null).length,estimatedHeatingHours:output.filter(r=>r.heatingBoundaryEstimate).length,estimatedCoolingHours:output.filter(r=>r.coolingBoundaryEstimate).length,heatingCyclingSharePercent:heatingCyclingCallHours?100*heatingBelowMinimumHours/heatingCyclingCallHours:null,coolingCyclingSharePercent:coolingCyclingCallHours?100*coolingBelowMinimumHours/coolingCyclingCallHours:null}};
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
  const original=parseCsv(schoolCsv(rows,school,location,zone,site)),s=result.selection,rating=s?bankRatings(s.groups):null;
  const operation=equipmentOperationCsv(result);
  const boiler=result.scenario.heating==="gas"?boilerModelFor(result.scenario.boilerSizeClass??"small"):null;
  const boilerRating=boiler?.sizeClass==="large"?cble4dRatingForPeakLoad(result.heatingCapacityBtuHr):null;
  const thermalEfficiencyPercent=boiler?.sizeClass==="large"?result.scenario.largeBoilerEfficiencyPercent:undefined;
  const modelsMhgrh=result.reheatCapacityBtuHr!==null;
  const metadata={...result.sizing?.metadata,Airflow_mode:result.scenario.airflowMode??"variable",Variable_airside_basis:VARIABLE_AIRSIDE_BASIS,Variable_fan_basis:result.scenario.airflowMode!=="fixed"?VARIABLE_FAN_BASIS:null,Airflow_curve_source_SHA256:AIRFLOW_COOLING_FIT.source.sha256,Airflow_capacity_coefficients:JSON.stringify(AIRFLOW_COOLING_FIT.capacity_coefficients),Airflow_curve_terms:AIRFLOW_COOLING_FIT.terms.join(";"),Airflow_curve_transforms:JSON.stringify(AIRFLOW_COOLING_FIT.transforms),Airflow_SHR_coefficients:s?JSON.stringify(AIRFLOW_COOLING_FIT.models.filter(m=>s.groups.some(g=>g.model.efficiency===m.efficiency&&(g.model.scaledFromNominalTons??g.model.nominal_tons)===m.nominal_tons)).map(m=>({model:m.id,coefficients:m.shr_numerator_coefficients}))):null,Supply_temperature_basis:"Cooling_coil_leaving_DB_F and Final_supply_DB_F are calculated outputs for user analysis. Sensible/latent loads determine cooling, with no fixed supply-temperature target or dew-point trigger. The existing 45 F cooling floor remains a model operating limit.",Reheat_capacity_BTU_hr:result.reheatCapacityBtuHr,Reheat_fuel:modelsMhgrh?"mhgrh":null,MHGRH_basis:modelsMhgrh?MHGRH_BASIS:null,Cooling_SHR_basis:"Cooling_SHR is the gross-capacity-weighted source fit. Operating_cooling_SHR is delivered sensible / delivered total after leaving-air saturation correction. Available source-curve gross capacity is separate from deliverable output at the 45 F floor. Cooling control solves against the final leaving-air state before reporting a shortfall.",Reheat_energy_basis:modelsMhgrh?"MHGRH uses recovered heat without separate fuel or resistance electricity. Reheat capacity reports occupied ASHRAE design demand. Hourly output depends on available recovery.":null,Backup_heating:result.scenario.heating==="heat-pump"?result.scenario.backupHeating:null,Backup_switchover_outdoor_F:result.scenario.heating==="heat-pump"?result.scenario.backupSwitchoverF:null,Backup_gas_efficiency_percent:result.scenario.heating==="heat-pump"&&result.scenario.backupHeating==="gas"?result.scenario.backupGasEfficiencyPercent:null,Backup_capacity_BTU_hr:result.backupHeatingCapacityBtuHr,Backup_basis:result.scenario.heating==="heat-pump"?"Backup replaces HP heating at outdoor DB <= switchover. Sized to full design heating load after fan heat credit. No supplemental backup above cutoff. Heating electricity and gas totals include backup. Compressor stage times exclude backup.":null,Equipment_model:EQUIPMENT_MODEL_VERSION,Scenario:scenarioName(result.scenario),Heating_equipment:EQUIPMENT_NAMES[result.scenario.heating],Cooling_equipment:coolingEquipmentName(result.scenario),Boiler_size_class:boiler?.sizeClass??null,Boiler_model:boiler?.id??null,Boiler_fuel:boiler?.sizeClass==="large"?result.scenario.boilerFuel:null,Boiler_firing_mode:boiler?.sizeClass==="large"?result.scenario.boilerFiringMode:null,Boiler_efficiency_metric:thermalEfficiencyPercent!==undefined?"Thermal efficiency":boiler?.efficiencyMetric??null,Boiler_AFUE_percent:boiler?.efficiencyMetric==="AFUE"?result.scenario.gasEfficiencyPercent:null,Boiler_thermal_efficiency_percent:thermalEfficiencyPercent??null,Boiler_capacity_basis:boiler?.sizeClass==="large"?"Smallest CBLE-4D rated hot-water output meeting ASHRAE design heating demand after fan heat credit":boiler?"ASHRAE design heating demand after fan heat credit":null,Boiler_rated_size_HP:boilerRating?.horsepower??null,Boiler_rated_output_BTU_hr:boilerRating?.ratedOutputBtuHr??null,Boiler_rated_fuel_rate:boilerRating?cble4dFuelRatingFor(boilerRating,result.scenario.boilerFuel??"natural-gas").consumptionPerHour:null,Boiler_rated_fuel_unit:boilerRating?cble4dFuelRatingFor(boilerRating,result.scenario.boilerFuel??"natural-gas").unit:null,Boiler_return_water_temperature_F:boiler?.returnWaterTemperatureF??null,Boiler_minimum_return_water_temperature_F:boiler?.minimumReturnWaterTemperatureF??null,Boiler_standby_fuel_input_BTU_hr:boiler?.standbyFuelInputBtuPerHr??null,Boiler_auxiliary_electric_kW:boiler?.auxiliaryElectricPowerKw??null,Boiler_part_load_efficiency_multiplier:boiler?.partLoadEfficiencyMultiplier??null,Chiller_capacity_tons:result.coolingCapacityTons,Chiller_efficiency_kW_per_ton:coolingFor(result.scenario)==="air-cooled-chiller"?AIR_COOLED_CHILLER_KW_PER_TON:null,Stage_preference:result.scenario.stage,Heating_cycling_share_percent:result.summary.heatingCyclingSharePercent,Cooling_cycling_share_percent:result.summary.coolingCyclingSharePercent,Scope:coolingFor(result.scenario)==="air-cooled-chiller"?"Chiller cooling at flat kW/ton; separate air-handler fan and pump electricity excluded":result.scenario.heating==="heat-pump"?"Heat pump heating and cooling with catalog fan/power balance":boiler?.sizeClass==="large"?thermalEfficiencyPercent!==undefined?"CBLE-4D boiler heating using entered thermal efficiency":"CBLE-4D boiler heating using manufacturer fuel rate":boiler?`Small non-condensing on/off natural-gas boiler; user-entered ${boiler.efficiencyMetric}`:"Selected heater with heat-pump cooling and separate supply fan",
    Minimum_compressor_on_minutes:school.minimumCompressorOnMinutes,Compressor_minimum_runtime_basis:"Packaged heating/cooling compressors only; per-unit total ON minutes after stage/cycling PLF calculations. Positive runtime below threshold is OFF; equality runs. Fans retain their schedule; suppressed loads remain unmet without carryover or forced overconditioning. Design sizing/reheat capacity exclude this annual cutoff. Hourly totals are not individual cycle lengths. Boiler, resistance, backup and chiller placeholder excluded.",
    Nominal_cooling_system_kW_per_unit:s?.groups.length===1&&rating?rating.coolingSystemKw/s.count:null,Inferred_supply_fan_kW_per_unit:s?.groups.length===1&&rating?rating.fanKw/s.count:null,Inferred_supply_fan_heat_BTU_hr_per_unit:s?.groups.length===1&&rating?rating.fanHeat/s.count:null,Unit_count:s?.count,Nominal_tons_per_unit:s?.groups.length===1?s.groups[0].model.nominal_tons:null,Total_nominal_tons:s?.totalTons,Supply_CFM:s?.supplyCfm,
    Catalog_model:s?.groups.length===1?s.groups[0].model.id:null,Installed_groups:s?JSON.stringify(s.groups.map(g=>({model:g.model.id,nominalTons:g.model.nominal_tons,count:g.count,supplyCfmEach:g.model.fixed_cfm,rating:unitRatingFor(g.model)}))):null,Selection_objective:result.scenario.airflowMode==="fixed"&&!modelsMhgrh?"Cooling-only sizing: fewest units, then lowest installed nominal tonnage; unavailable cooling checks ignored; heating and ventilation airflow are diagnostic only":"Variable-airflow sizing checks sensible/latent cooling, fan HP/CFM and ventilation. Best feasible evaluated unit count then tons; global optimality is not proven.",Optimization_complete:s?.optimizationComplete,Design_check_loading_JSON:s?JSON.stringify(s.designLoading):null,Zone_load_allocation:"Fixed nominal-tonnage shares of the building loads; no whole-unit lead/lag shedding or transfer of spare capacity across zones. Same-size units have identical assumed profiles. All supply fans run on scheduled calls; compressors stage/cycle locally.",Shared_cooling_capacity_curve:JSON.stringify(!modelsMhgrh&&result.scenario.airflowMode==="fixed"?SHARED_COOLING_CAPACITY:{schema:AIRFLOW_COOLING_FIT.schema,terms:AIRFLOW_COOLING_FIT.terms,transforms:AIRFLOW_COOLING_FIT.transforms,capacity_coefficients:AIRFLOW_COOLING_FIT.capacity_coefficients,source:AIRFLOW_COOLING_FIT.source}),Large_unit_assumptions:s?.groups.some(g=>g.model.scaledFromNominalTons)?LARGE_UNIT_BASIS:null,Cycling_derate_basis:"Below minimum compressor stage: PLF = 1 - 0.15 * (1 - load / minimum-stage capacity); runtime = (load / minimum-stage capacity) / PLF. PLF 1 means no cycling derate. Boiler has no additional cycling derate; resistance/chiller switching data unavailable. Boundary estimates use nearest supplied curve conditions, not an additional derate.",Stage_time_basis:"Numeric stage, ON and OFF minutes are per unit in each hourly interval; stage minutes sum to ON minutes and ON + OFF = 60. Mixed-bank columns are separated by installed group order and identify model, count and stage capacity percent. Current zoned units share their group profile; legacy lead/lag groups use unit-count means. Runtime fraction = ON minutes / 60. PLF is dimensionless. Known idle stages are zero; unavailable times are blank. These are hourly totals, not cycle periods or start counts. Supply-fan operation is separate.",Autosizing_basis:s?.basis,Curve_range_mode:curveRangeMode(result.scenario),Curve_range_basis:CURVE_RANGE_BASIS,Source_checked_design_cooling_hours:s?.verifiedCoolingHours,Boundary_estimated_cooling_hours:result.summary.estimatedCoolingHours,Unverified_design_cooling_hours:s?.unverifiedCoolingHours,Cooling_fit_coefficients:s&&!modelsMhgrh&&result.scenario.airflowMode==="fixed"?JSON.stringify(s.groups.map(({model:m,count})=>({model:m.id,count,capacityCurveId:m.capacityCurveId,capacity:m.capacity_coefficients,shrNumerator:m.shr_numerator_coefficients,shrDenominator:m.shr_capacity_coefficients??m.capacity_coefficients,referenceBtuHr:m.reference_capacity_Btu_hr,scaledFromNominalTons:m.scaledFromNominalTons}))):null,
    Heating_table:result.scenario.heating==="heat-pump"?s?.groups.map(g=>g.heatingModel.table).join(" + "):null,Heating_reference_capacity_BTU_hr:result.scenario.heating==="heat-pump"?s?.referenceHeatingBtuHr:null,Heating_reference_condition:s&&result.scenario.heating==="heat-pump"?"47 F outdoor / 70 F entering dry bulb":null,Source_checked_design_heating_hours:s?.verifiedHeatingHours,Boundary_estimated_heating_hours:result.summary.estimatedHeatingHours,Unverified_design_heating_hours:s?.unverifiedHeatingHours,
    Heating_fit_coefficients:s&&result.scenario.heating==="heat-pump"?JSON.stringify({groups:s.groups.map(({heatingModel:h,count})=>({count,table:h.table,capacity:h.capacity_coefficients,power:h.power_coefficients,referenceBtuHr:h.reference_capacity_Btu_hr,referencePowerKw:h.reference_power_kW})),terms:"x=(outdoor_F-47)/40; y=(entering_DB_F-70)/20; [1,x,y,x^2,xy,y^2,x^3,x^2y,xy^2,y^3,x^4,x^3y,x^2y^2,xy^3,y^4]"}):null,
    Heating_basis:s&&result.scenario.heating==="heat-pump"?HEATING_BASIS:null,Heating_energy_basis:boiler?.sizeClass==="large"?thermalEfficiencyPercent!==undefined?"CBLE-4D rated output is selected using design heating demand after fan-heat credit. Gas input is hourly delivered boiler output divided by thermal efficiency.":"CBLE-4D manufacturer fuel consumption per hour is multiplied by runtime fraction. Runtime fraction is delivered output divided by rated output.":boiler?`On/off runtime = boiler PLR. Fuel uses user-entered ${boiler.efficiencyMetric}; no separate part-load/cycling efficiency correction is applied.`:s?"Supply fan runs on heat/cool/ventilation calls. Credit fan heat before heater demand; HP coil capacity/input exclude the inferred fan component before duty scaling. Sum coil heating, non-supply-fan cooling and supply-fan electricity exactly once.":null,
    Mixing_basis:"Outdoor-air fraction = min(1, scheduled ventilation / operating supply CFM). Report airflow shortfall; retain full requested ventilation thermal loads. Standard-volume dry-air approximation at 101325 Pa. Mix humidity ratio and enthalpy; solve mixed dry bulb and wet bulb. Infiltration excluded from mixer; retained in building loads.",
    Return_air_basis:"Zone dry bulb from clamped building free-float temperature; RH from building indoor RH target.",Cooling_power_basis:coolingFor(result.scenario)==="air-cooled-chiller"?"Chiller placeholder uses flat kW/ton of delivered cooling; separate air-handler fan and pump input are excluded.":result.scenario.airflowMode==="fixed"?COOLING_POWER_BASIS:"Full-output compressor/condenser input uses the nominal non-supply-fan rating; compressor staging and cycling scale that input. No airflow-dependent compressor input-power curve is supplied. Supply-fan power varies with operating airflow using the cubic law and standard-motor limits, and is counted separately once.",Fan_operation:"Full-hour fan during scheduled occupied operation or any heating/cooling/ventilation call. Fan heat enters signed sensible balance and reduces heating coil demand. Heating/cooling kWh exclude separately counted supply fan. Fan proxy is inferred from each model family’s supplied ratings.",Pending:"No off-rating compressor input-power curve, heating-coil capacity correction for airflow, or additional defrost term is supplied."};
  const keys:(keyof EquipmentHour)[]=["mhgrhAvailableBtuHr","mhgrhBoundaryEstimate","returnAirCfm","actualOutdoorAirCfm","coilLeavingDryF","supplyDryF","supplyHumidityRatio","dehumidificationActive","unmetLatentBtuHr","reheatNeed","reheatDelivered","reheatElectricity","reheatGasTherms","unmetReheat","heatingCompressorElectricity","backupActive","backupHeatingElectricity","backupGasTherms","backupDeliveredHeating","electricity","heatingElectricity","coolingElectricity","fanElectricity","fanHeat","gasTherms","boilerFuelConsumption","boilerFuelUnit","boilerFuelInputBtu","boilerPartLoadRatio","boilerRuntimeFraction","availableHeating","availableCooling","deliveredHeating","deliveredCooling","unmetHeating","unmetCooling","heatingCop","coolingCop","coolingOperatingCop","coolingShr","coolingOperatingShr","deliverableCooling","availableSensibleCooling","availableLatentCooling","enteringDryBulbF","enteringWetBulbF","outdoorAirFraction","supplyCfm","unmetVentilationCfm","heatingBoundaryEstimate","coolingBoundaryEstimate","heatingCurveOutdoorF","heatingCurveDryF","coolingCurveOutdoorF","coolingCurveWetF","coolingCurveDryF","groupPerformance","fanOnMinutes","status"];
  const headers=["MHGRH_available_reheat_BTU_hr","MHGRH_boundary_estimate","Return_air_CFM","Admitted_outdoor_air_CFM","Cooling_coil_leaving_DB_F","Final_supply_DB_F","Supply_humidity_ratio_lb_lb","Dehumidification_active","Unmet_latent_cooling_BTU_hr","Reheat_required_BTU_hr","Reheat_delivered_BTU_hr","Reheat_electricity_kWh","Reheat_gas_therms","Unmet_reheat_BTU_hr","Heating_compressor_electricity_kWh","Backup_active","Backup_heating_electricity_kWh","Backup_gas_input_therms","Backup_delivered_heat_excluding_fan_BTU_hr","Equipment_electricity_kWh","Heating_coil_electricity_excluding_supply_fan_kWh","Cooling_electricity_excluding_supply_fan_kWh","Supply_fan_electricity_kWh","Supply_fan_heat_BTU_hr","Gas_input_therms","Selected_boiler_fuel_consumption_native_units","Selected_boiler_fuel_unit","Selected_boiler_fuel_input_BTU","Boiler_part_load_ratio","Boiler_runtime_fraction","Available_heating_BTU_hr","Available_gross_cooling_BTU_hr","Delivered_heating_BTU_hr","Delivered_gross_cooling_BTU_hr","Unmet_heating_BTU_hr","Unmet_cooling_BTU_hr","Heating_COP","Full_output_net_cooling_COP","Operating_net_cooling_COP","Cooling_SHR","Operating_cooling_SHR","Deliverable_cooling_at_45F_limit_BTU_hr","Available_sensible_cooling_at_45F_limit_BTU_hr","Available_latent_cooling_at_45F_limit_BTU_hr","Mixed_entering_dry_bulb_F","Mixed_entering_wet_bulb_F","Outdoor_air_fraction","Supply_CFM","Unmet_ventilation_CFM","Heating_boundary_estimate","Cooling_boundary_estimate","Heating_curve_outdoor_F","Heating_curve_entering_DB_F","Cooling_curve_outdoor_F","Cooling_curve_entering_WB_F","Cooling_curve_entering_DB_F","Equipment_group_performance_JSON","Supply_fan_on_minutes","Equipment_status"];
  return [line([...original[0],...Object.keys(metadata)]),line([...original[1],...Object.values(metadata)]),"",line([...original[2],...headers,...operation.headers]),...rows.map((_,i)=>line([...original[i+3],...keys.map(k=>result.rows[i][k]),...operation.values(result.rows[i])]))].join("\r\n");
}
export function equipmentComparisonCsv(results:EquipmentResult[]):string {
  return [line(["Scenario","Airflow_mode","Reheat_capacity_BTU_hr","Reheat_electricity_kWh_available_hours","Reheat_gas_therms_available_hours","Unmet_reheat_hours","Backup_heating","Backup_switchover_outdoor_F","Backup_gas_efficiency_percent","Backup_capacity_BTU_hr","Heating_equipment","Boiler_size_class","Boiler_fuel","Boiler_firing_mode","Boiler_efficiency_metric","Cooling_scope","Units","Nominal_tons_each","Total_nominal_tons","Heating_capacity_BTU_hr","Heating_capacity_basis","Sizing_provisional","Unverified_design_cooling_hours","Unverified_design_heating_hours","Heating_airflow_approximation","Electricity_kWh_available_hours","Supply_fan_kWh_available_hours","Gas_therms_available_hours","Boiler_fuel_quantity_available_hours","Boiler_fuel_unit","Boiler_fuel_input_BTU_available_hours","Complete_energy_hours","Full_year","Unmet_heating_BTU_available_hours","Unmet_cooling_BTU_available_hours","Curve_range_mode","Boundary_estimated_heating_hours","Boundary_estimated_cooling_hours","Stage_preference","Heating_cycling_share_percent","Cooling_cycling_share_percent","Sizing_basis","Design_station_WMO","ASHRAE_edition","Heating_design_percent","Cooling_design_percent","Installed_groups","Optimization_complete"]),
    ...results.map(r=>{const boiler=r.scenario.heating==="gas"?boilerModelFor(r.scenario.boilerSizeClass??"small"):null;return line([scenarioName(r.scenario),r.scenario.airflowMode??"variable",r.reheatCapacityBtuHr,r.summary.reheatElectricity,r.summary.reheatGasTherms,r.summary.unmetReheatHours,r.scenario.heating==="heat-pump"?r.scenario.backupHeating:null,r.scenario.heating==="heat-pump"?r.scenario.backupSwitchoverF:null,r.scenario.heating==="heat-pump"&&r.scenario.backupHeating==="gas"?r.scenario.backupGasEfficiencyPercent:null,r.backupHeatingCapacityBtuHr,EQUIPMENT_NAMES[r.scenario.heating],boiler?.sizeClass,boiler?.sizeClass==="large"?r.scenario.boilerFuel:null,boiler?.sizeClass==="large"?r.scenario.boilerFiringMode:null,boiler?.sizeClass==="large"&&r.scenario.largeBoilerEfficiencyPercent!==undefined?"Thermal efficiency":boiler?.efficiencyMetric,coolingEquipmentName(r.scenario),r.selection?.count,r.selection?.groups.length===1?r.selection.groups[0].model.nominal_tons:null,r.selection?.totalTons,r.heatingCapacityBtuHr,r.scenario.heating==="heat-pump"?"47 F outdoor / 70 F entering DB, catalog nominal airflow":"ASHRAE design heater output after fan heat credit",r.selection?.provisional,r.selection?.unverifiedCoolingHours,r.selection?.unverifiedHeatingHours,r.selection?.heatingAirflowApproximation,r.summary.electricity,r.summary.fanElectricity,r.summary.gasTherms,r.summary.boilerFuelConsumption,r.summary.boilerFuelUnit,r.summary.boilerFuelInputBtu,r.summary.completeHours,r.summary.fullYear,r.summary.unmetHeatingBtu,r.summary.unmetCoolingBtu,curveRangeMode(r.scenario),r.summary.estimatedHeatingHours,r.summary.estimatedCoolingHours,r.scenario.stage,r.summary.heatingCyclingSharePercent,r.summary.coolingCyclingSharePercent,r.sizing?.basis,r.sizing?.metadata.Design_station_WMO,r.sizing?.metadata.ASHRAE_edition,r.sizing?.metadata.Heating_design_percent,r.sizing?.metadata.Cooling_design_percent,r.selection?selectionGroupsLabel(r.selection):null,r.selection?.optimizationComplete]);})].join("\r\n");
}
