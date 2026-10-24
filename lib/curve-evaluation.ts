import type { CurveRangeMode } from "./equipment";
import { coolingPoint, type CoolingModel } from "./packaged-cooling";
import { heatingPoint, type HeatingModel } from "./packaged-heating";

export const CURVE_RANGE_BASIS = "Outside the supplied temperature range, screening mode holds performance at the nearest covered curve conditions. Actual weather and mixed air still determine loads. Boundary values are estimates, not measured performance; cold-weather heating can be overstated. Source-only mode leaves these results unavailable.";
const clamp = (v: number, range: number[]) => Math.max(range[0], Math.min(range[1], v));
type Plane = { normal: number[]; offset: number };
const planes = new WeakMap<CoolingModel, Plane[]>();
// Distance uses the fit's normalized temperature coordinates. Preserve the full
// source hull, including the 25-ton sloping face; an axis box alone is insufficient.
function closestCoolingInput(model: CoolingModel, input: number[]): number[] | null {
  let hull = planes.get(model);
  if (!hull) {
    const unique = new Map<string, Plane>();
    for (const [a,b,c,d] of model.valid_domain_halfspaces) {
      const normal = [20*a,6*b,10*c], length = Math.hypot(...normal);
      const plane = { normal: normal.map(v=>v/length), offset: (95*a+67*b+80*c+d)/length };
      unique.set([...plane.normal,plane.offset].map(v=>v.toFixed(10)).join(","),plane);
    }
    hull = [...unique.values()]; planes.set(model,hull);
  }
  let point = [(input[0]-95)/20,(input[1]-67)/6,(input[2]-80)/10];
  const corrections = hull.map(()=>[0,0,0]);
  // Dykstra's projection onto the intersection of the catalog's halfspaces.
  for (let iteration=0;iteration<256;iteration++) {
    const before = [...point];
    hull.forEach(({normal,offset},i)=>{
      const corrected = point.map((v,j)=>v+corrections[i][j]);
      const excess = Math.max(0,offset+normal.reduce((s,v,j)=>s+v*corrected[j],0));
      point = corrected.map((v,j)=>v-excess*normal[j]);
      corrections[i] = corrected.map((v,j)=>v-point[j]);
    });
    if (Math.hypot(...point.map((v,j)=>v-before[j]))<1e-11 && hull.every(({normal,offset})=>offset+normal.reduce((s,v,j)=>s+v*point[j],0)<1e-10)) break;
  }
  const result = [95+20*point[0],67+6*point[1],80+10*point[2]];
  return coolingPoint(model,result[0],result[1],result[2]) ? result : null;
}

/** Strict source evaluators stay unchanged. Only this explicit policy bounds inputs. */
export function operatingCoolingPoint(model: CoolingModel, outdoorF: number, wetF: number, dryF: number, mode: CurveRangeMode) {
  if (![outdoorF,wetF,dryF].every(Number.isFinite)) return null;
  const source = coolingPoint(model,outdoorF,wetF,dryF);
  if (source) return {...source,boundaryEstimate:false,curveOutdoorF:outdoorF,curveWetF:wetF,curveDryF:dryF};
  if (mode==="strict") return null;
  let input = [clamp(outdoorF,model.axis_ranges_F.outdoor_dry_bulb_F),clamp(wetF,model.axis_ranges_F.entering_wet_bulb_F),clamp(dryF,model.axis_ranges_F.entering_dry_bulb_F)];
  if (!coolingPoint(model,input[0],input[1],input[2])) {
    const projected = closestCoolingInput(model,[outdoorF,wetF,dryF]);
    if (!projected) return null;
    input = projected;
  }
  const point = coolingPoint(model,input[0],input[1],input[2]);
  return point ? {...point,boundaryEstimate:true,curveOutdoorF:input[0],curveWetF:input[1],curveDryF:input[2]} : null;
}

export function operatingHeatingPoint(model: HeatingModel, outdoorF: number, dryF: number, mode: CurveRangeMode) {
  if (![outdoorF,dryF].every(Number.isFinite)) return null;
  const source = heatingPoint(model,outdoorF,dryF);
  if (source) return {...source,boundaryEstimate:false,curveOutdoorF:outdoorF,curveDryF:dryF};
  if (mode==="strict") return null;
  const curveOutdoorF = clamp(outdoorF,model.outdoor_range_F), curveDryF = clamp(dryF,model.entering_dry_bulb_range_F);
  const point = heatingPoint(model,curveOutdoorF,curveDryF);
  return point ? {...point,boundaryEstimate:true,curveOutdoorF,curveDryF} : null;
}
