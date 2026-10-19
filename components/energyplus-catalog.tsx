"use client";

import { useId, useMemo, useState } from "react";
import { Download } from "lucide-react";
import coverage from "@/lib/data/energyplus/coverage.json";
import { ENERGYPLUS_VERSION } from "@/lib/energyplus";

export function EnergyPlusCatalog() {
  const id = useId(), [search, setSearch] = useState(""), [status, setStatus] = useState("all");
  const rows = useMemo(() => coverage.equipmentTypes.filter(row => (status === "all" || row.status === status)
    && `${row.object_type} ${row.group} ${row.reason}`.toLowerCase().includes(search.toLowerCase())), [search, status]);
  return <details className="catalog-details energyplus-catalog">
    <summary>EnergyPlus {ENERGYPLUS_VERSION} equipment, curve data & integration limits</summary>
    <p>{coverage.counts.coolingProfiles} cooling and {coverage.counts.heatingProfiles} heating profiles are available in the equipment selectors. These single-speed profiles retain source COP, rated airflow and cooling SHR, and scale capacity to the selected nominal tons. Heating retains the source heating/cooling capacity ratio. Source curves are evaluated with their stated input and output limits.</p>
    <p>BEAST adapts these profiles to its CAV air path. Defrost, crankcase heaters, off-cycle moisture and stage modulation are excluded. Dataset names refer to historical reference data; they do not establish current product availability. Curve data alone cannot supply the missing plant, refrigerant, zone or storage models for other equipment.</p>
    {coverage.excludedProfiles.map(profile => <p key={`${profile.dataset}:${profile.name}`}><strong>Excluded: {profile.name}.</strong> {profile.reason}</p>)}
    <div className="energyplus-downloads">
      <a className="button secondary" href="/data/energyplus-curve-fits.csv" download><Download size={16}/>All curve fit data CSV</a>
      <a className="button secondary" href="/data/energyplus-equipment.csv" download><Download size={16}/>Dataset equipment CSV</a>
      <a className="button secondary" href="/data/energyplus-coverage.csv" download><Download size={16}/>Coverage & reasons CSV</a>
    </div>
    <p>The curve CSV contains all {coverage.counts.curveObjects.toLocaleString()} curve/table objects and embedded equation-fit coefficients in the pinned equipment libraries, including those exported for reference only. Each row identifies its equipment association, coefficients, limits, complete source fields and source link. Unattached curves remain identifiable. The coverage CSV accounts for every object in the release dictionary; the table below lists its {coverage.counts.equipmentTypes} equipment types.</p>
    <div className="energyplus-filters">
      <div className="form-field"><label htmlFor={`${id}-search`}>Find an equipment type or reason</label><input id={`${id}-search`} type="search" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <div className="form-field"><label htmlFor={`${id}-status`}>Integration status</label><select id={`${id}-status`} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All equipment types</option><option value="adapted">Selectable curve profiles</option><option value="existing-simplification">Existing simplified model</option><option value="not-integrated">Not integrated</option></select></div>
    </div>
    <p role="status">{rows.length} equipment types shown</p>
    <div className="comparison-table-scroll energyplus-table" tabIndex={0} aria-label="EnergyPlus equipment integration coverage">
      <table className="comparison-table"><thead><tr><th scope="col">EnergyPlus equipment type</th><th scope="col">Status</th><th scope="col">Reason / model limits</th></tr></thead><tbody>{rows.map(row => <tr key={row.object_type}><th scope="row"><a href={row.source_url} target="_blank" rel="noreferrer">{row.object_type}</a></th><td>{row.status === "adapted" ? `Curve adaptation · ${row.selectable_profiles} profiles` : row.status === "existing-simplification" ? "Existing simplified model" : "Not integrated"}</td><td>{row.reason}</td></tr>)}</tbody></table>
    </div>
    <p><a href={`https://github.com/NatLabRockies/EnergyPlus/releases/tag/v${ENERGYPLUS_VERSION}`} target="_blank" rel="noreferrer">Official release</a> · <a href="/data/energyplus-method.md" target="_blank" rel="noreferrer">Data scope and method</a>. This is a BEAST screening calculation; it does not run the EnergyPlus simulation engine.</p>
  </details>;
}
