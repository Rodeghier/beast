"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Place } from "@/lib/climate";
import type { SchoolAssumptions } from "@/lib/school";

type Catalog = { county: string; countyFips: string; buildingTypes: string[]; error?: string };
type Characteristics = { assumptions: Partial<SchoolAssumptions>; error?: string };

export function ComstockInputs({ place, selectedType, onSelect }: {
  place: Place;
  selectedType: string;
  onSelect: (buildingType: string, assumptions: Partial<SchoolAssumptions>) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState(true);
  const [loadingType, setLoadingType] = useState("");
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const importRequest = useRef<AbortController | null>(null);
  const query = useMemo(() => new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), state: place.stateCode, county: place.county || "" }), [place]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/comstock?${query}`, { signal: controller.signal }).then(async response => {
      const payload = await response.json() as Catalog;
      if (!response.ok) throw new Error(payload.error || "ComStock building types could not be loaded.");
      if (!controller.signal.aborted) setCatalog(payload);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "ComStock building types could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [query]);

  useEffect(() => () => importRequest.current?.abort(), []);

  async function selectType(buildingType: string) {
    setError("");
    setImportedCount(null);
    if (!buildingType) {
      onSelect("", {});
      return;
    }
    const controller = new AbortController();
    importRequest.current = controller;
    setLoadingType(buildingType);
    const params = new URLSearchParams(query);
    params.set("buildingType", buildingType);
    params.set("characteristics", "true");
    try {
      const response = await fetch(`/api/comstock?${params}`, { signal: controller.signal });
      const payload = await response.json() as Characteristics;
      if (!response.ok) throw new Error(payload.error || "ComStock building characteristics could not be loaded.");
      if (controller.signal.aborted) return;
      onSelect(buildingType, payload.assumptions);
      setImportedCount(Object.keys(payload.assumptions).length);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "ComStock building characteristics could not be loaded.");
    } finally {
      if (!controller.signal.aborted) {
        importRequest.current = null;
        setLoadingType("");
      }
    }
  }

  return <section className="comstock-inputs" aria-label="ComStock building assumptions">
    <div><span className="eyebrow">OPTIONAL INPUT SOURCE</span><h3>ComStock building characteristics</h3><p>Select a county building type to fill the matching fields in Building characteristics and assumptions.</p></div>
    {busy && <p className="comstock-status" role="status"><LoaderCircle className="spin" size={16}/>Finding county building types.</p>}
    {error && <p className="comstock-status comstock-error" role="alert">{error}</p>}
    {catalog && <div className="comstock-controls">
      <label htmlFor="comstock-building-type">Building type<select id="comstock-building-type" value={loadingType || selectedType} disabled={!!loadingType} onChange={event => void selectType(event.target.value)}><option value="">Select a type available in {catalog.county}</option>{catalog.buildingTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <span>{catalog.county}, {place.stateCode} &middot; OEDI {catalog.countyFips}</span>
    </div>}
    {!busy && catalog?.buildingTypes.length === 0 && <p className="comstock-status">No county building type files were found for this location.</p>}
    {loadingType && <p className="comstock-status" role="status"><LoaderCircle className="spin" size={16}/>Loading {loadingType} characteristics.</p>}
    {importedCount !== null && <p className="comstock-status" role="status">{importedCount ? `Filled ${importedCount} building ${importedCount === 1 ? "field" : "fields"} from ${selectedType}.` : "No published characteristics for this type match a BEAST input."}</p>}
  </section>;
}
