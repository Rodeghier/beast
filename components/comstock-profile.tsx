"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, LoaderCircle } from "lucide-react";
import type { Place } from "@/lib/climate";

type Catalog = { county: string; countyFips: string; buildingTypes: string[] };
type MonthTotal = { month: string; mwh: number };
type ProfileSummary = { months: MonthTotal[]; models: number; floorArea: number; totalMwh: number };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseProfile(csv: string): ProfileSummary {
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const index = (name: string) => header.indexOf(name);
  const timestampIndex = index("timestamp");
  const modelsIndex = index("models_used");
  const areaIndex = index("floor_area_represented");
  const energyIndex = index("out.site_energy.total.energy_consumption.kwh");
  if ([timestampIndex, modelsIndex, areaIndex, energyIndex].some(i => i < 0)) throw new Error("The OEDI file has an unexpected column layout.");
  const totals = Array.from({ length: 12 }, () => 0);
  let models = 0, floorArea = 0;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cells = line.split(",");
    const month = Number(cells[timestampIndex]?.slice(5, 7)) - 1;
    const energy = Number(cells[energyIndex]);
    if (month < 0 || month > 11 || !Number.isFinite(energy)) continue;
    totals[month] += energy;
    if (!models) models = Number(cells[modelsIndex]) || 0;
    if (!floorArea) floorArea = Number(cells[areaIndex]) || 0;
  }
  const months = totals.map((kwh, i) => ({ month: MONTHS[i], mwh: Math.round(kwh / 1000) }));
  return { months, models, floorArea, totalMwh: Math.round(totals.reduce((sum, value) => sum + value, 0) / 1000) };
}

export function ComstockProfile({ place }: { place: Place }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selectedType, setSelectedType] = useState("");
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [downloadCsv, setDownloadCsv] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), state: place.stateCode, county: place.county || "" }), [place.latitude, place.longitude, place.stateCode, place.county]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/comstock?${query}`, { signal: controller.signal }).then(async response => {
      const payload = await response.json() as Catalog & { error?: string };
      if (!response.ok) throw new Error(payload.error || "ComStock profile options could not be loaded.");
      if (!controller.signal.aborted) setCatalog(payload);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "ComStock profile options could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    if (!selectedType) return;
    const controller = new AbortController();
    void fetch(`/api/comstock?${query}&buildingType=${encodeURIComponent(selectedType)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "The ComStock profile could not be loaded.");
      }
      const csv = await response.text();
      const summary = parseProfile(csv);
      if (!controller.signal.aborted) { setProfile(summary); setDownloadCsv(csv); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The ComStock profile could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [selectedType, query]);

  function download() {
    if (!downloadCsv || !catalog) return;
    const url = URL.createObjectURL(new Blob([downloadCsv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `comstock-${place.stateCode}-${catalog.countyFips}-${selectedType.toLowerCase()}-2018.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="comstock-profile" aria-label="County ComStock aggregate profile">
    <div className="comstock-heading"><div><span className="eyebrow">COMSTOCK COUNTY PROFILE</span><h3>Aggregate commercial building energy</h3><p>2018 actual weather · 15-minute end-use energy, weighted across models of the selected building type in this county.</p></div></div>
    {busy && <p className="comstock-status" role="status"><LoaderCircle className="spin" size={16}/> {selectedType ? `Loading ${selectedType} profile…` : "Finding county profiles…"}</p>}
    {error && <p className="comstock-status comstock-error" role="alert">{error}</p>}
    {catalog && <div className="comstock-controls"><label htmlFor="comstock-building-type">Building type<select id="comstock-building-type" value={selectedType} onChange={event => { const value = event.target.value; setSelectedType(value); setProfile(null); setDownloadCsv(""); setError(""); setBusy(!!value); }}><option value="">Select a type available in {catalog.county}</option>{catalog.buildingTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label><span>{catalog.county}, {place.stateCode} · OEDI {catalog.countyFips}</span></div>}
    {!busy && catalog?.buildingTypes.length === 0 && <p className="comstock-status">No county aggregate files were found for this location.</p>}
    {profile && <><div className="comstock-summary"><div><span>Models represented</span><strong>{profile.models.toLocaleString()}</strong></div><div><span>Floor area represented</span><strong>{Math.round(profile.floorArea).toLocaleString()} ft²</strong></div><div><span>Annual site energy</span><strong>{profile.totalMwh.toLocaleString()} MWh</strong></div></div><div className="comstock-chart" aria-label={`Monthly site energy for ${selectedType} in ${catalog?.county} County`}><ResponsiveContainer width="100%" height="100%"><BarChart data={profile.months} margin={{ top: 12, right: 18, bottom: 2, left: 0 }}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month"/><YAxis tickFormatter={value => `${Number(value).toLocaleString()} MWh`} width={92}/><Tooltip formatter={(value) => [`${Number(value).toLocaleString()} MWh`, "Site energy"]}/><Bar dataKey="mwh" name="Site energy" fill="#38685f" radius={[3, 3, 0, 0]}/></BarChart></ResponsiveContainer></div><div className="comstock-footer"><p>This is an aggregate county load profile, not a single building. It is a reference dataset and does not replace BEAST&rsquo;s editable single-building load assumptions.</p><button className="button secondary" type="button" onClick={download}><Download size={16}/>Download 15-minute CSV</button></div></>}
  </section>;
}
