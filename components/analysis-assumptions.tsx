"use client";

/**
 * BUILDING INPUT EDITOR. The only collapsible default/custom input panel.
 * school is the current input object. onSchool sends a replacement object to
 * app/page.tsx. Default mode resets the whole input set; custom mode enables
 * editing. The actual load equations remain in lib/school.ts.
 */


import { useId, useState } from "react";
import { DEFAULT_SCHOOL, SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";

export function AnalysisAssumptions({ school, onSchool }: {
  school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void;
}) {
  const id = useId();
  // State remembers whether the form is editable. Returning to defaults sends a
  // fresh copy of DEFAULT_SCHOOL to the parent, resetting all building groups together.
  const [custom, setCustom] = useState(() => SCHOOL_FIELDS.some(group => group.fields.some(({key}) => school[key] !== DEFAULT_SCHOOL[key])));
  return <details className="analysis-assumptions" onInvalidCapture={event => { event.currentTarget.open = true; }}>
    <summary><span>Building characteristics and assumptions</span><small>{custom ? "Custom values" : "Default values"}</small></summary>
    <div className="assumptions-body">
      <div className="assumptions-mode" role="radiogroup" aria-label="Building input values">
        <label><input type="radio" name={id} checked={!custom} onChange={() => { setCustom(false); onSchool({ ...DEFAULT_SCHOOL }); }}/>Use defaults</label>
        <label><input type="radio" name={id} checked={custom} onChange={() => setCustom(true)}/>Modify values</label>
      </div>
      <fieldset className="assumptions-values" disabled={!custom}><legend className="sr-only">Building input values</legend>
        {SCHOOL_FIELDS.map(group => <fieldset className="assumption-group" key={group.title}>
          <legend>{group.title}</legend><div className="assumption-grid">{group.fields.map(field => <div className="form-field" key={field.key}>
            <label htmlFor={`input-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label>
            <input form="analysis-inputs" id={`input-${field.key}`} type="number" required min={field.min} max={field.max} step={field.step} value={Number.isFinite(school[field.key]) ? school[field.key] : ""} onChange={e => onSchool({ ...school, [field.key]: e.target.valueAsNumber })}/>
          </div>)}</div>
        </fieldset>)}
      </fieldset>
    </div>
  </details>;
}
