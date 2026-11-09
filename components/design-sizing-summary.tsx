/** Display the station and probabilities that actually determined installed size. */
import { fahrenheit, type SchoolAssumptions } from "@/lib/school";
import type { DesignConditionResponse, DesignSizing, DesignStationChoice } from "@/lib/design-sizing";

const n=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:1});
export function DesignSizingSummary({design,station,sizing,school,onStation}:{design:DesignConditionResponse;station:DesignStationChoice|undefined;sizing:DesignSizing|undefined;school:SchoolAssumptions;onStation:(id:string)=>void}) {
  const cooling=station?.cooling[String(school.coolingDesignPercent)]?.dryBulb,heating=station?.heating[String(school.heatingDesignPercent)];
  return <section className="design-sizing-summary" aria-label="ASHRAE design sizing">
    <h3>ASHRAE design sizing</h3>
    <label htmlFor="design-weather-station">Design weather station<select id="design-weather-station" value={station?.id??""} onChange={event=>onStation(event.target.value)}>{design.stations.map(option=><option key={option.id} value={option.id}>{option.name}, {option.state} · WMO {option.id} · {n(option.distanceKm/1.609344)} mi</option>)}</select></label>
    <p><a href={design.source.url} target="_blank" rel="noreferrer">ASHRAE {design.source.edition} design conditions</a>. Nearest station selected initially; choose a station appropriate to the site’s climate and elevation.</p>
    {cooling&&heating&&<p><strong>Cooling {school.coolingDesignPercent}%:</strong> {n(fahrenheit(cooling.dryC))}°F outdoor dry bulb / {n(fahrenheit(cooling.humidityC))}°F mean coincident wet bulb. <strong>Heating {school.heatingDesignPercent}%:</strong> {n(fahrenheit(heating.dryC))}°F outdoor dry bulb.</p>}
    <p>Heat-pump banks are sized for sensible and latent cooling using dry-bulb, wet-bulb and dew-point design days. Heating and ventilation airflow do not increase the bank size. Ventilation heat and moisture remain in the cooling loads. Separate boilers and resistance heaters use heating design loads. Sizing uses occupied hours and seasonal occupancy reductions. Annual weather determines energy and unmet loads.</p>
    {sizing?.error&&<p className="model-error" role="alert">{sizing.error}</p>}
  </section>;
}
