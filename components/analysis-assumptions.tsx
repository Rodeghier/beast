"use client";

/**
 * BUILDING INPUT EDITOR. This panel starts with the BEAST defaults and displays
 * the current editable assumptions, including any ComStock values applied.
 * school is the current input object. onSchool sends a replacement object to
 * app/page.tsx. The actual load equations remain in lib/school.ts.
 */


import type { Ref } from "react";
import { COMSTOCK_CONSTRUCTION_SOURCE, ENVELOPE_PRESETS, type EnvelopeSurface, FLOAT_GLASS_SOURCE, MATERIAL_PROPERTY_SOURCE, SUPERMARKET_ROOF_SOURCE, WOOD_FRAMING_SOURCE } from "@/lib/envelope-construction";
import { applyEnvelopePreset, DEFAULT_SCHOOL, ENVELOPE_FIELDS, ENVELOPE_SURFACES, SCHOOL_FIELDS, selectedEnvelopeProfile, type SchoolAssumptions, type SchoolField } from "@/lib/school";
import { INTERNAL_MASS_SOURCE } from "@/lib/thermal-mass";

const materialNumber = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 2 });
const stockShare = new Intl.NumberFormat(undefined, { style: "percent", maximumSignificantDigits: 2 });

type EditorProps = { school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void };

function AssumptionInput({ school, onSchool, field, disabled }: EditorProps & { field: SchoolField; disabled?: boolean }) {
  const value = school[field.key] ?? DEFAULT_SCHOOL[field.key];
  const id = `input-${field.key}`;
  return <div className="form-field">
    <label htmlFor={id}>{field.label}<span className="input-unit">{field.unit}</span></label>
    {field.options
      ? <select id={id} required value={value} onChange={e => onSchool({ ...school, [field.key]: Number(e.target.value) })}>
        {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      : <input id={id} type="number" required min={field.min} max={field.max} step="any" disabled={disabled}
        value={Number.isFinite(value) ? value : ""} onChange={e => onSchool({ ...school, [field.key]: e.target.valueAsNumber })}/>}
  </div>;
}

function MaterialInput({ school, onSchool, surface }: EditorProps & { surface: EnvelopeSurface }) {
  const { label } = ENVELOPE_FIELDS[surface];
  const imported = school.construction?.[surface];
  const selection = school.materialPresets?.[surface] ?? (imported ? "stock" : ENVELOPE_PRESETS[surface][0].id);
  const profile = selectedEnvelopeProfile(school, surface);
  const id = `input-${surface}-material`;
  return <div className="form-field">
    <label htmlFor={id}>{label} material
      {profile.share !== undefined && <span className="input-unit">{stockShare.format(profile.share)} of represented county buildings of this type</span>}
    </label>
    <select id={id} value={selection} onChange={e => onSchool(applyEnvelopePreset(school, surface, e.target.value))}>
      {imported && <option value="stock">{imported.label} (ComStock)</option>}
      {ENVELOPE_PRESETS[surface].map(preset => <option key={preset.id} value={preset.id}>{preset.profile.label}</option>)}
    </select>
  </div>;
}

function MaterialProperties({ school }: { school: SchoolAssumptions }) {
  const surfaces = ENVELOPE_SURFACES.map(surface => ({
    name: ENVELOPE_FIELDS[surface].label, profile: selectedEnvelopeProfile(school, surface),
  }));
  return <details>
      <summary>Representative material properties</summary>
      <div className="rate-scroll">
        <table>
          <thead><tr><th scope="col">Surface</th><th scope="col">Material</th><th scope="col">Thickness (mm)</th><th scope="col">Area share</th><th scope="col">Conductivity (W/m·K)</th><th scope="col">Density (kg/m³)</th><th scope="col">Specific heat (J/kg·K)</th></tr></thead>
          <tbody>{surfaces.flatMap(({ name, profile }) => profile.layers.map(layer => <tr key={`${name}-${layer.material}`}>
            <td>{name}</td><th scope="row">{layer.material}</th>
            <td>{materialNumber.format(layer.thicknessM * 1000)}</td>
            <td>{stockShare.format(layer.areaFraction ?? 1)}</td>
            <td>{materialNumber.format(layer.conductivityWmK)}</td>
            <td>{materialNumber.format(layer.densityKgM3)}</td>
            <td>{materialNumber.format(layer.specificHeatJKgK)}</td>
          </tr>))}</tbody>
        </table>
      </div>
      <p className="assumption-intro">Heat capacity sums density × specific heat × thickness × area share. Glazing assumes 6 mm of glass per pane. <a href={MATERIAL_PROPERTY_SOURCE} target="_blank" rel="noreferrer">LBNL material data</a> · <a href={WOOD_FRAMING_SOURCE} target="_blank" rel="noreferrer">Wood framing reference</a> · <a href={FLOAT_GLASS_SOURCE} target="_blank" rel="noreferrer">Float glass properties</a></p>
  </details>;
}

export function AnalysisAssumptions({ school, onSchool, ref, summerOccupancyEditable = true }: {
  school: SchoolAssumptions; onSchool: (value: SchoolAssumptions) => void;
  ref?: Ref<HTMLDetailsElement>;
  summerOccupancyEditable?: boolean;
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
          <legend>{group.title}</legend>
          {group.title === "ASHRAE design sizing" && <p className="assumption-intro">The Radiant Time Series (RTS) construction class and carpet coverage affect peak cooling. Annual loads use the editable heat capacities in the envelope section.</p>}
          {group.title === "Occupancy schedule" && <p className="assumption-intro">Matching start and end hours mark a closed period. An end before the start continues into the next day. June–August occupancy can be reduced for schools.</p>}
          {group.title === "Envelope and outdoor air" && <>
            <p className="assumption-intro">Changing a material sets its assembly U-value or slab F₂ and heat capacity. Both can be edited.</p>
            {school.construction && <p className="assumption-intro">ComStock construction defaults for {school.construction.buildingType} in {school.construction.county}, {school.construction.state}. <a href={COMSTOCK_CONSTRUCTION_SOURCE} target="_blank" rel="noreferrer">ComStock construction methods</a>{school.construction.buildingType === "Grocery" && <> · <a href={SUPERMARKET_ROOF_SOURCE} target="_blank" rel="noreferrer">PNNL grocery roof template</a></>}</p>}
            {ENVELOPE_SURFACES.map(surface => {
              const { coefficient, capacity } = ENVELOPE_FIELDS[surface];
              const fields = group.fields.filter(field => field.key === coefficient || field.key === capacity);
              return <div key={surface} className="assumption-grid envelope-material-row">
                <MaterialInput school={school} onSchool={onSchool} surface={surface}/>
                {fields.map(field => <AssumptionInput key={field.key} school={school} onSchool={onSchool} field={field}/>)}
              </div>;
            })}
            <MaterialProperties school={school}/>
            <p className="assumption-intro">{school.interiorMassSource ? <>Interior thermal mass default · {school.interiorMassSource}. </> : <>Interior thermal mass represents partitions, elevated floors and furnishings. </>}{school.construction?.interiorMassAreaRatio !== undefined && <>Reported surface area per floor area is {school.construction.interiorMassAreaRatio}. <a href={INTERNAL_MASS_SOURCE} target="_blank" rel="noreferrer">OpenStudio prototype reference</a></>}</p>
          </>}
          <div className="assumption-grid">{group.fields.filter(field => !ENVELOPE_SURFACES.some(surface => {
            const { coefficient, capacity } = ENVELOPE_FIELDS[surface];
            return field.key === coefficient || field.key === capacity;
          })).map(field => <AssumptionInput key={field.key} school={school} onSchool={onSchool} field={field}
            disabled={field.key === "summerPercent" && !summerOccupancyEditable}/>)}</div>
        </fieldset>)}
      </fieldset>
    </div>
  </details>;
}
