/** User-supplied temperature-rise tables; not a compressor input-power map. */
import data from './data/mhgrh.json';
import type { CoolingModel } from './packaged-cooling';
import type { CurveRangeMode } from './equipment';

export const MHGRH_BASIS='MHGRH uses PKGP-PRC023F-EN tables 74–86: multilinear interpolation of MAX leaving-reheat minus MAX leaving-evaporator temperature. Table temperatures are 60–70 F ambient, 51–59 F entering wet bulb, and 60–75 F entering dry bulb. Bounded estimates are flagged; strict mode rejects outside conditions. Larger units scale 25-ton assemblies; 10-ton high efficiency uses WSK120 table 80, standard uses table 81. Heat recovery is limited by compressor runtime and estimated heat rejection. Below minimum valve output, bypass/duty modulation is assumed. Cooling curves and compressor input remain the base-unit approximation: no reheat-mode power or coupled capacity map is supplied. No additional resistance or gas energy is charged for recovered heat; no supplemental heater is assumed.';
const tables=new Map<number,number[][]>();
for(const p of data.points){if(!tables.has(p[0]))tables.set(p[0],[]);tables.get(p[0])!.push(p);}
const lookup=new Map(data.points.map(p=>[p.slice(0,6).join(':'),p]));
const grids=new Map([...tables].map(([table,points])=>[table,[2,3,4,5].map(i=>[...new Set(points.map(p=>p[i]))].sort((a,b)=>a-b))]));
export function mhgrhPoint(model:CoolingModel,outdoorF:number,wetF:number,dryF:number,cfm:number,mode:CurveRangeMode='bounded'){
  if(![outdoorF,wetF,dryF,cfm].every(Number.isFinite))return null;
  const tons=Math.min(25,model.nominal_tons),table=tons===10?(model.efficiency==='high'?80:81):({3:74,4:75,5:76,6:77,7.5:78,8.5:79,12.5:82,15:83,17.5:84,20:85,25:86} as Record<number,number>)[tons];
  const grid=grids.get(table);if(!grid)return null;
  const scale=model.nominal_tons/tons,values=[outdoorF,cfm/scale,dryF,wetF];let boundaryEstimate=false;
  const axes=values.map((v,i)=>{
    const axis=grid[i];
    if(v<axis[0]-1e-6||v>axis.at(-1)!+1e-6)boundaryEstimate=true;
    const x=Math.max(axis[0],Math.min(axis.at(-1)!,v)),lo=axis.filter(a=>a<=x).at(-1)!,hi=axis.find(a=>a>=x)!;
    return lo===hi?[[lo,1]]:[[lo,(hi-x)/(hi-lo)],[hi,(x-lo)/(hi-lo)]];
  });
  // Do not extrapolate airflow, even in bounded temperature mode.
  const flows=grid[1];if(cfm/scale<flows[0]-1e-6||cfm/scale>flows.at(-1)!+1e-6||mode==='strict'&&boundaryEstimate)return null;
  let minRiseF=0,maxRiseF=0;
  for(const [o,wo] of axes[0])for(const [f,wf] of axes[1])for(const [d,wd] of axes[2])for(const [w,ww] of axes[3]){
    const p=lookup.get([table,tons,o,f,d,w].join(':'));if(!p)return null;
    const weight=wo*wf*wd*ww;minRiseF+=weight*(p[8]-p[6]);maxRiseF+=weight*(p[9]-p[7]);
  }
  return {table,minRiseF,maxRiseF,maxBtuHr:1.08*cfm*Math.max(0,maxRiseF),boundaryEstimate,scaledProxy:scale!==1};
}
