/** Verify published design conditions, load generation and fixed annual equipment sizing. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
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
const {newScenario:createScenario}=load('lib/equipment.ts');
// Keep these existing heat-pump fixtures above their explicitly configured backup cutoff.
const newScenario=(heating)=>({...createScenario(heating),backupHeating:'resistance',backupSwitchoverF:-200,airflowMode:'fixed'});
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
assert.equal(sizing.error,null);assert.equal(sizing.rows.length,40);assert.equal(sizing.metadata.Cooling_design_percent,1);assert.equal(sizing.metadata.Heating_design_percent,99);
assert.ok(sizing.rows.every(r=>r.heating!==null&&r.totalCooling!==null));
const winter=sizing.rows.filter(r=>r.heating>0),summer=sizing.rows.filter(r=>r.heating===0);
assert.ok(winter.every(r=>r.heatingSetpointF===70&&r.totalCooling===0));
assert.ok(summer.every(r=>r.heating===0));assert.ok(summer.filter(r=>r.hour>=7&&r.hour<17).every(r=>r.occupants===120));
const weekendSizing=buildDesignSizing(station,{...DEFAULT_SCHOOL,weekendStartHour:18,weekendEndHour:21},response.source,site);
assert.equal(weekendSizing.rows.length,52);assert.ok(weekendSizing.rows.some(r=>r.hour===20));
const windowSizing=buildDesignSizing(station,{...DEFAULT_SCHOOL,windowU:0},response.source,site);
assert.ok(windowSizing.metadata.Design_heating_load_BTU_hr<sizing.metadata.Design_heating_load_BTU_hr);
// Winter capacity takes no credit for people, lighting or plug heat.
const winterWithGains=buildDesignSizing(station,{...DEFAULT_SCHOOL,lightingW:5,equipmentW:10,sensiblePerson:1000},response.source,site);
assert.deepEqual(winterWithGains.rows.filter(r=>r.heating>0).map(r=>r.heating),winter.map(r=>r.heating));
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
 assert.equal(spike.selection.count,normal.selection.count);assert.equal(spike.selection.groups[0].model.id,normal.selection.groups[0].model.id);
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
assert.equal(coolingHp.selection.count,baseHp.selection.count);assert.equal(coolingHp.selection.groups[0].model.id,baseHp.selection.groups[0].model.id);assert.ok(coolingHp.rows[0].unmetCooling>1e7);
const largeScenario={...newScenario('gas'),boilerSizeClass:'large',cooling:'air-cooled-chiller'};
const largeBase=simulateEquipment(annual,school,largeScenario,undefined,smallSizing),largeSpike=simulateEquipment([extreme],school,largeScenario,undefined,smallSizing);
assert.equal(largeSpike.heatingCapacityBtuHr,largeBase.heatingCapacityBtuHr);assert.ok(largeSpike.rows[0].unmetHeating>1e7);
const {cble4dRatingForPeakLoad}=load('lib/boiler-model.ts');
const largeRating=cble4dRatingForPeakLoad(largeBase.heatingCapacityBtuHr);
assert.equal(largeScenario.gasEfficiencyPercent,90);
assert.equal(largeScenario.largeBoilerEfficiencyPercent,90);
assert.ok(largeBase.rows[0].deliveredHeating>0);
near(largeBase.rows[0].gasTherms,largeBase.rows[0].deliveredHeating/90000);
const legacyLarge=simulateEquipment(annual,school,{...largeScenario,largeBoilerEfficiencyPercent:undefined},undefined,smallSizing);
near(legacyLarge.rows[0].gasTherms,largeRating.naturalGasThermsPerHr*legacyLarge.rows[0].boilerRuntimeFraction);
const largeCsv=parseCsv(equipmentResultsCsv(annual,school,largeBase,'Madison','CST',site));
assert.equal(largeCsv[1][largeCsv[0].indexOf('Boiler_thermal_efficiency_percent')],'90');
const noChillerDesign=simulateEquipment(annual,school,chillerScenario);
assert.equal(noChillerDesign.coolingCapacityTons,null);assert.equal(noChillerDesign.rows[0].coolingElectricity,null);
// Regression: selection minimizes unit count before installed nominal tonnage.
const fixture={...annual[0],heating:0,coolBalance:40000,sensibleCooling:-40000,latentCooling:-10000,totalCooling:-50000,temperatureF:95,freeFloatF:75,coolingSetpointF:75};
const selected=autosizePackaged([fixture],school,'standard','gas');assert.ok(selected);assert.equal(selected.count,1);assert.ok(selected.totalTons>=6);
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
assert.equal((inputHtml.match(/<details/g)||[]).length,2);assert.match(inputHtml,/<select[^>]*id="input-coolingDesignPercent"/);assert.match(inputHtml,/<option value="1" selected="">1%/);
assert.doesNotMatch(inputHtml,/<fieldset[^>]*disabled|type="radio"/);
assert.match(inputHtml,/id="input-windowU"[^>]*value="0.5"/);
assert.match(inputHtml,/<select[^>]*id="input-wall-material"/);
assert.match(inputHtml,/<input[^>]*id="input-interiorMassKjM2K"/);
assert.match(inputHtml,/id="input-weekendStartHour"/);
const officeHtml=renderToStaticMarkup(createElement(AnalysisAssumptions,{school:{...DEFAULT_SCHOOL,summerPercent:100},onSchool:()=>{},summerOccupancyEditable:false}));
assert.match(officeHtml,/id="input-summerPercent"[^>]*disabled[^>]*value="100"/);
const {GET}=load('app/api/design-conditions/route.ts');
assert.equal((await GET(new Request('http://localhost/api/design-conditions'))).status,400);
assert.equal((await GET(new Request('http://localhost/api/design-conditions?latitude=43.14&longitude=-89.35'))).status,200);
assert.equal((await GET(new Request('http://localhost/api/design-conditions?latitude=24&longitude=-125'))).status,422);

// Exercise the ComStock route with a small county archive and both day types.
const comstockHeaders=[
  'in.comstock_building_type','weight','in.sqft..ft2',
  'in.weekday_opening_time..hr','in.weekday_operating_hours..hr','in.weekend_opening_time..hr','in.weekend_operating_hours..hr',
  'out.params.average_window_u_value..btu_per_ft2_f_hr','out.params.average_window_shgc',
  'in.wall_construction_type','in.window_type','in.year_built','out.params.average_wall_u_value..btu_per_ft2_f_hr','out.params.average_roof_u_value..btu_per_ft2_f_hr','out.params.com_report_internal_mass_area_ratio',
];
const countyCsv=Buffer.from([
  comstockHeaders,
  ['PrimarySchool',1,58551,7.2,9.6,'',0,0.4321,0.3519,'Mass','Double pane',1985,0.0634,0.0442,2],
  ['SecondarySchool',1,76329,8,11,10,3,'',0.3521],
  ['LargeOffice',1,300450,22,8,20,5,0.6381,0.271,'Mass','Triple pane',2000],
  ['LargeOffice',3,310550,22,8,0,0,'',0.317,'SteelFramed','Double pane',2000],
  ['Warehouse',1,81000,7,9,0,0,'','','Metal Building','None',1987],
  ['Warehouse',3,91000,7,9,0,0,'','','Mass','None',1975],
  ['GroceryStore',1,50000,7,9,8,9,'','','Wood Framed','Double pane',1995],
].map(row=>row.join(',')).join('\n'));
const tarHeader=Buffer.alloc(512);
tarHeader.write(countyCsv.length.toString(8),124);
const countyArchive=gzipSync(Buffer.concat([tarHeader,countyCsv]));
const originalFetch=globalThis.fetch;
try {
  globalThis.fetch=async input=>{
    const url=new URL(input);
    if(url.hostname==='geocoding.geo.census.gov')return Response.json({result:{geographies:{Counties:[{STATE:'27',COUNTY:'053',NAME:'Hennepin'}]}}});
    if(url.searchParams.has('list-type'))return new Response(['PrimarySchool','SecondarySchool','LargeOffice','Warehouse','GroceryStore'].map(type=>`<Key>up0-G2700530-${type}.csv</Key>`).join(''));
    assert.match(url.pathname,/MN_G2700530_upgrade0_agg\.csv\.gz$/);
    return new Response(countyArchive);
  };
  const {GET:comstock}=load('app/api/comstock/route.ts');
  async function characteristics(type){
    const reply=await comstock(new Request(`http://localhost/api/comstock?latitude=44.98&longitude=-93.26&state=MN&buildingType=${type}&characteristics=true`));
    assert.equal(reply.status,200);
    return reply.json();
  }
  const schoolInput=await characteristics('PrimarySchool');
  const officeInput=await characteristics('LargeOffice');
  const secondaryInput=await characteristics('SecondarySchool');
  assert.deepEqual(schoolInput.assumptions,{floorAreaFt2:58600,windowU:.43,shgc:.35,wallU:.063,roofU:.044,startHour:7,endHour:17,weekendStartHour:0,weekendEndHour:0,summerPercent:10,interiorMassKjM2K:250,interiorMassCouplingWm2K:9});
  assert.deepEqual(secondaryInput.assumptions,{floorAreaFt2:76300,shgc:.35,startHour:8,endHour:19,weekendStartHour:10,weekendEndHour:13,summerPercent:10});
  assert.deepEqual(officeInput.assumptions,{floorAreaFt2:308000,windowU:.64,shgc:.31,startHour:22,endHour:6,weekendStartHour:20,weekendEndHour:21,summerPercent:100});
  assert.equal(schoolInput.construction.county,'Hennepin');
  assert.equal(schoolInput.construction.interiorMassAreaRatio,2);
  assert.equal(officeInput.construction.interiorMassAreaRatio,undefined);
  const {interiorMassDefaults}=load('lib/thermal-mass.ts');
  assert.equal(interiorMassDefaults('LargeOffice').interiorMassKjM2K,170);
  assert.equal(schoolInput.construction.wall.label,'Mass');
  near(schoolInput.construction.wall.arealHeatCapacityKjM2K,2240*836.8*.127/1000);
  assert.equal(officeInput.construction.wall.label,'Steel framed');
  assert.equal(officeInput.construction.wall.share,.75);
  assert.equal(officeInput.construction.window.label,'Double pane');
  assert.equal(officeInput.construction.window.share,.75);
  near(officeInput.construction.window.arealHeatCapacityKjM2K,2500*880*.012/1000);
  assert.equal(officeInput.construction.slab.label,'Slab on grade');
  assert.equal(secondaryInput.construction.wall,null);
  assert.equal(secondaryInput.construction.window,null);
  const warehouseInput=await characteristics('Warehouse');
  assert.equal(warehouseInput.construction.roof.label,'Insulation entirely above deck');
  assert.equal(warehouseInput.construction.roof.share,.75);
  assert.equal((await characteristics('Grocery')).construction.roof.source,'PNNL supermarket prototype');
  const {roofTemplateKind}=load('lib/envelope-construction.ts');
  assert.equal(roofTemplateKind('LargeOffice','CA',1985,''),'mass');
  assert.equal(roofTemplateKind('PrimarySchool','CA',1985,''),'wood-framed');
  assert.equal(roofTemplateKind('Warehouse','MN',1987,''),'metal-building');
  const imported={...DEFAULT_SCHOOL,...schoolInput.assumptions};
  const {applyEnvelopeDefaults,applyEnvelopePreset,schoolCsv}=load('lib/school.ts');
  const withConstruction=applyEnvelopeDefaults(DEFAULT_SCHOOL,{...schoolInput.assumptions,construction:schoolInput.construction});
  const changed=applyEnvelopePreset({...withConstruction,wallU:.07,wallCapacityKjM2K:234},'wall','wood-framed');
  assert.equal(changed.wallU,.055);
  assert.notEqual(changed.wallCapacityKjM2K,234);
  assert.equal(changed.roofCapacityKjM2K,withConstruction.roofCapacityKjM2K);
  const restored=applyEnvelopePreset(changed,'wall','stock');
  assert.equal(restored.wallU,.063);
  assert.equal(restored.wallCapacityKjM2K,withConstruction.wallCapacityKjM2K);
  assert.equal(applyEnvelopeDefaults(DEFAULT_SCHOOL,{construction:schoolInput.construction}).wallU,.08);
  const importedHtml=renderToStaticMarkup(createElement(AnalysisAssumptions,{school:withConstruction,onSchool:()=>{}}));
  assert.match(importedHtml,/Heavyweight concrete/);
  assert.match(importedHtml,/id="input-wallCapacityKjM2K"[^>]*value="240"/);
  assert.match(importedHtml,/0\.063/);
  assert.deepEqual(simulateSchool(annual,withConstruction,site,'heating'),simulateSchool(annual,imported,site,'heating'));
  const [fields,values]=parseCsv(schoolCsv([],withConstruction,'Minneapolis','CST'));
  assert.equal(values[fields.indexOf('Wall_construction')],'Mass');
  assert.equal(values[fields.indexOf('Wall_U_BTU_hr_ft2_F')],'0.063');
  near(Number(values[fields.indexOf('Wall_UA_BTU_hr_F')]),.063*Number(values[fields.indexOf('Opaque_wall_area_ft2')]));
  assert.equal(JSON.parse(values[fields.indexOf('Wall_representative_mass_layers')])[0].densityKgM3,2240);
  assert.equal(values[fields.indexOf('Slab_construction')],'Slab on grade');
} finally {
  globalThis.fetch=originalFetch;
}
console.log('PASS: ASHRAE station source, independent conditions, daily profiles, psychrometrics, solar, design schedules, sizing independence, unmet loads, missing-data behavior, API, controls and exports.');

