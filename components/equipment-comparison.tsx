"use client";

import { useId } from "react";
import { Download, GitCompareArrows } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COOLING_OPTIONS, HEATING_OPTIONS, FAMILIES, familySource, isHeatPump, type SystemChoice, type HeatingType, type CoolingType } from "@/lib/equipment-catalog";
import type { RtuResult } from "@/lib/rtu";
import { BTU_PER_KWH } from "@/lib/rtu-curves";

const n = (v: number, digits = 0) => v.toLocaleString(undefined, { maximumFractionDigits: digits });
export function EquipmentComparison({ choices, onChange, results, active, onActive, onDownload, onAdd, onRemove }: {
  choices: SystemChoice[]; onChange: (index: number, choice: SystemChoice) => void;
  results: RtuResult[]; active: number; onActive: (index: number) => void; onDownload?: () => void; onAdd?: () => void; onRemove?: (index: number) => void;
}) {
  const id = useId();
  const valid = results.length > 0 && results.length === choices.length && results.every(r => r.equipment && r.summary.completeHours > 0);
  const maxEnergy = Math.max(1, ...results.map(r => r.summary.siteMMBtu));
  const equalService = valid && results.every(r => r.summary.fullYear && r.summary.unmetHeatingHours === 0 && r.summary.unmetCoolingHours === 0);
  const metrics: [string, string, (r: RtuResult) => string][] = [
    ["Selected cooling equipment", "units × nominal tons", r => `${r.equipment!.count} × ${r.equipment!.tonsEach}`],
    ["Supply airflow", "CFM", r => n(r.equipment!.supplyCfm)],
    ["Primary heating bank", "BTU/hr output per unit", r => isHeatPump(r.system.heating) ? "Temperature-dependent HP" : n(r.equipment!.heatingBankBtuEach)],
    ["HVAC electricity", "kWh", r => n(r.summary.electricity)],
    ["Natural gas input", "therms", r => n(r.summary.gasTherms, 1)],
    ["Combined site energy", "MMBtu", r => n(r.summary.siteMMBtu, 1)],
    ["Unmet heating energy", "MMBtu thermal", r => n(r.summary.unmetHeatingBtu / 1e6, 2)],
    ["Unmet heating", "hours / peak BTU/hr", r => `${n(r.summary.unmetHeatingHours)} / ${n(r.summary.peakUnmetHeating)}`],
    ["Unmet cooling", "hours / MMBtu thermal", r => `${n(r.summary.unmetCoolingHours)} / ${n(r.summary.unmetCoolingBtu / 1e6, 2)}`],
    ["Map boundary estimates", "operating hours", r => n(r.summary.boundedHours)],
    ["Operating cooling SHR", "on-cycle sensible / total", r => r.summary.coolingShrMin === null ? "—" : `${n(r.summary.coolingShrMin, 3)}–${n(r.summary.coolingShrMax!, 3)}`],
    ["Weather coverage", "valid hourly records", r => `${n(r.summary.completeHours)}${r.summary.fullYear ? " · full year" : " · partial"}`],
  ];
  return <section className="equipment-comparison" aria-label="Compare heating and cooling equipment">
    <div className="comparison-heading"><div><span className="eyebrow">EQUIPMENT COMPARISON</span><h3><GitCompareArrows size={22}/>Heating and cooling equipment</h3><p>Choose heating and cooling for each case. All scenarios use the same weather, loads, and applied CAV assumptions.</p></div>{onDownload && valid && <button className="button secondary" onClick={onDownload}><Download size={16}/>Comparison CSV</button>}</div>
    {onAdd && <button type="button" className="button secondary add-equipment" onClick={onAdd} disabled={choices.length >= 3}>Add equipment scenario ({choices.length}/3)</button>}<div className="scenario-grid">{choices.map((choice, i) => {
      const heating = HEATING_OPTIONS.find(o => o.id === choice.heating)!;
      return <div className={`scenario-card scenario-${i}`} key={i}>
        <div className="scenario-title"><span className="scenario-letter">{String.fromCharCode(65 + i)}</span><h4>Scenario {String.fromCharCode(65 + i)}</h4>{onRemove && choices.length > 1 && <button type="button" className="button text-button" aria-label={`Remove scenario ${String.fromCharCode(65 + i)}`} onClick={() => onRemove(i)}>Remove</button>}</div>
        <div className="form-field"><label htmlFor={`${id}-heat-${i}`}>Heating equipment</label><Select value={choice.heating} onValueChange={v => onChange(i, { ...choice, heating: v as HeatingType })}><SelectTrigger className="field-select" id={`${id}-heat-${i}`} aria-label={`Scenario ${String.fromCharCode(65 + i)} heating equipment`}><SelectValue/></SelectTrigger><SelectContent>{HEATING_OPTIONS.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="form-field"><label htmlFor={`${id}-cool-${i}`}>Cooling equipment</label><Select value={choice.cooling} onValueChange={v => onChange(i, { ...choice, cooling: v as CoolingType })}><SelectTrigger className="field-select" id={`${id}-cool-${i}`} aria-label={`Scenario ${String.fromCharCode(65 + i)} cooling equipment`}><SelectValue/></SelectTrigger><SelectContent>{COOLING_OPTIONS.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select></div>
        {isHeatPump(choice.heating) && <div className="form-field lockout-field"><label htmlFor={`${id}-lockout-${i}`}>Heating compressor lockout</label><Select value={String(choice.lockoutF)} onValueChange={v => onChange(i, { ...choice, lockoutF: Number(v) })}><SelectTrigger className="field-select" id={`${id}-lockout-${i}`} aria-label={`Scenario ${String.fromCharCode(65 + i)} heating lockout`}><SelectValue/></SelectTrigger><SelectContent>{[-15, -10, -5, 0, 5, 10, 15, 20, 30, 40].map(t => <SelectItem key={t} value={String(t)}>Below {t}°F</SelectItem>)}</SelectContent></Select><p className="field-hint">0°F is the ComStock measure default. A lower setting is a design assumption; out-of-range map use is flagged.</p></div>}
        <p className="scenario-description">{heating.description} <a href={heating.source} target="_blank" rel="noreferrer">NLR source</a></p>
        <p className="scenario-cooling-source">{COOLING_OPTIONS.find(o => o.id === choice.cooling)!.description} <a href={familySource(choice.cooling)} target="_blank" rel="noreferrer">Cooling curves</a></p>
        {results[i]?.error && <p className="model-error" role="alert">{results[i].error}</p>}
        <button className={`button ${active === i ? "primary" : "secondary"} scenario-active`} aria-pressed={active === i} onClick={() => onActive(i)}>{active === i ? "Showing" : "Show"} scenario {String.fromCharCode(65 + i)} in hourly results</button>
      </div>;
    })}</div>
    {valid ? <>
      <div className="comparison-energy" aria-label="Combined site energy comparison"><div className="chart-legend"><span><i style={{ background: "#3479a4" }}/>Electricity</span><span><i style={{ background: "#ba733d" }}/>Gas</span><span>Both converted to MMBtu of site energy</span></div>{results.map((r, i) => <div className="energy-bar-row" key={i}><strong>{String.fromCharCode(65 + i)}</strong><div className="energy-bar-track" role="img" aria-label={`Scenario ${String.fromCharCode(65 + i)}: ${n(r.summary.siteMMBtu, 1)} MMBtu site energy`}><span className="electric-bar" style={{ width: `${r.summary.electricity * BTU_PER_KWH / 1e6 / maxEnergy * 100}%` }}/><span className="gas-bar" style={{ width: `${r.summary.gasTherms * 0.1 / maxEnergy * 100}%` }}/></div><span>{n(r.summary.siteMMBtu, 1)} MMBtu</span></div>)}</div>
      <div className="comparison-table-scroll" tabIndex={0} aria-label="Equipment comparison table"><Table className="comparison-table"><TableHeader><TableRow><TableHead>Result</TableHead>{choices.map((_, i) => <TableHead key={i}>Scenario {String.fromCharCode(65 + i)}</TableHead>)}</TableRow></TableHeader><TableBody>{metrics.map(([label, unit, get]) => <TableRow key={label}><TableCell>{label}<span className="comparison-unit">{unit}</span></TableCell>{results.map((r, i) => <TableCell key={i}>{get(r)}</TableCell>)}</TableRow>)}</TableBody></Table></div>
      <p className={`comparison-note ${equalService ? "" : "service-note"}`}>{equalService ? "All scenarios meet modeled heating and cooling needs for every valid hour. " : "Review unmet loads before comparing energy: a system that leaves heat unmet can consume less because it delivers less comfort. "}Electricity and gas are separate inputs. MMBtu combines their site energy; it does not represent cost, emissions, or source energy. Totals include supply fans and electric dehumidification reheat. Defrost and crankcase heaters are excluded.</p>
    </> : <p className="comparison-note">Load a city and year to calculate each scenario. Changing equipment or building assumptions reuses the loaded weather.</p>}
    <details className="catalog-details"><summary>NLR equipment data and comparison scope</summary><p>These are generic coil combinations on the existing CAV rooftop model. Heating and cooling can be paired independently for energy screening; a pair does not identify a purchasable packaged product.</p><p>All four HP families come from the same pinned ComStock measure. The highest eligible stage cycles to meet the load. Fans remain constant; variable-speed modulation, economizers, heat recovery, and auxiliary space heat are excluded. The common rated-COP fits follow the active ComStock measure; no invented high-efficiency multiplier is applied.</p><p>The repository also includes chillers, condensing/electric boilers, water-source and ground-source heat pumps, and VRF/DOAS systems. Those require water-loop temperatures, pumps/towers, ground-loop behavior, or zonal controls; they are not selectable in this air-side CAV comparison.</p><p>{Object.entries(FAMILIES).map(([key, f], i) => <span key={key}>{i > 0 && " · "}<a href={familySource(key as keyof typeof FAMILIES)} target="_blank" rel="noreferrer">{f.name}</a></span>)} · <a href="/engineering-guide.pdf" target="_blank" rel="noreferrer">Engineering guide</a></p></details>
  </section>;
}
