"use client";
import { useId, useState } from "react";
import { emptyCurves, missingCurves, parseCurves, type CurveScenario } from "@/lib/performance-curves";
import { parseEnteringWetBulbCsv, type CurveResult } from "@/lib/curve-model";

function CurveEditor({ value, onChange }: { value: CurveScenario; onChange: (v: CurveScenario) => void }) {
  const id = useId(), [draft, setDraft] = useState(JSON.stringify(value.curves, null, 2)), [error, setError] = useState("");
  const missing = missingCurves(value.curves);
  return <><label htmlFor={`${id}-name`}>Scenario name<input id={`${id}-name`} value={value.name} maxLength={80} onChange={e => onChange({ ...value, name: e.target.value })}/></label>
    <p role="status">{missing.length ? `Awaiting ${missing.length} curves. Performance results remain unavailable.` : "All five mode-specific curves supplied."}</p>
    <label htmlFor={`${id}-curves`}>Normalized capacity, COP and SHR curves</label>
    <textarea id={`${id}-curves`} rows={10} spellCheck={false} value={draft} onChange={e => { setDraft(e.target.value); setError(""); }}/>
    <p className="field-hint">Replace each null with a grid containing outdoorF and enteringWetBulbF temperature arrays, plus values. Each values row corresponds to an entering wet-bulb temperature; columns follow outdoor dry-bulb temperatures. Both axes must increase. Capacity is a nonnegative multiplier, COP is a positive absolute value, and SHR is between 0 and 1.</p>
    {error && <p className="model-error" role="alert">{error}</p>}
    <div className="curve-actions"><button type="button" className="button primary" onClick={() => { try { const curves = parseCurves(JSON.parse(draft)); onChange({ ...value, curves }); setDraft(JSON.stringify(curves, null, 2)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid curve JSON."); } }}>Apply curves</button><button type="button" className="button secondary" onClick={() => { const curves = emptyCurves(); onChange({ ...value, curves }); setDraft(JSON.stringify(curves, null, 2)); setError(""); }}>Clear curves</button></div>
    <label htmlFor={`${id}-wb`}>Entering wet-bulb · optional fixed value (°F)<input id={`${id}-wb`} type="number" step="any" placeholder="No default" value={value.enteringWetBulbF ?? ""} onChange={e => onChange({ ...value, enteringWetBulbF: e.target.value === "" || !Number.isFinite(e.target.valueAsNumber) ? null : e.target.valueAsNumber })}/></label>
    <label htmlFor={`${id}-hourly`}>Or import hourly entering wet-bulb temperatures<input id={`${id}-hourly`} type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { onChange({ ...value, hourlyEnteringWetBulbF: parseEnteringWetBulbCsv(await file.text()) }); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid hourly input file."); } e.target.value = ""; }}/></label>
    <p className="field-hint"><a href="/templates/entering-wet-bulb.csv" download>Download empty hourly input template</a>. Use YYYY-MM-DD and HH:00 in local standard time. Hourly values override the fixed value; hours with neither remain unavailable. A fixed value is a screening input applied to every remaining hour.</p>
    {!!Object.keys(value.hourlyEnteringWetBulbF ?? {}).length && <p>{Object.keys(value.hourlyEnteringWetBulbF!).length.toLocaleString()} hourly temperatures imported. <button type="button" className="button text-button" onClick={() => onChange({ ...value, hourlyEnteringWetBulbF: undefined })}>Clear hourly inputs</button></p>}
  </>;
}
export function CurveScenarios({ choices, onChange, results = [], active, onActive, onAdd, onRemove, onDownload }: {
  choices: CurveScenario[]; onChange: (i: number, value: CurveScenario) => void; results?: CurveResult[]; active: number;
  onActive: (i: number) => void; onAdd?: () => void; onRemove?: (i: number) => void; onDownload?: () => void;
}) {
  return <section className="curve-scenarios" aria-label="User performance curves"><div className="comparison-heading"><div><h3>Your performance curves</h3><p>Only normalized capacity, COP and SHR curves determine equipment performance. Add your curves below; building loads can be calculated before curves are supplied.</p></div><a className="button secondary" href="/templates/performance-curves.json" download>Download empty curve template</a></div>
    <p>All curves use outdoor dry-bulb and entering wet-bulb temperatures in °F. Supply entering wet-bulb operating conditions explicitly below. Capacity multipliers scale the selected dataset’s peak heating and total cooling building loads. These building-derived references change when the location, year or building inputs change. Curve values use bilinear interpolation only within both supplied temperature domains.</p>
    <p className="field-hint">Grid shape: {`{"outdoorF": [/* increasing °F */], "enteringWetBulbF": [/* increasing °F */], "values": [/* one row per wet-bulb temperature */]}`}. No performance values are preloaded.</p>
    {onAdd && <button type="button" className="button secondary add-curve" disabled={choices.length >= 3} onClick={onAdd}>Add curve scenario ({choices.length}/3)</button>}
    <div className="scenario-grid">{choices.map((choice, i) => <div className="scenario-card curve-editor" key={i}><div className="scenario-title"><h4>Scenario {String.fromCharCode(65 + i)}</h4>{onRemove && choices.length > 1 && <button type="button" className="button text-button" onClick={() => onRemove(i)}>Remove</button>}</div><CurveEditor key={JSON.stringify(choice.curves)} value={choice} onChange={v => onChange(i, v)}/>
      {results[i] && <p role="status">{results[i].error ?? `${results[i].summary.completeHours.toLocaleString()} calculated hours${results[i].summary.fullYear ? " · full year" : " · partial coverage"}`}</p>}
      {results[i]?.summary.electricity != null && <p>Curve-based electricity over valid hours: <strong>{results[i].summary.electricity.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh</strong>. Unmet heating: {results[i].summary.unmetHeatingHours} hours; unmet cooling: {results[i].summary.unmetCoolingHours} hours.</p>}
      <button type="button" className={`button ${active === i ? "primary" : "secondary"}`} aria-pressed={active === i} onClick={() => onActive(i)}>Show scenario {String.fromCharCode(65 + i)}</button></div>)}</div>
    {onDownload && <button type="button" className="button secondary" onClick={onDownload}>Comparison CSV</button>}
  </section>;
}
