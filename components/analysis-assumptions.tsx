"use client";

import { useState } from "react";
import { DEFAULT_SCHOOL, SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";
import { InputModeChoice, InputSection } from "./input-section";

function AssumptionGroup({ group, school, onSchool, disabled }: {
  group: typeof SCHOOL_FIELDS[number]; school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void; disabled: boolean;
}) {
  const [custom, setCustom] = useState(() => group.fields.some(({key}) => school[key] !== DEFAULT_SCHOOL[key]));
  return <InputSection title={group.title} description={disabled ? "ComStock values" : custom ? "Custom values" : "Default values"}>
    {!disabled && <InputModeChoice custom={custom} onChange={next => {
      setCustom(next);
      if (!next) onSchool({ ...school, ...Object.fromEntries(group.fields.map(({key}) => [key,DEFAULT_SCHOOL[key]])) });
    }}/>}
    <fieldset className="assumption-group" disabled={disabled || !custom}>
      <legend className="sr-only">{group.title}</legend><div className="assumption-grid">{group.fields.map(field => <div className="form-field" key={field.key}>
        <label htmlFor={`input-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label>
        <input form="analysis-inputs" id={`input-${field.key}`} type="number" required min={field.min} max={field.max} step={field.step} value={Number.isFinite(school[field.key]) ? school[field.key] : ""} onChange={e => onSchool({ ...school, [field.key]: e.target.valueAsNumber })}/>
      </div>)}</div>
    </fieldset>
  </InputSection>;
}

export function AnalysisAssumptions({ school, onSchool, disabled = false, sourceNote }: {
  school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void; disabled?: boolean; sourceNote?: string;
}) {
  return <section className="analysis-assumptions" aria-label="Building characteristics and assumptions">
    <h2>Building characteristics and assumptions</h2>
    <p>{school.floorArea.toLocaleString()} ft² building</p>
    {sourceNote && <p className="field-hint">{sourceNote}</p>}
    {SCHOOL_FIELDS.map(group => <AssumptionGroup key={group.title} group={group} school={school} onSchool={onSchool} disabled={disabled}/>)}
  </section>;
}
