/** Verify published design conditions, load generation and fixed annual equipment sizing. */
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



const {COOLING_MODELS,SOURCE_COOLING_MODELS,SHARED_COOLING_CAPACITY,coolingPoint}=load('lib/packaged-cooling.ts');
const {EXTENDED_UNIT_TONS}=load('lib/catalog-sizes.ts');
const {heatingModelFor,heatingPoint}=load('lib/packaged-heating.ts');
const {unitRatingFor}=load('lib/unit-ratings.ts');
const {compressorStages,matchesPackagedScenario,packagedCompressorOperation}=load('lib/precedent-stages.ts');
const {zonedSystemOperation}=load('lib/equipment-staging.ts');
const {bankCooling,dispatchCooling,dispatchHeating}=load('lib/packaged-bank.ts');
const {equipmentOperation}=load('lib/equipment-operation.ts');
const {newScenario}=load('lib/equipment.ts');
const {parseCsv}=load('lib/csv.ts');
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const {intellipakHeating}=load('lib/intellipak-performance.ts');
const {airflowCoolingPoint}=load('lib/airflow-cooling.ts');
const {operatingHeatingPoint}=load('lib/curve-evaluation.ts');
assert.equal(COOLING_MODELS.length,54);
assert.deepEqual(EXTENDED_UNIT_TONS,[30,40,50,55,60,70,75,90,105,115,130]);
for(const family of ['standard','high']){
 const base=COOLING_MODELS.find(m=>m.nominal_tons===25&&m.efficiency===family);
 for(const model of COOLING_MODELS.filter(m=>m.efficiency===family)){
  near(coolingPoint(model,95,67,80).normalized,1);
  if(!model.intellipak){
   assert.deepEqual(model.capacity_coefficients,SHARED_COOLING_CAPACITY.capacity_coefficients);
   near(coolingPoint(model,105,67,80).normalized,coolingPoint(base,105,67,80).normalized);
   const original=SOURCE_COOLING_MODELS.find(m=>m.id===model.id);
   for(const temperatures of [[95,67,80],[105,61,85],[115,73,75]])near(coolingPoint(model,...temperatures).shr,coolingPoint(original,...temperatures).shr);
   continue;
  }
  const scale=model.nominal_tons/25,rating=unitRatingFor(model),baseRating=unitRatingFor(base);
  for(const key of ['cooling_system_power_kW','inferred_supply_fan_heat_Btu_hr','inferred_supply_fan_power_kW','cooling_non_supply_fan_power_kW'])near(rating[key],scale*baseRating[key]);
  near(rating.cooling_system_power_kW,rating.inferred_supply_fan_power_kW+rating.cooling_non_supply_fan_power_kW);
  const h=heatingPoint(heatingModelFor(model),17,65),hb=heatingPoint(heatingModelFor(base),17,65);
  near(h.powerKw,scale*hb.powerKw);assert.ok(h.capacityBtuHr>0);
  assert.ok(compressorStages(family,model.nominal_tons).length>=4);assert.equal(rating.scaledFromNominalTons,25);
 }
}
const standard=tons=>COOLING_MODELS.find(m=>m.nominal_tons===tons&&m.efficiency==='standard');
const large=standard(130);
assert.equal(large.table,65);
assert.deepEqual(compressorStages('standard',130),[.23,.46,.73,1]);
assert.deepEqual(compressorStages('standard',30),[.21,.39,.61,.79,1]);
assert.deepEqual(compressorStages('high',30),[.23,.38,.62,.77,1]);
assert.deepEqual(compressorStages('high',75),[.20,.46,.73,1]);
const eflex=COOLING_MODELS.find(m=>m.table===53);
const eflexHp=COOLING_MODELS.find(m=>m.table===54);
assert.equal(matchesPackagedScenario(eflex,'high','variable','heat-pump'),false);
assert.equal(matchesPackagedScenario(eflexHp,'high','variable','heat-pump'),true);
assert.equal(matchesPackagedScenario(eflex,'standard','variable','gas'),true);
assert.equal(matchesPackagedScenario(eflexHp,'standard','automatic','heat-pump'),false);
near(coolingPoint(eflexHp,95,67,80).capacityBtuHr,739000);
near(coolingPoint(eflexHp,115,67,80).capacityBtuHr,645000);
const eMod=packagedCompressorOperation(eflexHp,'cooling',37,100,1);
near(eMod.modulatingCapacityFraction,.37);near(eMod.partialUnitRuntimeFraction,1);near(eMod.powerEquivalentUnits,.37);
const lowMod=packagedCompressorOperation(eflexHp,'cooling',7.5,100,1);
near(lowMod.modulatingCapacityFraction,.15);near(lowMod.partialUnitRuntimeFraction,.5/.925);near(lowMod.powerEquivalentUnits,.15*.5/.925);
assert.ok(lowMod.belowMinimumStage);
const heatMod=packagedCompressorOperation(large,'heating',37,100,1);
near(heatMod.modulatingCapacityFraction,.37);near(heatMod.powerEquivalentUnits,.37);
assert.equal(unitRatingFor({nominal_tons:130,efficiency:'high'}),null);
const ratedCooling=coolingPoint(large,95,67,80);
near(ratedCooling.capacityBtuHr,1502000);near(ratedCooling.shr,1166/1502);
const airflowPoint=airflowCoolingPoint(large,95,67,80,39000,'strict');
near(airflowPoint.capacityBtuHr,1477000);near(airflowPoint.shr,1070/1477);
const halfway=airflowCoolingPoint(large,95,67,80,41000,'strict');
near(halfway.capacityBtuHr,(1477000+1492000)/2);
near(halfway.shr,(1070+1127)/(1477+1492));
assert.equal(airflowCoolingPoint(large,80,67,80,39000,'strict'),null);
assert.equal(airflowCoolingPoint(large,80,67,80,30000,'bounded'),null);
assert.ok(airflowCoolingPoint(large,80,67,80,39000,'bounded').boundaryEstimate);
near(intellipakHeating(60,45,70,24000),711000);
near(intellipakHeating(60,47,70,24000),733000);
near(intellipakHeating(130,47,70,52000),733000*130/60);
const source55=heatingModelFor(standard(55));
assert.deepEqual(source55.intellipak.tables,[70,71]);
assert.equal(source55.intellipak.scaledFromTons,undefined);
const largeHeating=heatingModelFor(large);
assert.equal(largeHeating.intellipak.scaledFromTons,60);
near(heatingPoint(largeHeating,47,70).capacityBtuHr,intellipakHeating(60,47,70,46000*60/130)*130/60);
assert.equal(operatingHeatingPoint(largeHeating,-5,70,'strict'),null);
assert.equal(operatingHeatingPoint(largeHeating,-5,70,'bounded').curveOutdoorF,0);
// Independent weighted normal equations check the shared anchored least-squares
// fit against accepted source samples, rather than merely reloading coefficients.
const csv=parseCsv(readFileSync(resolve(root,'public/references/packaged-cooling-source-data.csv'),'utf8'));
const field=(r,key)=>r[csv[0].findIndex(k=>k.replace(/^\uFEFF/,'')===key)];
const samples=csv.slice(1).filter(r=>field(r,'capacity_normalized'));
const counts=new Map();for(const r of samples)counts.set(field(r,'table'),(counts.get(field(r,'table'))??0)+1);
const equations=Array(9).fill(0);
for(const r of samples){
 const x=(Number(field(r,'outdoor_dry_bulb_F'))-95)/20,y=(Number(field(r,'entering_wet_bulb_F'))-67)/6,z=(Number(field(r,'entering_dry_bulb_F'))-80)/10;
 const terms=[1,x,y,z,x*x,x*y,x*z,y*y,y*z,z*z];
 const residual=terms.reduce((s,t,i)=>s+t*SHARED_COOLING_CAPACITY.capacity_coefficients[i],0)-Number(field(r,'capacity_normalized'));
 for(let i=0;i<9;i++)equations[i]+=residual*terms[i+1]/counts.get(field(r,'table'));
}
assert.equal(samples.length,SHARED_COOLING_CAPACITY.source_fit.points);equations.forEach(v=>near(v,0,1e-10));
assert.ok(SHARED_COOLING_CAPACITY.source_fit.relative_rmse_percent<2);
// Every zone gets 5% load, rather than one full unit and 19 shed units.
const stages=compressorStages("standard",30), minimum=stages[0], part=.05/minimum, runtime=part/(1-.15*(1-part));
const op=zonedSystemOperation(100,100,20,stages);
assert.equal(op.fullUnits,0);assert.equal(op.idleUnits,0);assert.equal(op.partialUnits,20);near(op.partialUnitLoadFraction,.05);
near(op.partialUnitRuntimeFraction,runtime);near(op.powerEquivalentUnits,20*minimum*runtime);
const model=COOLING_MODELS.find(m=>m.nominal_tons===30&&m.efficiency==='standard'),group={model,heatingModel:heatingModelFor(model),count:20};
const result={scenario:newScenario(),selection:{groups:[group],count:20},rows:[{coolingElectricity:1,groupPerformance:JSON.stringify({cooling:[{model:model.id,staging:op}]})}],error:null};
const histogram=equipmentOperation(result,'cooling');assert.equal(histogram.includedUnitHours,20);assert.equal(histogram.idleUnitHoursExcluded,0);
near(histogram.onUnitHours,20*runtime);near(histogram.offUnitHours,20*(1-runtime));near(histogram.stages[1].unitHours,20*runtime);
near(histogram.stages.reduce((s,b)=>s+b.unitHours,0),20);assert.equal(histogram.minutes.reduce((s,b)=>s+b.on,0),20);
const first=equipmentOperation(result,'cooling',{scope:'unit',unit:1}),last=equipmentOperation(result,'cooling',{scope:'unit',unit:20});
assert.deepEqual(first,last);near(first.onUnitHours,runtime);
assert.equal(zonedSystemOperation(2000,100,20,stages).fullUnits,20);assert.equal(zonedSystemOperation(0,100,20,stages).idleUnits,20);
// 30-ton and 130-ton units retain fixed nominal-tonnage load shares.
const groups=[{...group,count:2},{model:large,heatingModel:heatingModelFor(large),count:1}];
const bank=bankCooling(groups,95,67,80,'bounded'),dispatch=dispatchCooling(bank,90000,20000);
near(dispatch.unmet,0);
for(const detail of dispatch.details){const g=groups.find(g=>g.model.id===detail.model);near(detail.zoneShare,g.count*g.model.nominal_tons/190);assert.equal(detail.staging.partialUnits,g.count);assert.equal(detail.staging.idleUnits,0);}
// A zone shortfall cannot be covered using spare output from a different zone.
const smallGroups=[3,4].map(tons=>{const model=COOLING_MODELS.find(m=>m.nominal_tons===tons&&m.efficiency==='standard');return {model,heatingModel:heatingModelFor(model),count:1};});
const evaluated=smallGroups.map((g,i)=>({g,rating:unitRatingFor(g.model),point:{capacityBtuHr:(i===0?40000:4000)+unitRatingFor(g.model).inferred_supply_fan_heat_Btu_hr,powerKw:10}}));
const heating=dispatchHeating({evaluated},20000);near(heating.delivered,20000*3/7+4000);assert.ok(heating.delivered<20000);
const cooling=dispatchCooling({evaluated:evaluated.map((v,i)=>({...v,point:{capacityBtuHr:i===0?40000:4000,shr:.75}}))},15000,5000);
near(cooling.unmet,20000*4/7-4000);
console.log('PASS: pooled-fit normal equations, 54 catalog models, IntelliPak cooling and heating data and extrapolation, local compressor cycling for all assigned zones, no cross-zone capacity transfer, and unit-hour conservation.');
