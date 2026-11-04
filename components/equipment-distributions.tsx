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
  const result = results[active];
  const distributions = useMemo(() => {
    const samples = result ? equipmentUtilization(result, mode) : { capacity: [], power: [] };
    return { capacity: utilizationDistribution(samples.capacity, includeZero), power: utilizationDistribution(samples.power, includeZero) };
  }, [result, mode, includeZero]);
  const fuelInput = mode === "heating" && result?.scenario.heating === "gas";
  return <section className="equipment-distributions" aria-label="Capacity and power distributions">
    <h3>Capacity and power distributions</h3>
    <div className="distribution-controls">
      <label htmlFor={`${id}-equipment`}>Equipment combination<select id={`${id}-equipment`} value={active} onChange={event => onActive(Number(event.target.value))}>{results.map((item, i) => <option key={i} value={i}>{scenarioName(item.scenario)}</option>)}</select></label>
      <label htmlFor={`${id}-mode`}>Operating mode<select id={`${id}-mode`} value={mode} onChange={event => setMode(event.target.value as UtilizationMode)}><option value="cooling">Cooling</option><option value="heating">Heating</option></select></label>
      <label className="distribution-zero"><input type="checkbox" checked={includeZero} onChange={event => setIncludeZero(event.target.checked)}/>Include zero-use hours</label>
    </div>
    <p className="distribution-note">Hourly averages for all installed units, including staging and cycling. Capacity uses available output at each hour’s evaluated conditions. Supply-fan power and heat are excluded from these equipment percentages. Missing values are excluded.</p>
    {result?.error && <p role="status" className="model-error">{result.error}</p>}
    <div className="distribution-grid">
      <DistributionGraph title={`${mode === "cooling" ? "Cooling" : "Heating"} capacity used`} basis={mode === "cooling" ? "Delivered gross cooling / available gross cooling (%)" : "Delivered heater or coil output / available heater or coil output (%)"} distribution={distributions.capacity} color="#2878a1" includeZero={includeZero}/>
      <DistributionGraph title={fuelInput ? "Heating fuel input used" : `${mode === "cooling" ? "Cooling" : "Heating"} electrical power used`} basis={fuelInput ? "Hourly fuel input / full firing fuel input (%)" : "Hourly average electrical input / full-output electrical input (%)"} distribution={distributions.power} color="#b56b32" includeZero={includeZero}/>
    </div>
  </section>;
}
