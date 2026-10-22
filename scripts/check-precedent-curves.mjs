import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateCooling } from './evaluate-precedent-curves.mjs';

const bundle=JSON.parse(readFileSync(new URL('../outputs/precedent-cooling/curve-fits.json',import.meta.url),'utf8'));
const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
assert.equal(bundle.models.filter(m=>m.equipment==='heat pump').length,24);
for(const model of bundle.models){
  near(model.fixed_cfm,480*model.nominal_tons);
  const reference=evaluateCooling(model,95,67,80);
  assert.equal(reference.status,'calculated');near(reference.capacityNormalized,1);near(reference.grossCapacityBtuHr,model.reference_capacity_Btu_hr);
  assert.equal(evaluateCooling(model,94,60,80).status,'unavailable');
  assert.equal(evaluateCooling(model,94,67,91).status,'unavailable');
  assert.equal(evaluateCooling(model,NaN,67,80).status,'unavailable');
  for(let outdoor=85;outdoor<=125;outdoor+=2)for(let wet=61;wet<=73;wet+=2)for(let dry=75;dry<=90;dry+=1){
    const result=evaluateCooling(model,outdoor,wet,dry);
    if(result.status==='calculated'){assert.ok(result.capacityNormalized>0);assert.ok(result.grossCapacityBtuHr>0);assert.ok(result.shr>=0&&result.shr<=1);}
    else {assert.equal(result.capacityNormalized,null);assert.equal(result.grossCapacityBtuHr,null);assert.equal(result.shr,null);}
  }
  if(model.equipment==='heat pump'&&model.nominal_tons===25){
    assert.equal(evaluateCooling(model,125,67,90).status,'unavailable');
    assert.equal(evaluateCooling(model,120,67,87.5).status,'calculated');
    assert.equal(evaluateCooling(model,120,67,88).status,'unavailable');
  }
}
const standard10=bundle.models.find(m=>m.id==='heat-pump-standard-10ton');
assert.equal(evaluateCooling(standard10,120,67,80).status,'calculated');assert.equal(evaluateCooling(standard10,125,67,80).status,'unavailable');
const fixture=bundle.models.find(m=>m.id==='heat-pump-standard-6ton');
near(evaluateCooling(fixture,95,67,80).grossCapacityBtuHr,79300);
assert.equal(evaluateCooling(fixture,95,61,90).shr,1);
assert.equal(evaluateCooling(undefined,95,67,80).status,'unavailable');
console.log(`Precedent checks passed: ${bundle.models.length} models, fixed airflow, reference normalization, three-input evaluation, dense-domain physical bounds, manufacturer gaps, and no extrapolation.`);
