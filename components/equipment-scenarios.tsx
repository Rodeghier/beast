"use client";

/**
 * EQUIPMENT INPUTS AND SELECTION DISPLAY. Selects types/family and displays
 * results supplied by the parent. onChange sends user choices back to page.tsx;
 * this component does not independently size units or calculate energy.
 */

import { useId } from "react";
import { coolingFor, scenarioName, EQUIPMENT_NAMES, type EquipmentScenario, type HeatingEquipment } from "@/lib/equipment";
import { unitRatingFor } from "@/lib/unit-ratings";
import type { EquipmentResult } from "@/lib/equipment-model";
function EquipmentEditor({value,onChange}:{value:EquipmentScenario;onChange:(v:EquipmentScenario)=>void}) {
 const id=useId(),cooling=coolingFor(value);
 return <>
  <fieldset className="equipment-fields"><legend className="sr-only">Equipment choices</legend>
  <label htmlFor={`${id}-heating`}>Heating equipment<select id={`${id}-heating`} value={value.heating} onChange={e=>{const heating=e.target.value as HeatingEquipment;onChange({...value,heating,cooling:heating==="heat-pump"?"heat-pump":value.heating==="heat-pump"?null:value.cooling});}}>{Object.entries(EQUIPMENT_NAMES).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
  {value.heating!=="heat-pump"?<label htmlFor={`${id}-cooling`}>Cooling equipment · required<select id={`${id}-cooling`} form="analysis-inputs" required value={cooling??""} onChange={e=>onChange({...value,cooling:e.target.value==="heat-pump"?"heat-pump":null})}><option value="" disabled>Select cooling equipment</option><option value="heat-pump">Rooftop Packaged Heat Pump</option></select></label>:<p><strong>Cooling:</strong> Rooftop Packaged Heat Pump</p>}
  {cooling&&<label htmlFor={`${id}-family`}>Heat-pump efficiency family<select id={`${id}-family`} value={value.efficiency} onChange={e=>onChange({...value,efficiency:e.target.value as EquipmentScenario["efficiency"]})}><option value="standard">Standard efficiency</option><option value="high">High efficiency</option></select></label>}
  </fieldset>
  {value.heating==="gas"&&<><label htmlFor={`${id}-efficiency`}>Heating efficiency (AHUE / AFUE) · %<input id={`${id}-efficiency`} form="analysis-inputs" required type="number" min="0.1" max="100" step="any" placeholder="Enter efficiency" value={value.gasEfficiencyPercent??""} onChange={e=>onChange({...value,gasEfficiencyPercent:e.target.value===""||!Number.isFinite(e.target.valueAsNumber)?null:e.target.valueAsNumber})}/></label></>}
 </>;
}
export function EquipmentScenarios({choices,onChange,results=[],active,onActive,onAdd,onRemove,onDownload}:{choices:EquipmentScenario[];onChange:(i:number,v:EquipmentScenario)=>void;results?:EquipmentResult[];active:number;onActive:(i:number)=>void;onAdd?:()=>void;onRemove?:(i:number)=>void;onDownload?:()=>void;}) {
 return <section className="equipment-scenarios" aria-label="Equipment scenarios"><h3>Equipment comparison</h3>
 {onAdd&&<button type="button" className="button secondary add-curve" disabled={choices.length>=3} onClick={onAdd}>Add equipment combination ({choices.length}/3)</button>}
 <div className="scenario-grid">{choices.map((choice,i)=>{const result=results[i],s=result?.selection,rating=s?unitRatingFor(s.model):null;return <div className="scenario-card equipment-editor" key={i}><div className="scenario-title"><h4>{scenarioName(choice)}</h4>{onRemove&&choices.length>1&&<button type="button" className="button text-button" onClick={()=>onRemove(i)}>Remove</button>}</div>
 <EquipmentEditor value={choice} onChange={v=>onChange(i,v)}/>
 {s&&<div className="equipment-selection"><strong>{s.count} × {s.model.nominal_tons} ton cooling units</strong><p>{s.totalTons.toLocaleString()} nominal tons total · {s.supplyCfm.toLocaleString()} CFM</p><p>{(s.referenceCoolingBtuHr/1000).toLocaleString(undefined,{maximumFractionDigits:1})} MBh gross cooling at reference conditions.</p>
 {rating&&<p>{(s.count*rating.cooling_system_power_kW).toFixed(2)} kW nominal total cooling input; {(s.count*rating.inferred_supply_fan_power_kW).toFixed(2)} kW estimated supply fan, already included in that total.</p>}
 {choice.heating==="heat-pump"&&<p>{(s.referenceHeatingBtuHr/1000).toLocaleString(undefined,{maximumFractionDigits:1})} MBh net heating at 47°F outdoor / 70°F entering dry bulb.</p>}
 <p>Within source coverage: {s.verifiedCoolingHours.toLocaleString()} cooling hours{choice.heating==="heat-pump"&&` · ${s.verifiedHeatingHours.toLocaleString()} heating hours`}.</p>
 {!!(s.unverifiedHeatingHours+s.unverifiedCoolingHours)&&<p className="model-error" role="status"><strong>Incomplete sizing coverage:</strong> {s.unverifiedHeatingHours.toLocaleString()} heating and {s.unverifiedCoolingHours.toLocaleString()} cooling hours could not be checked. Review the input data and exported status details.</p>}
 </div>}
 {result&&choice.heating!=="heat-pump"&&result.heatingCapacityBtuHr!==null&&<p className="equipment-selection"><strong>{(result.heatingCapacityBtuHr/1000).toLocaleString(undefined,{maximumFractionDigits:1})} MBh heater output</strong><br/>Peak heating demand after fan heat credit.</p>}
 {result?.error&&<p className="model-error" role="alert">{result.error}</p>}
 {result&&result.summary.completeHours>0&&<p>{result.summary.completeHours.toLocaleString()} complete energy hours. Electricity: {result.summary.electricity?.toLocaleString(undefined,{maximumFractionDigits:1})??"Unavailable"} kWh; supply fan: {result.summary.fanElectricity?.toLocaleString(undefined,{maximumFractionDigits:1})??"Unavailable"} kWh across hours with fan data. Corresponding fan use is counted once in complete-hour electricity. Gas: {result.summary.gasTherms?.toLocaleString(undefined,{maximumFractionDigits:1})??"Unavailable"} therms.</p>}
 <button type="button" className={`button ${active===i?"primary":"secondary"}`} aria-pressed={active===i} onClick={()=>onActive(i)}>Show this combination</button>
 </div>;})}</div>{onDownload&&<button type="button" className="button secondary" onClick={onDownload}>Comparison CSV</button>}
 </section>;
}
