/** Verify published design conditions, load generation and fixed annual equipment sizing. */
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

const {nearestDesignStations}=load('lib/ashrae-design-stations.ts');
const {buildDesignSizing,designCoolingWeather,DESIGN_DRY_BULB_MULTIPLIERS}=load('lib/design-sizing.ts');
const {DEFAULT_SCHOOL,simulateSchool,validateSchool,humidityRatio,celsius}=load('lib/school.ts');
const {wetBulbF}=load('lib/mixed-air.ts');
const {sunVector}=load('lib/solar.ts');
const {simulateEquipment,autosizePackaged,equipmentResultsCsv,equipmentComparisonCsv}=load('lib/equipment-model.ts');
const {newScenario}=load('lib/equipment.ts');
const {parseCsv}=load('lib/csv.ts');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const site={latitude:43.14,longitude:-89.35,utcOffset:-6};
const response=nearestDesignStations(site.latitude,site.longitude),station=response.stations[0];
assert.equal(response.source.edition,2017);assert.equal(response.source.stationCount,1724);
assert.equal(station.id,'726410');near(station.distanceKm,0);assert.equal(new Set(response.stations.map(s=>s.id)).size,response.stations.length);
// Independently transcribed source-DDY conditions, not derived from our parser.
near(station.heating['99'].dryC,-18.5);near(station.cooling['1'].dryBulb.dryC,30.3);near(station.cooling['1'].dryBulb.humidityC,22.4);
near(station.cooling['1'].wetBulb.humidityC,23.8);near(station.cooling['1'].dewPoint.humidityC,22.3);
const weather=designCoolingWeather(station.cooling['1'].dryBulb,site);
assert.equal(weather.length,24);near(Math.max(...weather.map(r=>r.temperature)),30.3);near(Math.min(...weather.map(r=>r.temperature)),19.6);
for(let hour=0;hour<24;hour++){
 const r=weather[hour];near(r.temperature,30.3-10.7*DESIGN_DRY_BULB_MULTIPLIERS[hour]);
 assert.ok(r.humidity>=0&&r.humidity<=100);assert.ok(r.dni>=0&&r.dhi>=0&&r.ghi>=0);
 const up=sunVector(r,site).up;near(r.ghi,r.dni*Math.max(0,up)+r.dhi);
 if(up<=0)near(r.ghi,0);
}
assert.ok(weather.some(r=>r.ghi>700));
const max=weather[14];near(wetBulbF(max.temperature*1.8+32,humidityRatio(max.temperature,max.humidity)),22.4*1.8+32,.001);
const sizing=buildDesignSizing(station,DEFAULT_SCHOOL,response.source,site);
assert.equal(sizing.error,null);assert.equal(sizing.rows.length,96);assert.equal(sizing.metadata.Cooling_design_percent,1);assert.equal(sizing.metadata.Heating_design_percent,99);
assert.ok(sizing.rows.every(r=>r.heating!==null&&r.totalCooling!==null));
const winter=sizing.rows.slice(0,24),summer=sizing.rows.slice(24);
assert.ok(winter.every(r=>r.heatingSetpointF===70&&r.totalCooling===0));
assert.ok(summer.every(r=>r.heating===0));assert.ok(summer.filter(r=>r.hour>=7&&r.hour<17).every(r=>r.occupants===1200));
// Winter capacity takes no credit for people, lighting or plug heat.
const winterWithGains=buildDesignSizing(station,{...DEFAULT_SCHOOL,lightingW:5,equipmentW:10,sensiblePerson:1000},response.source,site);
assert.deepEqual(winterWithGains.rows.slice(0,24).map(r=>r.heating),winter.map(r=>r.heating));
const colder=buildDesignSizing(station,{...DEFAULT_SCHOOL,heatingDesignPercent:99.6,coolingDesignPercent:.4},response.source,site);
assert.ok(colder.metadata.Design_heating_load_BTU_hr>sizing.metadata.Design_heating_load_BTU_hr);
assert.ok(colder.metadata.Cooling_design_DB_F>sizing.metadata.Cooling_design_DB_F);
assert.match(validateSchool({...DEFAULT_SCHOOL,coolingDesignPercent:.5}),/Select a listed/);
assert.equal(buildDesignSizing(undefined,DEFAULT_SCHOOL,response.source,site).rows.length,0);
// Use a small building to make the fixed-installation/extreme-hour test transparent.
const school={...DEFAULT_SCHOOL,floorAreaFt2:1000,stories:1,people:0,ventilationArea:0,ventilationPerson:0,lightingW:0,equipmentW:0};
const smallSizing=buildDesignSizing(station,school,response.source,site);
const annual=simulateSchool([{year:2025,month:1,day:7,hour:12,minute:0,temperature:celsius(20),humidity:20,dhi:0,dni:0,ghi:0}],school,site);
const extreme={...annual[0],year:2040,heating:1e8,heatBalance:1e8};
for(const heating of ['heat-pump','gas','resistance']){
 const scenario={...newScenario(heating),cooling:'heat-pump',gasEfficiencyPercent:90};
 const normal=simulateEquipment(annual,school,scenario,undefined,smallSizing);
 const spike=simulateEquipment([...annual,extreme],school,scenario,undefined,smallSizing);
 assert.equal(normal.error,null);assert.equal(spike.error,null);assert.ok(normal.selection);
 assert.equal(spike.selection.count,normal.selection.count);assert.equal(spike.selection.model.id,normal.selection.model.id);
 assert.equal(spike.heatingCapacityBtuHr,normal.heatingCapacityBtuHr);assert.ok(spike.rows[1].unmetHeating>1e7);
 const unavailable=simulateEquipment(annual,school,scenario);assert.match(unavailable.error,/design-day/);assert.equal(unavailable.selection,null);assert.equal(unavailable.heatingCapacityBtuHr,null);
}
const chillerScenario={...newScenario('resistance'),cooling:'air-cooled-chiller'};
const normalChiller=simulateEquipment(annual,school,chillerScenario,undefined,smallSizing);
const coolingSpike={...annual[0],heating:0,coolBalance:1e8,sensibleCooling:-1e8,latentCooling:0,totalCooling:-1e8};
const spikeChiller=simulateEquipment([coolingSpike],school,chillerScenario,undefined,smallSizing);
assert.equal(spikeChiller.coolingCapacityTons,normalChiller.coolingCapacityTons);assert.ok(spikeChiller.rows[0].unmetCooling>1e7);
// An annual cooling spike also leaves the heat-pump installation unchanged.
const hpScenario=newScenario(),baseHp=simulateEquipment(annual,school,hpScenario,undefined,smallSizing);
const coolingHp=simulateEquipment([{...coolingSpike,temperatureF:95,temperature:celsius(95)}],school,hpScenario,undefined,smallSizing);
assert.equal(coolingHp.selection.count,baseHp.selection.count);assert.equal(coolingHp.selection.model.id,baseHp.selection.model.id);assert.ok(coolingHp.rows[0].unmetCooling>1e7);
const largeScenario={...newScenario('gas'),boilerSizeClass:'large',cooling:'air-cooled-chiller'};
const largeBase=simulateEquipment(annual,school,largeScenario,undefined,smallSizing),largeSpike=simulateEquipment([extreme],school,largeScenario,undefined,smallSizing);
assert.equal(largeSpike.heatingCapacityBtuHr,largeBase.heatingCapacityBtuHr);assert.ok(largeSpike.rows[0].unmetHeating>1e7);
const noChillerDesign=simulateEquipment(annual,school,chillerScenario);
assert.equal(noChillerDesign.coolingCapacityTons,null);assert.equal(noChillerDesign.rows[0].coolingElectricity,null);
// Regression: selection minimizes installed nominal tonnage before unit count.
const fixture={...annual[0],heating:0,coolBalance:40000,sensibleCooling:-40000,latentCooling:-10000,totalCooling:-50000,temperatureF:95,freeFloatF:75,coolingSetpointF:75};
const selected=autosizePackaged([fixture],school,'standard','gas');assert.ok(selected);assert.equal(selected.count,2);assert.equal(selected.model.nominal_tons,4);assert.equal(selected.totalTons,8);
const hp=simulateEquipment(annual,school,newScenario(),undefined,smallSizing);
const comparison=parseCsv(equipmentComparisonCsv([hp]));assert.equal(comparison[0].length,comparison[1].length);
assert.equal(comparison[1][comparison[0].indexOf('Design_station_WMO')],'726410');
const csv=parseCsv(equipmentResultsCsv(annual,school,hp,'Madison','CST',site));
assert.ok(csv[1][csv[0].indexOf('Design_station_WMO')]==='726410');
assert.ok(csv[1][csv[0].indexOf('Cooling_design_percent')]==='1');
const {DesignSizingSummary}=load('components/design-sizing-summary.tsx');
const html=renderToStaticMarkup(createElement(DesignSizingSummary,{design:response,station,sizing,school:DEFAULT_SCHOOL,onStation:()=>{}}));
assert.match(html,/ASHRAE 2017/);assert.match(html,/Cooling 1%/);assert.match(html,/Heating 99%/);assert.match(html,/design-weather-station/);
const {AnalysisAssumptions}=load('components/analysis-assumptions.tsx');
const inputHtml=renderToStaticMarkup(createElement(AnalysisAssumptions,{school:DEFAULT_SCHOOL,onSchool:()=>{}}));
assert.equal((inputHtml.match(/<details/g)||[]).length,1);assert.match(inputHtml,/<select[^>]*id="input-coolingDesignPercent"/);assert.match(inputHtml,/<option value="1" selected="">1%/);
const {GET}=load('app/api/design-conditions/route.ts');
assert.equal((await GET(new Request('http://localhost/api/design-conditions'))).status,400);
assert.equal((await GET(new Request('http://localhost/api/design-conditions?latitude=43.14&longitude=-89.35'))).status,200);
assert.equal((await GET(new Request('http://localhost/api/design-conditions?latitude=24&longitude=-125'))).status,422);
console.log('PASS: ASHRAE station source, independent conditions, daily profiles, psychrometrics, solar, design schedules, sizing independence, unmet loads, missing-data behavior, API, controls and exports.');

