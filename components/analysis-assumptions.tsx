"use client";

import { SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";
import { RTU_FIELDS, UNIT_SIZES, type RtuAssumptions } from "@/lib/rtu";

export function AnalysisAssumptions({ school, onSchool, rtu, onRtu }: {
  school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void;
  rtu: RtuAssumptions; onRtu: (value: RtuAssumptions) => void;
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
    <fieldset className="assumption-group"><legend>Equipment sizing assumptions</legend><div className="assumption-grid">
      <div className="form-field"><label htmlFor="input-maxTons">Maximum nominal unit size<span className="input-unit">tons per unit</span></label><select id="input-maxTons" form="analysis-inputs" className="field-select" value={rtu.maxTons} onChange={e => onRtu({ ...rtu, maxTons: Number(e.target.value) as RtuAssumptions["maxTons"] })}>{UNIT_SIZES.map(size => <option key={size} value={size}>{size} tons</option>)}</select></div>
      {RTU_FIELDS.map(field => <div className="form-field" key={field.key}><label htmlFor={`input-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label><input form="analysis-inputs" id={`input-${field.key}`} type="number" required min={field.min} max={field.max} step={field.step} value={Number.isFinite(rtu[field.key]) ? rtu[field.key] : ""} onChange={e => onRtu({ ...rtu, [field.key]: e.target.valueAsNumber })}/></div>)}
    </div></fieldset>
    <p>Utility rates are retrieved through OpenEI and EIA. CO₂ uses EPA data. Select the applicable utility tariff and EPA subregion in results; no manual rates or emissions factors are required.</p>
  </section>;
}
