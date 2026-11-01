/**
 * ANNUAL ENERGY AND BILLING. Applies prices to already-calculated equipment
 * kWh and therms. tierCharge handles cumulative limits, electricityBill handles
 * monthly tariff logic, and annualPerformance combines energy/cost/emissions.
 * A missing cost input can block cost while energy remains available.
 * One-hour kWh equals average kW numerically; it is not subhourly billing demand.
 */

import { energyEmissions } from "./emissions";
import type { ClimateRow } from "./csv";
import type { ElectricTariff, EmissionRegion, GasContext, GasCombustion, RateTier } from "./location-energy";
import { ENERGY_TIER_UNITS } from "./location-energy";
import type { EquipmentResult } from "./equipment-model";

export type BillingHour = Pick<ClimateRow, "year" | "month" | "day" | "hour" | "minute"> & { electricity: number };
export type ElectricMonth = { energy: number; demand: number; fixed: number; minimum: number; total: number };
export type ElectricityBill = { months: ElectricMonth[]; total: number | null; reason: string | null; warnings: string[] };
export type MonthlyPerformance = { month: number; energy: number; electricity: number; gasTherms:number; gasCost:number|null; gasPeriod:string|null; cost: number | null; co2e: number | null };
export type AnnualPerformance = {
  months: MonthlyPerformance[]; energy: number | null; cost: number | null; co2e: number | null;
  electricBill: ElectricityBill; emissionsReason: string | null; reason: string | null; gasReason:string|null;
};

/** Cumulative tier maxima; reset consumption for every billing month/TOU period. */
// Example: 0.10 per unit up to 100, then 0.20 thereafter. A quantity of 150
// costs 100*0.10 + 50*0.20, not 150*0.20. max values are cumulative limits.
export function tierCharge(quantity: number, tiers: RateTier[]): number {
  if (!tiers.length || !Number.isFinite(quantity) || quantity < 0) throw new Error("Invalid tier quantity or missing tiers.");
  let previous = 0, cost = 0;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i], limit = t.max ?? Infinity;
    if (limit <= previous || (t.max === null && i !== tiers.length - 1) || (t.rate === null && t.adjustment === null)) throw new Error("Invalid tier limits or missing tier price.");
    const price = (t.rate ?? 0) + (t.adjustment ?? 0);
    if (!Number.isFinite(price) || (t.max !== null && !Number.isFinite(t.max))) throw new Error("Invalid tier price or limit.");
    cost += Math.max(0, Math.min(quantity, limit) - previous) * price;
    previous = limit;
  }
  if (quantity > previous) throw new Error("Usage exceeds the supplied tariff tiers.");
  return cost;
}

function periodicCharge(value: number | null, unit: string | null, days: number): number {
  if (value === null) return 0; // Absent optional charge, not an absent energy price.
  if (!Number.isFinite(value)) throw new Error("Invalid fixed or minimum charge.");
  if (unit === "$/month") return value;
  if (unit === "$/day") return value * days;
  if (unit === "$/year") return value / 12;
  throw new Error("Unsupported fixed or minimum charge units.");
}

/** URDB units describe cumulative tier limits; prices remain dollars/kWh.
 * Demand-based limits use this calendar month's peak hourly-average import kW.
 * See https://samrepo.nlr.gov/help/electricity_purchases.html (Billing Demand).
 */
function energyTierCharge(quantity: number, tiers: RateTier[], days: number, peak: number): number {
  const converted = tiers.map(tier => {
    const unit = tier.unit || "kWh";
    if (!ENERGY_TIER_UNITS.includes(unit)) throw new Error(`Unsupported energy tier units: ${unit}.`);
    const scale = (unit.includes("/kW") ? peak : 1) * (unit.endsWith(" daily") ? days : 1);
    if (tier.max !== null && (!Number.isFinite(tier.max) || tier.max <= 0)) throw new Error("Invalid energy tier limit.");
    return { ...tier, max: tier.max === null ? null : tier.max * scale };
  });
  // A zero-load month has zero demand and therefore zero demand-based allowances.
  const applicable = converted.filter(tier => tier.max !== 0);
  if (!applicable.length && quantity === 0) return 0;
  return tierCharge(quantity, applicable);
}

// manualRate, when supplied, replaces the API tariff calculation. Otherwise
// validate the tariff before calculating monthly energy, demand and fixed charges.
export function electricityBill(hours: BillingHour[], tariff: ElectricTariff | undefined, manualRate?: number): ElectricityBill {
  const fail = (reason: string): ElectricityBill => ({ months: [], total: null, reason, warnings: [] });
  if (manualRate !== undefined) {
    if (!Number.isFinite(manualRate) || manualRate < 0) return fail("Enter a valid nonnegative electricity rate in $/kWh.");
    if (!hours.length || hours.some(h => !Number.isFinite(h.electricity) || h.electricity < 0)) return fail("Invalid hourly electricity data.");
    const months = Array.from({ length: 12 }, (_, m) => {
      const energy = hours.filter(h => h.month === m + 1).reduce((sum, h) => sum + h.electricity * manualRate, 0);
      return { energy, demand: 0, fixed: 0, minimum: 0, total: energy };
    });
    const total = months.reduce((sum, m) => sum + m.total, 0);
    if (!Number.isFinite(total)) return fail("Electricity cost exceeds the supported numeric range.");
    return { months, total, reason: null, warnings: [`Manual electricity rate: $${manualRate}/kWh × modeled consumption. Replaces API tariff pricing; no separate demand, fixed, minimum, tax or rider charges are added.`] };
  }
  if (!tariff) return fail("No electricity tariff selected or available. Energy and emissions can still be calculated; total utility cost requires an applicable tariff.");
  if (tariff.unsupportedClauses.length) return fail(`Unsupported tariff terms: ${tariff.unsupportedClauses.join("; ")}.`);
  if (tariff.serviceType !== "Bundled" && tariff.serviceType !== "Delivery with Standard Offer") return fail("A bundled electricity tariff is required; this tariff omits or does not identify supply/delivery charges.");
  if (!tariff.energyRates || !tariff.energyWeekdaySchedule || !tariff.energyWeekendSchedule) return fail("The API did not provide a complete energy rate schedule.");
  if (tariff.energyRates.some(period => period.some(tier => tier.unit && !ENERGY_TIER_UNITS.includes(tier.unit)))) return fail("Unsupported energy tier units.");
  if (tariff.demandRates && (tariff.demandRateUnits !== "kW" || !tariff.demandWeekdaySchedule || !tariff.demandWeekendSchedule)) return fail("Missing or unsupported time-of-use demand schedule/units.");
  if (tariff.flatDemandRates && (tariff.flatDemandUnits !== "kW" || !tariff.flatDemandMonths)) return fail("Missing or unsupported monthly demand schedule/units.");
  if (!hours.length) return fail("Hourly energy data are unavailable.");
  try {
    const year = hours[0].year;
    const months = Array.from({ length: 12 }, (_, month) => {
      // Separate accumulators are needed because kWh are summed within TOU periods,
      // whereas billing demand is the largest hourly-average kW within a period.
      const energy = new Map<number, number>(), demand = new Map<number, number>();
      let peak = 0, kwh = 0;
      for (const row of hours.filter(h => h.month === month + 1)) {
        if (!Number.isFinite(row.electricity) || row.electricity < 0 || row.year !== year) throw new Error("Invalid hourly electricity data.");
        const weekday = new Date(Date.UTC(row.year, row.month - 1, row.day)).getUTCDay();
        const weekend = weekday === 0 || weekday === 6;
        const p = (weekend ? tariff.energyWeekendSchedule : tariff.energyWeekdaySchedule)![month]?.[row.hour];
        if (!Number.isInteger(p) || !tariff.energyRates![p]) throw new Error("Invalid energy period in the tariff schedule.");
        energy.set(p, (energy.get(p) ?? 0) + row.electricity);
        kwh += row.electricity; peak = Math.max(peak, row.electricity); // One-hour kWh = average kW.
        if (tariff.demandRates) {
          const d = (weekend ? tariff.demandWeekendSchedule : tariff.demandWeekdaySchedule)![month]?.[row.hour];
          if (!Number.isInteger(d) || !tariff.demandRates[d]) throw new Error("Invalid demand period in the tariff schedule.");
          demand.set(d, Math.max(demand.get(d) ?? 0, row.electricity));
        }
      }
      const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      // Add monthly fuel adjustment once to total monthly kWh. Fixed charges and
      // minimum-bill top-ups are separate terms; a top-up is only the remaining shortfall.
      const energyCharge = [...energy].reduce((sum, [p, quantity]) => sum + energyTierCharge(quantity, tariff.energyRates![p], days, peak), 0) + kwh * (tariff.fuelAdjustmentsMonthly?.[month] ?? 0);
      let demandCharge = [...demand].reduce((sum, [p, quantity]) => sum + tierCharge(quantity, tariff.demandRates![p]), 0);
      if (tariff.flatDemandRates) {
        const tiers = tariff.flatDemandRates[tariff.flatDemandMonths![month]];
        if (!tiers) throw new Error("Invalid monthly demand period.");
        demandCharge += tierCharge(peak, tiers);
      }
      const fixed = periodicCharge(tariff.fixedCharge, tariff.fixedChargeUnits, days);
      const minimum = tariff.minimumChargeUnits === "$/year" ? 0 : Math.max(0, periodicCharge(tariff.minimumCharge, tariff.minimumChargeUnits, days) - energyCharge - demandCharge - fixed);
      return { energy: energyCharge, demand: demandCharge, fixed, minimum, total: energyCharge + demandCharge + fixed + minimum };
    });
    if (tariff.minimumCharge !== null && tariff.minimumChargeUnits === "$/year") {
      const topUp = Math.max(0, tariff.minimumCharge - months.reduce((sum, m) => sum + m.total, 0));
      months[11].minimum += topUp; months[11].total += topUp;
    }
    if (months.some(m => !Number.isFinite(m.total))) throw new Error("Incomplete or invalid tariff charges.");
    const warnings = ["Calendar-month estimate for curve-based electricity treated as a separate meter. Uses local standard-time weekday/weekend schedules; holidays and daylight-saving shifts are not modeled. Taxes and riders not returned in the tariff are excluded.", "Confirm tariff eligibility using the building’s full meter load, voltage, phase, and utility service territory."];
    if (tariff.demandRates || tariff.flatDemandRates) warnings.push(`Demand charges use peak hourly-average kW. The tariff’s ${tariff.demandWindowMinutes ?? "unspecified"}-minute billing demand may differ from this estimate.`);
    if (tariff.energyRates.some(period => period.some(tier => tier.unit?.includes("/kW")))) warnings.push("Demand-based energy tier limits use the calendar month’s peak hourly-average curve-based kW; actual utility billing demand may differ.");
    if (tariff.energyRates.some(period => period.some(tier => tier.unit?.endsWith(" daily")))) warnings.push("Daily energy tier limits are multiplied by the number of calendar days in the billing month.");
    if (tariff.notes.length) warnings.push("Review the tariff’s published notes for additional conditions.");
    return { months, total: months.reduce((sum, m) => sum + m.total, 0), reason: null, warnings };
  } catch (error) { return fail(error instanceof Error ? error.message : "Unable to apply the tariff."); }
}

/** Annual totals require a complete energy record; gas and electricity are independent inputs. */
// Gate annual metrics on complete equipment energy and calendar coverage first.
// Then calculate monthly site energy, utility cost and emissions independently.
export function annualPerformance(result: EquipmentResult, rows: ClimateRow[], tariff: ElectricTariff | undefined, region: EmissionRegion | undefined, gas?:GasContext, combustion?:GasCombustion, manualRate?: number): AnnualPerformance {
  const dates = new Set(rows.map(row => `${row.year}-${row.month}-${row.day}-${row.hour}`));
  const calendar = rows.every(row => {
    const date=new Date(Date.UTC(row.year,row.month-1,row.day,row.hour));
    return row.year===rows[0].year && row.minute===0 && Number.isInteger(row.hour) && row.hour>=0 && row.hour<24 && date.getUTCMonth()===row.month-1 && date.getUTCDate()===row.day && !(row.month===2&&row.day===29);
  });
  const valid=(n:number|null):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
  const invalid=!!result.error || !result.summary.fullYear || rows.length!==8760 || dates.size!==8760 || !calendar || result.rows.length!==rows.length || result.rows.some(r=>!valid(r.electricity)||!valid(r.gasTherms));
  if(invalid){
    const reason=result.error || result.rows.find(r=>r.electricity===null||r.gasTherms===null)?.status || "A complete year of valid equipment energy is required.";
    return {months:[],energy:null,cost:null,co2e:null,electricBill:{months:[],total:null,reason,warnings:[]},reason,emissionsReason:null,gasReason:null};
  }
  const hours=rows.map((row,i)=>({...row,electricity:result.rows[i].electricity!}));
  const electricBill:ElectricityBill=hours.every(h=>h.electricity===0)?{months:Array.from({length:12},()=>({energy:0,demand:0,fixed:0,minimum:0,total:0})),total:0,reason:null,warnings:["No modeled electricity use; no separate electricity account charges assigned."]}:electricityBill(hours,tariff,manualRate);
  // EIA records are sorted newest first. Each modeled calendar month uses the
  // newest supplied price for that month; it need not be from the weather year.
  const prices=[...(gas?.status==="ok"?gas.prices:[])].sort((a,b)=>b.period.localeCompare(a.period));
  const conversion=combustion&&Number.isFinite(combustion.thermsPerMcf)&&combustion.thermsPerMcf>0?combustion.thermsPerMcf:null;
  const months=Array.from({length:12},(_,month):MonthlyPerformance=>{
    let electricity=0,gasTherms=0;
    rows.forEach((row,i)=>{if(row.month===month+1){electricity+=result.rows[i].electricity!;gasTherms+=result.rows[i].gasTherms!;}});
    const price=prices.find(p=>Number(p.period.slice(5))===month+1&&Number.isFinite(p.dollarsPerMcf)&&p.dollarsPerMcf>=0);
    const gasCost=gasTherms===0?0:price&&conversion!==null?gasTherms/conversion*price.dollarsPerMcf:null;
    const electricCost=electricBill.months[month]?.total??null, emissions=energyEmissions(electricity,gasTherms,region,combustion);
    return {month:month+1,electricity,gasTherms,energy:electricity*3412.141633/1e6+gasTherms*.1,gasCost,gasPeriod:price?.period??null,cost:electricCost===null||gasCost===null?null:electricCost+gasCost,co2e:emissions.co2e===null?null:emissions.co2e/1000};
  });
  const total=(key:"energy"|"cost"|"co2e")=>months.every(m=>m[key]!==null)?months.reduce((sum,m)=>sum+m[key]!,0):null;
  return {months,energy:total("energy"),cost:total("cost"),co2e:total("co2e"),electricBill,reason:null,
    gasReason:months.some(m=>m.gasCost===null)?"Natural-gas cost requires an EIA monthly price for each used month and a valid heat-content conversion. Refresh gas data or configure the EIA connection.":null,
    emissionsReason:months.some(m=>m.co2e===null)?"Required EPA electricity or natural-gas emissions factors are unavailable.":null};
}
