import { scenarioName } from "@/lib/equipment";
import type { EquipmentResult } from "@/lib/equipment-model";
import type { AnnualPerformance } from "@/lib/utility-billing";
import { PerformanceGraphs } from "./performance-graphs";
const number=(v:number|null|undefined,digits=0)=>v==null?"Unavailable":v.toLocaleString(undefined,{maximumFractionDigits:digits});
const money=(v:number)=>v.toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:0});
export function AnnualScorecard({results,performance,location,year,loading,ready=true,children}:{results:EquipmentResult[];performance:AnnualPerformance[];location:string;year:number;loading:boolean;ready?:boolean;children?:React.ReactNode}){
 return <section className="annual-scorecard" aria-label="Annual performance scorecard"><span className="eyebrow">BEAST RESULTS · {year}</span><h2>Annual performance scorecard</h2><p>{location} · Modeled site energy, utility cost and CO₂e</p>{children}
 {loading&&<p role="status">Retrieving utility and EPA data…</p>}
 {!ready?<p className="results-prompt" role="status">Select <strong>Load results</strong> to view scorecards and graphs. Missing performance inputs remain unavailable.</p>:<>
 {results.map((r,i)=>{const p=performance[i],s=r.summary;if(!p)return null;return <div className="scorecard-scenario" key={i}><h3>{scenarioName(r.scenario)}</h3>

 {!!(s.unknownHeatingHours+s.unknownCoolingHours)&&<p className="model-error">Incomplete performance data: {number(s.unknownHeatingHours)} heating and {number(s.unknownCoolingHours)} cooling hours remain unavailable. Annual totals require complete hourly energy.</p>}
 <div className="scorecard-grid"><div><span>Annual energy consumption</span><strong>{number(p.energy,1)}{p.energy!==null&&<small>MMBtu site energy</small>}</strong><p>{p.reason||`${number(s.electricity)} kWh electricity + ${number(s.gasTherms,1)} therms gas`}</p></div>
 <div><span>Annual utility cost · estimate</span><strong>{p.cost===null?"Unavailable":money(p.cost)}</strong><p>{p.electricBill.reason||p.gasReason||"Electricity tariff or manual rate; EIA monthly gas benchmark when used"}</p></div>
 <div><span>Annual CO₂e emissions</span><strong>{number(p.co2e,1)}{p.co2e!==null&&<small>metric tons CO₂e</small>}</strong><p>{p.emissionsReason||p.reason||"EPA electricity generation and natural-gas combustion factors"}</p></div></div>
 <p className="service-note">Known unmet loads: {number(s.unmetHeatingHours)} heating hours and {number(s.unmetCoolingHours)} cooling hours.{s.unknownHeatingHours>0&&` Heating performance is unknown for ${number(s.unknownHeatingHours)} hours.`}{s.unknownCoolingHours>0&&` Cooling performance is unknown for ${number(s.unknownCoolingHours)} hours.`}</p></div>;})}
 <p className="comparison-note">Equipment-only screening estimates with selected heating and heat-pump cooling. Nominal cooling power is constant at full output. The inferred supply fan runs on heating, cooling and ventilation calls; its energy is counted once and its heat enters the load balance. Both efficiency families use their own supplied power ratings. No auxiliary heat or reheat is added. Annual totals require 8,760 complete hourly energy records.</p><PerformanceGraphs performance={performance} labels={results.map(r=>scenarioName(r.scenario))}/>
 <details className="billing-breakdown"><summary>Monthly energy, charges, emissions and calculation scope</summary><p>Electricity applies supported tariff terms or the entered flat rate. Gas cost uses an EIA monthly state delivered-price benchmark. Current prices and EPA factors are independent of the weather year.</p>
 {performance.map((p,i)=><div key={i}><h4>{results[i]?scenarioName(results[i].scenario):"Equipment combination"}</h4>{p.reason&&<p>{p.reason}</p>}{p.electricBill.warnings.map(w=><p key={w}>{w}</p>)}{p.gasReason&&<p>{p.gasReason}</p>}{p.months.length>0&&<div className="rate-scroll"><table><thead><tr><th>Month</th><th>Electricity (kWh)</th><th>Gas (therms)</th><th>Site energy (MMBtu)</th><th>Electricity cost ($)</th><th>Gas cost ($)</th><th>Gas source month</th><th>Total cost ($)</th><th>CO₂e (t)</th></tr></thead><tbody>{p.months.map((m,j)=><tr key={m.month}><th>{m.month}</th><td>{number(m.electricity,2)}</td><td>{number(m.gasTherms,2)}</td><td>{number(m.energy,2)}</td><td>{number(p.electricBill.months[j]?.total,2)}</td><td>{number(m.gasCost,2)}</td><td>{m.gasTherms>0?m.gasPeriod||"Unavailable":"Not used"}</td><td>{number(m.cost,2)}</td><td>{number(m.co2e,2)}</td></tr>)}</tbody></table></div>}</div>)}
 </details></>}
 </section>;
}
