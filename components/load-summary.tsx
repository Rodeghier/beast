"use client";

/**
 * BUILDING LOAD DISPLAY. Uses summarizeLoads to find peaks and plot thermal
 * loads. Cooling is stored negative; these are demands, not electrical use.
 */


import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { summarizeLoads, type SchoolRow } from "@/lib/school";

export const formatLoad = (value: number | null) => value === null ? "—" : Math.round(value) === 0 ? "0" : `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString("en-US")}`;
const COLORS = { heating: "#ad4c1f", sensibleCooling: "#6b8bd9", totalCooling: "#2649c0" };
const NAMES = { heating: "Heating", sensibleCooling: "Sensible cooling", totalCooling: "Total cooling" };

export function LoadSummary({ rows }: { rows: SchoolRow[] }) {
  const summary = useMemo(() => summarizeLoads(rows), [rows]);
  const peaks = [{ label: "Peak sensible cooling", peak: summary.sensible, className: "cool-label" }, { label: "Peak total cooling", peak: summary.total, className: "total-label" }, { label: "Peak heating", peak: summary.heating, className: "heat-label" }];
  return <section className="load-summary" aria-label="Building load results">
    <div className="peak-grid">{peaks.map(({ label, peak, className }) => <div className={`peak-card ${className}`} key={label}><h3>{label}</h3><div><strong>{formatLoad(peak?.value ?? null)}</strong><span>BTU/hr</span></div><p>{peak ? peak.value === 0 ? "No load in available hours" : `${peak.timestamp} · local` : "No valid hours"}</p></div>)}</div>
    <div className="chart-heading"><div><h3>Daily peak hourly loads</h3><p>Each point is that day’s largest load in each category. Peaks can occur at different hours.</p></div><span>{summary.completeHours.toLocaleString()} complete hours</span></div>
    <div className="chart-legend">{Object.entries(NAMES).map(([key, name]) => <span key={key}><i style={{ background: COLORS[key as keyof typeof COLORS] }}/>{name}</span>)}</div>
    <ChartContainer className="load-chart" config={Object.fromEntries(Object.entries(NAMES).map(([key, label]) => [key, { label, color: COLORS[key as keyof typeof COLORS] }]))}>
      <LineChart accessibilityLayer data={summary.daily} margin={{ top: 12, right: 12, bottom: 8, left: 5 }}>
        <CartesianGrid vertical={false} stroke="#e8edf5"/>
        <XAxis dataKey="date" minTickGap={55} tickFormatter={value => String(value).slice(5)} tickLine={false} axisLine={false} tick={{ fontSize: 12 }}/>
        <YAxis width={85} tickFormatter={v => `${(Number(v) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} label={{ value: "BTU/hr", position: "insideTopLeft", offset: 0, fontSize: 12 }}/>
        <ReferenceLine y={0} stroke="#9eabc1"/>
        <Tooltip formatter={(value, name) => [`${formatLoad(Number(value))} BTU/hr`, String(name)]} labelFormatter={label => `${label} · daily peaks`} contentStyle={{ border: "1px solid #dce2ed", borderRadius: 8, fontSize: 14 }}/>
        {(["heating", "sensibleCooling", "totalCooling"] as const).map(key => <Line key={key} type="linear" dataKey={key} name={NAMES[key]} stroke={COLORS[key]} strokeWidth={key === "sensibleCooling" ? 1.4 : 1.8} strokeDasharray={key === "sensibleCooling" ? "4 3" : undefined} dot={false} connectNulls={false} isAnimationActive={false}/>)}
      </LineChart>
    </ChartContainer>
    {summary.completeHours < rows.length && <p className="incomplete-note" role="status">{(rows.length - summary.completeHours).toLocaleString()} hours have missing weather inputs. Missing loads remain blank and are excluded from peaks.</p>}
  </section>;
}
