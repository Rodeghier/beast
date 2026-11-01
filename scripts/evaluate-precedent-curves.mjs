/**
 * STANDALONE CURVE EVALUATOR. Reads a fitting-package JSON bundle and evaluates
 * one cooling point. It may require an ignored outputs artifact; the website
 * uses lib/packaged-cooling.ts with its committed application dataset instead.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Temperatures are °F. Airflow is fixed in the selected catalog model. */
export function evaluateCooling(model, outdoorDryBulbF, enteringWetBulbF, enteringDryBulbF) {
  const inputs = [outdoorDryBulbF, enteringWetBulbF, enteringDryBulbF];
  const unavailable = reason => ({ status: 'unavailable', reason, capacityNormalized: null, grossCapacityBtuHr: null, shr: null });
  if (!model) return unavailable('Unknown catalog model.');
  if (!inputs.every(v => typeof v === 'number' && Number.isFinite(v))) return unavailable('Supply three finite temperatures in °F.');
  if (model.valid_domain_halfspaces.some(([a,b,c,d]) => a*inputs[0]+b*inputs[1]+c*inputs[2]+d > 1e-7)) return unavailable('Outside the convex hull of valid catalog data; extrapolation is disabled.');
  const x=(inputs[0]-95)/20, y=(inputs[1]-67)/6, z=(inputs[2]-80)/10;
  const terms=[1,x,y,z,x*x,x*y,x*z,y*y,y*z,z*z];
  const capacityNormalized=model.capacity_coefficients.reduce((total,c,i) => total+c*terms[i],0);
  const numerator=model.shr_numerator_coefficients.reduce((total,b,i) => total+b*terms[i],0);
  const grossCapacityBtuHr=model.reference_capacity_Btu_hr*capacityNormalized;
  if (!(capacityNormalized>0) || !Number.isFinite(grossCapacityBtuHr) || !Number.isFinite(numerator)) return unavailable('Invalid fitted capacity or numerator.');
  return { status: 'calculated', modelId: model.id, fixedCfm: model.fixed_cfm, outdoorDryBulbF, enteringWetBulbF, enteringDryBulbF,
    capacityNormalized, grossCapacityBtuHr, shr: Math.max(0,Math.min(1,numerator/capacityNormalized)), warnings: model.warnings };
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const adjacent=new URL('./curve-fits.json',import.meta.url);
  const source=existsSync(adjacent) ? adjacent : new URL('../outputs/precedent-cooling/curve-fits.json',import.meta.url);
  const bundle=JSON.parse(readFileSync(source,'utf8'));
  const [id,...raw]=process.argv.slice(2);
  if (!id) console.log(JSON.stringify({ usage:'node evaluate-precedent-curves.mjs MODEL_ID OUTDOOR_DB_F ENTERING_WB_F ENTERING_DB_F', models:bundle.models.map(m=>m.id) },null,2));
  else {
    const result=raw.length===3 ? evaluateCooling(bundle.models.find(m=>m.id===id),...raw.map(Number)) : {status:'unavailable',reason:'Supply model ID and all three temperatures.'};
    console.log(JSON.stringify(result,null,2));
    if(result.status!=='calculated') process.exitCode=1;
  }
}
