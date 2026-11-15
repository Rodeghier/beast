/** Independent source-fit, fan-law, air/moisture and reheat regression checks. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),cache=new Map();
function load(path){
  let file=resolve(root,path);if(!existsSync(file))file+=existsSync(file+'.tsx')?'.tsx':'.ts';
  if(file.endsWith('.json'))return JSON.parse(readFileSync(file,'utf8'));
  if(cache.has(file))return cache.get(file).exports;
  const loaded={exports:{}};cache.set(file,loaded);
  const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  const localRequire=name=>name.startsWith('@/')?load(name.slice(2)):name.startsWith('.')?load(resolve(dirname(file),name)):require(name);
  new Function('require','module','exports',outputText)(localRequire,loaded,loaded.exports);return loaded.exports;
}
const {DEFAULT_SCHOOL,simulateSchool,celsius,humidityRatio}=load('lib/school.ts');
const {newScenario}=load('lib/equipment.ts');
const {COOLING_MODELS}=load('lib/packaged-cooling.ts');
const {airflowCoolingPoint,AIRFLOW_COOLING_FIT}=load('lib/airflow-cooling.ts');
const {variableFanModel,standardFanLimit}=load('lib/variable-fan.ts');
const {solveVariableAirside,leavingAirState}=load('lib/variable-airside.ts');
const {heatingModelFor}=load('lib/packaged-heating.ts');
const {simulateEquipment,equipmentResultsCsv,equipmentComparisonCsv,BTU_PER_KWH}=load('lib/equipment-model.ts');
const {equipmentOperationCsv}=load('lib/equipment-operation.ts');
const {parseCsv}=load('lib/csv.ts');
const {EquipmentScenarios}=load('components/equipment-scenarios.tsx');
const near=(a,b,t=1e-6)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,`${a} != ${b}`);
const source=parseCsv(readFileSync(resolve(root,'public/references/packaged-cooling-all-airflows.csv'),'utf8'));
const header=source.shift(),at=(row,key)=>row[header.indexOf(key)];
let capacityError=0,shrError=0,n=0;
for(const row of source){
  if(at(row,'accepted_for_fit')!=='True'||at(row,'gross_capacity_MBh')==='')continue;
  const model=COOLING_MODELS.find(m=>m.table===Number(at(row,'table'))&&!m.scaledFromNominalTons);
  const point=airflowCoolingPoint(model,...['outdoor_dry_bulb_F','entering_wet_bulb_F','entering_dry_bulb_F','cfm'].map(k=>Number(at(row,k))),'strict');
  assert.ok(point,`Source point unavailable: ${row.join(',')}`);
  const actual=Number(at(row,'gross_capacity_MBh'))*1000;
  capacityError+=(point.capacityBtuHr/actual-1)**2;shrError+=(point.shr-Number(at(row,'shr')))**2;n++;
}
assert.equal(n,7192);near(100*Math.sqrt(capacityError/n),AIRFLOW_COOLING_FIT.capacity_relative_rmse_percent,1e-9);
near(Math.sqrt(shrError/n),AIRFLOW_COOLING_FIT.shr_rmse,1e-10);
assert.ok(Math.sqrt(capacityError/n)<.021);assert.ok(Math.sqrt(shrError/n)<.003);
for(const model of COOLING_MODELS){
  const max=airflowCoolingPoint(model,95,67,80,480*model.nominal_tons,'strict');
  near(max.normalized,1);near(max.capacityBtuHr,model.reference_capacity_Btu_hr);
  for(const perTon of [300,330,360,400,440,480]){
    const point=airflowCoolingPoint(model,95,67,80,perTon*model.nominal_tons,'strict');assert.ok(point);assert.ok(point.shr>0&&point.shr<=1);
    const reference=airflowCoolingPoint(COOLING_MODELS[0],95,67,80,perTon*3,'strict');near(point.normalized,reference.normalized);
  }
  assert.equal(airflowCoolingPoint(model,95,67,80,299*model.nominal_tons),null);
  const fan=variableFanModel(model);assert.ok(fan);near(fan.power(fan.referenceCfm*.8)/fan.power(fan.referenceCfm),.8**3);
  assert.ok(fan.maxCfm<=480*model.nominal_tons+1e-6);assert.ok(fan.power(fan.maxCfm)<=fan.maxElectricalKw+1e-7);
}
near(standardFanLimit({nominal_tons:3,efficiency:'standard'}).maxHp,.75);
near(standardFanLimit({nominal_tons:3,efficiency:'high'}).maxHp,2.9);
near(standardFanLimit({nominal_tons:10,efficiency:'standard'}).maxHp,2.9);
near(standardFanLimit({nominal_tons:10,efficiency:'high'}).maxHp,4.2);
near(standardFanLimit({nominal_tons:25,efficiency:'high'}).maxHp,5.8);
// Sensible + latent energy is conserved even when a provisional SHR would
// otherwise create a supersaturated leaving state.
const state=leavingAirState(80,humidityRatio(celsius(80),80),1200,30000,.9);
near(state.sensible+state.latent,30000,.001);assert.ok(state.humidityRatio<=humidityRatio(celsius(state.dryF),100)+1e-9);

const school={...DEFAULT_SCHOOL,floorAreaFt2:10000,stories:1,people:50,ventilationPerson:10,ventilationArea:.12,lightingW:.9,equipmentW:.6};
const raw=(temperatureF,rh,extra={})=>({year:2025,month:5,day:5,hour:12,minute:0,temperature:celsius(temperatureF),humidity:rh,dhi:0,dni:0,ghi:0,...extra});
const rows=simulateSchool([raw(90,55),raw(72,85),raw(65,85),raw(20,60,{month:1,day:7}),raw(68,20)],school);
const model=COOLING_MODELS.find(m=>m.efficiency==='standard'&&m.nominal_tons===10);
const groups=[{model,heatingModel:heatingModelFor(model),count:3}];
const air=rows.map(r=>solveVariableAirside(groups,r,school,'bounded'));
assert.ok(air.every(Boolean));
assert.ok(new Set(air.map(p=>p.cfm.toFixed(2))).size>1,'Flow should respond to loads and humidity');
for(let i=0;i<rows.length;i++){
  const p=air[i];near(p.cfm,p.returnCfm+p.outdoorCfm);assert.ok(p.outdoorCfm<=rows[i].ventilationCfm+1e-7);
  for(const detail of p.details){
    near(detail.fanHeat,detail.fanKw*BTU_PER_KWH);assert.ok(detail.cfm<=detail.maxCfm+1e-6);
    if(detail.called){assert.ok(detail.cfm/detail.count>=300*model.nominal_tons-1e-5);assert.ok(detail.coilLeavingF>=45-1e-5);}
    // The building uses standard 1.08 air coefficients while mixed DB comes
    // from moist-air enthalpy. Their heating balances should agree within 1%.
    near(detail.requiredPostCoilHeat,detail.primaryHeatNeed+detail.reheatNeed,.01*Math.max(1,detail.requiredPostCoilHeat));
  }
}
assert.ok(air.some(p=>p.reheatNeed>0),'Humid mild weather should require reheat');
const sizing={rows,basis:'Controlled variable-airflow design',metadata:{},error:null};
const prepared={groups,count:3,totalTons:30,supplyCfm:groups[0].count*4800,referenceCoolingBtuHr:groups[0].count*model.reference_capacity_Btu_hr,referenceHeatingBtuHr:groups[0].count*groups[0].heatingModel.reference_capacity_Btu_hr,verifiedCoolingHours:5,estimatedCoolingHours:0,unverifiedCoolingHours:0,verifiedHeatingHours:5,estimatedHeatingHours:0,unverifiedHeatingHours:0,rangeMode:'bounded',heatingAirflowApproximation:true,includesHeatPumpHeating:true,provisional:true,optimizationComplete:false,basis:'Controlled fixture',designLoading:{heating:0,sensibleCooling:0,latentCooling:0,ventilation:0}};
const scenarios=[{...newScenario('gas'),cooling:'heat-pump',gasEfficiencyPercent:80,reheatOption:'natural-gas'},{...newScenario('resistance'),cooling:'heat-pump'},{...newScenario(),backupHeating:'gas',backupSwitchoverF:30,backupGasEfficiencyPercent:80}];
for(const scenario of scenarios){
  const result=simulateEquipment(rows,school,scenario,prepared,sizing);assert.equal(result.error,null);
  assert.ok(result.reheatCapacityBtuHr>0);
  let reheatHours=0;
  for(let i=0;i<rows.length;i++){
    const hour=result.rows[i];assert.ok(hour.electricity!==null,`Unknown hour ${i}: ${hour.status}`);
    near(hour.electricity,hour.heatingElectricity+hour.coolingElectricity+hour.fanElectricity);
    near(hour.supplyCfm,hour.returnAirCfm+hour.actualOutdoorAirCfm);
    assert.ok(hour.deliverableCooling<=hour.availableCooling+1e-5);
    near(hour.availableSensibleCooling+hour.availableLatentCooling,hour.deliverableCooling,.03);
    if(hour.availableCooling>0){
      const detail=JSON.parse(hour.groupPerformance).cooling;
      near(hour.coolingShr,detail.reduce((s,d)=>s+d.capacity*d.shr,0)/hour.availableCooling);
      if(hour.deliveredCooling>0)near(hour.coolingOperatingShr,detail.reduce((s,d)=>s+d.deliveredSensible,0)/hour.deliveredCooling);
    }
    assert.ok(hour.reheatDelivered<=result.reheatCapacityBtuHr+1e-6);
    if(hour.reheatDelivered>1){
      reheatHours++;
      if(scenario.heating==='gas'){near(hour.reheatGasTherms,hour.reheatDelivered/80000);near(hour.reheatElectricity,0);}
      else{near(hour.reheatElectricity,hour.reheatDelivered/BTU_PER_KWH);near(hour.reheatGasTherms,0);}
      assert.ok(hour.supplyDryF>hour.coilLeavingDryF);
    }
    near(hour.boilerFuelInputBtu,hour.gasTherms*100000);
    const numeric=equipmentOperationCsv(result),values=numeric.values(hour);
    for(const name of numeric.headers.filter(h=>/^Cooling.*_on_minutes_per_unit$/.test(h)))assert.ok(Number.isFinite(values[numeric.headers.indexOf(name)]));
  }
  assert.ok(reheatHours>0);
  const csv=parseCsv(equipmentResultsCsv(rows,school,result,'Test','Local'));
  assert.equal(csv[0].length,csv[1].length);csv.slice(3).forEach(r=>assert.equal(r.length,csv[2].length));
  for(const name of ['Return_air_CFM','Supply_CFM','Cooling_coil_leaving_DB_F','Final_supply_DB_F','Reheat_electricity_kWh','Reheat_gas_therms','Operating_cooling_SHR','Deliverable_cooling_at_45F_limit_BTU_hr'])assert.ok(csv[2].includes(name));
  const comparison=parseCsv(equipmentComparisonCsv([result]));assert.equal(comparison[0].length,comparison[1].length);
  const html=renderToStaticMarkup(createElement(EquipmentScenarios,{choices:[scenario],results:[result],active:0,onActive:()=>{},onChange:()=>{}}));
  assert.match(html,/dedicated reheat output/);assert.match(html,/Airflow varies within source limits/);
}
assert.equal(newScenario().airflowMode,'variable');
const shortage=solveVariableAirside([{model:COOLING_MODELS[0],heatingModel:heatingModelFor(COOLING_MODELS[0]),count:1}],rows[0],school,'bounded');
assert.ok(shortage.unmetVentilationCfm>0);near(shortage.returnCfm,0);near(shortage.outdoorCfm,shortage.cfm);
const drySizing={...sizing,rows:[rows[4]]};
const reheatShortfall=simulateEquipment([rows[1]],school,scenarios[1],prepared,drySizing);
assert.equal(reheatShortfall.reheatCapacityBtuHr,0);assert.ok(reheatShortfall.rows[0].unmetReheat>0);
const missing=simulateSchool([raw(80,null)],school);
assert.equal(simulateEquipment(missing,school,scenarios[1],prepared,sizing).rows[0].electricity,null);

// Exercise the website's default sizing path, rather than only prepared banks.
const {nearestDesignStations}=load('lib/ashrae-design-stations.ts');
const {buildDesignSizing}=load('lib/design-sizing.ts');
const response=nearestDesignStations(43.14,-89.35);
const actualDesign=buildDesignSizing(response.stations[0],school,response.source,{latitude:43.14,longitude:-89.35});
const start=performance.now();
const autosized=simulateEquipment(rows,school,scenarios[1],undefined,actualDesign);
assert.equal(autosized.error,null);assert.ok(autosized.selection);assert.match(autosized.selection.basis,/all-airflow/);
assert.ok(autosized.selection.supplyCfm>=Math.max(...actualDesign.rows.map(r=>r.ventilationCfm)));
for(const row of actualDesign.rows){
  const designAir=solveVariableAirside(autosized.selection.groups,row,school,'bounded');
  assert.ok(designAir);assert.ok(designAir.unmet<=1);near(designAir.unmetVentilationCfm,0);
}
console.log(`Variable design sizing: ${(performance.now()-start).toFixed(0)} ms, ${autosized.selection.count} units / ${autosized.selection.totalTons} tons.`);
const defaultDesign=buildDesignSizing(response.stations[0],DEFAULT_SCHOOL,response.source,{latitude:43.14,longitude:-89.35});
const defaultStart=performance.now();
const defaultResult=simulateEquipment(defaultDesign.rows,DEFAULT_SCHOOL,{...scenarios[0]},undefined,defaultDesign);
assert.equal(defaultResult.error,null);assert.ok(defaultResult.selection);
assert.equal(defaultResult.summary.unknownHeatingHours,0);assert.equal(defaultResult.summary.unknownCoolingHours,0);
assert.equal(defaultResult.summary.unmetCoolingHours,0);assert.equal(defaultResult.summary.unmetReheatHours,0);
assert.ok(defaultResult.rows.every(r=>(r.unmetVentilationCfm??1)===0));
console.log(`Default 150000 ft² design sizing: ${(performance.now()-defaultStart).toFixed(0)} ms, ${defaultResult.selection.count} units / ${defaultResult.selection.totalTons} tons.`);
const weather=Array.from({length:8760},(_,i)=>{
  const d=new Date(Date.UTC(2025,0,1,i)),base=[raw(90,55),raw(72,85),raw(65,85),raw(20,60),raw(68,20)][i%5];
  return {...base,year:2025,month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours()};
});
const annualRows=simulateSchool(weather,school),annualStart=performance.now();
const annual=simulateEquipment(annualRows,school,scenarios[2],prepared,sizing);
assert.equal(annual.summary.fullYear,true);assert.equal(annual.summary.completeHours,8760);
const {annualPerformance}=load('lib/utility-billing.ts');
const purchased=annualPerformance(annual,annualRows);
near(purchased.energy,annual.summary.electricity*BTU_PER_KWH/1e6+annual.summary.gasTherms*.1,1e-6);
near(annual.summary.heatingElectricity,annual.rows.reduce((s,r)=>s+r.heatingElectricity,0),1e-6);
assert.ok(annual.summary.reheatElectricity>0);assert.ok(annual.summary.gasTherms>0);
assert.ok(annual.summary.reheatElectricity<=annual.summary.heatingElectricity);
console.log(`Annual variable-airflow simulation: ${(performance.now()-annualStart).toFixed(0)} ms for 8760 hours.`);
console.log('PASS: all 7192 source points, 46 sizes/families, shared airflow capacity, SHR, fan cubic law/HP limits, airflow and moisture balances, supply temperature reporting, reheat fuels, backup, stages and CSVs.');
