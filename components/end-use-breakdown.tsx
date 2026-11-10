import { Fragment } from "react";
import { scenarioName } from "@/lib/equipment";
import type { EquipmentResult } from "@/lib/equipment-model";
import type { AnnualPerformance } from "@/lib/utility-billing";

const number=(value:number|null|undefined,digits=1)=>value==null?"Unavailable":value.toLocaleString(undefined,{maximumFractionDigits:digits});
const END_USES=[{id:"cooling",label:"Cooling, excluding supply fans"},{id:"heating",label:"Heating, excluding supply fans"},{id:"fans",label:"Supply fans, all operating hours"}] as const;

export function EndUseBreakdown({results,performance}:{results:EquipmentResult[];performance:AnnualPerformance[]}) {
  if(!results.length||!performance.length)return null;
  return <div className="end-use-breakdown">
    <h3>Heating, cooling and fan breakdown</h3>
    <p>Annual purchased site energy and CO₂e by equipment use. Electricity and fuel are converted to MMBtu for comparison; these values are energy consumed, not heat delivered.</p>
    <div className="rate-scroll" role="region" aria-label="Annual heating, cooling and fan comparison" tabIndex={0}>
      <table><caption className="sr-only">Annual site energy and emissions by equipment use and system</caption>
        <thead><tr><th rowSpan={2} scope="col">Equipment use</th>{results.map((result,i)=><th key={i} colSpan={2} scope="colgroup">{scenarioName(result.scenario)}</th>)}</tr>
          <tr>{results.map((_,i)=><Fragment key={i}><th scope="col">Site energy (MMBtu)</th><th scope="col">CO₂e (metric tons)</th></Fragment>)}</tr></thead>
        <tbody>{END_USES.map(({id,label})=><tr key={id}><th scope="row">{label}</th>{results.map((_,i)=>{
          const use=performance[i]?.endUses?.find(use=>use.id===id);
          return <Fragment key={i}><td>{number(use?.energy)}<small className="end-use-consumption">{number(use?.electricity,0)} kWh{use?.fuelConsumption!=null&&use.fuelConsumption>0&&` + ${number(use.fuelConsumption,0)} ${use.fuelUnit??"fuel units"}`}</small></td><td>{number(use?.co2e)}</td></Fragment>;
        })}</tr>)}</tbody>
        <tfoot><tr><th scope="row">Total equipment</th>{results.map((_,i)=><Fragment key={i}><td>{number(performance[i]?.energy)}</td><td>{number(performance[i]?.co2e)}</td></Fragment>)}</tr></tfoot>
      </table>
    </div>
    <p>Supply fans serve heating, cooling and ventilation and are counted once in their own row. Emissions use the selected electricity-region and fuel factors. Annual values require 8,760 complete hourly energy records; missing factors leave affected emissions unavailable. Totals use unrounded values.</p>
    {results.map((result,i)=>{const summary=result.summary;return (summary.unmetHeatingBtu??0)>0||(summary.unmetCoolingBtu??0)>0?<p key={i} className="service-note"><strong>{scenarioName(result.scenario)}:</strong> Known unmet heating {number((summary.unmetHeatingBtu??0)/1e6)} MMBtu across {number(summary.unmetHeatingHours,0)} hours; unmet cooling {number((summary.unmetCoolingBtu??0)/1e6)} MMBtu across {number(summary.unmetCoolingHours,0)} hours. No backup energy or emissions are added to cover these shortfalls.</p>:null;})}
  </div>;
}
