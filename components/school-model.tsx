"use client";

import { useEffect, useId, useState } from "react";
import { Building2, Check, Info, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DEFAULT_SCHOOL, SCHOOL_FIELDS, validateSchool, type SchoolAssumptions } from "@/lib/school";

function draftOf(a: SchoolAssumptions) {
  return Object.fromEntries(Object.entries(a).map(([key, value]) => [key, String(value)])) as Record<keyof SchoolAssumptions, string>;
}

export function SchoolModel({ value, onChange }: { value: SchoolAssumptions; onChange: (value: SchoolAssumptions) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(draftOf(value));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setDraft(draftOf(value)); }, [value]);
  const dirty = Object.keys(value).some(key => draft[key as keyof SchoolAssumptions] !== String(value[key as keyof SchoolAssumptions]));

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const next = Object.fromEntries(Object.entries(draft).map(([key, v]) => [key, v.trim() === "" ? NaN : Number(v)])) as SchoolAssumptions;
    const issue = validateSchool(next);
    if (issue) { setError(issue); setMessage(""); return; }
    onChange(next); setError(""); setMessage("Assumptions applied. Hourly results use these values.");
  }

  return <section className="school-model" aria-label="School load model">
    <div className="school-overview"><span className="section-icon"><Building2 size={23}/></span><div><h3>150,000 ft² K–12 school</h3><p>{value.people.toLocaleString()} students + staff · Weekdays {String(value.startHour).padStart(2, "0")}:00–{String(value.endHour).padStart(2, "0")}:00 · {value.summerPercent}% summer occupancy</p></div><span className="estimate-badge">Screening estimate</span></div>
    <div className="load-convention"><span className="heat-label">+ Heating</span><span className="cool-label">− Sensible cooling</span><span className="total-label">− Total cooling <span>(sensible + latent)</span></span><strong>BTU/hr</strong></div>
    <Accordion type="multiple" className="model-accordion">
      <AccordionItem value="assumptions"><AccordionTrigger><span className="accordion-title"><SlidersHorizontal size={16}/>Adjust school assumptions{dirty && <span className="unsaved">Unapplied changes</span>}</span></AccordionTrigger><AccordionContent>
        <p className="assumption-intro">Illustrative defaults for this school, not a calibrated building or a code-compliance model. Apply changes to recalculate the full year without fetching weather again.</p>
        <form onSubmit={apply}>
          {SCHOOL_FIELDS.map(group => <fieldset className="assumption-group" key={group.title}><legend>{group.title}</legend><div className="assumption-grid">{group.fields.map(field => <div className="form-field" key={field.key}><label htmlFor={`${id}-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label><input id={`${id}-${field.key}`} type="number" inputMode="decimal" required min={field.min} max={field.max} step={field.step} value={draft[field.key]} onChange={e => { setDraft(d => ({ ...d, [field.key]: e.target.value })); setMessage(""); setError(""); }}/></div>)}</div></fieldset>)}
          {error && <p className="model-error" role="alert">{error}</p>}
          <div className="assumption-actions"><button type="submit" className="button primary"><Check size={16}/>Apply assumptions</button><button type="button" className="button secondary" onClick={() => { onChange({ ...DEFAULT_SCHOOL }); setDraft(draftOf(DEFAULT_SCHOOL)); setMessage("Default assumptions restored."); setError(""); }}><RotateCcw size={15}/>Reset defaults</button><p role="status">{message || (dirty ? "Apply to update the results and download." : "Current assumptions are applied.")}</p></div>
        </form>
      </AccordionContent></AccordionItem>
      <AccordionItem value="method"><AccordionTrigger><span className="accordion-title"><Info size={16}/>Model method & limitations</span></AccordionTrigger><AccordionContent>
        <div className="method-grid"><div><h4>Hourly heat balance</h4><p>The 150,000 ft² school is one zone. Envelope heat transfer and outdoor air are balanced against occupant, lighting, equipment, and assumed solar gains. Heating and sensible cooling use separate thermostat setpoints.</p><div className="equations"><span>H = UA + 1.08 × outdoor CFM</span><span>Heating = max(0, H × (T<sub>heat</sub> − T<sub>out</sub>) − gains)</span><span>Sensible cooling = −max(0, H × (T<sub>out</sub> − T<sub>cool</sub>) + gains)</span><span>Latent cooling = −max(0, 0.68 × outdoor CFM × Δgrains + occupant latent gain)</span><span>Total cooling = sensible cooling + latent cooling</span></div><p>Δgrains is outdoor minus indoor moisture content in grains/lb of dry air. Indoor moisture is limited to {value.indoorRh}% RH at the calculated zone temperature within the thermostat deadband. Dry outdoor air can offset occupant moisture. Moisture removal is evaluated at every hour and may coexist with space heating.</p></div>
        <div><h4>Schedule and air</h4><p>Weekdays use the entered occupied hours, with full occupancy September–May and reduced occupancy June–August. Weekends and other hours use setback temperatures. Holidays and school breaks are not modeled. The CSV’s fixed local standard time is used throughout.</p><p>Outdoor air = infiltration + occupied ventilation. Infiltration = ACH × floor area × conditioned height ÷ 60. Occupied ventilation = CFM/person × occupants + CFM/ft² × floor area; it is off outside occupied hours. Heat recovery and economizers are excluded. Air factors and humidity ratios use standard sea-level conditions.</p><h4>Gains and limits</h4><p>Unoccupied lighting is 10% and equipment is 25% of full power; both ramp with the occupancy fraction. All electric input becomes sensible heat. The solar allowance is the hourly average of a sine profile from 06:00 to 18:00, peaking at noon. It is assumed, not retrieved solar radiation.</p><p>No thermal mass, warm-up load, orientation, detailed constructions, separate zones, fan heat, equipment capacity or efficiency, coil reheat, or humidification is modeled. Loads are thermal demand, not electricity or fuel consumption. Do not add sensible cooling to total cooling again.</p></div></div>
        <p className="method-sources">Temperature: °F = °C × 9/5 + 32. Dew point and moisture content use <a href="https://psychrometrics.github.io/psychrolib/api_docs.html" target="_blank" rel="noreferrer">ASHRAE relations documented by PsychroLib</a>; below freezing, the reported saturation temperature follows the ice/frost-point convention. Zero RH has no finite dew point. A detailed building simulation can instead use <a href="https://www.energy.gov/cmei/buildings/commercial-reference-buildings" target="_blank" rel="noreferrer">DOE reference models</a>; this tool does not run a DOE prototype.</p>
      </AccordionContent></AccordionItem>
    </Accordion>
  </section>;
}
