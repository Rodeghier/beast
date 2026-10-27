"use client";

import { SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";

export function AnalysisAssumptions({ school, onSchool }: {
  school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void;
}) {
  return <section className="analysis-assumptions" aria-label="Building characteristics and assumptions">
    <h2>Building characteristics and assumptions</h2>
    <p>Review the editable defaults before continuing. The current model represents a 150,000 ft² building.</p>
    {SCHOOL_FIELDS.map(group => <fieldset className="assumption-group" key={group.title}>
      <legend>{group.title}</legend><div className="assumption-grid">{group.fields.map(field => <div className="form-field" key={field.key}>
        <label htmlFor={`input-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label>
        <input form="analysis-inputs" id={`input-${field.key}`} type="number" required min={field.min} max={field.max} step={field.step} value={Number.isFinite(school[field.key]) ? school[field.key] : ""} onChange={e => onSchool({ ...school, [field.key]: e.target.valueAsNumber })}/>
      </div>)}</div>
    </fieldset>)}
    <p>Return-air temperature follows the modeled zone condition and return-air humidity uses the indoor RH target above. The heat-pump model calculates mixed-air dry bulb and wet bulb from these conditions and scheduled ventilation. Utility and emissions data are selected in results.</p>
  </section>;
}
