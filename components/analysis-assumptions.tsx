"use client";

/**
 * BUILDING INPUT EDITOR. This panel starts with the BEAST defaults and displays
 * the current editable assumptions, including any ComStock values applied.
 * school is the current input object. onSchool sends a replacement object to
 * app/page.tsx. The actual load equations remain in lib/school.ts.
 */


import type { Ref } from "react";
import { SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";

export function AnalysisAssumptions({ school, onSchool, ref }: {
  school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void;
  ref?: Ref<HTMLDetailsElement>;
}) {
  // ComStock averages can have fractional precision between the form's original increments.
  return <details ref={ref} className="analysis-assumptions" onInvalidCapture={event => { event.currentTarget.open = true; }}>
    <summary><span>Building characteristics and assumptions</span></summary>
    <div className="assumptions-body">
      <p className="assumption-intro">Total floor area includes all conditioned floors. Floors have equal areas; conditioned height is per floor.</p>
      <p className="assumption-intro">The thermostat deadband allows heating below its setpoint minus the band and cooling above its setpoint plus the band. Humidity control stays active. Design sizing uses the entered setpoints. Hourly results do not resolve individual compressor starts or minimum off-times.</p>
      <p className="assumption-intro">Packaged compressors stay off when their calculated total ON-time is below the minimum minutes per hour, including humidity-only cooling calls. Fans retain their ventilation schedule. Unserved loads are reported as unmet.</p>
      <fieldset className="assumptions-values"><legend className="sr-only">Building input values</legend>
        {SCHOOL_FIELDS.map(group => <fieldset className="assumption-group" key={group.title}>
          <legend>{group.title}</legend><div className="assumption-grid">{group.fields.map(field => <div className="form-field" key={field.key}>
            <label htmlFor={`input-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label>
            {field.options ? <select id={`input-${field.key}`} required value={school[field.key]} onChange={e => onSchool({ ...school, [field.key]: Number(e.target.value) })}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input id={`input-${field.key}`} type="number" required min={field.min} max={field.max} step="any" value={Number.isFinite(school[field.key]) ? school[field.key] : ""} onChange={e => onSchool({ ...school, [field.key]: e.target.valueAsNumber })}/>}
          </div>)}</div>
        </fieldset>)}
      </fieldset>
    </div>
  </details>;
}
