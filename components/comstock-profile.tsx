"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, LoaderCircle } from "lucide-react";
import { InputModeChoice, InputSection } from "./input-section";
import type { Place } from "@/lib/climate";
import type { ComstockAnalysisInputs, ComstockGainHour, SchoolAssumptions } from "@/lib/school";

type Catalog = { county: string; countyFips: string; buildingTypes: string[] };
type MonthTotal = { month: string; mwh: number };
type ProfileSummary = { months: MonthTotal[]; models: number; floorArea: number; totalMwh: number };
type Characteristics = { assumptions: Partial<SchoolAssumptions>; representedWeight: number; county: string; countyFips: string; buildingType: string; error?: string };
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

function parseGainProfile(csv: string, representedWeight: number, utcOffset: number): ComstockGainHour[] {
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const index = (name: string) => header.indexOf(name);
  const timestampIndex = index("timestamp");
  const lightingIndex = index("out.electricity.interior_lighting.energy_consumption.kwh");
  const equipmentIndexes = ["electricity", "natural_gas", "propane", "fuel_oil", "other_fuel", "district_heating"].map(fuel => index(`out.${fuel}.interior_equipment.energy_consumption.kwh`)).filter(i => i >= 0);
  if (timestampIndex < 0 || lightingIndex < 0 || equipmentIndexes.length === 0) throw new Error("The ComStock profile is missing interior lighting or equipment end-use data.");
  const hours = new Map<string, { month: number; day: number; hour: number; lighting: number; equipment: number }>();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cells = line.split(",");
    const stamp = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(cells[timestampIndex] ?? "");
    if (!stamp) continue;
    const [, year, month, day, hour, minute] = stamp;
    const end = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) + (utcOffset + 5) * 3_600_000;
    const start = new Date(end - 15 * 60_000);
    const key = `${start.getUTCMonth() + 1}-${start.getUTCDate()}-${start.getUTCHours()}`;
    const current = hours.get(key) ?? { month: start.getUTCMonth() + 1, day: start.getUTCDate(), hour: start.getUTCHours(), lighting: 0, equipment: 0 };
    const number = (cell: string | undefined) => { const value = Number(cell); return Number.isFinite(value) && value > 0 ? value : 0; };
    current.lighting += number(cells[lightingIndex]);
    current.equipment += equipmentIndexes.reduce((sum, i) => sum + number(cells[i]), 0);
    hours.set(key, current);
  }
  if (hours.size < 8000 || !Number.isFinite(representedWeight) || representedWeight <= 0) throw new Error("The ComStock profile does not contain a complete year of building end-use data.");
  const btuPerKwh = 3412.141633;
  return [...hours.values()].map(hour => ({ month: hour.month, day: hour.day, hour: hour.hour, lightingBtuHr: hour.lighting * btuPerKwh / representedWeight, equipmentBtuHr: hour.equipment * btuPerKwh / representedWeight }));
}

export function ComstockProfile({ place, utcOffset, usingComstock, onUsingComstock, onInputs }: {
  place: Place; utcOffset: number | null; usingComstock: boolean; onUsingComstock: (value: boolean) => void; onInputs: (value: ComstockAnalysisInputs | null) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selectedType, setSelectedType] = useState("");
  const [customProfile, setCustomProfile] = useState(false);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [downloadCsv, setDownloadCsv] = useState("");
  const [busy, setBusy] = useState(true);
  const [characteristicBusy, setCharacteristicBusy] = useState(false);
  const [error, setError] = useState("");
  const [inputError, setInputError] = useState("");
  const [analysisInputs, setAnalysisInputs] = useState<ComstockAnalysisInputs | null>(null);
  const [gainProfile, setGainProfile] = useState<ComstockGainHour[] | null>(null);

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
    const profileUrl = `/api/comstock?${query}&buildingType=${encodeURIComponent(selectedType)}`;
    void fetch(profileUrl, { signal: controller.signal }).then(async profileResponse => {
      if (!profileResponse.ok) { const payload = await profileResponse.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || "The ComStock profile could not be loaded."); }
      const csv = await profileResponse.text();
      const summary = parseProfile(csv);
      let parsedGains: ComstockGainHour[] | null = null, gainError = "";
      if (utcOffset !== null) { try { parsedGains = parseGainProfile(csv, summary.models, utcOffset); } catch (cause) { gainError = cause instanceof Error ? cause.message : "ComStock internal-gain inputs could not be prepared."; } }
      else gainError = "The location's standard time zone could not be resolved for ComStock analysis inputs.";
      if (!controller.signal.aborted) { setProfile(summary); setDownloadCsv(csv); setGainProfile(parsedGains); setInputError(gainError); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The ComStock profile could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [selectedType, query, utcOffset]);

  async function useComstockInputs() {
    if (analysisInputs) { onUsingComstock(true); return; }
    if (!downloadCsv || !selectedType || utcOffset === null) return;
    setCharacteristicBusy(true); setInputError("");
    try {
      const response = await fetch(`/api/comstock?${query}&buildingType=${encodeURIComponent(selectedType)}&characteristics=true`);
      const characteristics = await response.json() as Characteristics;
      if (!response.ok) throw new Error(characteristics.error || "ComStock building characteristics could not be loaded.");
      const accurateGains = parseGainProfile(downloadCsv, characteristics.representedWeight, utcOffset);
      const inputs: ComstockAnalysisInputs = { assumptions: characteristics.assumptions, gainProfile: accurateGains, representedWeight: characteristics.representedWeight, county: characteristics.county, buildingType: selectedType };
      setAnalysisInputs(inputs); setGainProfile(accurateGains); onInputs(inputs); onUsingComstock(true);
    } catch (cause) {
      setInputError(cause instanceof Error ? cause.message : "ComStock building characteristics could not be loaded.");
    } finally { setCharacteristicBusy(false); }
  }

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
    {catalog && <InputSection title="Building profile inputs" description={selectedType || "Default assumptions"}><InputModeChoice custom={customProfile} disabled={characteristicBusy} onChange={next=>{setCustomProfile(next);if(!next){setBusy(false);setSelectedType("");setProfile(null);setDownloadCsv("");setAnalysisInputs(null);setGainProfile(null);setInputError("");onInputs(null);onUsingComstock(false);}}}/><div className="comstock-controls"><label htmlFor="comstock-building-type">Building type<select id="comstock-building-type" value={selectedType} disabled={characteristicBusy || !customProfile} onChange={event => { const value = event.target.value; setSelectedType(value); setProfile(null); setDownloadCsv(""); setAnalysisInputs(null); setGainProfile(null); setInputError(""); onInputs(null); onUsingComstock(false); setError(""); setBusy(!!value); }}><option value="">Select a type available in {catalog.county}</option>{catalog.buildingTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label><span>{catalog.county}, {place.stateCode} · OEDI {catalog.countyFips}</span></div></InputSection>}
    {!busy && catalog?.buildingTypes.length === 0 && <p className="comstock-status">No county aggregate files were found for this location.</p>}
    {profile && <><div className="comstock-summary"><div><span>Models represented</span><strong>{profile.models.toLocaleString()}</strong></div><div><span>Floor area represented</span><strong>{Math.round(profile.floorArea).toLocaleString()} ft²</strong></div><div><span>Annual site energy</span><strong>{profile.totalMwh.toLocaleString()} MWh</strong></div></div><div className="comstock-chart" aria-label={`Monthly site energy for ${selectedType} in ${catalog?.county} County`}><ResponsiveContainer width="100%" height="100%"><BarChart data={profile.months} margin={{ top: 12, right: 18, bottom: 2, left: 0 }}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month"/><YAxis tickFormatter={value => `${Number(value).toLocaleString()} MWh`} width={92}/><Tooltip formatter={(value) => [`${Number(value).toLocaleString()} MWh`, "Site energy"]}/><Bar dataKey="mwh" name="Site energy" fill="#38685f" radius={[3, 3, 0, 0]}/></BarChart></ResponsiveContainer></div><InputSection title="Building analysis source" description={usingComstock?"ComStock":"Building assumptions"}><div className="comstock-input-choice" role="radiogroup" aria-label="Building inputs for BEAST"><strong>Building inputs for BEAST</strong><label><input type="radio" name="comstock-analysis-source" checked={!usingComstock && !characteristicBusy} onChange={() => onUsingComstock(false)}/> Use editable assumptions</label><label><input type="radio" name="comstock-analysis-source" checked={usingComstock || characteristicBusy} disabled={!gainProfile || busy || characteristicBusy} onChange={() => void useComstockInputs()}/> {characteristicBusy ? "Loading ComStock characteristics…" : "Use ComStock characteristics and end-use profile"}</label></div></InputSection>{inputError && <p className="comstock-status comstock-error" role="alert">{inputError}</p>}{usingComstock && <p className="comstock-source-note" role="status">BEAST uses the weighted average floor area, weekday hours, people count, thermostat and envelope characteristics where available. ComStock 2018 lighting and interior-equipment energy shapes supply internal heat gains; solar gains are calculated from ComStock envelope characteristics and the selected climate weather. Characteristics absent from the release retain the editable values.</p>}<div className="comstock-footer"><p>This is a county-weighted profile, reduced to a representative model for BEAST&rsquo;s single-building load analysis. The ComStock lighting and equipment shape is from 2018 and is reused across the selected climate year.</p><button className="button secondary" type="button" onClick={download}><Download size={16}/>Download 15-minute CSV</button></div></>}
  </section>;
}
