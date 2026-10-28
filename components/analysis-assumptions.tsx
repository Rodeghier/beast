"use client";

import { useState } from "react";
import { DEFAULT_SCHOOL, SCHOOL_AREA, SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";
import { InputModeChoice, InputSection } from "./input-section";

function AssumptionGroup({ group, school, onSchool }: {
  group: typeof SCHOOL_FIELDS[number]; school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void;
}) {
  const [custom, setCustom] = useState(() => group.fields.some(({key}) => school[key] !== DEFAULT_SCHOOL[key]));
  return <InputSection title={group.title} description={custom ? "Custom values" : "Default values"}>
    <InputModeChoice custom={custom} onChange={next => {
      setCustom(next);
      if (!next) onSchool({ ...school, ...Object.fromEntries(group.fields.map(({key}) => [key,DEFAULT_SCHOOL[key]])) });
    }}/>
    <fieldset className="assumption-group" disabled={!custom}>
      <legend className="sr-only">{group.title}</legend><div className="assumption-grid">{group.fields.map(field => <div className="form-field" key={field.key}>
        <label htmlFor={`input-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label>
        <input form="analysis-inputs" id={`input-${field.key}`} type="number" required min={field.min} max={field.max} step={field.step} value={Number.isFinite(school[field.key]) ? school[field.key] : ""} onChange={e => onSchool({ ...school, [field.key]: e.target.valueAsNumber })}/>
      </div>)}</div>
    </fieldset>
  </InputSection>;
}

export function AnalysisAssumptions({ school, onSchool }: {
  school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void;
}) {
  return <section className="analysis-assumptions" aria-label="Building characteristics and assumptions">
    <h2>Building characteristics and assumptions</h2>
    <p>{SCHOOL_AREA.toLocaleString()} ft² building</p>
    {SCHOOL_FIELDS.map(group => <AssumptionGroup key={group.title} group={group} school={school} onSchool={onSchool}/>)}
  </section>;
}
