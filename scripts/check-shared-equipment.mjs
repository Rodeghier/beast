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
const {compressorStages}=load('lib/precedent-stages.ts');
const {zonedSystemOperation}=load('lib/equipment-staging.ts');
const {bankCooling,dispatchCooling,dispatchHeating}=load('lib/packaged-bank.ts');
const {equipmentOperation}=load('lib/equipment-operation.ts');
const {newScenario}=load('lib/equipment.ts');
const {parseCsv}=load('lib/csv.ts');
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
assert.equal(COOLING_MODELS.length,46);
assert.deepEqual(EXTENDED_UNIT_TONS,[30,40,55,60,70,75,90,105,120,130,150]);
for(const family of ['standard','high']){
 const base=COOLING_MODELS.find(m=>m.nominal_tons===25&&m.efficiency===family);
 for(const model of COOLING_MODELS.filter(m=>m.efficiency===family)){
  assert.deepEqual(model.capacity_coefficients,SHARED_COOLING_CAPACITY.capacity_coefficients);
  near(coolingPoint(model,95,67,80).normalized,1);
  near(coolingPoint(model,105,67,80).normalized,coolingPoint(base,105,67,80).normalized);
  const original=SOURCE_COOLING_MODELS.find(m=>m.nominal_tons===model.nominal_tons&&m.efficiency===family)??SOURCE_COOLING_MODELS.find(m=>m.nominal_tons===25&&m.efficiency===family);
  for(const temperatures of [[95,67,80],[105,61,85],[115,73,75]])near(coolingPoint(model,...temperatures).shr,coolingPoint(original,...temperatures).shr);
  if(model.nominal_tons<=25)continue;
  const scale=model.nominal_tons/25,rating=unitRatingFor(model),baseRating=unitRatingFor(base);
  near(coolingPoint(model,105,67,80).capacityBtuHr,scale*coolingPoint(base,105,67,80).capacityBtuHr);
  for(const key of ['cooling_system_power_kW','inferred_supply_fan_heat_Btu_hr','inferred_supply_fan_power_kW','cooling_non_supply_fan_power_kW'])near(rating[key],scale*baseRating[key]);
  near(rating.cooling_system_power_kW,rating.inferred_supply_fan_power_kW+rating.cooling_non_supply_fan_power_kW);
  const h=heatingPoint(heatingModelFor(model),17,65),hb=heatingPoint(heatingModelFor(base),17,65);
  near(h.capacityBtuHr,scale*hb.capacityBtuHr);near(h.powerKw,scale*hb.powerKw);near(h.cop,hb.cop);
  assert.deepEqual(compressorStages(family,model.nominal_tons),compressorStages(family,25));assert.equal(rating.scaledFromNominalTons,25);
 }
}
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
const stages=[.25,.37,.63,1],runtime=.2/.88;
const op=zonedSystemOperation(100,100,20,stages);
assert.equal(op.fullUnits,0);assert.equal(op.idleUnits,0);assert.equal(op.partialUnits,20);near(op.partialUnitLoadFraction,.05);
near(op.partialUnitRuntimeFraction,runtime);near(op.powerEquivalentUnits,20*.25*runtime);
const model=COOLING_MODELS.find(m=>m.nominal_tons===30&&m.efficiency==='standard'),group={model,heatingModel:heatingModelFor(model),count:20};
const result={scenario:newScenario(),selection:{groups:[group],count:20},rows:[{coolingElectricity:1,groupPerformance:JSON.stringify({cooling:[{model:model.id,staging:op}]})}],error:null};
const histogram=equipmentOperation(result,'cooling');assert.equal(histogram.includedUnitHours,20);assert.equal(histogram.idleUnitHoursExcluded,0);
near(histogram.onUnitHours,20*runtime);near(histogram.offUnitHours,20*(1-runtime));near(histogram.stages[1].unitHours,20*runtime);
near(histogram.stages.reduce((s,b)=>s+b.unitHours,0),20);assert.equal(histogram.minutes.reduce((s,b)=>s+b.on,0),20);
const first=equipmentOperation(result,'cooling',{scope:'unit',unit:1}),last=equipmentOperation(result,'cooling',{scope:'unit',unit:20});
assert.deepEqual(first,last);near(first.onUnitHours,runtime);
assert.equal(zonedSystemOperation(2000,100,20,stages).fullUnits,20);assert.equal(zonedSystemOperation(0,100,20,stages).idleUnits,20);
// 30-ton and 150-ton units retain fixed nominal-tonnage load shares.
const large=COOLING_MODELS.find(m=>m.nominal_tons===150&&m.efficiency==='standard');
const groups=[{...group,count:2},{model:large,heatingModel:heatingModelFor(large),count:1}];
const bank=bankCooling(groups,95,67,80,'bounded'),dispatch=dispatchCooling(bank,bank.sensible*.1,bank.latent*.1);
near(dispatch.unmet,0);
for(const detail of dispatch.details){const g=groups.find(g=>g.model.id===detail.model);near(detail.zoneShare,g.count*g.model.nominal_tons/210);assert.equal(detail.staging.partialUnits,g.count);assert.equal(detail.staging.idleUnits,0);near(detail.staging.partialUnitLoadFraction,.1);}
// A zone shortfall cannot be covered using spare output from a different zone.
const smallGroups=[3,4].map(tons=>{const model=COOLING_MODELS.find(m=>m.nominal_tons===tons&&m.efficiency==='standard');return {model,heatingModel:heatingModelFor(model),count:1};});
const evaluated=smallGroups.map((g,i)=>({g,rating:unitRatingFor(g.model),point:{capacityBtuHr:(i===0?40000:4000)+unitRatingFor(g.model).inferred_supply_fan_heat_Btu_hr,powerKw:10}}));
const heating=dispatchHeating({evaluated},20000);near(heating.delivered,20000*3/7+4000);assert.ok(heating.delivered<20000);
const cooling=dispatchCooling({evaluated:evaluated.map((v,i)=>({...v,point:{capacityBtuHr:i===0?40000:4000,shr:.75}}))},15000,5000);
near(cooling.unmet,20000*4/7-4000);
console.log('PASS: pooled-fit normal equations, all 46 sizes/families, large-unit scaling and provenance, local compressor cycling for all assigned zones, no cross-zone capacity transfer, and unit-hour conservation.');
