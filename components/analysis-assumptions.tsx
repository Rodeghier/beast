"use client";

/**
 * BUILDING INPUT EDITOR. This panel starts with the BEAST defaults and displays
 * the current editable assumptions, including any ComStock values applied.
 * school is the current input object. onSchool sends a replacement object to
 * app/page.tsx. The actual load equations remain in lib/school.ts.
 */


import type { Ref } from "react";
import { COMSTOCK_CONSTRUCTION_SOURCE, FLOAT_GLASS_SOURCE, MATERIAL_PROPERTY_SOURCE, SUPERMARKET_ROOF_SOURCE, WOOD_FRAMING_SOURCE } from "@/lib/envelope-construction";
import { DEFAULT_SCHOOL, SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";

const materialNumber = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 2 });
const stockShare = new Intl.NumberFormat(undefined, { style: "percent", maximumSignificantDigits: 2 });

function ConstructionDetails({ school }: { school: SchoolAssumptions }) {
  const construction = school.construction;
  if (!construction) return null;
  const windowU = school.windowU ?? DEFAULT_SCHOOL.windowU;
  const surfaces = [
    { name: "Opaque wall", profile: construction.wall, coefficient: school.wallU, unit: "BTU/(hr·ft²·°F)" },
    { name: "Roof", profile: construction.roof, coefficient: school.roofU, unit: "BTU/(hr·ft²·°F)" },
    { name: "Windows", profile: construction.window, coefficient: windowU, unit: "BTU/(hr·ft²·°F)" },
    { name: "Slab", profile: construction.slab, coefficient: school.slabF2, unit: "BTU/(hr·ft·°F)" },
  ];
  return <fieldset className="assumption-group">
    <legend>Envelope construction · {construction.buildingType}</legend>
    <p className="assumption-intro">Source area {construction.county}, {construction.state}. The representative layers estimate heat storage. Annual loads and design sizing use the editable assembly U-values and slab edge F₂ above.</p>
    <div className="rate-scroll">
      <table>
        <thead><tr><th scope="col">Surface</th><th scope="col">Construction basis</th><th scope="col">Model U-value or slab F₂</th><th scope="col">Nominal heat capacity<br/>kJ/(m²·K)</th></tr></thead>
        <tbody>
          {surfaces.map(({ name, profile, coefficient, unit }) => <tr key={name}>
            <th scope="row">{name}</th>
            <td>{profile ? <>{profile.label}<br/>{profile.source}{profile.share !== undefined && ` · ${stockShare.format(profile.share)} of represented stock`}</> : "Construction unavailable"}</td>
            <td>{Number.isFinite(coefficient) ? `${coefficient} ${unit}` : "—"}</td>
            <td>{profile?.arealHeatCapacityKjM2K != null ? materialNumber.format(profile.arealHeatCapacityKjM2K) : "—"}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {surfaces.some(({ profile }) => profile?.layers.length) && <details>
      <summary>Representative material properties</summary>
      <div className="rate-scroll">
        <table>
          <thead><tr><th scope="col">Surface</th><th scope="col">Material</th><th scope="col">Thickness (mm)</th><th scope="col">Area share</th><th scope="col">Conductivity (W/m·K)</th><th scope="col">Density (kg/m³)</th><th scope="col">Specific heat (J/kg·K)</th></tr></thead>
          <tbody>{surfaces.flatMap(({ name, profile }) => (profile?.layers ?? []).map(layer => <tr key={`${name}-${layer.material}`}>
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
    </details>}
    <p className="assumption-intro"><a href={COMSTOCK_CONSTRUCTION_SOURCE} target="_blank" rel="noreferrer">ComStock construction methods</a>{construction.buildingType === "Grocery" && <> · <a href={SUPERMARKET_ROOF_SOURCE} target="_blank" rel="noreferrer">PNNL supermarket roof template</a></>}</p>
  </fieldset>;
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
          {group.title === "Occupancy schedule" && <p className="assumption-intro">Matching start and end hours mark a closed period. An end before the start continues into the next day. June–August occupancy can be reduced for schools.</p>}
          <div className="assumption-grid">{group.fields.map(field => {
            const value = school[field.key] ?? DEFAULT_SCHOOL[field.key];
            return <div className="form-field" key={field.key}>
              <label htmlFor={`input-${field.key}`}>{field.label}<span className="input-unit">{field.unit}</span></label>
              {field.options ? <select id={`input-${field.key}`} required value={value} onChange={e => onSchool({ ...school, [field.key]: Number(e.target.value) })}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input id={`input-${field.key}`} type="number" required min={field.min} max={field.max} step="any" disabled={field.key === "summerPercent" && !summerOccupancyEditable} value={Number.isFinite(value) ? value : ""} onChange={e => onSchool({ ...school, [field.key]: e.target.valueAsNumber })}/>}
            </div>;
          })}</div>
        </fieldset>)}
        <ConstructionDetails school={school}/>
      </fieldset>
    </div>
  </details>;
}
