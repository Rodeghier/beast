/** Published station data are bundled locally: no API key or external lookup. */
import { nearestDesignStations } from "@/lib/ashrae-design-stations";

export async function GET(request:Request) {
  const p=new URL(request.url).searchParams,latitude=Number(p.get("latitude")),longitude=Number(p.get("longitude"));
  if(!p.get("latitude")?.trim()||!p.get("longitude")?.trim()||!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<24||latitude>50||longitude< -125||longitude> -66)
    return Response.json({error:"Provide coordinates in the contiguous United States for ASHRAE design conditions."},{status:400});
  const result=nearestDesignStations(latitude,longitude);
  if(!result.stations.length)return Response.json({error:"No complete ASHRAE design station is available within 250 km. Equipment sizing requires suitable design conditions."},{status:422});
  return Response.json(result,{headers:{"Cache-Control":"public, max-age=86400"}});
}
