"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Place } from "@/lib/climate";
import { SCHOOL_FIELDS, type SchoolAssumptions } from "@/lib/school";

type Catalog = { county: string; countyFips: string; buildingTypes: string[] };
type Characteristics = { assumptions: Partial<SchoolAssumptions>; county: string; countyFips: string; buildingType: string; error?: string };
const FIELD_DETAILS = new Map(SCHOOL_FIELDS.flatMap(group => group.fields.map(field => [field.key, field] as const)));

export function ComstockInputs({ place, selectedType, onSelectedType, usingComstock, onUsingComstock, onAssumptions }: {
  place: Place;
  selectedType: string;
  onSelectedType: (value: string) => void;
  usingComstock: boolean;
  onUsingComstock: (value: boolean) => void;
  onAssumptions: (value: Partial<SchoolAssumptions> | null) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [characteristics, setCharacteristics] = useState<Partial<SchoolAssumptions> | null>(null);
  const [busy, setBusy] = useState(true);
  const [characteristicBusy, setCharacteristicBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useMemo(() => new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), state: place.stateCode, county: place.county || "" }), [place]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/comstock?${query}`, { signal: controller.signal }).then(async response => {
      const payload = await response.json() as Catalog & { error?: string };
      if (!response.ok) throw new Error(payload.error || "ComStock building types could not be loaded.");
      if (!controller.signal.aborted) setCatalog(payload);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "ComStock building types could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    if (!selectedType) return;
    const controller = new AbortController();
    setCharacteristicBusy(true);
    void fetch(`/api/comstock?${query}&buildingType=${encodeURIComponent(selectedType)}&characteristics=true`, { signal: controller.signal }).then(async response => {
      const payload = await response.json() as Characteristics;
      if (!response.ok) throw new Error(payload.error || "ComStock building characteristics could not be loaded.");
      if (!controller.signal.aborted) { setCharacteristics(payload.assumptions); onAssumptions(payload.assumptions); }
    }).catch(cause => { if (!controller.signal.aborted) { setCharacteristics(null); onAssumptions(null); setError(cause instanceof Error ? cause.message : "ComStock building characteristics could not be loaded."); } })
      .finally(() => { if (!controller.signal.aborted) setCharacteristicBusy(false); });
    return () => controller.abort();
  }, [selectedType, query, onAssumptions]);

  return <section className="comstock-inputs" aria-label="ComStock building assumptions">
    <div><span className="eyebrow">OPTIONAL INPUT SOURCE</span><h3>ComStock building characteristics</h3><p>Select a county building type to fill matching BEAST assumptions. BEAST continues to calculate loads and equipment results with its existing model.</p></div>
    {busy && <p className="comstock-status" role="status"><LoaderCircle className="spin" size={16}/>Finding county building types…</p>}
    {error && <p className="comstock-status comstock-error" role="alert">{error}</p>}
    {catalog && <div className="comstock-controls">
      <label htmlFor="comstock-building-type">Building type<select id="comstock-building-type" value={selectedType} disabled={characteristicBusy} onChange={event => {
        const value = event.target.value; onSelectedType(value); setCharacteristics(null); onAssumptions(null); onUsingComstock(false); setError("");
      }}><option value="">Select a type available in {catalog.county}</option>{catalog.buildingTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <span>{catalog.county}, {place.stateCode} · OEDI {catalog.countyFips}</span>
    </div>}
    {!busy && catalog?.buildingTypes.length === 0 && <p className="comstock-status">No county building type files were found for this location.</p>}
    {selectedType && characteristics && <div className="comstock-input-choice" role="radiogroup" aria-label="Building assumptions for BEAST">
      <strong>Values used by BEAST</strong>
      <label><input type="radio" name="comstock-input-source" checked={!usingComstock} onChange={() => onUsingComstock(false)}/> Use editable assumptions</label>
      <label><input type="radio" name="comstock-input-source" checked={usingComstock} disabled={!Object.keys(characteristics).length || characteristicBusy} onChange={() => onUsingComstock(true)}/> Use ComStock characteristics</label>
    </div>}
    {selectedType && characteristics && Object.keys(characteristics).length > 0 && <dl className="comstock-values">{Object.entries(characteristics).map(([key, value]) => { const field = FIELD_DETAILS.get(key as keyof SchoolAssumptions); return <div key={key}><dt>{field?.label || key}</dt><dd>{Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{field?.unit ? ` ${field.unit}` : ""}</dd></div>; })}</dl>}
    {selectedType && characteristics && Object.keys(characteristics).length === 0 && <p className="comstock-status">No published characteristics for this type match a BEAST input. Editable values remain in use.</p>}
    {characteristicBusy && <p className="comstock-status" role="status"><LoaderCircle className="spin" size={16}/>Loading {selectedType} characteristics…</p>}
    {usingComstock && characteristics && <p className="comstock-source-note" role="status">Only available characteristics that match BEAST’s existing input fields are substituted. Other assumptions keep their current values; the BEAST load, solar gain and equipment calculations remain unchanged.</p>}
  </section>;
}
