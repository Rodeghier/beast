"use client";
/** Present recorded unit stages and hourly on/off totals without changing loads
 * or inventing cycle lengths. All aggregation is in equipment-operation.ts. */
import { Bar, BarChart, CartesianGrid, Cell, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import type { OperationDistribution } from "@/lib/equipment-operation";

const n=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:1});
export function EquipmentOperationGraphs({data}:{data:OperationDistribution}) {
  if(data.reason)return <p className="distribution-note" role="status">{data.reason}</p>;
  const empty=data.knownClockHours>0?"No units in this size group were called to run. Select all installed units or another size.":"No valid hourly stage data for this selection.";
  return <>
    <div className="distribution-grid operation-grid">
      <figure><figcaption>Time at each {data.source?.kind==="burner"?"burner":"unit"} stage</figcaption>
        <p className="distribution-basis">Estimated time at each modeled capacity stage, including OFF time. One unit-hour is one unit observed for one hour.</p>
        {data.includedUnitHours>0?<ChartContainer className="utilization-graph" config={{unitHours:{label:"Unit-hours",color:"#2878a1"}}}>
          <BarChart accessibilityLayer data={data.stages} margin={{left:0,right:12,top:12,bottom:12}}>
            <CartesianGrid vertical={false}/><XAxis dataKey="label" interval={0} angle={-20} textAnchor="end" height={55} tick={{fontSize:10}}/>
            <YAxis width={75} tickFormatter={v=>Number(v).toLocaleString(undefined,{notation:"compact"})} label={{value:"Unit-hours",angle:-90,position:"insideLeft"}}/>
            <Tooltip formatter={(value,_name,item)=>[`${n(Number(value))} unit-hours · ${n(Number(item.payload.percent))}% of included time`,"Time"]}/>
            <Bar dataKey="unitHours" isAnimationActive={false} radius={[3,3,0,0]}>{data.stages.map((stage,i)=><Cell key={stage.label} fill={i===0?"#94a3b8":"#2878a1"}/>)}</Bar>
          </BarChart>
        </ChartContainer>:<p className="graph-empty">{empty}</p>}
        <table className="sr-only"><caption>Stage runtime distribution values</caption><thead><tr><th>Stage</th><th>Unit-hours</th><th>Share of included time</th></tr></thead><tbody>{data.stages.map(stage=><tr key={stage.label}><th>{stage.label}</th><td>{n(stage.unitHours)}</td><td>{n(stage.percent)}%</td></tr>)}</tbody></table>
      </figure>
      <figure><figcaption>{data.source?.kind==="burner"?"Burner":"Unit"} ON/OFF time per hour</figcaption>
        <p className="distribution-basis">{data.source?.kind==="compressor"&&"ON means at least one compressor is running. "}Each bar counts unit-hours with that ON/OFF minute total. Individual cycle lengths and starts are not resolved.</p>
        {data.includedUnitHours>0?<ChartContainer className="utilization-graph" config={{on:{label:"ON time",color:"#2878a1"},off:{label:"OFF time",color:"#94a3b8"}}}>
          <BarChart accessibilityLayer data={data.minutes} margin={{left:0,right:12,top:12,bottom:12}}>
            <CartesianGrid vertical={false}/><XAxis dataKey="range" interval={0} height={55} tick={{fontSize:10}} label={{value:"Minutes per hour",position:"insideBottom",offset:0}}/>
            <YAxis allowDecimals={false} width={75} tickFormatter={v=>Number(v).toLocaleString(undefined,{notation:"compact"})} label={{value:"Unit-hours",angle:-90,position:"insideLeft"}}/>
            <Tooltip formatter={(value,name)=>[`${n(Number(value))} unit-hours`,name==="on"||name==="ON time"?"ON time":"OFF time"]} labelFormatter={range=>`${range} minutes per hour`}/><Legend/>
            <Bar dataKey="on" name="ON time" fill="#2878a1" isAnimationActive={false} radius={[3,3,0,0]}/><Bar dataKey="off" name="OFF time" fill="#94a3b8" isAnimationActive={false} radius={[3,3,0,0]}/>
          </BarChart>
        </ChartContainer>:<p className="graph-empty">{empty}</p>}
        <table className="sr-only"><caption>Hourly ON/OFF time distribution values</caption><thead><tr><th>Minutes per hour</th><th>ON time unit-hours</th><th>OFF time unit-hours</th></tr></thead><tbody>{data.minutes.map(bin=><tr key={bin.range}><th>{bin.range}</th><td>{n(bin.on)}</td><td>{n(bin.off)}</td></tr>)}</tbody></table>
      </figure>
    </div>
    <p className="distribution-coverage">{n(data.includedUnitHours)} unit-hours included · {n(data.idleUnitHoursExcluded)} idle unit-hours excluded · Unavailable weather hours: {n(data.unavailableClockHours)}. ON time: {n(data.onUnitHours)} unit-hours; OFF time: {n(data.offUnitHours)} unit-hours.</p>
    {data.cyclingUnitHours>0&&<p className="distribution-note">{n(data.cyclingUnitHours)} unit-hours with modeled cycling averaged {n(data.cyclingOnMinutes/data.cyclingUnitHours)} ON minutes and {n(data.cyclingOffMinutes/data.cyclingUnitHours)} OFF minutes within the hour.</p>}
  </>;
}
