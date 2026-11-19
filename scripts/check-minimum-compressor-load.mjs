/**
 * OFFLINE VERIFICATION. Runs assertions against the actual source functions.
 * A failed assertion stops the command and points to the check that disagreed.
 * These checks are independent of a live provider connection. Read the handbook
 * for which engineering assumptions each check covers.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url), cache = new Map();
function load(path) {
  let file = resolve(root, path);
  if (!existsSync(file)) file += existsSync(file + ".tsx") ? ".tsx" : ".ts";
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  if (cache.has(file)) return cache.get(file).exports;
  const loadedModule = { exports: {} }; cache.set(file, loadedModule);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const localRequire = name => name.startsWith("@/") ? load(name.slice(2)) : name.startsWith(".") ? load(resolve(dirname(file), name)) : require(name);
  new Function("require", "module", "exports", outputText)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}


const { DEFAULT_SCHOOL, simulateSchool, celsius, validateSchool } = load('lib/school.ts');
const { bankCooling, bankHeating, dispatchCooling, dispatchHeating, bankRatings } = load('lib/packaged-bank.ts');
const { COOLING_MODELS } = load('lib/packaged-cooling.ts');
const { heatingModelFor } = load('lib/packaged-heating.ts');
const { unitRatingFor } = load('lib/unit-ratings.ts');
const { newScenario } = load('lib/equipment.ts');
const { airContext, mixAir } = load('lib/mixed-air.ts');
const { simulateEquipment, equipmentResultsCsv } = load('lib/equipment-model.ts');
const { parseCsv } = load('lib/csv.ts');
const { AnalysisAssumptions } = load('components/analysis-assumptions.tsx');
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
const model=COOLING_MODELS.find(m=>m.nominal_tons===3&&m.efficiency==='standard');
assert.ok(model);
const g={model,heatingModel:heatingModelFor(model),count:1},rating=unitRatingFor(model);
const heatingBank={evaluated:[{g,rating,point:{capacityBtuHr:100000+rating.inferred_supply_fan_heat_Btu_hr,powerKw:10+rating.inferred_supply_fan_power_kW}}]};
const coolingBank={evaluated:[{g,rating,point:{capacityBtuHr:100000,shr:.75}}]};

const { compressorOnMinutes, zonedSystemOperation }=load('lib/equipment-staging.ts');
// Invert runtime = r / (0.85 + 0.15*r) for independent 20-minute thresholds.
for(const stageLevels of [[1],[.5,1]]) {
  const minimumStage=stageLevels[0],r=(20/60)*.85/(1-(20/60)*.15);
  const boundary=100000*minimumStage*r;
  // Dispatch uses catalog stages (single stage for the selected 3-ton model).
  for(const q of [boundary-1,boundary,boundary+1]) {
    const op=zonedSystemOperation(q,100000,1,stageLevels);
    assert.ok(q<boundary?compressorOnMinutes(op)<20:compressorOnMinutes(op)>=20-1e-8);
  }
}
const boundary=100000*(1/3)*.85/(1-.15/3);
for(const need of [0,boundary-1,boundary,boundary+1,100000]) {
  const heat=dispatchHeating(heatingBank,need,20),cold=dispatchCooling(coolingBank,need*.75,need*.25,20);
  const off=need<boundary;
  for(const op of [heat,cold]) {
    near(op.delivered,off?0:need);
    assert.equal(op.details[0].minimumRuntimeLockout,need>0&&off);
    const minutes=compressorOnMinutes(op.details[0].staging);
    assert.ok(minutes===0||minutes>=20-1e-8);
    if(off)near(op.electricity,0);else assert.ok(op.electricity>0);
  }
}
near(dispatchCooling(coolingBank,0,1000,20).delivered,0);
assert.ok(dispatchHeating(heatingBank,1000,0).electricity>0);
assert.ok(dispatchCooling(coolingBank,750,250,0).electricity>0);
// A larger capacity can shorten runtime enough to trigger lockout.
const bigger={evaluated:[{g,rating,point:{capacityBtuHr:200000,shr:.75}}]};
near(dispatchCooling(bigger,30000,10000,20).delivered,0);
assert.ok(dispatchCooling(coolingBank,30000,10000,20).delivered>0);
// Mixed groups keep per-unit runtime checks rather than bank averages.
const mixed={evaluated:[{g,rating,point:{capacityBtuHr:200000,shr:.75}},{g:{...g,count:3},rating,point:{capacityBtuHr:20000,shr:.75}}]};
const mixedDispatch=dispatchCooling(mixed,24000,8000,20);
assert.deepEqual(mixedDispatch.details.map(d=>d.minimumRuntimeLockout),[true,false]);
near(mixedDispatch.delivered,24000);near(mixedDispatch.unmet,8000);
// Full equipment path: fan stays on, suppressed load is unmet, stage times are OFF.
const school={...DEFAULT_SCHOOL},weather={year:2025,month:7,day:7,hour:12,minute:0,temperature:35,humidity:50,dhi:0,dni:0,ghi:0};
const base={...simulateSchool([weather],school)[0],freeFloatF:80,heatingSetpointF:70,coolingSetpointF:80,ventilationCfm:0,heating:0,sensibleCooling:0,latentCooling:0,totalCooling:0};
const fan=bankRatings([g]),mix=mixAir(airContext(base,school),model.fixed_cfm),bank=bankCooling([g],95,mix.wetF,mix.dryF,'bounded');
const row={...base,coolBalance:-fan.fanHeat+.01*bank.sensible};
const selection={groups:[g],count:1,totalTons:3,supplyCfm:model.fixed_cfm,referenceHeatingBtuHr:g.heatingModel.reference_capacity_Btu_hr,referenceCoolingBtuHr:model.reference_capacity_Btu_hr,rangeMode:'bounded',designLoading:{}};
const sizing={error:null,rows:[row],metadata:{}};
const scenario={...newScenario(),airflowMode:"fixed",reheatOption:undefined,backupSwitchoverF:-100};
const result=simulateEquipment([row],school,scenario,selection,sizing),hour=result.rows[0];
assert.equal(result.error,null);near(hour.coolingElectricity,0);near(hour.deliveredCooling,0);near(hour.unmetCooling,.01*bank.sensible);
near(hour.fanElectricity,fan.fanKw);near(hour.electricity,fan.fanKw);assert.equal(hour.coolingStage,'Off');assert.equal(hour.coolingOnMinutes,'0.0');
assert.equal(hour.fanOnMinutes,60);assert.match(hour.status,/Cooling compressors held off.*20 minutes/);
assert.equal(JSON.parse(hour.groupPerformance).cooling[0].minimumRuntimeLockout,true);
assert.equal(result.summary.unmetCoolingHours,1);assert.equal(result.summary.coolingCyclingSharePercent,null);
const disabled=simulateEquipment([row],{...school,minimumCompressorOnMinutes:0},scenario,selection,sizing).rows[0];
assert.ok(disabled.coolingElectricity>0);near(disabled.unmetCooling,0);
// Heating capacity excludes fan heat; the fan still provides its credited heat.
const heatBase={...base,temperature: celsius(47),temperatureF:47,freeFloatF:70,sensibleCooling:0,totalCooling:0,coolBalance:-1e6};
const heatMix=mixAir(airContext(heatBase,school),model.fixed_cfm),heatBank=bankHeating([g],47,heatMix.dryF,'bounded');
const coilCapacity=heatBank.capacity-fan.fanHeat,heatRow={...heatBase,heating:fan.fanHeat+.01*coilCapacity};
const heatResult=simulateEquipment([heatRow],school,scenario,selection,{...sizing,rows:[heatRow]}).rows[0];
near(heatResult.heatingElectricity,0);near(heatResult.deliveredHeating,fan.fanHeat);near(heatResult.unmetHeating,.01*coilCapacity);
assert.equal(heatResult.heatingStage,'Off');assert.match(heatResult.status,/Heating compressors held off.*20 minutes/);
const csv=parseCsv(equipmentResultsCsv([row],school,result,'Test','UTC'));
const meta=Object.fromEntries(csv[0].map((key,i)=>[key,csv[1][i]]));
assert.equal(meta.Minimum_compressor_on_minutes,'20');assert.match(meta.Compressor_minimum_runtime_basis,/equality runs/);
assert.equal(DEFAULT_SCHOOL.minimumCompressorOnMinutes,20);
for(const value of [-1,61,NaN,Infinity])assert.ok(validateSchool({...school,minimumCompressorOnMinutes:value}));
const html=renderToStaticMarkup(createElement(AnalysisAssumptions,{school,onSchool:()=>{}}));
assert.match(html,/id="input-minimumCompressorOnMinutes"/);assert.match(html,/Minimum compressor ON-time/);
console.log('PASS: 20-minute heating/cooling cutoff, equality, disabled control, latent-only calls, hourly capacity, per-group dispatch, fans, unmet loads, stages, metadata and controls.');

// Regression: real UI scenarios use the physical airside path, including fixed airflow.
const { solveVariableAirside }=load('lib/variable-airside.ts');
const physicalRow={...base,occupants:0,infiltrationCfm:0,outdoorAirCfm:0,coolBalance:0};
const offOptions={airflowMode:'fixed',reheatOption:'electricity',minimumOnMinutes:0};
const reference=solveVariableAirside([g],physicalRow,school,'bounded',true,offOptions);
const light={...physicalRow,coolBalance:-reference.fanHeat+.01*reference.capacity*reference.sourceShr};
for(const reheatOption of ['electricity','natural-gas','mhgrh']) {
  const options={...offOptions,reheatOption,minimumOnMinutes:20};
  const on=solveVariableAirside([g],light,school,'bounded',true,{...options,minimumOnMinutes:0});
  assert.ok(on.delivered>0&&on.delivered/on.capacity<.05);
  const off=solveVariableAirside([g],light,school,'bounded',true,options);
  near(off.delivered,0);near(off.electricity,0);near(off.reheatNeed,0);
  assert.ok(off.unmet>0);near(off.fanKw,on.fanKw);
  const d=off.details[0];assert.equal(d.minimumRuntimeLockout,true);
  near(d.coilLeavingF,d.mixed.dryF);near(d.supplyHumidityRatio,d.mixed.humidityRatio);
  near(d.recoveryCapacity,0);near(d.staging.powerEquivalentUnits,0);
  const ui={...newScenario(),airflowMode:'fixed',reheatOption,backupSwitchoverF:-100};
  const uiResult=simulateEquipment([light],school,ui,selection,sizing),h=uiResult.rows[0];
  assert.equal(uiResult.error,null);near(h.coolingElectricity,0);near(h.deliveredCooling,0);
  near(h.reheatDelivered,0);near(h.reheatElectricity,0);near(h.reheatGasTherms,0);
  assert.ok(h.unmetCooling>0);assert.equal(h.coolingStage,'Off');
  assert.match(h.status,/Cooling compressors held off/);
  assert.equal(uiResult.summary.coolingCyclingSharePercent,null);
  const disabledResult=simulateEquipment([light],{...school,minimumCompressorOnMinutes:0},ui,selection,sizing);
  assert.ok(disabledResult.rows[0].coolingElectricity>0);
  near(uiResult.reheatCapacityBtuHr,disabledResult.reheatCapacityBtuHr);
}
// Candidate selection cannot return a positive output below the configured cutoff.
for(const airflowMode of ['fixed','variable']) {
  for(const load of [10,100,500,1000,3000]) {
    const p=solveVariableAirside([g,{...g,count:2}],{...physicalRow,coolBalance:load},school,'bounded',true,{airflowMode,minimumOnMinutes:20});
    assert.ok(p);
    for(const d of p.details)assert.ok(d.delivered===0||compressorOnMinutes(d.staging)>=20-1e-8);
  }
}
// Humidity-only demand stays unmet when the compressor is locked out.
const humidSchool={...school,latentPerson:1};
const humidityRow={...physicalRow,coolBalance:-reference.fanHeat-1000,occupants:50};
const humidOn=solveVariableAirside([g],humidityRow,humidSchool,'bounded',true,offOptions);
const humidOff=solveVariableAirside([g],humidityRow,humidSchool,'bounded',true,{...offOptions,minimumOnMinutes:20});
assert.ok(humidOn.delivered>0&&humidOn.delivered<.05*humidOn.capacity);
near(humidOff.delivered,0);assert.ok(humidOff.unmetLatent>0);near(humidOff.reheatNeed,0);
console.log('PASS: current fixed/variable airside cutoff, all reheat fuels, OFF air state, mixed groups, latent-only demand, annual status/energy and unchanged design reheat capacity.');
