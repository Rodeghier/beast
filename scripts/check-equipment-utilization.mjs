/** Verify utilization denominators, missing-hour coverage and exact bin edges. */
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
 const module={exports:{}};cache.set(file,module);
 const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
 const localRequire=name=>name.startsWith('@/')?load(name.slice(2)):name.startsWith('.')?load(resolve(dirname(file),name)):require(name);
 new Function('require','module','exports',outputText)(localRequire,module,module.exports);return module.exports;
}
const {equipmentUtilization,utilizationDistribution}=load('lib/equipment-utilization.ts');
const {simulateEquipment:simulateEquipmentModel,BTU_PER_KWH,stagedSystemOperation}=load('lib/equipment-model.ts');
// These component fixtures explicitly serve as their own controlled design days.
const simulateEquipment=(rows,school,scenario,selection)=>simulateEquipmentModel(rows,school,scenario,selection,{rows,basis:'Controlled design fixture',metadata:{Sizing_basis:'Controlled design fixture'},error:null});
const {DEFAULT_SCHOOL,simulateSchool,celsius}=load('lib/school.ts');
const {newScenario}=load('lib/equipment.ts');
const {unitRatingFor}=load('lib/unit-ratings.ts');
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const values=[null,NaN,Infinity,-1,0,0,.001,10,10.00000000002,10.1,20,99,100,100.001];
const distribution=utilizationDistribution(values);
assert.equal(distribution.plottedHours,8);assert.equal(distribution.missingHours,4);assert.equal(distribution.zeroHours,2);
assert.equal(distribution.bins[1].hours,3);assert.equal(distribution.bins[2].hours,2);assert.equal(distribution.bins[10].hours,2);assert.equal(distribution.bins[11].hours,1);
near(distribution.bins.reduce((sum,b)=>sum+b.percentOfHours,0),100);
const withZero=utilizationDistribution(values,true);assert.equal(withZero.plottedHours,10);assert.equal(withZero.bins[0].hours,2);
assert.equal(withZero.bins.reduce((sum,b)=>sum+b.hours,0),10);
assert.ok(utilizationDistribution([null,0]).bins.every(b=>b.percentOfHours===0));
const base=simulateSchool([{year:2025,month:1,day:7,hour:12,minute:0,temperature:celsius(47),humidity:50,dhi:0,dni:0,ghi:0}],DEFAULT_SCHOOL)[0];
const heatRow={...base,temperatureF:47,freeFloatF:70,heatingSetpointF:70,coolingSetpointF:80,ventilationCfm:0,heating:15500,heatBalance:15500,coolBalance:-300000,sensibleCooling:0,latentCooling:0,totalCooling:0};
const hp=simulateEquipment([heatRow],DEFAULT_SCHOOL,newScenario());
assert.equal(hp.error,null);assert.equal(hp.selection.count,1);assert.equal(hp.selection.groups[0].model.nominal_tons,3);
const rating=unitRatingFor(hp.selection.groups[0].model),fanKw=rating.inferred_supply_fan_power_kW;
// Independent 31,000 BTU/hr / 2.6 kW full-output heating example. Fan heat is
// 1,000 BTU/hr: 16,000 delivered to the building means 15,000 from a 30,000 coil.
const heating={...hp,rows:[{...hp.rows[0],availableHeating:31000,deliveredHeating:16000,fanHeat:1000,heatingCop:31000/(BTU_PER_KWH*2.6),heatingElectricity:(2.6-fanKw)*.6}]};
near(equipmentUtilization(heating,'heating').capacity[0],50);near(equipmentUtilization(heating,'heating').power[0],60);
const cooling={...hp,rows:[{...hp.rows[0],availableCooling:100000,deliveredCooling:50000,coolingElectricity:rating.cooling_non_supply_fan_power_kW*.7,fanElectricity:99}]};
near(equipmentUtilization(cooling,'cooling').capacity[0],50);near(equipmentUtilization(cooling,'cooling').power[0],70);
const bank={...cooling,selection:{...hp.selection,count:3,groups:hp.selection.groups.map(g=>({...g,count:3}))},rows:[{...cooling.rows[0],availableCooling:300000,deliveredCooling:150000,coolingElectricity:3*rating.cooling_non_supply_fan_power_kW*.7}]};
near(equipmentUtilization(bank,'cooling').capacity[0],50);near(equipmentUtilization(bank,'cooling').power[0],70);
const idle={...hp,selection:null,rows:[{...hp.rows[0],availableCooling:null,deliveredCooling:0,coolingElectricity:0,availableHeating:null,deliveredHeating:0,heatingElectricity:0,fanHeat:0}]};
assert.deepEqual(equipmentUtilization(idle,'cooling'),{capacity:[0],power:[0]});assert.deepEqual(equipmentUtilization(idle,'heating'),{capacity:[0],power:[0]});
assert.deepEqual(equipmentUtilization({...idle,error:'Unsupported selection'},'cooling'),{capacity:[null],power:[null]});
const gap={...cooling,rows:[{...cooling.rows[0],deliveredCooling:null,coolingElectricity:null}]};
assert.deepEqual(equipmentUtilization(gap,'cooling'),{capacity:[null],power:[null]});
const noCapacity={...cooling,rows:[{...cooling.rows[0],availableCooling:null}]};assert.equal(equipmentUtilization(noCapacity,'cooling').capacity[0],null);
const boiler={...hp,scenario:{...newScenario('gas'),cooling:'heat-pump'},rows:[{...hp.rows[0],boilerPartLoadRatio:.4,boilerRuntimeFraction:.6}]};
for(const fuel of ['natural-gas','propane','light-oil']){
 const sample=equipmentUtilization({...boiler,scenario:{...boiler.scenario,boilerFuel:fuel}},'heating');near(sample.capacity[0],40);near(sample.power[0],60);
}
const resistance={...hp,scenario:newScenario('resistance'),heatingCapacityBtuHr:10*BTU_PER_KWH,rows:[{...hp.rows[0],deliveredHeating:5*BTU_PER_KWH+1000,fanHeat:1000,heatingElectricity:5}]};
near(equipmentUtilization(resistance,'heating').capacity[0],50);near(equipmentUtilization(resistance,'heating').power[0],50);
const chiller={...hp,scenario:{...newScenario('gas'),cooling:'air-cooled-chiller'},selection:null,coolingCapacityTons:100,rows:[{...hp.rows[0],availableCooling:1200000,deliveredCooling:300000,coolingElectricity:15}]};
near(equipmentUtilization(chiller,'cooling').capacity[0],25);near(equipmentUtilization(chiller,'cooling').power[0],25);
// Existing cycling behavior should be visible as a greater input fraction than
// delivered-capacity fraction at a partial load; charting must not replace it.
const actual=equipmentUtilization(hp,'heating');assert.ok(actual.power[0]>actual.capacity[0]);assert.ok(actual.power[0]<100);
const {EquipmentDistributions}=load('components/equipment-distributions.tsx');
const chartCooling={...cooling,rows:[{...cooling.rows[0],groupPerformance:JSON.stringify({cooling:[{model:hp.selection.groups[0].model.id,staging:stagedSystemOperation(50000,100000,1,[1])}]})}]};
const html=renderToStaticMarkup(createElement(EquipmentDistributions,{results:[chartCooling],active:0,onActive:()=>{}}));
assert.match(html,/Equipment stages and cycling/);assert.match(html,/Time at each unit stage/);assert.match(html,/Unit ON\/OFF time per hour/);assert.match(html,/Unit stages and ON\/OFF time/);assert.match(html,/distribution values/);assert.match(html,/Unavailable weather hours: 0/);
const errorHtml=renderToStaticMarkup(createElement(EquipmentDistributions,{results:[{...cooling,error:'Unsupported selection'}],active:0,onActive:()=>{}}));
assert.match(errorHtml,/Unavailable weather hours: 1/);assert.match(errorHtml,/No valid hourly stage data/);
const page=readFileSync(resolve(root,'app/page.tsx'),'utf8');assert.match(page,/<EquipmentDistributions results=\{comparisonResults\} active=\{activeSystem\} onActive=\{setActiveSystem\}/);
console.log('Utilization checks passed: installed capacity/input bases, fans, cycling, all heating/fuel/cooling types, idle/missing data, bin boundaries, hour conservation and rendered controls.');
