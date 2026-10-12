import type { ClimateRow } from "./csv";
import type { ElectricTariff, EmissionRegion, GasCombustion, GasContext, RateTier } from "./location-energy";
import { ENERGY_TIER_UNITS } from "./location-energy";
import type { RtuResult } from "./rtu";

export type BillingHour = Pick<ClimateRow, "year" | "month" | "day" | "hour" | "minute"> & { electricity: number; gasTherms: number };
export type ElectricMonth = { energy: number; demand: number; fixed: number; minimum: number; total: number };
export type ElectricityBill = { months: ElectricMonth[]; total: number | null; reason: string | null; warnings: string[] };
export type MonthlyPerformance = {
  month: number; energy: number; electricity: number; gasTherms: number;
  electricCost: number | null; gasCost: number | null; cost: number | null;
  electricCo2: number | null; gasCo2: number | null; co2: number | null; gasPeriod: string | null;
};
export type AnnualPerformance = {
  months: MonthlyPerformance[]; energy: number | null; cost: number | null; co2: number | null;
  electricBill: ElectricityBill; gasReason: string | null; emissionsReason: string | null;
  reason: string | null; gasBenchmark: boolean;
};

/** Cumulative tier maxima; reset consumption for every billing month/TOU period. */
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

export function electricityBill(hours: BillingHour[], tariff: ElectricTariff | undefined): ElectricityBill {
  const fail = (reason: string): ElectricityBill => ({ months: [], total: null, reason, warnings: [] });
  if (!tariff) return fail("Select the building’s applicable electricity tariff below.");
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
    const warnings = ["Calendar-month estimate for HVAC treated as a separate meter. Uses local standard-time weekday/weekend schedules; holidays and daylight-saving shifts are not modeled. Taxes and riders not returned in the tariff are excluded.", "Confirm tariff eligibility using the building’s full meter load, voltage, phase, and utility service territory."];
    if (tariff.demandRates || tariff.flatDemandRates) warnings.push(`Demand charges use peak hourly-average kW. The tariff’s ${tariff.demandWindowMinutes ?? "unspecified"}-minute billing demand may differ from this estimate.`);
    if (tariff.energyRates.some(period => period.some(tier => tier.unit?.includes("/kW")))) warnings.push("Demand-based energy tier limits use the calendar month’s peak hourly-average HVAC kW; actual utility billing demand may differ.");
    if (tariff.energyRates.some(period => period.some(tier => tier.unit?.endsWith(" daily")))) warnings.push("Daily energy tier limits are multiplied by the number of calendar days in the billing month.");
    if (tariff.notes.length) warnings.push("Review the tariff’s published notes for additional conditions.");
    return { months, total: months.reduce((sum, m) => sum + m.total, 0), reason: null, warnings };
  } catch (error) { return fail(error instanceof Error ? error.message : "Unable to apply the tariff."); }
}

/** One source of totals for both scorecards and graphs; never fill missing API data with prices. */
export function annualPerformance(result: RtuResult, rows: ClimateRow[], tariff: ElectricTariff | undefined, region: EmissionRegion | undefined, gas: GasContext | undefined, combustion: GasCombustion | undefined): AnnualPerformance {
  const dates = new Set(rows.map(row => `${row.year}-${row.month}-${row.day}-${row.hour}`));
  const validCalendar = rows.every(row => {
    const date = new Date(Date.UTC(row.year, row.month - 1, row.day, row.hour));
    return row.year === rows[0].year && row.minute === 0 && row.hour >= 0 && row.hour <= 23 && Number.isInteger(row.hour)
      && date.getUTCMonth() === row.month - 1 && date.getUTCDate() === row.day && !(row.month === 2 && row.day === 29);
  });
  const invalid = !result.equipment || !!result.error || !result.summary.fullYear || rows.length !== 8760 || dates.size !== 8760 || !validCalendar || result.rows.length !== rows.length;
  const hours: BillingHour[] = [];
  if (!invalid) rows.forEach((row, i) => {
    const r = result.rows[i];
    if (r.electricity !== null && r.gasTherms !== null && Number.isFinite(r.electricity) && Number.isFinite(r.gasTherms) && r.electricity >= 0 && r.gasTherms >= 0) hours.push({ ...row, electricity: r.electricity, gasTherms: r.gasTherms });
  });
  if (invalid || hours.length !== 8760) {
    const reason = result.error || "A complete year of valid hourly energy data is required.";
    return { months: [], energy: null, cost: null, co2: null, electricBill: { months: [], total: null, reason, warnings: [] }, gasReason: null, emissionsReason: null, reason, gasBenchmark: false };
  }
  const electricBill = electricityBill(hours, tariff);
  const factor = region && Number.isFinite(region.kgCo2PerKwh) && region.kgCo2PerKwh >= 0 ? region.kgCo2PerKwh : null;
  const gasFactor = combustion && Number.isFinite(combustion.kgCo2PerTherm) && combustion.kgCo2PerTherm >= 0 ? combustion.kgCo2PerTherm : null;
  const thermsPerMcf = combustion && Number.isFinite(combustion.thermsPerMcf) && combustion.thermsPerMcf > 0 ? combustion.thermsPerMcf : null;
  // Apply the newest available price for each calendar month, with source year retained.
  const prices = [...(gas?.status === "ok" ? gas.prices : [])].sort((a, b) => b.period.localeCompare(a.period));
  const months = Array.from({ length: 12 }, (_, month): MonthlyPerformance => {
    const selected = hours.filter(h => h.month === month + 1);
    const electricity = selected.reduce((sum, h) => sum + h.electricity, 0), gasTherms = selected.reduce((sum, h) => sum + h.gasTherms, 0);
    const price = prices.find(p => Number(p.period.slice(5)) === month + 1 && Number.isFinite(p.dollarsPerMcf) && p.dollarsPerMcf >= 0);
    const gasCost = gasTherms === 0 ? 0 : price && thermsPerMcf !== null ? gasTherms / thermsPerMcf * price.dollarsPerMcf : null;
    const electricCost = electricBill.months[month]?.total ?? null;
    const electricCo2 = factor === null ? null : electricity * factor / 1000;
    const gasCo2 = gasTherms === 0 ? 0 : gasFactor === null ? null : gasTherms * gasFactor / 1000;
    return { month: month + 1, electricity, gasTherms, energy: electricity * 3412.141633 / 1e6 + gasTherms * 0.1, electricCost, gasCost, cost: electricCost === null || gasCost === null ? null : electricCost + gasCost, electricCo2, gasCo2, co2: electricCo2 === null || gasCo2 === null ? null : electricCo2 + gasCo2, gasPeriod: price?.period ?? null };
  });
  const total = (key: "energy" | "cost" | "co2") => months.every(m => m[key] !== null) ? months.reduce((sum, m) => sum + m[key]!, 0) : null;
  return { months, energy: total("energy"), cost: total("cost"), co2: total("co2"), electricBill, reason: null,
    gasReason: months.some(m => m.gasCost === null) ? gas?.status !== "ok" ? gas?.message || "Waiting for API gas prices." : "The API lacks a monthly gas price or heat-content conversion required for this scenario." : null,
    emissionsReason: factor === null ? "Select an applicable EPA eGRID subregion; no assumed grid factor is used." : months.some(m => m.gasCo2 === null) ? "EPA natural gas combustion data are unavailable." : null,
    gasBenchmark: months.some(m => m.gasTherms > 0),
  };
}
