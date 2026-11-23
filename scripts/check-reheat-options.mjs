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
const {DEFAULT_SCHOOL,simulateSchool,celsius}=load('lib/school.ts');
const {newScenario}=load('lib/equipment.ts');
const {COOLING_MODELS}=load('lib/packaged-cooling.ts');
const {variableFanModel}=load('lib/variable-fan.ts');
const {solveVariableAirside}=load('lib/variable-airside.ts');
const {heatingModelFor}=load('lib/packaged-heating.ts');
const {simulateEquipment,equipmentResultsCsv,BTU_PER_KWH}=load('lib/equipment-model.ts');
const {parseCsv}=load('lib/csv.ts');
const {EquipmentScenarios}=load('components/equipment-scenarios.tsx');
const near=(a,b,t=1e-6)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,`${a} != ${b}`);
const school={...DEFAULT_SCHOOL,floorAreaFt2:10000,stories:1,people:50,ventilationPerson:10,ventilationArea:.12,lightingW:.9,equipmentW:.6};
const raw=(temperatureF,rh,extra={})=>({year:2025,month:5,day:5,hour:12,minute:0,temperature:celsius(temperatureF),humidity:rh,dhi:0,dni:0,ghi:0,...extra});
const rows=simulateSchool([raw(90,55),raw(72,85),raw(65,85),raw(20,60,{month:1,day:7}),raw(68,20)],school);
const model=COOLING_MODELS.find(m=>m.efficiency==='standard'&&m.nominal_tons===10);
const groups=[{model,heatingModel:heatingModelFor(model),count:3}];

const {mhgrhPoint}=load('lib/mhgrh.ts');
const data=load('lib/data/mhgrh.json');
for(const p of data.points){
  const nominal=p[1],efficiency=p[0]===80?'high':'standard';
  const point=mhgrhPoint({nominal_tons:nominal,efficiency},p[2],p[5],p[4],p[3],'strict');
  assert.ok(point);near(point.maxRiseF,p[9]-p[7],1e-8);near(point.minRiseF,p[8]-p[6],1e-8);
}
assert.equal(mhgrhPoint(model,80,55,70,4000,'strict'),null);
assert.equal(mhgrhPoint(model,65,55,70,2999),null);
assert.ok(mhgrhPoint(model,80,65,80,4000).boundaryEstimate);
const sizing={rows,error:null,metadata:{}},prepared={groups,count:3,totalTons:30,supplyCfm:3*variableFanModel(model).referenceCfm,referenceCoolingBtuHr:360000,referenceHeatingBtuHr:360000,verifiedCoolingHours:5,estimatedCoolingHours:0,unverifiedCoolingHours:0,verifiedHeatingHours:5,unverifiedHeatingHours:0,rangeMode:'bounded',heatingAirflowApproximation:true,includesHeatPumpHeating:true,provisional:true,optimizationComplete:false,basis:'Fixture',designLoading:{heating:0,sensibleCooling:0,latentCooling:0,ventilation:0}};
for(const airflowMode of ['variable','fixed'])for(const reheatOption of ['mhgrh','electricity','natural-gas']){
  const scenario={...newScenario(),backupSwitchoverF:30,airflowMode,reheatOption,reheatGasEfficiencyPercent:80};
  const result=simulateEquipment(rows,school,scenario,prepared,sizing);assert.equal(result.error,null);
  assert.ok(result.rows.some(r=>r.reheatNeed>0));
  for(const h of result.rows){
    assert.ok(h.electricity!==null,h.status);near(h.electricity,h.heatingElectricity+h.coolingElectricity+h.fanElectricity);
    near(h.supplyCfm,h.returnAirCfm+h.actualOutdoorAirCfm);
    near(h.reheatNeed,h.reheatDelivered+h.unmetReheat);
    if(airflowMode==='fixed')near(h.supplyCfm,prepared.supplyCfm);
    if(reheatOption==='mhgrh'){
      near(h.reheatElectricity,0);near(h.reheatGasTherms,0);
      const details=JSON.parse(h.groupPerformance).cooling;
      assert.ok(h.reheatDelivered<=details.reduce((s,d)=>s+d.recoveryCapacity,0)+1e-6);
    }else if(reheatOption==='electricity'){near(h.reheatElectricity,h.reheatDelivered/BTU_PER_KWH);near(h.reheatGasTherms,0);}
    else {near(h.reheatGasTherms,h.reheatDelivered/80000);near(h.reheatElectricity,0);assert.ok(h.gasTherms>=h.reheatGasTherms);}
  }
  const html=renderToStaticMarkup(createElement(EquipmentScenarios,{choices:[scenario],results:[result],active:0,onActive:()=>{},onChange:()=>{}}));
  assert.match(html,/MHGRH/);assert.match(html,/Constant airflow/);assert.match(html,/Reheat . required/);
  const csv=parseCsv(equipmentResultsCsv(rows,school,result,'Test','Local'));assert.equal(csv[1][csv[0].indexOf('Reheat_fuel')],reheatOption);
}
const full=solveVariableAirside(groups,rows[0],school,'bounded',true,{airflowMode:'fixed',reheatOption:'mhgrh'});
for(const d of full.details)if(d.staging.fullUnits>0)assert.ok(d.recoveryCapacity>0);
const overloaded=solveVariableAirside(groups,{...rows[0],occupants:1000000},school,'bounded',true,{airflowMode:'fixed',reheatOption:'mhgrh'});
assert.ok(overloaded.details.every(d=>d.staging.fullUnits===d.count&&d.recoveryCapacity>0),'Full compressor output must still provide recovered heat');
const constantSized=simulateEquipment(rows,school,{...newScenario('resistance'),airflowMode:'fixed'},undefined,sizing);
assert.equal(constantSized.error,null);assert.ok(constantSized.selection);
assert.ok(constantSized.rows.every(h=>h.unmetCooling<=1&&h.unmetVentilationCfm===0));
assert.equal(newScenario().reheatOption,'electricity');
assert.equal(newScenario().reheatGasEfficiencyPercent,90);
assert.equal(newScenario('gas').cooling,'heat-pump');
console.log('PASS: 2340 table knots, range limits, all six airflow/reheat combinations, recovered-heat limits, independent fuel accounting, CSV and required dropdowns.');
