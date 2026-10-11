import type { RtuResult } from "@/lib/rtu";
import type { EnergyAssumptions } from "./analysis-assumptions";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });

export function AnnualScorecard({ results, assumptions, location, year }: { results: RtuResult[]; assumptions: EnergyAssumptions; location: string; year: number }) {
  return <section className="annual-scorecard" aria-label="Annual performance scorecard">
    <span className="eyebrow">BEAST RESULTS · {year}</span><h2>Annual performance scorecard</h2><p>{location} · Modeled HVAC energy, utility cost, and CO₂</p>
    {results.map((result, index) => {
      const s = result.summary;
      const valid = !!result.equipment && !result.error && s.completeHours > 0;
      const annual = valid && s.fullYear;
      const cost = s.electricity * assumptions.electricityRate + s.gasTherms * assumptions.gasRate;
      const co2 = (s.electricity * assumptions.electricityCo2 + s.gasTherms * assumptions.gasCo2) / 1000;
      return <div className="scorecard-scenario" key={index}><h3>Equipment scenario {String.fromCharCode(65 + index)}</h3>
        <div className="scorecard-grid">
          <div><span>Annual energy consumption</span><strong>{annual ? number(s.siteMMBtu, 1) : "Unavailable"}{annual && <small>MMBtu</small>}</strong><p>{valid ? `${number(s.electricity)} kWh electricity + ${number(s.gasTherms, 1)} therms gas` : "Equipment selection unavailable"}</p></div>
          <div><span>Annual utility cost</span><strong>{annual ? cost.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Unavailable"}</strong><p>Estimated from your flat utility rates</p></div>
          <div><span>Annual CO₂ emissions</span><strong>{annual ? number(co2, 1) : "Unavailable"}{annual && <small>metric tons CO₂</small>}</strong><p>Electricity generation + gas combustion</p></div>
        </div>
        {!annual && <p role="status">{result.error || `A complete year is required for annual totals. ${number(s.completeHours)} valid hours are available; energy shown above covers available hours only.`}</p>}
        {valid && (s.unmetHeatingHours > 0 || s.unmetCoolingHours > 0) && <p className="service-note">Unmet loads: {number(s.unmetHeatingHours)} heating hours and {number(s.unmetCoolingHours)} cooling hours. Compare comfort coverage alongside energy use.</p>}
      </div>;
    })}
    <p className="comparison-note">HVAC only; excludes lighting, plug loads, and other building energy. Cost and CO₂ use the assumptions entered before running the analysis. These are screening estimates.</p>
  </section>;
}
