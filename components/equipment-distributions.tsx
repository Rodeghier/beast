"use client";

/** RESULTS HISTOGRAMS. The shared selection stays aligned with the hourly table.
 * lib/equipment-utilization.ts defines percentages and bin boundaries; this
 * component only controls the selected mode, zero-hour filter and presentation.
 */
import { useId, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { scenarioName } from "@/lib/equipment";
import type { EquipmentResult } from "@/lib/equipment-model";
import { equipmentUtilization, utilizationDistribution, type UtilizationDistribution, type UtilizationMode } from "@/lib/equipment-utilization";
import { equipmentOperation, operationSources, type OperationScope } from "@/lib/equipment-operation";
import { EquipmentOperationGraphs } from "@/components/equipment-operation-graphs";

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

function DistributionGraph({ title, basis, distribution, color, includeZero }: {
  title: string; basis: string; distribution: UtilizationDistribution; color: string; includeZero: boolean;
}) {
  return <figure>
    <figcaption>{title}</figcaption><p className="distribution-basis">{basis}</p>
    {distribution.plottedHours > 0 ? <ChartContainer className="utilization-graph" config={{ hours: { label: "Hours", color } }}>
      <BarChart accessibilityLayer data={distribution.bins} margin={{ left: 0, right: 12, top: 12, bottom: 12 }}>
        <CartesianGrid vertical={false}/><XAxis dataKey="range" interval={0} angle={-45} textAnchor="end" height={60} tick={{ fontSize: 10 }}/>
        <YAxis allowDecimals={false} width={65} tickFormatter={value => Number(value).toLocaleString(undefined, { notation: "compact" })} label={{ value: "Hours", angle: -90, position: "insideLeft" }}/>
        <Tooltip formatter={(value, _name, item) => [`${number(Number(value))} hours · ${number(Number(item.payload.percentOfHours))}% of included hours`, "Frequency"]} labelFormatter={label => `${label} used`}/>
        <Bar dataKey="hours" fill={color} isAnimationActive={false} radius={[3, 3, 0, 0]}/>
      </BarChart>
    </ChartContainer> : <p className="graph-empty">{distribution.zeroHours > 0 && !includeZero ? "No nonzero use in the available hours. Include zero-use hours to view them." : "No valid hourly utilization data for this selection."}</p>}
    <p className="distribution-coverage">{number(distribution.plottedHours)} hours included · {number(distribution.missingHours)} unavailable · {number(distribution.zeroHours)} zero-use hours {includeZero ? "included" : "excluded"}</p>
    <table className="sr-only"><caption>{title} distribution values</caption><thead><tr><th>Percentage used</th><th>Hours</th><th>Share of included hours</th></tr></thead><tbody>{distribution.bins.map(bin => <tr key={bin.range}><th>{bin.range}</th><td>{bin.hours}</td><td>{number(bin.percentOfHours)}%</td></tr>)}</tbody></table>
  </figure>;
}

export function EquipmentDistributions({ results, active, onActive }: {
  results: EquipmentResult[]; active: number; onActive: (index: number) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<UtilizationMode>("cooling");
  const [includeZero, setIncludeZero] = useState(false);
  const [view,setView]=useState<"operation"|"utilization">("operation");
  const [groupId,setGroupId]=useState("");
  const [scope,setScope]=useState<OperationScope>("operating");
  const [unit,setUnit]=useState(1);
  const result = results[active];
  const sources=operationSources(result,mode).sources;
  const source=sources.find(s=>s.id===groupId)??sources[0];
  const operation=useMemo(()=>equipmentOperation(result,mode,{groupId:source?.id,scope,unit:Math.min(unit,source?.count??1)}),[result,mode,source?.id,scope,unit,source?.count]);
  const distributions = useMemo(() => {
    const samples = result ? equipmentUtilization(result, mode) : { capacity: [], power: [] };
    return { capacity: utilizationDistribution(samples.capacity, includeZero), power: utilizationDistribution(samples.power, includeZero) };
  }, [result, mode, includeZero]);
  const fuelInput = mode === "heating" && result?.scenario.heating === "gas";
  const loading=result?.selection?.designLoading;
  const designChecks=loading?[{label:"Heat-pump heating",value:loading.heating},{label:"Sensible cooling",value:loading.sensibleCooling},{label:"Latent cooling",value:loading.latentCooling},{label:"Ventilation",value:loading.ventilation}]:[];
  const highest=designChecks.filter(c=>(c.label==="Sensible cooling"||c.label==="Latent cooling")&&c.value!==null&&c.value>0).sort((a,b)=>b.value!-a.value!)[0];
  if(!results.length)return null;
  return <section className="equipment-distributions" aria-label="Equipment stages and cycling">
    <h3>Equipment stages and cycling</h3>
    {loading&&<div className="design-loading-summary"><p className="distribution-note">{highest&&<>Highest evaluated cooling design loading: <strong>{highest.label} · {number(highest.value!*100)}%</strong>. </>}Cooling determines the installed bank. Heating and ventilation airflow are diagnostic only; values above 100% indicate a shortfall. Unavailable checks are excluded.</p><dl>{designChecks.map(check=><div key={check.label}><dt>{check.label}</dt><dd>{check.value===null?"Not evaluated":`${number(check.value*100)}%`}</dd></div>)}</dl></div>}
    <div className="distribution-controls">
      <label htmlFor={`${id}-equipment`}>Equipment combination<select id={`${id}-equipment`} value={active} onChange={event => onActive(Number(event.target.value))}>{results.map((item, i) => <option key={i} value={i}>{scenarioName(item.scenario)}</option>)}</select></label>
      <label htmlFor={`${id}-mode`}>Operating mode<select id={`${id}-mode`} value={mode} onChange={event => setMode(event.target.value as UtilizationMode)}><option value="cooling">Cooling</option><option value="heating">Heating</option></select></label>
      <label htmlFor={`${id}-view`}>Chart view<select id={`${id}-view`} value={view} onChange={event=>setView(event.target.value as "operation"|"utilization")}><option value="operation">Unit stages and ON/OFF time</option><option value="utilization">Capacity and power · bank average</option></select></label>
      {view==="operation"&&sources.length>0&&<>
        {sources.length>1&&<label htmlFor={`${id}-group`}>Equipment size<select id={`${id}-group`} value={source?.id??""} onChange={event=>setGroupId(event.target.value)}>{sources.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        <label htmlFor={`${id}-scope`}>Units included<select id={`${id}-scope`} value={scope} onChange={event=>setScope(event.target.value as OperationScope)}><option value="operating">Units called to run</option><option value="all">All installed units</option><option value="unit">Individual unit</option></select></label>
        {scope==="unit"&&<label htmlFor={`${id}-unit`}>Unit number<input id={`${id}-unit`} type="number" min={1} max={source?.count??1} step={1} value={Math.min(unit,source?.count??1)} onChange={event=>setUnit(Number.isFinite(event.target.valueAsNumber)?Math.max(1,Math.min(source?.count??1,Math.round(event.target.valueAsNumber))):1)}/></label>}
      </>}
      {view==="utilization"&&<label className="distribution-zero"><input type="checkbox" checked={includeZero} onChange={event => setIncludeZero(event.target.checked)}/>Include zero-use hours</label>}
    </div>
    {view==="operation"?<p className="distribution-note">{source&&<><strong>{source.label}.</strong> </>}Building loads are allocated to assigned zones in proportion to unit nominal tonnage. Every unit serves its own share; spare capacity is not transferred between zones. Supply fans run across the bank on scheduled calls. Compressors stage or cycle locally. {scope==="operating"?"Only unit-hours with a mode demand are included; local cycling OFF time is retained.":scope==="unit"?"Units of the same size have identical assumed load shares and operating profiles; unit numbers are identifiers.":"Hours with no demand in the selected mode are included as compressor OFF time."}</p>:<p className="distribution-note">Hourly averages for the entire installed bank. Every unit receives its assigned zone load; compressors stage or cycle locally. Capacity uses each hour’s available output; supply-fan power and heat are excluded. Missing values are excluded.</p>}
    {result?.error && <p role="status" className="model-error">{result.error}</p>}
    {view==="operation"?<EquipmentOperationGraphs data={operation}/>:<div className="distribution-grid">
      <DistributionGraph title={`${mode === "cooling" ? "Cooling" : "Heating"} capacity used`} basis={mode === "cooling" ? "Delivered gross cooling / available gross cooling (%)" : "Delivered heater or coil output / available heater or coil output (%)"} distribution={distributions.capacity} color="#2878a1" includeZero={includeZero}/>
      <DistributionGraph title={fuelInput ? "Heating fuel input used" : `${mode === "cooling" ? "Cooling" : "Heating"} electrical power used`} basis={fuelInput ? "Hourly fuel input / full firing fuel input (%)" : "Hourly average electrical input / full-output electrical input (%)"} distribution={distributions.power} color="#b56b32" includeZero={includeZero}/>
    </div>}
  </section>;
}
