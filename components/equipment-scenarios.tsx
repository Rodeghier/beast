"use client";
import { useId } from "react";
import { EQUIPMENT_NAMES, type EquipmentScenario, type HeatingEquipment } from "@/lib/equipment";
import type { EquipmentResult } from "@/lib/equipment-model";

function EquipmentEditor({value,onChange}:{value:EquipmentScenario;onChange:(v:EquipmentScenario)=>void}) {
  const id=useId();
  return <><label htmlFor={`${id}-name`}>Scenario name<input id={`${id}-name`} value={value.name} maxLength={80} onChange={e=>onChange({...value,name:e.target.value})}/></label>
    <label htmlFor={`${id}-equipment`}>Equipment<select id={`${id}-equipment`} value={value.heating} onChange={e=>onChange({...value,heating:e.target.value as HeatingEquipment})}>{Object.entries(EQUIPMENT_NAMES).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
    {value.heating==="gas"&&<><label htmlFor={`${id}-efficiency`}>Heating efficiency (AHUE / AFUE) · %<input id={`${id}-efficiency`} type="number" min="0.1" max="100" step="any" placeholder="Enter efficiency" value={value.gasEfficiencyPercent??""} onChange={e=>onChange({...value,gasEfficiencyPercent:e.target.value===""||!Number.isFinite(e.target.valueAsNumber)?null:e.target.valueAsNumber})}/></label><p className="field-hint">Gas input equals delivered heating divided by this efficiency. Enter the equipment’s annual fuel utilization efficiency.</p></>}
    {value.heating==="heat-pump"?<><label htmlFor={`${id}-family`}>Cooling efficiency family<select id={`${id}-family`} value={value.efficiency} onChange={e=>onChange({...value,efficiency:e.target.value as EquipmentScenario["efficiency"]})}><option value="standard">Standard efficiency</option><option value="high">High efficiency</option></select></label>
      <p>Unit count and size are selected automatically from the supplied 3–25 ton Precedent cooling fits. Airflow uses the largest listed CFM for each size.</p>
      <p className="equipment-pending" role="status"><strong>Cooling capacity and SHR loaded.</strong> Heat-pump heating capacity and COP are awaiting the data you will provide. Dependent results remain unavailable.</p></>:<p className="equipment-scope"><strong>Heating only.</strong> Cooling loads remain unserved and are reported separately.</p>}
  </>;
}
export function EquipmentScenarios({choices,onChange,results=[],active,onActive,onAdd,onRemove,onDownload}:{
  choices:EquipmentScenario[];onChange:(i:number,v:EquipmentScenario)=>void;results?:EquipmentResult[];active:number;onActive:(i:number)=>void;onAdd?:()=>void;onRemove?:(i:number)=>void;onDownload?:()=>void;
}) {
  return <section className="equipment-scenarios" aria-label="Equipment scenarios"><div className="comparison-heading"><div><h3>Equipment comparison</h3><p>Compare a rooftop packaged heat pump with natural gas or electric resistance heating. Entering dry bulb and wet bulb are calculated from mixed air.</p></div><a className="button secondary" href="/references/precedent-cooling-fits.pdf" target="_blank" rel="noreferrer">Cooling fit report</a></div>
    <p className="field-hint">Mixed air combines scheduled ventilation with return air at the building’s indoor humidity target. Unit sizing includes ventilation airflow and separate sensible/latent cooling checks. Conditions outside the supplied data make sizing provisional.</p>
    {onAdd&&<button type="button" className="button secondary add-curve" disabled={choices.length>=3} onClick={onAdd}>Add scenario ({choices.length}/3)</button>}
    <div className="scenario-grid">{choices.map((choice,i)=>{const result=results[i],s=result?.selection;return <div className="scenario-card equipment-editor" key={i}><div className="scenario-title"><h4>Scenario {String.fromCharCode(65+i)}</h4>{onRemove&&choices.length>1&&<button type="button" className="button text-button" onClick={()=>onRemove(i)}>Remove</button>}</div>
      <EquipmentEditor value={choice} onChange={v=>onChange(i,v)}/>
      {s&&<div className="equipment-selection"><strong>{s.count} × {s.model.nominal_tons} ton units</strong><p>{s.totalTons.toLocaleString()} nominal tons total · {s.supplyCfm.toLocaleString()} CFM</p><p>{(s.referenceCoolingBtuHr/1000).toLocaleString(undefined,{maximumFractionDigits:1})} MBh gross cooling at catalog reference conditions.</p><p>{s.verifiedCoolingHours.toLocaleString()} cooling load hours verified.</p>
        {s.provisional&&<p className="model-error" role="status"><strong>Provisional sizing:</strong> {s.unverifiedCoolingHours.toLocaleString()} hours could not be checked using the supplied curves. {s.basis}</p>}
        {!!s.model.warnings.length&&<p className="model-error">The selected fit contains a flagged catalog value. Review the cooling fit report.</p>}
        <p className="field-hint">Cooling-based selection; heating capacity has not yet been sized.</p></div>}
      {result&&choice.heating!=="heat-pump"&&result.heatingCapacityBtuHr!==null&&<p className="equipment-selection"><strong>{(result.heatingCapacityBtuHr/1000).toLocaleString(undefined,{maximumFractionDigits:1})} MBh heating output</strong><br/>Sized to peak building heating load.</p>}
      {result?.error&&<p className="model-error" role="alert">{result.error}</p>}
      {result&&choice.heating==="heat-pump"&&!s&&<p role="status">Cooling selection is unavailable without valid cooling loads. Heating selection awaits heating-performance data.</p>}
      {result&&result.summary.completeHours>0&&<p>{result.summary.completeHours.toLocaleString()} complete energy hours{result.summary.fullYear?" · full year":" · partial year"}. Electricity: {result.summary.electricity?.toLocaleString(undefined,{maximumFractionDigits:1})??"Unavailable"} kWh. Gas: {result.summary.gasTherms?.toLocaleString(undefined,{maximumFractionDigits:1})??"Unavailable"} therms.</p>}
      <button type="button" className={`button ${active===i?"primary":"secondary"}`} aria-pressed={active===i} onClick={()=>onActive(i)}>Show scenario {String.fromCharCode(65+i)}</button>
    </div>;})}</div>
    {onDownload&&<button type="button" className="button secondary" onClick={onDownload}>Comparison CSV</button>}
  </section>;
}
