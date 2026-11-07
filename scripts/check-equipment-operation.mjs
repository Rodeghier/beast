/** Independent unit-stage timing, histogram conservation and presentation checks. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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



const {stagedSystemOperation,stageTimeFractions,stagedPowerFraction}=load('lib/equipment-staging.ts');
const {equipmentOperation,operationSources}=load('lib/equipment-operation.ts');
const {COOLING_MODELS}=load('lib/packaged-cooling.ts');
const {heatingModelFor}=load('lib/packaged-heating.ts');
const {compressorStages}=load('lib/precedent-stages.ts');
const {unitRatingFor}=load('lib/unit-ratings.ts');
const {equipmentUtilization}=load('lib/equipment-utilization.ts');
const {newScenario}=load('lib/equipment.ts');
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const stages=[.32,.68,1],runtime=.5/.925;
const op=stagedSystemOperation(216,100,20,stages);
assert.equal(op.fullUnits,2);assert.equal(op.idleUnits,17);near(op.partialUnitLoadFraction,.16);near(op.partialUnitRuntimeFraction,runtime);near(op.powerEquivalentUnits,2+.32*runtime);
assert.equal(op.belowMinimumStage,true);near(op.partialUnitStageTimes[0],runtime);assert.equal(op.partialUnitStageTimes[2],0);
const between=stageTimeFractions(.5,stages);near(between[0],.5);near(between[1],.5);near(between.reduce((s,t)=>s+t,0),1);
const single=stagedSystemOperation(10,100,1,[1]);near(single.partialUnitRuntimeFraction,.1/.865);
for(const model of COOLING_MODELS){
 const levels=compressorStages(model.efficiency,model.nominal_tons);
 for(const plr of [0,.01,levels[0]/2,levels[0],...levels.slice(1).map((v,i)=>(v+levels[i])/2),1]){
  const operation=stagedSystemOperation((2+plr)*1000,1000,5,levels);
  assert.equal(operation.fullUnits+operation.idleUnits+(operation.partialUnitLoadFraction>0?1:0),5);
  near(operation.partialUnitStageTimes.reduce((s,t)=>s+t,0),operation.partialUnitRuntimeFraction);
  near(operation.fullUnits+operation.partialUnitStageTimes.reduce((s,t,i)=>s+t*levels[i],0),operation.powerEquivalentUnits);
  near(operation.powerEquivalentUnits,2+stagedPowerFraction(plr,levels));
  assert.ok(operation.partialUnitRuntimeFraction>=0&&operation.partialUnitRuntimeFraction<=1+1e-7);
 }
}
const model=COOLING_MODELS.find(m=>m.nominal_tons===8.5&&m.efficiency==='standard');
const rating=unitRatingFor(model),group={model,heatingModel:heatingModelFor(model),count:20};
const row={coolingElectricity:rating.cooling_non_supply_fan_power_kW*op.powerEquivalentUnits,heatingElectricity:0,deliveredCooling:216,availableCooling:2000,groupPerformance:JSON.stringify({cooling:[{model:model.id,count:20,staging:op}]})};
const result={scenario:newScenario(),selection:{groups:[group],count:20,designLoading:{heating:1,sensibleCooling:.1,latentCooling:.5,ventilation:.05}},rows:[row],error:null};
near(equipmentUtilization(result,'cooling').capacity[0],10.8);
// The user's low-bank-utilization case: one full-stage unit in a 20-unit bank
// is 5% bank output, while the unit-stage histogram correctly reports full stage.
const one=stagedSystemOperation(100,100,20,stages);
const oneRunning={...result,rows:[{...row,deliveredCooling:100,coolingElectricity:rating.cooling_non_supply_fan_power_kW,groupPerformance:JSON.stringify({cooling:[{model:model.id,staging:one}]})}]};
near(equipmentUtilization(oneRunning,'cooling').capacity[0],5);
const oneHistogram=equipmentOperation(oneRunning,'cooling');assert.equal(oneHistogram.includedUnitHours,1);near(oneHistogram.stages[3].percent,100);assert.equal(oneHistogram.offUnitHours,0);
const running=equipmentOperation(result,'cooling');
assert.equal(running.includedUnitHours,3);assert.equal(running.idleUnitHoursExcluded,17);near(running.stages[0].unitHours,1-runtime);near(running.stages[1].unitHours,runtime);near(running.stages[3].unitHours,2);
near(running.onUnitHours,2+runtime);near(running.offUnitHours,1-runtime);assert.equal(running.cyclingUnitHours,1);
near(running.cyclingOnMinutes,60*runtime);near(running.cyclingOffMinutes,60*(1-runtime));
assert.equal(running.minutes[4].on,1);assert.equal(running.minutes[3].off,1);assert.equal(running.minutes[6].on,2);assert.equal(running.minutes[0].off,2);
const all=equipmentOperation(result,'cooling',{scope:'all'});
assert.equal(all.includedUnitHours,20);near(all.stages[0].unitHours,18-runtime);near(all.onUnitHours+all.offUnitHours,20);
near(all.stages.reduce((s,stage)=>s+stage.unitHours,0),20);near(all.stages.reduce((s,stage)=>s+stage.percent,0),100);
assert.equal(all.minutes.reduce((s,bin)=>s+bin.on,0),20);assert.equal(all.minutes.reduce((s,bin)=>s+bin.off,0),20);assert.equal(all.minutes[0].on,17);assert.equal(all.minutes[6].off,17);
const lead=equipmentOperation(result,'cooling',{scope:'unit',unit:1});near(lead.stages[3].unitHours,1);assert.equal(lead.minutes[6].on,1);
const partial=equipmentOperation(result,'cooling',{scope:'unit',unit:3});near(partial.onUnitHours,runtime);near(partial.offUnitHours,1-runtime);
const idleUnit=equipmentOperation(result,'cooling',{scope:'unit',unit:4});assert.equal(idleUnit.onUnitHours,0);assert.equal(idleUnit.offUnitHours,1);assert.equal(idleUnit.minutes[6].off,1);
assert.match(equipmentOperation(result,'cooling',{scope:'unit',unit:21}).reason,/Choose a unit/);
const idle=equipmentOperation({...result,rows:[{...row,coolingElectricity:0,groupPerformance:null}]},'cooling');assert.equal(idle.includedUnitHours,0);assert.equal(idle.idleUnitHoursExcluded,20);assert.equal(idle.knownClockHours,1);
for(const bad of [{...row,coolingElectricity:null},{...row,coolingElectricity:-1},{...row,groupPerformance:'broken JSON'},{...row,groupPerformance:JSON.stringify({cooling:[{model:model.id,staging:{...op,unitCount:19}}]})}]){
 const missing=equipmentOperation({...result,rows:[row,bad]},'cooling',{scope:'all'});assert.equal(missing.knownClockHours,1);assert.equal(missing.unavailableClockHours,1);assert.equal(missing.includedUnitHours,20);
}
assert.equal(equipmentOperation({...result,error:'Invalid selection'},'cooling').unavailableClockHours,1);
const small=COOLING_MODELS.find(m=>m.nominal_tons===3&&m.efficiency==='standard');
const mixed={...result,selection:{groups:[group,{model:small,heatingModel:heatingModelFor(small),count:1}],count:21},rows:[{...row,groupPerformance:JSON.stringify({cooling:[{model:model.id,staging:op},{model:small.id,staging:single}]})}]};
const smallUnit=equipmentOperation(mixed,'cooling',{groupId:small.id,scope:'unit',unit:1});near(smallUnit.onUnitHours,.1/.865);assert.match(smallUnit.stages[1].label,/100%/);assert.equal(smallUnit.minutes[1].on,1);
const boiler={...result,scenario:{...newScenario('gas'),cooling:'heat-pump'},rows:[{boilerRuntimeFraction:.25}]};
const burner=equipmentOperation(boiler,'heating');assert.equal(burner.source.kind,'burner');near(burner.stages[0].unitHours,.75);near(burner.stages[1].unitHours,.25);near(burner.cyclingOnMinutes,15);near(burner.cyclingOffMinutes,45);
assert.ok(operationSources({...result,scenario:newScenario('resistance')},'heating').reason);
assert.ok(operationSources({...result,scenario:{...newScenario('gas'),cooling:'air-cooled-chiller'}},'cooling').reason);
const {EquipmentDistributions}=load('components/equipment-distributions.tsx');
const html=renderToStaticMarkup(createElement(EquipmentDistributions,{results:[result],active:0,onActive:()=>{}}));
for(const text of ['Equipment stages and cycling','Time at each unit stage','Unit ON/OFF time per hour','Units called to run','Individual unit','cycle lengths and starts are not resolved','Stage runtime distribution values','Hourly ON/OFF time distribution values','Highest evaluated cooling design loading','Heating and ventilation airflow are diagnostic only'])assert.ok(html.includes(text),text);
assert.match(html,/Highest evaluated cooling design loading: <strong>Latent cooling/);
const {EquipmentOperationGraphs}=load('components/equipment-operation-graphs.tsx');
const graphHtml=renderToStaticMarkup(createElement(EquipmentOperationGraphs,{data:partial}));assert.match(graphHtml,/unit-hours/);assert.match(graphHtml,/ON minutes/);
console.log('PASS: independent stage/runtime arithmetic, all catalog stages, lead/lag identities, mixed-size unit selection, time and histogram conservation, idle/missing states, boiler firing, unsupported equipment and rendered controls.');
