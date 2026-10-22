"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3, Download, Droplets, ExternalLink, Globe2, Info, LoaderCircle, MapPin, SlidersHorizontal, Table2, Thermometer, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { STATES, MIN_YEAR, MAX_YEAR, supportsClimate, type Place } from "@/lib/climate";
import { parseClimateCsv, type ClimateData } from "@/lib/csv";
import { solarLocation } from "@/lib/solar";
import { DEFAULT_SCHOOL, simulateSchool, validateSchool, type SchoolAssumptions } from "@/lib/school";
import { autosizePackaged, simulateEquipment, equipmentResultsCsv, equipmentComparisonCsv } from "@/lib/equipment-model";
import { newScenario, type EquipmentScenario } from "@/lib/equipment";
import { EquipmentScenarios } from "@/components/equipment-scenarios";
import { LoadSummary, formatLoad } from "@/components/load-summary";
import { AnalysisAssumptions } from "@/components/analysis-assumptions";
import { LocationEnergy } from "@/components/location-energy";

const DOCS = "https://developer.nlr.gov/docs/climate/sup3rcc/sup3rcc-conus-ecearth3cc-ssp245-r1i1p1f1-v0-2-2-download/";
type Result = { place: Place; year: number; data: ClimateData; csv: string };
type Stage = "idle" | "locating" | "choosing" | "loading" | "ready" | "error" | "unsupported";
const pad = (n: number) => String(n).padStart(2, "0");
const coordinate = (v: number, lat = false) => `${Math.abs(v).toFixed(4)}° ${lat ? (v < 0 ? "S" : "N") : (v < 0 ? "W" : "E")}`;

async function request(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(problem.error || "The request could not be completed. Please try again.");
  }
  return response;
}

function Choice({ id, label, value, onChange, children, disabled = false }: { id: string; label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger id={id} aria-label={label} className="field-select"><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger><SelectContent position="popper">{children}</SelectContent></Select>;
}

export default function Home() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [year, setYear] = useState("2025");
  const [tab, setTab] = useState("query");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [candidates, setCandidates] = useState<Place[]>([]);
  const [candidate, setCandidate] = useState("");
  const [pending, setPending] = useState<{ city: string; state: string; year: number } | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [elapsed, setElapsed] = useState(0);
  const [school, setSchool] = useState<SchoolAssumptions>({ ...DEFAULT_SCHOOL });
  const schoolRows = useMemo(() => result && !validateSchool(school) ? simulateSchool(result.data.rows, school, solarLocation(result.data.metadata)) : [], [result, school]);
  const [systems, setSystems] = useState<EquipmentScenario[]>(() => [newScenario("Scenario A", "heat-pump"), newScenario("Scenario B", "gas"), newScenario("Scenario C", "resistance")]);
  const [activeSystem, setActiveSystem] = useState(0);
  const needsStandard=systems.some(s=>s.heating==="heat-pump"&&s.efficiency==="standard"), needsHigh=systems.some(s=>s.heating==="heat-pump"&&s.efficiency==="high");
  const packagedSelections=useMemo(()=>({standard:schoolRows.length&&needsStandard?autosizePackaged(schoolRows,school,"standard"):null,high:schoolRows.length&&needsHigh?autosizePackaged(schoolRows,school,"high"):null}),[schoolRows,school,needsStandard,needsHigh]);
  const comparisonResults = useMemo(() => schoolRows.length ? systems.map(system => simulateEquipment(schoolRows, school, system,packagedSelections[system.efficiency])) : [], [schoolRows, school, systems,packagedSelections]);
  const curveResult = comparisonResults[activeSystem] ?? null;
  function updateSystem(index: number, choice: EquipmentScenario) {
    setSystems(current => current.map((s, i) => i === index ? choice : s));
  }
  function downloadComparison() {
    if (!result) return;
    const csv = equipmentComparisonCsv(comparisonResults);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `equipment-comparison-${result.place.stateCode}-${result.year}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const operation = useRef<AbortController | null>(null);
  const busy = stage === "locating" || stage === "loading";

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [busy, stage]);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => { if (tab === "data") window.scrollTo({ top: 0, behavior: "auto" }); }, [tab, stage]);

  const fetchClimate = useCallback(async (selected: Place, requestedYear: number, controller: AbortController) => {
    setPlace(selected);
    if (!supportsClimate(selected.stateCode)) {
      setStage("unsupported");
      return { status: "outside_dataset_coverage", city: selected.name, state: selected.state, latitude: selected.latitude, longitude: selected.longitude };
    }
    setStage("loading");
    const params = new URLSearchParams({ latitude: String(selected.latitude), longitude: String(selected.longitude), state: selected.stateCode, year: String(requestedYear) });
    const response = await request(`/api/climate?${params}`, controller.signal);
    const csv = await response.text();
    const data = parseClimateCsv(csv, requestedYear);
    if (controller.signal.aborted) return;
    setResult({ place: selected, year: requestedYear, data, csv }); setPage(1); setStage("ready");
    return { city: selected.name, state: selected.state, year: requestedYear, rows: data.rows.length, latitude: selected.latitude, longitude: selected.longitude };
  }, []);

  const startQuery = useCallback(async (query: { city: string; state: string; year: number }) => {
    if (!query.city.trim() || !Object.hasOwn(STATES, query.state)) {
      setError("Enter a city or town and select a state.");
      return { status: "error", error: "A city and state are required." };
    }
    const issue = validateSchool(school);
    if (issue) {
      setError(issue); return;
    }
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setError(""); setResult(null); setCandidates([]); setPlace(null); setPending(query); setTab("data"); setStage("locating");
    try {
      const params = new URLSearchParams({ city: query.city.trim(), state: query.state });
      const response = await request(`/api/locations?${params}`, controller.signal);
      const { places, exact } = await response.json() as { places: Place[]; exact: boolean };
      if (controller.signal.aborted) return;
      if (places.length !== 1 || !exact) {
        setCandidates(places); setCandidate(String(places[0]?.id || "")); setStage("choosing");
        return { status: "choose_location", places };
      }
      return await fetchClimate(places[0], query.year, controller);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : "Something went wrong. Please try again.";
      setError(message); setStage("error"); return { status: "error", error: message };
    }
  }, [fetchClimate, school]);

  useEffect(() => {
    type Context = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: "load_climate_table", title: "Load climate table",
        description: "Resolve a US city and state, fetch a year of Sup3rCC data, display Fahrenheit and dew point, simulate hourly building loads, autosize packaged cooling units using Precedent capacity and SHR fits with calculated mixed-air conditions, or evaluate heating-only gas and electric resistance equipment. Ambiguous matches ask for a location in the page.",
        inputSchema: { type: "object", properties: { city: { type: "string", minLength: 1, maxLength: 100 }, state: { type: "string", enum: Object.keys(STATES) }, year: { type: "integer", minimum: MIN_YEAR, maximum: MAX_YEAR } }, required: ["city", "state", "year"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(input) {
          const q = input as { city: string; state: string; year: number };
          if (!q || typeof q.city !== "string" || q.city.trim().length < 1 || q.city.length > 100 || !Object.hasOwn(STATES, q.state) || !Number.isInteger(q.year) || q.year < MIN_YEAR || q.year > MAX_YEAR) throw new Error("Enter a city, a US state code, and a year from 2015 to 2059.");
          setCity(q.city); setState(q.state); setYear(String(q.year));
          const response = await startQuery(q);
          await new Promise(resolve => setTimeout(resolve, 0)); return response;
        },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* The regular form remains available. */ }
    return () => lifecycle.abort();
  }, [startQuery]);

  function cancel() { operation.current?.abort(); setStage("idle"); setPending(null); setError(""); setTab("query"); }
  async function confirmPlace() {
    const selected = candidates.find(p => String(p.id) === candidate);
    if (!selected || !pending || !operation.current) return;
    const controller = operation.current;
    try { await fetchClimate(selected, pending.year, controller); }
    catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Unable to load the data."); setStage("error"); } }
  }
  function download(source = false) {
    if (!result) return;
    const csv = source || !curveResult ? result.csv : equipmentResultsCsv(schoolRows, school, curveResult, `${result.place.name}, ${result.place.state}`, `${timezone}; local standard time`, solarLocation(result.data.metadata));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `${source ? "sup3rcc-source" : `equipment-results-${String.fromCharCode(65 + activeSystem)}`}-${result.place.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${result.place.stateCode.toLowerCase()}-${result.year}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const total = result?.data.rows.length || 0;
  const pages = Math.max(1, Math.ceil(total / Number(pageSize)));
  const start = (page - 1) * Number(pageSize);
  const rows = schoolRows.slice(start, start + Number(pageSize));
  const zone = result?.data.metadata["Local Time Zone"] ?? result?.data.metadata["Time Zone"];
  const timezone = zone && Number.isFinite(Number(zone)) ? `UTC${Number(zone) >= 0 ? "+" : "−"}${Math.abs(Number(zone))}` : "Local standard time";

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner"><a className="brand" href="/" aria-label="BEAST home"><span className="brand-mark"><Table2 size={21}/></span>BEAST</a><span className="header-label">HVAC ENERGY ANALYSIS</span><a className="source-link header-guide" href="/engineering-guide.pdf" target="_blank" rel="noreferrer">Engineering guide <Download size={14}/></a><a className="source-link" href={DOCS} target="_blank" rel="noreferrer">About the data <ExternalLink size={14}/></a></div></header>
    <main>
      <div className="page-intro"><h1>Building Energy Analysis Selection Tool <span>(BEAST)</span></h1><p>Choose your location, review building assumptions, and compare rooftop heat pumps, natural gas, and electric resistance.</p></div>
      <Tabs value={tab} onValueChange={setTab} className="workspace">
        <div className="tabs-bar"><TabsList aria-label="BEAST workspace" variant="line" className="workspace-tabs"><TabsTrigger value="query"><SlidersHorizontal size={17}/>Analysis inputs</TabsTrigger><TabsTrigger value="data" disabled={(!pending && !result) || !!validateSchool(school)}><Table2 size={17}/>Results{result && <span className="tab-count">{total.toLocaleString()}</span>}</TabsTrigger></TabsList><span className="coverage"><Globe2 size={15}/>US cities & towns</span></div>
        <TabsContent value="query" className="query-panel"><div className="query-grid">
          <section className="form-section"><div className="section-heading"><span className="section-icon"><MapPin size={22}/></span><div><h2>Location and year</h2></div></div>
            <form id="analysis-inputs" onSubmit={e => { e.preventDefault(); void startQuery({ city, state, year: Number(year) }); }}>
              <div className="form-location-row"><div className="form-field"><label htmlFor="city">City or town</label><input id="city" name="city" value={city} onChange={e => setCity(e.target.value)} placeholder="Enter city or town" required minLength={1} maxLength={100} autoComplete="address-level2" disabled={busy}/></div><div className="form-field"><label htmlFor="state">State</label><Choice id="state" label="State" value={state} onChange={setState} disabled={busy}>{Object.entries(STATES).map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}</Choice></div></div>
              <div className="form-field year-field"><label htmlFor="year">Year</label><Choice id="year" label="Year" value={year} onChange={setYear} disabled={busy}>{Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</Choice><p className="field-hint">Available years: 2015–2059</p></div>
              {state && !supportsClimate(state) && <div className="coverage-note" role="status"><Info size={17}/><span>We can locate cities in {STATES[state]}, but this Sup3rCC dataset has no climate data there.</span></div>}
              <div className="coordinate-note"><MapPin size={17}/><span>Search cities and towns in all 50 states and Washington, DC.</span></div>
            </form>
          </section><aside className="dataset-section"><div className="eyebrow">WEATHER DATA</div><h3>Hourly climate projections</h3><p className="dataset-description">2-meter temperature, relative humidity, and hourly DHI / DNI / GHI.</p><div className="variable"><span className="variable-icon temperature"><Thermometer size={20}/></span><div><strong>Air temperature</strong><span>Degrees Fahrenheit · °F</span></div></div><div className="variable"><span className="variable-icon humidity"><Droplets size={20}/></span><div><strong>Dew point</strong><span>Derived from temperature + RH · °F</span></div></div><div className="variable"><span className="variable-icon temperature"><Thermometer size={20}/></span><div><strong>Solar irradiance</strong><span>DHI · DNI · GHI in W/m²</span></div></div><dl className="dataset-meta"><div><dt>Climate model</dt><dd>EC-Earth3-CC</dd></div><div><dt>Scenario</dt><dd>SSP2-4.5</dd></div><div><dt>Time interval</dt><dd>60 minutes</dd></div><div><dt>Grid resolution</dt><dd>4 km</dd></div><div><dt>Climate coverage</dt><dd>48 contiguous states + DC</dd></div></dl><div className="dataset-footnote"><Clock3 size={15}/><span>Local standard time, without daylight saving time. February 29 excluded.</span></div></aside>
        </div><AnalysisAssumptions school={school} onSchool={setSchool}/><EquipmentScenarios choices={systems} onChange={updateSystem} results={[]} active={activeSystem} onActive={setActiveSystem} onAdd={() => setSystems(current => current.length < 3 ? [...current, newScenario(`Scenario ${String.fromCharCode(65 + current.length)}`)] : current)} onRemove={index => { setSystems(current => current.filter((_, i) => i !== index)); setActiveSystem(0); }}/><div className="continue-actions">{error && <p className="model-error" role="alert">{error}</p>}<button className="button primary" type="submit" form="analysis-inputs" disabled={busy || !city.trim() || !state}>Continue to results<ArrowRight size={18}/></button></div></TabsContent>
        <TabsContent value="data" className="data-panel">
          {busy && <section className="status-panel" aria-live="polite"><span className="loading-icon"><LoaderCircle className="spin" size={28}/></span><h2>{stage === "locating" ? "Finding your location" : "Loading your climate data"}</h2><p>{place ? `${place.name}, ${place.state} · ${pending?.year}` : `${pending?.city}, ${STATES[pending?.state || ""]} · ${pending?.year}`}</p><div className="load-steps"><span className={stage === "loading" ? "complete" : "current"}>{stage === "loading" ? <Check size={16}/> : <MapPin size={16}/>}Resolve location</span><span className={stage === "loading" ? "current" : ""}><Table2 size={16}/>Read hourly data</span></div><p className="status-hint">{elapsed > 25 ? "NLR is still preparing this year of data. This can take a couple of minutes." : "Fetching data directly from the source. This may take a moment."}</p><button className="button text-button" onClick={cancel}><X size={16}/>Cancel</button></section>}
          {stage === "choosing" && <section className="status-panel"><span className="loading-icon"><MapPin size={27}/></span><h2>Confirm your location</h2><p>Choose the matching place in {STATES[pending?.state || ""]}.</p><div className="match-select"><Choice id="location-match" label="Matching location" value={candidate} onChange={setCandidate}>{candidates.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.county ? ` · ${p.county}` : ""} · {p.latitude.toFixed(3)}, {p.longitude.toFixed(3)}</SelectItem>)}</Choice></div><div className="center-actions"><button className="button secondary" onClick={cancel}>Edit location</button><button className="button primary" onClick={() => void confirmPlace()}>Continue to results<ArrowRight size={17}/></button></div></section>}
          {stage === "unsupported" && place && <section className="status-panel"><span className="loading-icon"><MapPin size={28}/></span><h2>Location found, outside climate coverage</h2><p><strong>{place.name}, {place.state}</strong><br/>{coordinate(place.latitude, true)} · {coordinate(place.longitude)}</p><p>The supplied Sup3rCC dataset covers the contiguous 48 states and Washington, DC. It does not provide climate CSVs for Alaska or Hawaii.</p><div className="center-actions"><button className="button primary" onClick={cancel}>Choose another location</button><a className="button secondary" href={DOCS} target="_blank" rel="noreferrer">Dataset coverage<ExternalLink size={15}/></a></div></section>}
          {stage === "error" && <section className="status-panel error-panel" role="alert"><span className="loading-icon"><Info size={28}/></span><h2>We couldn’t load the results</h2><p>{error}</p><div className="center-actions"><button className="button secondary" onClick={cancel}>Edit location</button><button className="button primary" onClick={() => pending && void startQuery(pending)}>Try again</button></div></section>}
          {result && stage === "ready" && <>
            <LocationEnergy key={`${result.place.id}-${result.place.stateCode}`} place={result.place} year={result.year} results={comparisonResults} rows={schoolRows}/><div className="edit-inputs"><button type="button" className="button secondary" onClick={() => setTab("query")}>Edit analysis inputs</button></div>
            <div className="results-heading"><div><div className="eyebrow">WEATHER & BUILDING LOADS</div><h2>{result.place.name}, {result.place.state}<span className="result-year">{result.year}</span></h2><p><MapPin size={14}/>{coordinate(result.place.latitude, true)}<span>·</span>{coordinate(result.place.longitude)}<span>·</span>{timezone}</p></div><div className="download-actions"><button className="button primary" onClick={() => download()}><Download size={17}/>Download results CSV</button><button className="button text-button" onClick={() => download(true)}>Original weather CSV</button></div></div>
            <div className="results-meta"><span><Table2 size={16}/><strong>{total.toLocaleString()}</strong> hourly records</span><span><CalendarDays size={16}/>{result.data.rows[0]?.year}-{pad(result.data.rows[0]?.month)}-{pad(result.data.rows[0]?.day)} to {result.data.rows.at(-1)?.year}-{pad(result.data.rows.at(-1)!.month)}-{pad(result.data.rows.at(-1)!.day)}</span><span>EC-Earth3-CC <span className="meta-separator">/</span> SSP2-4.5</span></div>
            <EquipmentScenarios choices={systems} onChange={updateSystem} results={comparisonResults} active={activeSystem} onActive={setActiveSystem} onDownload={downloadComparison}/><LoadSummary rows={schoolRows}/>{schoolRows.some(r => r.solarGain === null) && <p className="model-error">Some hours lack valid solar radiation or grid location metadata. Their dependent loads and energy are blank; totals are incomplete.</p>}
            <div className="hourly-heading"><h3>Hourly results · Scenario {String.fromCharCode(65 + activeSystem)}</h3><span>Cooling − · Heating + · Electricity in kWh per hour</span></div>
            <div className="table-scroll" tabIndex={0} aria-label="Hourly weather, building loads and equipment performance"><Table className="school-table"><TableHeader><TableRow>
              {["#", "Date", "Time (local)", "Outdoor dry bulb (°F)", "Dew point (°F)", "DHI / DNI / GHI (W/m²)", "Solar heat gain (BTU/hr)", "Sensible cooling (BTU/hr · −)", "Total cooling (BTU/hr · −)", "Building heat need (BTU/hr · +)", "Mixed entering dry bulb (°F)", "Mixed entering wet bulb (°F)", "Outdoor-air fraction", "Available heat (BTU/hr)", "Available cooling (BTU/hr)", "Heating COP", "Cooling COP", "Cooling SHR", "Equipment electricity (kWh)", "Gas input (therms)", "Unmet heat (BTU/hr)", "Unmet cooling (BTU/hr)", "Status"].map(label => <TableHead key={label}>{label}</TableHead>)}
            </TableRow></TableHeader><TableBody>{rows.map((row, index) => { const p = curveResult?.rows[start + index]; return <TableRow key={start + index}>
              <TableCell>{start + index + 1}</TableCell><TableCell className="date-cell">{row.year}-{pad(row.month)}-{pad(row.day)}</TableCell><TableCell>{pad(row.hour)}:{pad(row.minute)}</TableCell>
              <TableCell>{row.temperatureF?.toFixed(2) ?? "—"}</TableCell><TableCell>{row.dewPointF?.toFixed(2) ?? "—"}</TableCell><TableCell>{[row.dhi, row.dni, row.ghi].map(v => v === null ? "—" : v.toFixed(0)).join(" / ")}</TableCell>
              {[row.solarGain, row.sensibleCooling, row.totalCooling, row.heating].map((v, i) => <TableCell className="numeric" key={i}>{formatLoad(v)}</TableCell>)}
              <TableCell>{p?.enteringDryBulbF?.toFixed(2) ?? "—"}</TableCell><TableCell>{p?.enteringWetBulbF?.toFixed(2) ?? "—"}</TableCell><TableCell>{p?.outdoorAirFraction?.toFixed(3) ?? "—"}</TableCell><TableCell>{formatLoad(p?.availableHeating ?? null)}</TableCell><TableCell>{formatLoad(p?.availableCooling ?? null)}</TableCell>
              <TableCell>{p?.heatingCop?.toFixed(2) ?? "—"}</TableCell><TableCell>{p?.coolingCop?.toFixed(2) ?? "—"}</TableCell><TableCell>{p?.coolingShr?.toFixed(3) ?? "—"}</TableCell>
              <TableCell>{p?.electricity?.toFixed(2) ?? "—"}</TableCell><TableCell>{p?.gasTherms?.toFixed(4) ?? "—"}</TableCell><TableCell>{formatLoad(p?.unmetHeating ?? null)}</TableCell><TableCell>{formatLoad(p?.unmetCooling ?? null)}</TableCell><TableCell>{p?.status ?? "Equipment selection pending"}</TableCell>
            </TableRow>; })}</TableBody></Table></div>
            <div className="table-pagination"><div className="rows-control"><span>Rows</span><Choice id="page-size" label="Rows per page" value={pageSize} onChange={v => {setPageSize(v); setPage(1);}}>{[25, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</Choice><span className="record-range" aria-live="polite">{(start + 1).toLocaleString()}–{Math.min(start + Number(pageSize), total).toLocaleString()} of {total.toLocaleString()}</span></div><Pagination className="page-nav"><PaginationContent><PaginationItem><button className="page-button" aria-label="First page" disabled={page === 1} onClick={() => setPage(1)}><ChevronsLeft size={17}/></button></PaginationItem><PaginationItem><button className="page-button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={17}/></button></PaginationItem><PaginationItem><span className="page-count">{page} / {pages}</span></PaginationItem><PaginationItem><button className="page-button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight size={17}/></button></PaginationItem><PaginationItem><button className="page-button" aria-label="Last page" disabled={page >= pages} onClick={() => setPage(pages)}><ChevronsRight size={17}/></button></PaginationItem></PaginationContent></Pagination></div>
            <div className="table-notes"><Info size={15}/><p>Times use local standard time; daylight saving time and February 29 are excluded. Total cooling includes sensible and latent loads. Packaged heat-pump cooling uses the supplied Precedent fits, with maximum listed airflow per unit. The model mixes scheduled ventilation air with return air using humidity ratio and enthalpy, then calculates entering dry bulb and wet bulb at standard sea-level pressure. Infiltration remains in the building load and is excluded from the mixer. Rooftop unit count and capacity are selected from cooling and ventilation requirements; heating sizing awaits your heating data. Out-of-domain hours remain blank and make cooling sizing provisional. Gas and electric resistance are heating-only and leave cooling loads unserved. Gas input = delivered heat / entered efficiency; resistance electricity = delivered heat / 3412.141633. Heat-pump heating performance and COP remain pending. No separate fan energy, fan heat, auxiliary heat or reheat is added. Annual energy requires a full valid year; CSV exports preserve input assumptions, selection, mixed-air conditions and status. {result.data.rows.some(r => r.temperature === null || r.humidity === null) ? " Missing values appear as —; dependent loads are left blank." : ""}{result.data.metadata.Latitude && result.data.metadata.Longitude ? ` Nearest dataset grid point: ${Number(result.data.metadata.Latitude).toFixed(4)}, ${Number(result.data.metadata.Longitude).toFixed(4)}.` : ""}{total !== 8760 ? ` The source returned ${total.toLocaleString()} rows; a complete non-leap year normally has 8,760.` : ""}</p></div>
          </>}
        </TabsContent>
      </Tabs>
      <div className="model-note"><Info size={18}/><p><strong>Modeled climate, not observed weather.</strong> Sup3rCC represents a possible climate under the selected scenario.</p></div>
    </main>
    <footer><span>Climate data from <a href={DOCS} target="_blank" rel="noreferrer">NLR’s Sup3rCC</a></span><span>City and town locations: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></span></footer>
  </div>;
}
