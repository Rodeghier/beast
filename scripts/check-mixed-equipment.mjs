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


const {COOLING_MODELS}=load('lib/packaged-cooling.ts');
const {DEFAULT_SCHOOL,simulateSchool,celsius}=load('lib/school.ts');
const {optimizePackagedBank}=load('lib/packaged-optimizer.ts');
const {bankRatings,bankCooling,bankHeating,dispatchCooling,dispatchHeating}=load('lib/packaged-bank.ts');
const {simulateEquipment,equipmentResultsCsv,equipmentComparisonCsv,BTU_PER_KWH}=load('lib/equipment-model.ts');
const {newScenario}=load('lib/equipment.ts');
const {parseCsv}=load('lib/csv.ts');
const {equipmentUtilization}=load('lib/equipment-utilization.ts');
const {nearestDesignStations}=load('lib/ashrae-design-stations.ts');
const {buildDesignSizing}=load('lib/design-sizing.ts');
const {mixAir,airContext}=load('lib/mixed-air.ts');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const weather=[{year:2025,month:1,day:7,hour:12,minute:0,temperature:celsius(95),humidity:50,dhi:0,dni:0,ghi:0}];
const school={...DEFAULT_SCHOOL,floorAreaFt2:1000,people:1,ventilationArea:0,ventilationPerson:0};
const raw=simulateSchool(weather,school)[0];
const fixture={...raw,occupied:true,ventilationCfm:0,freeFloatF:75,temperatureF:95,heating:0,sensibleCooling:-56000,latentCooling:-21000,totalCooling:-77000,coolBalance:56000};
const original=[...COOLING_MODELS];
try {
 // Controlled constant-output curves: 3 tons => 36,000 and 4 tons => 60,000
 // gross BTU/hr, both SHR .75. Real rating/fan lookups remain in use.
 const constant=tons=>({...original.find(m=>m.efficiency==='standard'&&m.nominal_tons===tons),reference_capacity_Btu_hr:tons===3?36000:60000,capacity_coefficients:[1,0,0,0,0,0,0,0,0,0],shr_numerator_coefficients:[.75,0,0,0],shr_capacity_coefficients:[1,0,0,0,0,0,0,0,0,0],valid_domain_halfspaces:[]});
 COOLING_MODELS.splice(0,COOLING_MODELS.length,constant(3),constant(4));
 const selected=optimizePackagedBank([fixture],school,'standard','gas');
 assert.equal(selected.count,2);assert.equal(selected.totalTons,7);assert.equal(selected.groups.length,2);assert.equal(selected.optimizationComplete,true);near(selected.designLoading.latentCooling,.875);assert.equal(selected.designLoading.heating,null);
 // Independent exhaustive integer enumeration verifies both objective levels.
 const feasible=[];
 for(let n3=0;n3<=3;n3++)for(let n4=0;n4<=3;n4++){
  if(!n3&&!n4)continue;
  const q=36000*n3+60000*n4;
  if(q*.75-bankRatings([{model:constant(3),count:n3},{model:constant(4),count:n4}]).fanHeat>=56000&&q*.25>=21000)feasible.push({count:n3+n4,tons:3*n3+4*n4});
 }
 feasible.sort((a,b)=>a.count-b.count||a.tons-b.tons);assert.deepEqual({count:selected.count,tons:selected.totalTons},feasible[0]);
 const hugeEmpty={...fixture,occupied:false,heating:1e9,coolBalance:1e9,sensibleCooling:-1e9,latentCooling:-1e9,totalCooling:-2e9,ventilationCfm:1e7};
 const withEmpty=optimizePackagedBank([fixture,hugeEmpty],school,'standard','gas');assert.equal(withEmpty.count,selected.count);assert.equal(withEmpty.totalTons,selected.totalTons);
 assert.equal(optimizePackagedBank([hugeEmpty],school,'standard','gas'),null);
 const sizing={rows:[fixture,hugeEmpty],basis:'Occupied mixed-bank fixture',metadata:{},error:null};
 const scenario={...newScenario('resistance'),cooling:'heat-pump'};
 const result=simulateEquipment([fixture],school,scenario,selected,sizing);
 assert.equal(result.error,null);assert.equal(result.heatingCapacityBtuHr,0);near(result.rows[0].availableCooling,96000);near(result.rows[0].coolingShr,.75);near(result.rows[0].unmetCooling,0);
 const chiller=simulateEquipment([fixture],school,{...scenario,cooling:'air-cooled-chiller'},undefined,sizing);
 near(chiller.coolingCapacityTons,77000/12000);assert.equal(chiller.heatingCapacityBtuHr,0);
 const gas=simulateEquipment([fixture],school,{...newScenario('gas'),cooling:'heat-pump',gasEfficiencyPercent:90},selected,sizing);
 assert.equal(gas.heatingCapacityBtuHr,0);
 const ratings=bankRatings(selected.groups),row=result.rows[0];
 near(row.fanElectricity,ratings.fanKw);near(row.fanHeat,ratings.fanHeat);near(row.electricity,row.heatingElectricity+row.coolingElectricity+row.fanElectricity);
 const mixed=mixAir(airContext(fixture,school),selected.supplyCfm);
 const cool=bankCooling(selected.groups,95,mixed.wetF,mixed.dryF,'bounded');
 const operation=dispatchCooling(cool,56000+ratings.fanHeat,21000);near(row.coolingElectricity,operation.electricity);
 near(row.coolingCop,(96000-ratings.fanHeat)/(BTU_PER_KWH*ratings.coolingSystemKw));
 near(equipmentUtilization(result,'cooling').power[0],100*row.coolingElectricity/ratings.coolingNonfanKw);
 const csv=parseCsv(equipmentResultsCsv([fixture],school,result,'Fixture','CST'));
 const groupMeta=JSON.parse(csv[1][csv[0].indexOf('Installed_groups')]);assert.equal(groupMeta.length,2);assert.deepEqual(groupMeta.map(g=>g.nominalTons),[4,3]);
 assert.equal(JSON.parse(csv[1][csv[0].indexOf('Shared_cooling_capacity_curve')]).id,'shared-normalized-cooling-capacity-v1');
 assert.match(csv[1][csv[0].indexOf('Zone_load_allocation')],/Fixed nominal-tonnage shares/);
 const hourlyHeader=csv.find(r=>r.includes('Equipment_group_performance_JSON'));assert.ok(hourlyHeader);
 assert.equal(JSON.parse(row.groupPerformance).cooling.length,2);assert.ok(JSON.parse(row.groupPerformance).cooling.every(g=>g.staging.unitCount===g.count));
 const comparison=parseCsv(equipmentComparisonCsv([result]));assert.equal(comparison[0].length,comparison[1].length);assert.equal(comparison[1][comparison[0].indexOf('Nominal_tons_each')],'');
 // Mixed heating uses individual curves and stage duty, with fan counted once.
 const hp=bankHeating(selected.groups,47,70,'bounded'),heat=dispatchHeating(hp,30000);
 near(hp.capacity,hp.evaluated.reduce((s,v)=>s+v.g.count*v.point.capacityBtuHr,0));near(heat.delivered,30000);
 const heatingFixture={...fixture,temperature:celsius(47),temperatureF:47,freeFloatF:70,heating:30000+ratings.fanHeat,coolBalance:-1e6,sensibleCooling:0,latentCooling:0,totalCooling:0};
 const heating=simulateEquipment([heatingFixture],school,newScenario(),selected,{...sizing,rows:[heatingFixture]});near(heating.rows[0].electricity,heat.electricity+ratings.fanKw);near(heating.rows[0].unmetHeating,0);
 // A large occupied winter load is diagnostic only. It cannot enlarge a
 // cooling-selected heat-pump bank, and unmet heat must remain explicit.
 const extremeHeat={...heatingFixture,heating:1e9,heatBalance:1e9};
 const coolingOnly=optimizePackagedBank([fixture,extremeHeat],school,'standard','heat-pump');
 assert.deepEqual(coolingOnly.groups.map(g=>[g.model.id,g.count]),selected.groups.map(g=>[g.model.id,g.count]));
 assert.ok(coolingOnly.designLoading.heating>1);assert.equal(coolingOnly.verifiedHeatingHours,1);
 const heatShortfall=simulateEquipment([extremeHeat],school,newScenario(),coolingOnly,{...sizing,rows:[fixture,extremeHeat]});
 assert.ok(heatShortfall.rows[0].unmetHeating>9e8);assert.ok(Number.isFinite(heatShortfall.rows[0].electricity));
 // Constant-output curves isolate airflow from thermal sizing: ventilation
 // above installed supply must not force extra units or erase cooling checks.
 const highVent={...fixture,ventilationCfm:50000};
 const ventBank=optimizePackagedBank([highVent],school,'standard','heat-pump');
 assert.deepEqual(ventBank.groups.map(g=>[g.model.id,g.count]),selected.groups.map(g=>[g.model.id,g.count]));
 assert.ok(ventBank.supplyCfm<highVent.ventilationCfm);near(ventBank.designLoading.ventilation,50000/ventBank.supplyCfm);
 near(ventBank.designLoading.latentCooling,.875);assert.equal(ventBank.unverifiedCoolingHours,0);
 const ventResult=simulateEquipment([highVent],school,newScenario(),ventBank,{...sizing,rows:[highVent]});
 near(ventResult.rows[0].outdoorAirFraction,1);near(ventResult.rows[0].unmetVentilationCfm,50000-ventBank.supplyCfm);
 near(ventResult.rows[0].unmetCooling,0);assert.ok(Number.isFinite(ventResult.rows[0].electricity));
 const ventCsv=parseCsv(equipmentResultsCsv([highVent],school,ventResult,'Fixture','CST'));
 const ventHeader=ventCsv.findIndex(r=>r.includes('Unmet_ventilation_CFM'));
 near(Number(ventCsv[ventHeader+1][ventCsv[ventHeader].indexOf('Unmet_ventilation_CFM')]),50000-ventBank.supplyCfm);
 const {EquipmentScenarios:VentScenarios}=load('components/equipment-scenarios.tsx');
 const ventHtml=renderToStaticMarkup(createElement(VentScenarios,{choices:[ventResult.scenario],results:[ventResult],onChange:()=>{},active:0,onActive:()=>{}}));
 assert.match(ventHtml,/Sized for sensible and latent cooling only/);assert.match(ventHtml,/Peak airflow shortfall/);
 // Availability is ignored, rather than used to prefer a larger covered bank.
 COOLING_MODELS[0]={...COOLING_MODELS[0],valid_domain_halfspaces:[[0,0,0,1]]};
 const ignored=optimizePackagedBank([fixture],school,'standard','gas','strict');assert.equal(ignored.count,1);assert.equal(ignored.totalTons,3);assert.equal(ignored.unverifiedCoolingHours,1);
 const unknown=simulateEquipment([fixture],school,{...scenario,rangeMode:'strict'},ignored,sizing);assert.equal(unknown.rows[0].coolingElectricity,null);
 const {EquipmentScenarios}=load('components/equipment-scenarios.tsx');
 const html=renderToStaticMarkup(createElement(EquipmentScenarios,{choices:[scenario],results:[result],onChange:()=>{},active:0,onActive:()=>{}}));assert.match(html,/4 ton/);assert.match(html,/3 ton/);assert.match(html,/2 units/);
} finally {COOLING_MODELS.splice(0,COOLING_MODELS.length,...original);}
// Compare the real catalog against exhaustive enumeration for small banks.
// Ventilation is zero in these fixtures, so mixed entering air is independent
// of bank airflow; capacities can be independently summed for every combination.
for(const [s,l] of [[50000,10000],[250000,30000],[350000,40000]]){
 const row={...fixture,coolBalance:s,sensibleCooling:-s,latentCooling:-l,totalCooling:-s-l};
 const available=original.filter(m=>m.efficiency==='standard');
 const {heatingModelFor}=load('lib/packaged-heating.ts');
 let best=null;
 const walk=(start,groups,left)=>{
  if(groups.length){
   const cooling=bankCooling(groups,95,mixAir(airContext(row,school),1e7).wetF,75,'bounded'),ratings=bankRatings(groups);
   if(cooling&&dispatchCooling(cooling,s+ratings.fanHeat,l).unmet<=1){
    const count=groups.reduce((n,g)=>n+g.count,0),tons=groups.reduce((n,g)=>n+g.count*g.model.nominal_tons,0);
    if(!best||count<best.count||count===best.count&&tons<best.tons)best={count,tons};
   }
  }
  if(!left)return;
  for(let i=start;i<available.length;i++)walk(i,[...groups,{model:available[i],heatingModel:heatingModelFor(available[i]),count:1}],left-1);
 };
 walk(0,[],3);assert.ok(best,`No small-bank oracle for ${s}/${l}`);
 const chosen=optimizePackagedBank([row],school,'standard','gas');
 assert.equal(chosen.optimizationComplete,true);assert.deepEqual({count:chosen.count,tons:chosen.totalTons},best);
}
// Exercise the actual worker message contract, including duplicate sizing reuse.
let workerReply;
const previousPost=globalThis.postMessage,previousMessage=globalThis.onmessage;
try {
 globalThis.postMessage=response=>{workerReply=response;};load('lib/equipment-sizing.worker.ts');
 globalThis.onmessage({data:{rows:[fixture],school,requests:'gas:standard:true:bounded:automatic|gas:standard:true:bounded:automatic|gas:standard:false:bounded:automatic'}});
 assert.equal(workerReply.error,null);assert.deepEqual(workerReply.selections[0],workerReply.selections[1]);assert.equal(workerReply.selections[2],null);
}finally {globalThis.postMessage=previousPost;globalThis.onmessage=previousMessage;}
const response=nearestDesignStations(43.14,-89.35),station=response.stations[0],site={latitude:43.14,longitude:-89.35};
const reduced=buildDesignSizing(station,DEFAULT_SCHOOL,response.source,site),full=buildDesignSizing(station,{...DEFAULT_SCHOOL,summerPercent:100},response.source,site);
assert.equal(reduced.rows.length,40);assert.ok(reduced.rows.every(r=>r.occupied&&r.hour>=7&&r.hour<17));
assert.ok(reduced.rows.filter(r=>r.month>=6&&r.month<=8).every(r=>r.occupants===120));
assert.ok(full.metadata.Design_total_cooling_load_BTU_hr>reduced.metadata.Design_total_cooling_load_BTU_hr);
const closed=buildDesignSizing(station,{...DEFAULT_SCHOOL,summerPercent:0},response.source,site);assert.ok(closed.rows.every(r=>r.month<6||r.month>8));

if(process.argv.includes('--built-worker')){
 const directory=resolve(root,'dist/client/_next/static');
 const file=readdirSync(directory).find(name=>/^equipment-sizing\.worker-.*\.js$/.test(name));assert.ok(file,'Production worker asset missing');
 const chunks=resolve(directory,'chunks');
 const pageCode=readdirSync(chunks).filter(name=>name.startsWith('page-')&&name.endsWith('.js')).map(name=>readFileSync(resolve(chunks,name),'utf8')).join('\n');
 assert.ok(pageCode.includes(file),'Page does not reference the bundled worker');
 assert.doesNotMatch(pageCode,/new Worker\(new URL\([^)]*file:\/\/\/ROOT/,'Worker URL must resolve in the browser, not on the build filesystem');
 let reply;
 const context={postMessage:value=>{reply=value;}};
 // Exercise the actual browser bundle without replacing its curves or solver.
 runInNewContext(readFileSync(resolve(directory,file),'utf8'),context,{timeout:10000});
 const winter={...fixture,temperature:celsius(47),temperatureF:47,freeFloatF:70,heating:1e9,coolBalance:-1e6,sensibleCooling:0,latentCooling:0,totalCooling:0};
 context.onmessage({data:{rows:[fixture,winter],school,requests:'heat-pump:standard:true:bounded:automatic|gas:standard:true:bounded:automatic'}});
 assert.equal(reply.error,null);
 const expected=optimizePackagedBank([fixture,winter],school,'standard','heat-pump'),actual=reply.selections[0];
 assert.equal(actual.count,reply.selections[1].count);assert.equal(actual.totalTons,reply.selections[1].totalTons);assert.ok(actual.designLoading.heating>1);
 assert.equal(actual.count,expected.count);assert.equal(actual.totalTons,expected.totalTons);assert.equal(actual.optimizationComplete,true);
 assert.equal(JSON.stringify(actual.designLoading),JSON.stringify(expected.designLoading));
 assert.equal(JSON.stringify(actual.groups.map(g=>[g.model.id,g.count])),JSON.stringify(expected.groups.map(g=>[g.model.id,g.count])));
 const largeRow={...fixture,coolBalance:900000,sensibleCooling:-900000,latentCooling:-200000,totalCooling:-1100000};
 context.onmessage({data:{rows:[largeRow],school,requests:'gas:standard:true:bounded:automatic'}});
 const largeExpected=optimizePackagedBank([largeRow],school,'standard','gas'),largeActual=reply.selections[0];
 assert.equal(reply.error,null);assert.equal(largeActual.count,largeExpected.count);assert.ok(largeActual.groups.some(g=>g.model.nominal_tons>25));
 assert.equal(JSON.stringify(largeActual.groups.map(g=>[g.model.id,g.count])),JSON.stringify(largeExpected.groups.map(g=>[g.model.id,g.count])));
 assert.equal(largeActual.groups[0].model.capacityCurveId,'shared-normalized-cooling-capacity-v1');
 console.log('PASS: compiled production worker is self-contained and matches the source selector.');
}
console.log('PASS: mixed integer objective against exhaustive counts, occupied-only design, seasonal reduction, ignored unknown checks, individual curves/stages/fans, energy reconciliation, utilization, UI and exports.');
