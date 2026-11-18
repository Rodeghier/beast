/** Check final-state humidity/temperature control rather than only fitted SHR. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),cache=new Map();
function load(path){
  let file=resolve(root,path);if(!existsSync(file))file+='.ts';
  if(file.endsWith('.json'))return JSON.parse(readFileSync(file,'utf8'));
  if(cache.has(file))return cache.get(file).exports;
  const loaded={exports:{}};cache.set(file,loaded);
  const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  const localRequire=name=>name.startsWith('.')?load(resolve(dirname(file),name)):require(name);
  new Function('require','module','exports',outputText)(localRequire,loaded,loaded.exports);return loaded.exports;
}
const {coolingForAirState,leavingAirState,solveVariableAirside}=load('lib/variable-airside.ts');
const {DEFAULT_SCHOOL,simulateSchool,celsius,humidityRatio}=load('lib/school.ts');
const {COOLING_MODELS}=load('lib/packaged-cooling.ts');
const {heatingModelFor}=load('lib/packaged-heating.ts');
const {newScenario}=load('lib/equipment.ts');
const {simulateEquipment,equipmentResultsCsv}=load('lib/equipment-model.ts');
const {optimizePackagedBank}=load('lib/packaged-optimizer.ts');
const {parseCsv}=load('lib/csv.ts');
const near=(a,b,t=.02)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,`${a} != ${b}`);
const dryF=75,cfm=900,w=humidityRatio(celsius(dryF),70),w60=humidityRatio(celsius(60),100);

// A high provisional SHR gives a supersaturated leaving state. At the target,
// required energy is independently the sensible change plus moisture removal.
const sensibleNeed=1.08*cfm*(dryF-60);
const expectedCooling=sensibleNeed+4760*cfm*(w-w60);
const temperature=coolingForAirState(dryF,w,cfm,50000,.9,sensibleNeed,0);
near(temperature.delivered,expectedCooling,.03);near(temperature.leaving.dryF,60,1e-5);
near(temperature.required,temperature.delivered);
assert.ok(temperature.delivered>sensibleNeed/.9);
near(temperature.leaving.sensible+temperature.leaving.latent,temperature.delivered);

// Latent control can need LESS cooling than latent/(1-SHR): condensation in
// the saturation correction changes the split. Avoid unnecessary reheat.
const latent=coolingForAirState(dryF,w,cfm,50000,.9,0,15000);
near(latent.leaving.latent,15000,.03);assert.ok(latent.delivered<40000);
assert.ok(leavingAirState(dryF,w,cfm,latent.delivered-1,.9).latent<15000);

const insufficient=coolingForAirState(dryF,w,cfm,20000,.9,sensibleNeed,0);
near(insufficient.delivered,20000);assert.ok(insufficient.leaving.dryF>60);
assert.equal(insufficient.required,null);
const lowTemperatureLimit=coolingForAirState(dryF,w,cfm,100000,.9,0,1e6);
near(lowTemperatureLimit.leaving.dryF,45,1e-5);
assert.ok(lowTemperatureLimit.delivered<100000);assert.ok(lowTemperatureLimit.leaving.latent<1e6);
assert.ok(lowTemperatureLimit.leaving.humidityRatio>=0);

// Ordinary unsaturated source states keep the direct analytical answer.
const linear=coolingForAirState(80,humidityRatio(celsius(80),30),1200,30000,1,12000,0);
near(linear.delivered,12000);near(linear.leaving.sensible,12000);near(linear.leaving.latent,0);

// Air above the former dew-point threshold does not cause a cooling call on
// its own. Supply temperature remains an outcome for the user to track.
assert.ok(w>humidityRatio(celsius(55),100));
const noLoad=coolingForAirState(dryF,w,cfm,50000,.9,0,0);
near(noLoad.delivered,0);near(noLoad.leaving.dryF,dryF);

// Check sensible/latent control through humid-weather operating conditions.
const model=COOLING_MODELS.find(m=>m.nominal_tons===3&&m.efficiency==='standard');
const groups=[{model,heatingModel:heatingModelFor(model),count:1}];
let cases=0;
for(const temp of [55,65])for(const rh of [60,90,100])for(const people of [0,10])for(const lightingW of [0,.5,1.5]){
  const school={...DEFAULT_SCHOOL,floorAreaFt2:1000,stories:1,people,indoorRh:70,lightingW,equipmentW:0};
  const row=simulateSchool([{year:2025,month:5,day:5,hour:12,minute:0,temperature:celsius(temp),humidity:rh,dhi:0,dni:0,ghi:0}],school)[0];
  const air=solveVariableAirside(groups,row,school,'bounded');assert.ok(air);
  for(const d of air.details){
    const full=leavingAirState(d.mixed.dryF,d.mixed.humidityRatio,d.cfm,d.deliverableCapacity,d.shr);
    const canMeet=full.sensible>=d.sensibleNeed&&full.latent>=d.latentNeed;
    if(canMeet)assert.ok(d.unmet<1);
    near(d.deliveredSensible+d.deliveredLatent,d.delivered,.03);
    assert.ok(d.delivered<=d.deliverableCapacity+.01);
    cases++;
  }
}
const humidSchool={...DEFAULT_SCHOOL,floorAreaFt2:1000,stories:1,people:0,indoorRh:70,lightingW:1.5,equipmentW:0,ventilationArea:.8};
const humidRows=simulateSchool([{year:2025,month:5,day:5,hour:12,minute:0,temperature:celsius(75),humidity:100,dhi:0,dni:0,ghi:0}],humidSchool);
const selection=optimizePackagedBank(humidRows,humidSchool,'standard','resistance');
const scenario={...newScenario('resistance'),cooling:'heat-pump'};
const sizing={rows:humidRows,basis:'Humidity-control fixture',metadata:{},error:null};
const result=simulateEquipment(humidRows,humidSchool,scenario,selection,sizing),hour=result.rows[0];
assert.equal(result.error,null);
assert.ok(hour.coilLeavingDryF>55);assert.ok(hour.reheatDelivered>0);
assert.ok(Math.abs(hour.coolingShr-hour.coolingOperatingShr)>.001);
const csv=parseCsv(equipmentResultsCsv(humidRows,humidSchool,result,'Test','Local'));
near(Number(csv[3][csv[2].indexOf('Cooling_coil_leaving_DB_F')]),hour.coilLeavingDryF,1e-10);
near(Number(csv[3][csv[2].indexOf('Final_supply_DB_F')]),hour.supplyDryF,1e-10);
assert.ok(!csv[2].some(header=>header.includes('55F')));
const metadata=Object.fromEntries(csv[0].map((key,i)=>[key,csv[1][i]]));
assert.match(metadata.Supply_temperature_basis,/no fixed supply-temperature target/);
assert.match(metadata.Cooling_power_basis,/Supply-fan power varies with operating airflow/);
near(Number(csv[3][csv[2].indexOf('Cooling_SHR')]),hour.coolingShr,1e-10);
near(Number(csv[3][csv[2].indexOf('Operating_cooling_SHR')]),hour.coolingOperatingShr,1e-10);
near(hour.availableSensibleCooling+hour.availableLatentCooling,hour.deliverableCooling);
console.log(`PASS: load-driven cooling without a fixed supply target, temperature CSV outputs, sensible/latent control, true capacity limits, 45 F floor and ${cases} humid-weather cases.`);
