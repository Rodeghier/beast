import type { CurveResult } from "@/lib/curve-model";
import type { AnnualPerformance } from "@/lib/utility-billing";
import { PerformanceGraphs } from "./performance-graphs";
const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const money = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function AnnualScorecard({ results, performance, location, year, loading, ready = true, children }: { results: CurveResult[]; performance: AnnualPerformance[]; location: string; year: number; loading: boolean; ready?: boolean; children?: React.ReactNode }) {
  return <section className="annual-scorecard" aria-label="Annual performance scorecard">
    <span className="eyebrow">BEAST RESULTS · {year}</span><h2>Annual performance scorecard</h2><p>{location} · Curve-based electricity, electricity cost, and electricity CO₂e</p>
    {children}
    {loading && <p role="status">Retrieving utility tariffs and EPA emissions data…</p>}
    {!ready ? <p className="results-prompt" role="status">Click <strong>Load results</strong> to view the scorecards and graphs. Curves and entering wet-bulb inputs are required; cost and emissions also require their source data.</p> : <>
      {results.map((result, index) => {
        const s = result.summary, p = performance[index];
        if (!p) return null;
        return <div className="scorecard-scenario" key={index}><h3>Curve scenario {String.fromCharCode(65 + index)} · {result.scenario?.name}</h3>
          <div className="scorecard-grid">
            <div><span>Annual curve-based electricity</span><strong>{p.energy === null ? "Unavailable" : number(p.energy)}{p.energy !== null && <small>kWh</small>}</strong><p>{p.reason || "Delivered heating / heating COP + gross cooling / cooling COP"}</p></div>
            <div><span>Annual electricity cost · estimate</span><strong>{p.cost === null ? "Unavailable" : money(p.cost)}</strong><p>{p.electricBill.reason || (p.electricBill.warnings.some(w => w.startsWith("Manual electricity rate:")) ? "Manual electricity rate" : "OpenEI electricity tariff structure")}</p></div>
            <div><span>Annual electricity CO₂e</span><strong>{p.co2e === null ? "Unavailable" : number(p.co2e, 1)}{p.co2e !== null && <small>metric tons CO₂e</small>}</strong><p>{p.emissionsReason || p.reason || "EPA eGRID electricity generation factor"}</p></div>
          </div>
          {p.energy !== null && <p className="service-note">Unmet loads: {number(s.unmetHeatingHours)} heating hours and {number(s.unmetCoolingHours)} cooling hours. Compare load coverage alongside electricity.</p>}
        </div>;
      })}
      <p className="comparison-note">Electricity covers only the energy implied by your capacity, COP and SHR curves. All energy must be represented in the supplied COP basis. These are screening estimates. Annual metrics require 8,760 complete hourly records. Tariffs and EPA factors are independent of the weather year.</p>
      <PerformanceGraphs performance={performance}/>
      <details className="billing-breakdown"><summary>Monthly electricity, charges, emissions, and calculation scope</summary>
        <p>Electricity cost applies supported tariff terms to curve-based consumption as a separate-meter estimate. A manual rate replaces tariff pricing. Missing prices and EPA factors remain unavailable.</p>
        {performance.map((p, index) => <div key={index}><h4>Scenario {String.fromCharCode(65 + index)}</h4>{p.reason && <p>{p.reason}</p>}{p.electricBill.warnings.map(warning => <p key={warning}>{warning}</p>)}
          {!!p.months.length && <div className="rate-scroll"><table><caption>Monthly curve-based results</caption><thead><tr><th>Month</th><th>Electricity (kWh)</th><th>Energy charge ($)</th><th>Demand ($)</th><th>Fixed ($)</th><th>Minimum top-up ($)</th><th>Electricity cost ($)</th><th>Electricity CO₂e (t)</th></tr></thead><tbody>{p.months.map((month, i) => { const bill = p.electricBill.months[i]; const n = (value: number | null | undefined) => value == null ? "Unavailable" : number(value, 2); return <tr key={month.month}><th>{month.month}</th><td>{n(month.electricity)}</td><td>{n(bill?.energy)}</td><td>{n(bill?.demand)}</td><td>{n(bill?.fixed)}</td><td>{n(bill?.minimum)}</td><td>{n(month.cost)}</td><td>{n(month.co2e)}</td></tr>; })}</tbody></table></div>}
        </div>)}
      </details>
    </>}
  </section>;
}
