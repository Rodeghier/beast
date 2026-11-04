/** Run integer equipment selection off the UI thread so inputs remain usable.
 * A replaced calculation is cancelled by terminating its worker in page.tsx. */
import { optimizePackagedBank } from "./packaged-optimizer";
import type { PackagedSelection } from "./packaged-bank";
import type { SchoolAssumptions, SchoolRow } from "./school";
import type { CurveRangeMode, EquipmentStage } from "./equipment";
export type SizingRequest={rows:SchoolRow[];school:SchoolAssumptions;requests:string};
export type SizingResponse={selections:(PackagedSelection|null)[];error:string|null};
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<SizingRequest>)=>void;postMessage:(response:SizingResponse)=>void};
scope.onmessage=({data})=>{
  try {
    const cache=new Map<string,PackagedSelection|null>();
    const selections=data.requests.split("|").map(request=>{
      const [mode,efficiency,selected,rangeMode,stage]=request.split(":");
      if(selected!=="true")return null;
      if(!cache.has(request))cache.set(request,optimizePackagedBank(data.rows,data.school,efficiency as "standard"|"high",mode as "heat-pump"|"gas",rangeMode as CurveRangeMode,stage as EquipmentStage));
      return cache.get(request)!;
    });
    scope.postMessage({selections,error:null});
  }catch(cause){scope.postMessage({selections:[],error:cause instanceof Error?cause.message:"Equipment selection could not be completed."});}
};
