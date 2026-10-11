"use client";

import { SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";
import { RTU_FIELDS, UNIT_SIZES, type RtuAssumptions } from "@/lib/rtu";

export const DEFAULT_ENERGY = { electricityRate: 0.15, gasRate: 1.2, electricityCo2: 0.4, gasCo2: 5.3 };
export type EnergyAssumptions = typeof DEFAULT_ENERGY;
const ENERGY_FIELDS: { key: keyof EnergyAssumptions; label: string; unit: string }[] = [
  { key: "electricityRate", label: "Electricity price", unit: "$/kWh" },
  { key: "gasRate", label: "Natural gas price", unit: "$/therm" },
  { key: "electricityCo2", label: "Electricity CO₂ factor", unit: "kg CO₂/kWh" },
  { key: "gasCo2", label: "Natural gas CO₂ factor", unit: "kg CO₂/therm" },
];

export function AnalysisAssumptions({ school, onSchool, rtu, onRtu, energy, onEnergy }: {
  school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void;
  rtu: RtuAssumptions; onRtu: (value: RtuAssumptions) => void;
  energy: EnergyAssumptions; onEnergy: (value: EnergyAssumptions) => void;
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
    <fieldset className="assumption-group"><legend>Utility cost and CO₂ assumptions</legend>
      <p>Illustrative flat rates and emissions factors, not location-specific tariffs or future projections. Replace these defaults with values appropriate to your building. Cost excludes demand charges, fixed charges, and taxes; CO₂ includes electricity generation and direct gas combustion.</p>
      <div className="assumption-grid">{ENERGY_FIELDS.map(field => <div className="form-field" key={field.key}><label htmlFor={`input-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label><input form="analysis-inputs" id={`input-${field.key}`} type="number" required min={0} step="any" value={Number.isFinite(energy[field.key]) ? energy[field.key] : ""} onChange={e => onEnergy({ ...energy, [field.key]: e.target.valueAsNumber })}/></div>)}</div>
    </fieldset>
  </section>;
}
