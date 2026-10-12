"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, MapPin, RefreshCw } from "lucide-react";
import type { Place } from "@/lib/climate";
import type { RtuResult } from "@/lib/rtu";
import type { SchoolRow } from "@/lib/school";
import type { ElectricTariff, LocationEnergyContext, RateTier } from "@/lib/location-energy";
import { annualPerformance } from "@/lib/utility-billing";
import { AnnualScorecard } from "./annual-scorecard";
import { electricityCo2 } from "@/lib/emissions";

const n = (value: number | null | undefined, digits = 3) => value === null || value === undefined ? "Not provided" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const date = (value: number | null) => value === null ? "Not provided" : new Date(value * 1000).toISOString().slice(0, 10);
function Source({ href, children }: { href: string; children: React.ReactNode }) { return <a href={href} target="_blank" rel="noreferrer">{children}</a>; }

function Rates({ title, rates, units }: { title: string; rates: RateTier[][] | null; units: string }) {
  if (!rates) return <p>{title}: not provided.</p>;
  return <><h5>{title}</h5><div className="rate-scroll"><table><thead><tr><th>Period</th><th>Tier</th><th>Upper limit</th><th>Base price</th><th>Adjustment</th></tr></thead><tbody>{rates.flatMap((period, p) => period.map((tier, t) => <tr key={`${p}-${t}`}><td>{p + 1}</td><td>{t + 1}</td><td>{tier.max === null ? "No limit supplied" : `${n(tier.max)} ${tier.unit || units.replace(/^\$\//, "")}`}</td><td>{n(tier.rate, 6)} {units}</td><td>{tier.adjustment === null ? "None supplied" : `${n(tier.adjustment, 6)} ${units}`}</td></tr>))}</tbody></table></div></>;
}
function Schedule({ title, schedule }: { title: string; schedule: number[][] | null }) {
  if (!schedule) return null;
  return <details className="rate-detail"><summary>{title}</summary><p>Cells identify the numbered rate period. Hours follow the utility schedule; these schedules are applied to the hourly electricity in the scorecard estimate when supported.</p><div className="rate-scroll"><table className="rate-schedule"><thead><tr><th>Month / hour</th>{Array.from({ length: 24 }, (_, h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{schedule.map((hours, m) => <tr key={m}><th>{MONTHS[m]}</th>{hours.map((period, h) => <td key={h}>{period + 1}</td>)}</tr>)}</tbody></table></div></details>;
}
function Tariff({ rate }: { rate: ElectricTariff }) {
  const e = rate.eligibility;
  return <div className="tariff-data">
    <h4>{rate.utility} · {rate.name}</h4>
    <p>Effective: {date(rate.effectiveDate)} · End: {date(rate.endDate)} · Service: {rate.serviceType || "Not provided"}</p>
    {rate.description && <p>{rate.description}</p>}
    <p>{rate.url && <Source href={rate.url}>OpenEI record</Source>} {rate.sourceUrl && <> · <Source href={rate.sourceUrl}>Utility tariff source</Source></>}</p>
    <details className="rate-detail"><summary>Eligibility and billing terms</summary><dl className="rate-terms">
      <dt>Demand eligibility</dt><dd>{n(e.minKw)} to {n(e.maxKw)} kW</dd><dt>Energy eligibility</dt><dd>{n(e.minKwh)} to {n(e.maxKwh)} kWh</dd>
      <dt>Voltage / phase</dt><dd>{e.voltageCategory || "Not provided"}; {n(e.voltageMinimum)}–{n(e.voltageMaximum)} V; {e.phaseWiring || "phase not provided"}</dd>
      <dt>Fixed charge (first meter)</dt><dd>{n(rate.fixedCharge)} {rate.fixedChargeUnits || ""}</dd><dt>Minimum charge</dt><dd>{n(rate.minimumCharge)} {rate.minimumChargeUnits || ""}</dd>
      <dt>Demand measurement window</dt><dd>{n(rate.demandWindowMinutes)} minutes</dd>
    </dl></details>
    <Rates title="Energy charges" rates={rate.energyRates} units="$/kWh"/>
    <Rates title="Time-of-use demand charges" rates={rate.demandRates} units={`$/${rate.demandRateUnits || "demand unit unspecified"}`}/>
    <Rates title="Monthly demand charges" rates={rate.flatDemandRates} units={`$/${rate.flatDemandUnits || "demand unit unspecified"}`}/>
    {rate.flatDemandMonths && <p>Monthly demand periods (Jan–Dec): {rate.flatDemandMonths.map(p => p + 1).join(", ")}</p>}
    {rate.fuelAdjustmentsMonthly && <p>Monthly fuel adjustments (Jan–Dec), $/kWh: {rate.fuelAdjustmentsMonthly.map(v => n(v, 6)).join(", ")}</p>}
    <Schedule title="Energy schedule · weekdays" schedule={rate.energyWeekdaySchedule}/><Schedule title="Energy schedule · weekends" schedule={rate.energyWeekendSchedule}/>
    <Schedule title="Demand schedule · weekdays" schedule={rate.demandWeekdaySchedule}/><Schedule title="Demand schedule · weekends" schedule={rate.demandWeekendSchedule}/>
    {!!rate.unsupportedClauses.length && <p className="energy-status">Additional or incomplete terms: {rate.unsupportedClauses.join("; ")}. Refer to the utility tariff.</p>}
    {rate.notes.map((note, i) => <p key={i}>{note}</p>)}
    <p className="comparison-note">The scorecard applies supported tariff terms to HVAC hourly use as a separate-meter estimate. A whole-building bill also needs complete meter load, billing calendar, taxes, riders, ratchets and the utility demand interval. Unsupported terms prevent a total cost estimate.</p>
  </div>;
}

export function LocationEnergy({ place, year, results, rows }: { place: Place; year: number; results: RtuResult[]; rows: SchoolRow[] }) {
  const [data, setData] = useState<LocationEnergyContext | null>(null), [error, setError] = useState("");
  const [zipDraft, setZipDraft] = useState(""), [zip, setZip] = useState(""), [retry, setRetry] = useState(0);
  const [tariffId, setTariffId] = useState(""), [regionCode, setRegionCode] = useState("");
  const [applied, setApplied] = useState<{ tariffId: string; regionCode: string } | null>(null);
  const [loading, setLoading] = useState(true), [zipError, setZipError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setApplied(null); setError(""); setData(null); setTariffId(""); setRegionCode("");
    const params = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), state: place.stateCode, ...(zip ? { zip } : {}) });
    void fetch(`/api/location-energy?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Location energy data could not be loaded. Please retry.");
      return response.json() as Promise<LocationEnergyContext>;
    }).then(next => {
      if (controller.signal.aborted) return;
      setData(next);
      if (next.electricity.tariffs.length === 1) setTariffId(next.electricity.tariffs[0].id);
      if (next.emissions.regions.length === 1) setRegionCode(next.emissions.regions[0].code);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load location energy data."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [place.latitude, place.longitude, place.stateCode, zip, retry]);
  const region = data?.emissions.regions.find(r => r.code === regionCode);
  const tariff = data?.electricity.tariffs.find(r => r.id === tariffId);
  const ready = !!applied && !!data && !loading && applied.tariffId === tariffId && applied.regionCode === regionCode;
  const performance = useMemo(() => ready ? results.map(result => annualPerformance(result, rows, tariff, region, data?.gas, data?.emissions.naturalGas)) : [], [ready, results, rows, tariff, region, data]);
  function exportEmissions() {
    if (!region) return;
    const quote = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const lines: unknown[][] = [["Location", `${place.name}, ${place.stateCode}`, "Weather year", year, "EPA data year", region.year, "Subregion", region.code, "kg CO2/kWh", region.kgCo2PerKwh, "Source", data?.emissions.sourceUrl], ["Scope", "Electricity generation CO2 only; constant annual factor; excludes natural gas combustion and upstream emissions; not a future-grid projection"], ["Date", "Hour", ...results.flatMap((_, i) => [`Case ${String.fromCharCode(65 + i)} kWh`, `Case ${String.fromCharCode(65 + i)} kg CO2`])]];
    rows.forEach((row, i) => { lines.push([`${row.year}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`, `${String(row.hour).padStart(2, "0")}:${String(row.minute).padStart(2, "0")}`, ...results.flatMap(result => { const kwh = result.rows[i]?.electricity ?? null; return [kwh, kwh === null ? null : kwh * region.kgCo2PerKwh]; })]); });
    const url = URL.createObjectURL(new Blob([lines.map(line => line.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `electricity-co2-${place.stateCode}-${year}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <><AnnualScorecard results={results} performance={performance} location={`${place.name}, ${place.state}`} year={year} loading={loading} ready={ready}>
      {error && <p role="alert" className="energy-status">{error}</p>}
      {data && <div className="scorecard-sources">
        <h3>Utility and EPA sources</h3><p>Choose the utility tariff structure that serves your building, then select Load results to calculate total utility cost and update the scorecards and graphs. A single candidate is preselected; verify eligibility in the tariff details below.</p>
        <div className="source-select-grid">{!!data.electricity.tariffs.length && <label className="energy-select-label" htmlFor="electric-tariff">Utility and tariff<select id="electric-tariff" value={tariffId} onChange={event => { setTariffId(event.target.value); setApplied(null); }}><option value="">Select an eligible tariff</option>{data.electricity.tariffs.map(r => <option key={r.id} value={r.id}>{r.utility} · {r.name}</option>)}</select></label>}{!!data.emissions.regions.length && <label className="energy-select-label" htmlFor="emission-region">Applicable eGRID subregion<select id="emission-region" value={regionCode} onChange={event => { setRegionCode(event.target.value); setApplied(null); }}><option value="">Select the applicable subregion</option>{data.emissions.regions.map(r => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}</select></label>}</div>
        {data.electricity.tariffs.length === 0 && <p role="status">{data.electricity.message}</p>}
        <div className="load-results-actions"><button type="button" className="button primary" disabled={loading || !tariff} aria-describedby="load-results-help" onClick={() => setApplied({ tariffId, regionCode })}>Load results</button><p id="load-results-help">{!tariff ? "Select a utility tariff structure to enable Load results." : ready ? "Results loaded using the selected tariff structure." : "Your tariff is selected. Click Load results to calculate total utility cost."}{!region && " Select the applicable EPA subregion to include CO₂ results."}</p></div>
        {ready && performance.some(p => p.cost === null) && <div className="energy-status" role="alert"><strong>Some total utility costs could not be calculated.</strong>{performance.map((p, i) => p.cost === null && <p key={i}>Scenario {String.fromCharCode(65 + i)}: {[p.electricBill.reason, p.gasReason].filter(Boolean).join(" ") || p.reason || "Required source data are unavailable."}</p>)}<p>Review the tariff details or refresh the API data below, then select Load results again.</p></div>}
        <p>{tariff ? `${tariff.utility} · ${tariff.name}` : "Electricity cost requires a tariff selection."} {region ? `EPA eGRID ${region.year} · ${region.code} · ${n(region.kgCo2PerKwh, 6)} kg CO₂/kWh.` : data.emissions.message}</p>
        <p>Natural gas: EPA {data.emissions.naturalGas.year} · {data.emissions.naturalGas.kgCo2PerTherm} kg CO₂/therm; {data.emissions.naturalGas.thermsPerMcf} therms/Mcf for EIA price conversion. <Source href={data.emissions.naturalGas.sourceUrl}>EPA combustion factors</Source> · <Source href={data.emissions.sourceUrl}>EPA eGRID</Source></p>
        <p>EPA annual factors stay constant for all weather years. CO₂ excludes upstream emissions, methane, and nitrous oxide. Gas pricing uses the newest API price for each calendar month; source months appear in the breakdown.</p>
      </div>}
    </AnnualScorecard><section className="location-energy" aria-label="Utility rates and electricity emissions">
    <div className="comparison-heading"><div><span className="eyebrow">LOCATION ENERGY DATA</span><h3>Utility rates & electricity CO₂</h3><p>{place.name}, {place.stateCode} · current rate information and EPA annual emissions factors</p></div><button type="button" className="secondary-button" onClick={() => setRetry(v => v + 1)} disabled={loading}><RefreshCw size={15}/>Refresh</button></div>
    <form className="energy-zip" onSubmit={event => { event.preventDefault(); const v = zipDraft.trim(); if (v && !/^\d{5}$/.test(v)) { setZipError("Enter a five-digit ZIP code, or leave it blank."); return; } setZipError(""); setZip(v); }}>
      <label htmlFor="energy-zip"><MapPin size={15}/>Building ZIP code <span>(optional; refines EPA utility mapping)</span></label><div><input id="energy-zip" inputMode="numeric" maxLength={5} value={zipDraft} onChange={event => setZipDraft(event.target.value)} placeholder="ZIP code"/><button type="submit" className="secondary-button">Apply ZIP</button></div>{zipError && <p role="alert">{zipError}</p>}
    </form>
    {loading && <p role="status">Loading location energy data…</p>}{error && <p role="alert" className="energy-status">{error}</p>}
    {data && <>
      <div className="energy-emissions"><h4>Electricity generation CO₂</h4><p>{data.emissions.message}</p>
        {!!data.emissions.utilities.length && <p>EPA providers: {data.emissions.utilities.map(u => `${u.name} (${u.subregion})`).join("; ")}</p>}

        {region && <><p className="emission-factor"><strong>{n(region.kgCo2PerKwh, 6)}</strong> kg CO₂/kWh <span>· eGRID {region.year}, {region.code} total output rate</span></p><div className="emission-cases">{results.map((_, i) => { const kg = electricityCo2(results[i], region); return <div key={i}><span>Case {String.fromCharCode(65 + i)} · {results[i]?.summary.fullYear ? "annual" : "available hours"}</span><strong>{kg === null ? "Unavailable" : `${n(kg / 1000, 1)} t CO₂`}</strong><p>{results[i]?.equipment ? `${n(results[i].summary.electricity, 0)} kWh · ${n(results[i].summary.completeHours, 0)} valid hours` : "Equipment selection required"}</p></div>; })}</div><button type="button" className="secondary-button" onClick={exportEmissions}><Download size={15}/>Hourly CO₂ CSV</button></>}
        <p className="comparison-note">kWh × kg CO₂/kWh. The annual EPA factor is held constant across all hours and weather years, including future climate scenarios. It is not an hourly or future-grid forecast. Excludes gas combustion, upstream emissions and CO₂-equivalent gases, so this is not a total-emissions ranking of gas versus electric equipment. Compare unmet loads as well as energy.</p><Source href={data.emissions.sourceUrl}>EPA eGRID source</Source>
      </div>
      <details className="energy-provider" open><summary>Electricity tariff structure <span>{data.electricity.status === "missing_key" ? "Connection needed" : `${data.electricity.tariffs.length} candidates`}</span></summary><p>{data.electricity.message}</p>
        {data.electricity.status === "missing_key" && <p><Source href="https://apps.openei.org/services/api/signup/">Get an OpenEI API key</Source> and provide it to configure the lookup.</p>}
{tariff && <Tariff rate={tariff}/>}
      </details>
      <details className="energy-provider" open><summary>Natural gas rates <span>{data.gas.status === "missing_key" ? "EIA connection needed" : "State benchmark"}</span></summary><h5>State commercial benchmark</h5><p>{data.gas.message}</p>
        {data.gas.status === "missing_key" && <p><Source href="https://www.eia.gov/opendata/register.php">Get an EIA API key</Source> and provide it to configure the lookup.</p>}
        {!!data.gas.prices.length && <div className="rate-scroll"><table><thead><tr><th>Month</th><th>{data.gas.state} commercial delivered average ($/Mcf)</th></tr></thead><tbody>{data.gas.prices.map(r => <tr key={r.period}><td>{r.period}</td><td>{n(r.dollarsPerMcf, 2)}</td></tr>)}</tbody></table></div>}
        <p>For the building’s actual rate structure, use its gas utility’s commercial schedule: commodity charge, delivery charge, monthly customer charge, minimum bill and applicable riders. The EIA average cannot resolve those components.</p><Source href={data.gas.sourceUrl}>EIA natural gas source</Source>
      </details><p className="energy-retrieved">Retrieved {new Date(data.retrievedAt).toLocaleString()}. Rates and emissions data years are independent of the selected weather year.</p>
    </>}
  </section></>;
}
