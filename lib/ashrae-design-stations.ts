/** SERVER CATALOG. Only the nearest station choices are sent to the browser.
 * Source rows with incomplete design/humidity/solar data were excluded by the
 * preparation script. Geographic proximity is a starting point; the engineer
 * can select another nearby station for local climate or elevation differences.
 */
import catalog from "./data/ashrae-design-2017-us.json";
import type { DesignConditionResponse, DesignStation } from "./design-sizing";

export const DESIGN_SOURCE=catalog.source;
export function nearestDesignStations(latitude:number,longitude:number):DesignConditionResponse {
  const rad=Math.PI/180;
  const distance=(station:DesignStation)=>{
    const a=Math.sin((station.latitude-latitude)*rad/2)**2+Math.cos(latitude*rad)*Math.cos(station.latitude*rad)*Math.sin((station.longitude-longitude)*rad/2)**2;
    return 6371*2*Math.asin(Math.min(1,Math.sqrt(a)));
  };
  const stations=(catalog.stations as DesignStation[]).map(station=>({...station,distanceKm:distance(station)}))
    .filter(station=>station.distanceKm<=250).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,10);
  return {source:DESIGN_SOURCE,stations};
}
