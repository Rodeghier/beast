import type { RtuResult } from "@/lib/rtu";
import type { AnnualPerformance } from "@/lib/utility-billing";
import { PerformanceGraphs } from "./performance-graphs";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const money = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function AnnualScorecard({ results, performance, location, year, loading, ready = true, children }: { results: RtuResult[]; performance: AnnualPerformance[]; location: string; year: number; loading: boolean; ready?: boolean; children?: React.ReactNode }) {
  return <section className="annual-scorecard" aria-label="Annual performance scorecard">
    <span className="eyebrow">BEAST RESULTS · {year}</span><h2>Annual performance scorecard</h2><p>{location} · Modeled HVAC energy, API utility rates, and EPA CO₂e</p>
    {children}
    {loading && <p role="status">Retrieving utility tariffs and EPA emissions data…</p>}
    {!ready ? <p className="results-prompt" role="status">Choose your utility tariff structure above, then click <strong>Load results</strong> to view the scorecards and graphs.</p> : <>
    {results.map((result, index) => {
      const s = result.summary, p = performance[index];
      if (!p) return null;
      return <div className="scorecard-scenario" key={index}><h3>Equipment scenario {String.fromCharCode(65 + index)}</h3>
        <div className="scorecard-grid">
          <div><span>Annual energy consumption</span><strong>{p.energy === null ? "Unavailable" : number(p.energy, 1)}{p.energy !== null && <small>MMBtu</small>}</strong><p>{p.energy !== null ? `${number(s.electricity)} kWh electricity + ${number(s.gasTherms, 1)} therms gas` : p.reason}</p></div>
          <div><span>Annual utility cost · estimate</span><strong>{p.cost === null ? loading ? "Loading…" : "Unavailable" : money(p.cost)}</strong><p>{p.electricBill.reason || p.gasReason || (p.gasBenchmark ? "OpenEI electricity tariff + EIA monthly gas benchmark" : "OpenEI electricity tariff structure")}</p>{p.electricBill.total !== null && <p>Electricity: {money(p.electricBill.total)}{!p.gasReason && p.gasBenchmark && ` · Gas benchmark: ${money(p.months.reduce((sum, month) => sum + (month.gasCost ?? 0), 0))}`}</p>}</div>
          <div><span>Annual CO₂e emissions</span><strong>{p.co2e === null ? loading ? "Loading…" : "Unavailable" : number(p.co2e, 1)}{p.co2e !== null && <small>metric tons CO₂e</small>}</strong><p>{p.emissionsReason || p.reason || "EPA eGRID electricity + EPA natural gas combustion"}</p>{p.co2e !== null && <p>Electricity: {number(p.months.reduce((sum, m) => sum + (m.electricCo2e ?? 0), 0), 2)} t CO₂e · Gas combustion: {number(p.months.reduce((sum, m) => sum + (m.gasCo2e ?? 0), 0), 2)} t CO₂e</p>}</div>
        </div>
        {result.equipment && (s.unmetHeatingHours > 0 || s.unmetCoolingHours > 0) && <p className="service-note">Unmet loads: {number(s.unmetHeatingHours)} heating hours and {number(s.unmetCoolingHours)} cooling hours. Compare comfort coverage alongside energy use.</p>}
      </div>;
    })}
    <p className="comparison-note">HVAC-only screening estimates, not a whole-building utility bill. Missing API data and unsupported tariffs remain unavailable. Current tariffs and the latest available monthly gas prices are applied to the selected weather year; they are not historical or future rate forecasts.</p>
    <PerformanceGraphs performance={performance}/>
    <details className="billing-breakdown"><summary>Monthly charges, emissions, and calculation scope</summary>
      <p>Electricity applies monthly/seasonal time-of-use periods, cumulative tiers, rate adjustments, demand charges, fixed charges, and minimum bills. Annual fixed charges are allocated evenly; annual minimum top-ups appear in December. Gas uses EIA state monthly delivered averages, with EPA default heat content for therm-to-Mcf conversion; these are benchmarks, not gas utility tariff structures.</p>
      {performance.map((p, index) => <div key={index}><h4>Scenario {String.fromCharCode(65 + index)}</h4>{p.reason && <p>{p.reason}</p>}{p.electricBill.warnings.map(warning => <p key={warning}>{warning}</p>)}
        {!!p.months.length && <div className="rate-scroll"><table><caption>Monthly scorecard data · scenario {String.fromCharCode(65 + index)}</caption><thead><tr><th>Month</th><th>Energy (MMBtu)</th><th>Electric energy ($)</th><th>Demand ($)</th><th>Fixed ($)</th><th>Minimum top-up ($)</th><th>Gas benchmark ($)</th><th>Gas price month</th><th>Total cost ($)</th><th>Electricity CO₂e (t)</th><th>Gas combustion CO₂e (t)</th><th>Total CO₂e (t)</th></tr></thead><tbody>{p.months.map((month, i) => { const bill = p.electricBill.months[i]; const n = (value: number | null | undefined) => value == null ? "Unavailable" : number(value, 2); return <tr key={month.month}><th>{month.month}</th><td>{n(month.energy)}</td><td>{n(bill?.energy)}</td><td>{n(bill?.demand)}</td><td>{n(bill?.fixed)}</td><td>{n(bill?.minimum)}</td><td>{n(month.gasCost)}</td><td>{month.gasTherms ? month.gasPeriod || "Unavailable" : "Not used"}</td><td>{n(month.cost)}</td><td>{n(month.electricCo2e)}</td><td>{n(month.gasCo2e)}</td><td>{n(month.co2e)}</td></tr>; })}</tbody></table></div>}
      </div>)}
    </details>
    </>}
  </section>;
}
