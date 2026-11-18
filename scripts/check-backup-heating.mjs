/** Regression checks for mandatory backup, switchover dispatch and energy exports. */
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
const {DEFAULT_SCHOOL,simulateSchool,celsius}=load('lib/school.ts');
const {newScenario,validateBackup,BOILER_FUEL_NAMES}=load('lib/equipment.ts');
const {simulateEquipment,equipmentResultsCsv,equipmentComparisonCsv,BTU_PER_KWH}=load('lib/equipment-model.ts');
const {equipmentOperation,equipmentOperationCsv}=load('lib/equipment-operation.ts');
const {equipmentUtilization}=load('lib/equipment-utilization.ts');
const {parseCsv}=load('lib/csv.ts');
const {EquipmentScenarios}=load('components/equipment-scenarios.tsx');
const near=(a,b,t=1e-7)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,`${a} != ${b}`);
const school=DEFAULT_SCHOOL;
const raw=simulateSchool([{year:2025,month:1,day:7,hour:12,minute:0,temperature:celsius(47),humidity:50,dhi:0,dni:0,ghi:0}],school)[0];
const heat={...raw,occupied:true,ventilationCfm:0,freeFloatF:70,heating:100000,heatBalance:100000,coolBalance:-1e6,sensibleCooling:0,latentCooling:0,totalCooling:0};
const cool={...heat,temperatureF:95,temperature:celsius(95),freeFloatF:75,heating:0,heatBalance:-1e6,coolBalance:60000,sensibleCooling:-60000,latentCooling:-20000,totalCooling:-80000};
const sizing={rows:[heat,cool],basis:'Controlled design fixture',metadata:{},error:null};
const electric={...newScenario(),airflowMode:'fixed',reheatOption:undefined,backupHeating:'resistance',backupSwitchoverF:20};
const selected=simulateEquipment([heat],school,electric,undefined,sizing);
assert.equal(selected.error,null);assert.ok(selected.selection);
const run=(rows,scenario=electric)=>simulateEquipment(rows,school,scenario,selected.selection,sizing);
const weather=(temperatureF,heating=50000)=>({...heat,temperatureF,temperature:celsius(temperatureF),heating,heatBalance:heating});
assert.deepEqual(Object.keys(BOILER_FUEL_NAMES),['natural-gas']);
assert.match(validateBackup(newScenario()),/temperature/);
for(const value of [null,NaN,Infinity])assert.match(validateBackup({...electric,backupSwitchoverF:value}),/temperature/);
for(const value of [null,0,101,NaN])assert.match(validateBackup({...electric,backupHeating:'gas',backupGasEfficiencyPercent:value}),/efficiency/);
assert.equal(validateBackup(newScenario('gas')),null);
const invalid=run([heat],newScenario());assert.ok(invalid.error);assert.equal(invalid.rows[0].electricity,null);assert.equal(invalid.summary.fullYear,false);

for(const backupHeating of ['resistance','gas']){
  const scenario={...electric,backupHeating,backupGasEfficiencyPercent:80,rangeMode:'strict'};
  const rows=[weather(20.01),weather(20),weather(-20),weather(-20,0),weather(-20,150000)];
  const result=run(rows,scenario),[above,equal,cold,idle,overload]=result.rows;
  assert.equal(above.backupActive,false);assert.ok(above.heatingElectricity>0);near(above.backupDeliveredHeating,0);
  for(const row of [equal,cold]){
    assert.equal(row.backupActive,true);assert.equal(row.heatingBoundaryEstimate,false);assert.equal(row.heatingCurveOutdoorF,null);
    const output=50000-row.fanHeat;
    near(row.backupDeliveredHeating,output);near(row.deliveredHeating,50000);near(row.unmetHeating,0);
    near(row.heatingElectricity,backupHeating==='resistance'?output/BTU_PER_KWH:0);
    near(row.gasTherms,backupHeating==='gas'?output/80000:0);
    near(row.backupGasTherms,row.gasTherms);near(row.backupHeatingElectricity,row.heatingElectricity);
    near(row.boilerFuelConsumption,row.gasTherms);near(row.boilerFuelInputBtu,row.gasTherms*100000);
    near(row.electricity,row.heatingElectricity+row.coolingElectricity+row.fanElectricity);
    assert.equal(row.heatingStage,'Off');assert.equal(row.heatingOnMinutes,'0.0');
  }
  near(idle.backupDeliveredHeating,0);near(idle.gasTherms,0);near(idle.heatingElectricity,0);
  near(overload.backupDeliveredHeating,result.backupHeatingCapacityBtuHr);assert.ok(overload.unmetHeating>0);
  const operation=equipmentOperation({...result,rows:[cold]},'heating',{scope:'all'});
  near(operation.onUnitHours,0);near(operation.offUnitHours,result.selection.groups[0].count);
  const utilization=equipmentUtilization({...result,rows:[cold]},'heating');near(utilization.capacity[0],0);near(utilization.power[0],0);
  const csv=parseCsv(equipmentResultsCsv(rows,school,result,'Test','Local'));
  assert.equal(csv[0].length,csv[1].length);csv.slice(3).forEach(row=>assert.equal(row.length,csv[2].length));
  assert.ok(csv[2].includes('Wet_bulb_F'));assert.ok(!csv[2].includes('Dew_point_F'));
  const header=csv[2],cell=name=>csv[4][header.indexOf(name)];
  assert.equal(cell('Backup_active'),'true');near(Number(cell('Backup_gas_input_therms')),equal.gasTherms);
  near(Number(cell('Backup_heating_electricity_kWh')),equal.heatingElectricity);
  const operationCsv=equipmentOperationCsv({...result,rows:[cold]});
  operationCsv.headers.forEach((name,i)=>{if(/Heating.*_on_minutes_per_unit$/.test(name))near(operationCsv.values(cold)[i],0);});
  const comparison=parseCsv(equipmentComparisonCsv([result]));assert.equal(comparison[0].length,comparison[1].length);
  assert.equal(comparison[1][comparison[0].indexOf('Backup_switchover_outdoor_F')],'20');
  const html=renderToStaticMarkup(createElement(EquipmentScenarios,{choices:[scenario],results:[result],active:0,onActive:()=>{},onChange:()=>{}}));
  assert.match(html,/Required backup heat/);assert.match(html,/Switchover outdoor temperature/);assert.doesNotMatch(html,/Propane|light oil/);
  assert.match(html,/id="[^"]+-backup"[^>]*required/);assert.match(html,/id="[^"]+-switchover"[^>]*required/);
}
// A normal heat-pump call above the cutoff still reports its capacity shortfall.
assert.ok(run([weather(47,1e8)]).rows[0].unmetHeating>0);
// Missing dependent inputs must not turn backup demand into known zero energy.
const unknown=run([{...weather(-20),heating:null}]);assert.equal(unknown.rows[0].backupHeatingElectricity,null);assert.equal(unknown.rows[0].electricity,null);
const {annualPerformance}=load('lib/utility-billing.ts');
for(const backupHeating of ['gas','resistance']){
  const year=Array.from({length:8760},(_,i)=>{
    const d=new Date(Date.UTC(2025,0,1,i));
    return {...weather(i%2?-20:47),year:2025,month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours()};
  });
  const annual=run(year,{...electric,backupHeating,backupGasEfficiencyPercent:80});
  assert.equal(annual.summary.fullYear,true);assert.equal(annual.summary.completeHours,8760);
  const expectedGas=annual.rows[1].gasTherms*4380;
  near(annual.summary.gasTherms,expectedGas,1e-5);
  near(annual.summary.electricity,(annual.rows[0].electricity+annual.rows[1].electricity)*4380,1e-5);
  const performance=annualPerformance(annual,year);
  near(performance.energy,annual.summary.electricity*BTU_PER_KWH/1e6+expectedGas*.1,1e-6);
  near(performance.months.reduce((sum,m)=>sum+m.gasTherms,0),expectedGas,1e-5);
}
console.log('PASS: required backup configuration, inclusive cutoff, strict cold operation, electric/gas balances, fan credit, design capacity, shortfalls, compressor-off charts, controls and CSVs.');
