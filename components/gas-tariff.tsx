"use client";
import { useEffect, useState } from "react";
import { MGE_GAS_SOURCE, type GasTariff } from "@/lib/gas-tariff";

export function GasTariffLookup({ state }: { state: string }) {
  const [provider, setProvider] = useState(""), [data, setData] = useState<GasTariff | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    setData(null); setError(""); setLoading(!!provider);
    if (!provider) return;
    const controller = new AbortController();
    void fetch(`/api/gas-tariff?provider=${provider}`, { signal: controller.signal }).then(async response => { const result = await response.json() as GasTariff & { error?: string }; if (!response.ok) throw new Error(result.error); return result as GasTariff; }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Gas tariff lookup failed."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [provider]);
  if (state !== "WI") return null;
  return <div className="gas-tariff-lookup"><h5>Utility-published charge structure</h5><p>MGE has a direct public connection available. Select it only if MGE supplies gas to this building; the city’s electric utility does not establish the gas provider. Other providers require their published schedule.</p>
    <label className="energy-select-label" htmlFor="gas-provider">Gas utility<select id="gas-provider" value={provider} onChange={event => setProvider(event.target.value)}><option value="">Select your gas provider</option><option value="mge">Madison Gas and Electric (MGE)</option></select></label>
    {loading && <p role="status">Reading MGE’s current gas tariff…</p>}{error && <p role="alert" className="energy-status">{error}</p>}
    {data && <><p><strong>{data.provider}</strong> · effective {data.effectiveDate}. Retrieved {new Date(data.retrievedAt).toLocaleDateString()}.</p><p>Distribution and supply are separate schedules. Select applicable service classes using the linked tariff eligibility rules and the building’s full gas use. Values below reproduce the utility’s component tables; they are not combined into a bill.</p>{data.schedules.map((schedule, i) => <details className="rate-detail" key={i}><summary>{schedule.name}</summary><div className="rate-scroll"><table><thead><tr><th>Charge / qualifier</th><th>Published value</th></tr></thead><tbody>{schedule.rows.map((row, j) => <tr key={j}><td>{row[0]}</td><td>{row.slice(1).join(" · ") || "—"}</td></tr>)}</tbody></table></div>{schedule.sourceUrl && <p><a href={schedule.sourceUrl} target="_blank" rel="noreferrer">Schedule and eligibility (PDF)</a></p>}</details>)}</>}
    <p><a href={MGE_GAS_SOURCE} target="_blank" rel="noreferrer">MGE commercial gas rates</a> · no API key required</p>
  </div>;
}
