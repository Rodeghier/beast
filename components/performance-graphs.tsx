"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import type { AnnualPerformance } from "@/lib/utility-billing";

const COLORS = ["#2878a1", "#b56b32", "#6d55a1"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const METRICS = { energy: { title: "Modeled site energy", unit: "MMBtu" }, cost: { title: "Estimated utility cost", unit: "USD" }, co2e: { title: "CO₂e emissions", unit: "metric tons CO₂e" } };
type Metric = keyof typeof METRICS;
const format = (value: number, metric: Metric) => metric === "cost" ? value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${METRICS[metric].unit}`;

export function PerformanceGraphs({ performance }: { performance: AnnualPerformance[] }) {
  const [metric, setMetric] = useState<Metric>("energy");
  const config = Object.fromEntries(performance.map((_, i) => [`scenario${i}`, { label: `Scenario ${String.fromCharCode(65 + i)}`, color: COLORS[i] }]));
  const monthly = MONTHS.map((month, i) => ({ month, ...Object.fromEntries(performance.map((p, s) => [`scenario${s}`, p.months[i]?.[metric] ?? null])) }));
  return <div className="performance-graphs" aria-label="Scorecard graphs">
    <h3>Compare annual performance</h3><div className="annual-graphs">{(Object.keys(METRICS) as Metric[]).map(key => {
      const data = performance.map((p, i) => ({ name: `Scenario ${String.fromCharCode(65 + i)}`, value: p[key], color: COLORS[i] }));
      return <figure key={key}><figcaption>{METRICS[key].title} · {METRICS[key].unit}</figcaption>
        {data.some(d => d.value !== null) ? <ChartContainer className="annual-graph" config={{ value: { label: METRICS[key].title } }}><BarChart accessibilityLayer data={data} margin={{ left: 0, right: 12, top: 12, bottom: 8 }}><CartesianGrid vertical={false}/><XAxis dataKey="name" tick={{ fontSize: 11 }}/><YAxis width={65} tickFormatter={v => Number(v).toLocaleString(undefined, { notation: "compact" })}/><Tooltip formatter={value => format(Number(value), key)}/><Bar dataKey="value" isAnimationActive={false} radius={[4, 4, 0, 0]}>{data.map(d => <Cell key={d.name} fill={d.color}/>)}</Bar></BarChart></ChartContainer> : <p className="graph-empty">Awaiting complete {key === "cost" ? "tariff and price" : key === "co2e" ? "EPA emissions" : "energy"} data.</p>}
        <ul className="graph-values">{data.map(d => <li key={d.name}><span style={{ color: d.color }}>{d.name}</span><strong>{d.value === null ? "Unavailable" : format(d.value, key)}</strong></li>)}</ul>
      </figure>;
    })}</div>
    <div className="monthly-graph-heading"><h3>Monthly performance</h3><label htmlFor="graph-metric">Show<select id="graph-metric" value={metric} onChange={event => setMetric(event.target.value as Metric)}>{(Object.keys(METRICS) as Metric[]).map(key => <option key={key} value={key}>{METRICS[key].title}</option>)}</select></label></div>
    <p>{METRICS[metric].unit} · Missing data appear as gaps, never as zero.</p>
    <div className="chart-legend">{performance.map((_, i) => <span key={i}><i style={{ background: COLORS[i] }}/>Scenario {String.fromCharCode(65 + i)}</span>)}</div>
    {performance.some(p => p.months.some(m => m[metric] !== null)) ? <ChartContainer className="monthly-performance-graph" config={config}><LineChart accessibilityLayer data={monthly} margin={{ left: 6, right: 16, top: 12, bottom: 8 }}><CartesianGrid vertical={false}/><XAxis dataKey="month"/><YAxis width={70} tickFormatter={v => Number(v).toLocaleString(undefined, { notation: "compact" })}/><Tooltip formatter={(value, name) => [format(Number(value), metric), String(name)]}/>{performance.map((_, i) => <Line key={i} dataKey={`scenario${i}`} name={`Scenario ${String.fromCharCode(65 + i)}`} stroke={COLORS[i]} strokeWidth={2} type="linear" connectNulls={false} isAnimationActive={false}/>)}</LineChart></ChartContainer> : <p className="graph-empty">Select available source data to display this graph.</p>}
  </div>;
}
