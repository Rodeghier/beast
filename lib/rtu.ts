import { parseCsv } from "./csv";
import type { SolarLocation } from "./solar";
import { celsius, humidityRatio, schoolCsv, type SchoolAssumptions, type SchoolRow } from "./school";
import { BTU_PER_KWH, CURVE_COMMIT, CURVE_REPORT, RATED_SHR, SHR_SOURCE, clamp, coolingOperatingPoint, heatingOperatingPoint, mixedAir, ratedCop, runtimeFraction } from "./rtu-curves";
import { DEFAULT_SYSTEM, FAMILIES, FURNACE_SOURCE, RESISTANCE_SOURCE, familySource, heatingName, coolingName, isHeatPump, validateSystem, type SystemChoice } from "./equipment-catalog";

export const RTU_VERSION = "cav-equipment-4.0";
export const UNIT_SIZES = [5, 7.5, 10, 12.5, 15, 17.5, 20, 25];
export const DEFAULT_RTU = { maxTons: 25, cfmPerTon: 404, maxOutdoorPercent: 25, fanWPerCfm: 0.5 };
export type RtuAssumptions = typeof DEFAULT_RTU;
export const RTU_FIELDS: { key: keyof RtuAssumptions; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: "cfmPerTon", label: "Constant supply airflow", unit: "CFM / nominal ton", min: 300, max: 550, step: 1 },
  { key: "maxOutdoorPercent", label: "Maximum outdoor-air fraction", unit: "% of supply airflow", min: 5, max: 50, step: 1 },
  { key: "fanWPerCfm", label: "Supply-fan input power", unit: "W / CFM", min: 0.1, max: 1.5, step: 0.01 },
];
export function validateRtu(a: RtuAssumptions): string | null {
  if (!UNIT_SIZES.includes(a.maxTons)) return "Select a maximum nominal unit size from the available sizes.";
  for (const f of RTU_FIELDS) if (!Number.isFinite(a[f.key]) || a[f.key] < f.min || a[f.key] > f.max) return `${f.label} must be between ${f.min} and ${f.max}.`;
  return null;
}
export type Equipment = { count: number; tonsEach: number; totalTons: number; supplyCfm: number; outdoorCapacityCfm: number; peakVentilationCfm: number; reheatKwEach: number; heatingBankBtuEach: number };
type Prepared = { row: SchoolRow; outsideW: number; latentGain: number };
type Demand = { fanKw: number; heating: number; sensible: number; latent: number; returnF: number; returnW: number; outdoorFraction: number; mixed: ReturnType<typeof mixedAir> };
export type RtuRow = {
  gasTherms: number | null; directHeatKwh: number | null;
  electricity: number | null; compressorKwh: number | null; fanKwh: number | null; reheatKwh: number | null;
  coolingShr: number | null; coilAdpF: number | null; coilBypassFactor: number | null;
  unmetHeating: number | null; unmetCooling: number | null; deliveredHeating: number | null; deliveredCooling: number | null;
  heatingDemand: number | null; sensibleDemand: number | null; latentDemand: number | null; availableCooling: number | null; availableHeating: number | null;
  usableHeating: number | null; heatingFullLoadKw: number | null; heatingFullLoadCop: number | null; operatingCop: number | null; fanHeatCredit: number | null; heatingCurveBounded: boolean; heatingShortfallReason: string;
  returnF: number | null; returnW: number | null; mixedDbF: number | null; mixedWbF: number | null; outdoorFraction: number | null;
  runtime: number | null; curveBounded: boolean; lockout: boolean; mode: string; status: string;
};
export type RtuResult = { system: SystemChoice; equipment: Equipment | null; rows: RtuRow[]; error: string | null; summary: {
  gasTherms: number; directHeat: number; siteMMBtu: number; unmetCoolingBtu: number;
  electricity: number; fan: number; compressor: number; reheat: number;
  coolingShrMin: number | null; coolingShrMax: number | null; subfreezingCoilHours: number;
  peakUnmetHeating: number; unmetHeatingHours: number; unmetHeatingBtu: number; unmetCoolingHours: number;
  capacityLimitedHours: number; heatingCopMin: number | null; heatingCopMax: number | null;
  boundedHours: number; lockoutHours: number; completeHours: number; fullYear: boolean; simultaneousHours: number;
} };

function prepare(row: SchoolRow, a: SchoolAssumptions): Prepared | null {
  if (row.temperatureF === null || row.heating === null || row.totalCooling === null || row.freeFloatF === null) return null;
  const outsideW = humidityRatio(row.temperature, row.humidity);
  return outsideW === null ? null : { row, outsideW, latentGain: row.occupants * a.latentPerson };
}
export function equipmentFor(count: number, tonsEach: number, a: RtuAssumptions, peakVentilationCfm = 0): Equipment {
  const totalTons = count * tonsEach, supplyCfm = totalTons * a.cfmPerTon;
  return { count, tonsEach, totalTons, supplyCfm, outdoorCapacityCfm: supplyCfm * a.maxOutdoorPercent / 100, peakVentilationCfm, reheatKwEach: 0, heatingBankBtuEach: 0 };
}
function demand(p: Prepared, e: Equipment, a: RtuAssumptions, school: SchoolAssumptions): Demand {
  const r = p.row;
  // Full constant airflow during occupied hours or an unoccupied load call.
  const fanOn = r.occupied || r.heating! > 0 || r.sensibleCooling! < 0 || r.latentCooling! < 0;
  const fanKw = fanOn ? e.supplyCfm * a.fanWPerCfm / 1000 : 0, fanHeat = fanKw * BTU_PER_KWH;
  const returnF = clamp(r.freeFloatF! + fanHeat / r.heatTransfer, r.heatingSetpointF, r.coolingSetpointF);
  const targetW = humidityRatio(celsius(returnF), school.indoorRh)!;
  const moistureRise = r.outdoorAirCfm > 0 ? p.latentGain / (0.68 * 7000 * r.outdoorAirCfm) : p.latentGain > 0 ? Infinity : 0;
  const returnW = Math.max(0, Math.min(targetW, p.outsideW + moistureRise));
  const latent = Math.max(0, 0.68 * 7000 * r.outdoorAirCfm * (p.outsideW - targetW) + p.latentGain);
  const sensible = Math.max(0, r.coolBalance! + fanHeat), heating = Math.max(0, r.heatBalance! - fanHeat);
  const outdoorFraction = fanOn ? r.ventilationCfm / e.supplyCfm : 0;
  return { fanKw, heating, sensible, latent, returnF, returnW, outdoorFraction,
    mixed: mixedAir(returnF, returnW, r.temperatureF!, p.outsideW, outdoorFraction) };
}
function blank(status: string): RtuRow {
  return { electricity: null, gasTherms: null, directHeatKwh: null, compressorKwh: null, fanKwh: null, reheatKwh: null, coolingShr: null, coilAdpF: null, coilBypassFactor: null,
    unmetHeating: null, unmetCooling: null, deliveredHeating: null, deliveredCooling: null, heatingDemand: null, sensibleDemand: null, latentDemand: null,
    availableCooling: null, availableHeating: null, returnF: null, returnW: null, mixedDbF: null, mixedWbF: null, outdoorFraction: null,
    usableHeating: null, heatingFullLoadKw: null, heatingFullLoadCop: null, operatingCop: null, fanHeatCredit: null, heatingCurveBounded: false, heatingShortfallReason: "Missing data",
    runtime: null, curveBounded: false, lockout: false, mode: "Unavailable", status };
}
export function simulateRtuHour(row: SchoolRow, equipment: Equipment, a: RtuAssumptions, school: SchoolAssumptions, system: SystemChoice = DEFAULT_SYSTEM): RtuRow {
  const p = prepare(row, school); if (!p) return blank("Missing weather or solar input");
  const d = demand(p, equipment, a, school), ratedBtu = equipment.totalTons * 12000;
  // Evaluate the installed capacity and full-load power independently of demand.
  // Entering air is the return/outdoor-air mixture, not the room setpoint alone.
  const heatPump = isHeatPump(system.heating);
  const bankCapacity = equipment.count * equipment.heatingBankBtuEach;
  const hp = isHeatPump(system.heating)
    ? heatingOperatingPoint(equipment.count, equipment.tonsEach, d.mixed.db, d.mixed.wb, row.temperature!, p.outsideW, a.cfmPerTon, system.heating, system.lockoutF)
    : { capacityBtu: bankCapacity, compressorKw: 0, inputKw: system.heating === "resistance" ? bankCapacity / BTU_PER_KWH : null, cop: system.heating === "resistance" ? 1 : null, bounded: false, lockout: false };
  const coolingCall = d.sensible > 0.01 || d.latent > 0.01;
  const usableHeating = coolingCall ? 0 : hp.capacityBtu;
  const fanHeatCredit = Math.min(row.heating!, d.fanKw * BTU_PER_KWH);
  const heatingDemand = Math.max(0, row.heating! - fanHeatCredit);
  let cooling = 0, heating = 0, availableCooling = 0, runtime = 0, compressor = 0, reheat = 0, gasTherms = 0, directHeatKwh = 0, bounded = false, lockout = false;
  let coolingShr: number | null = null, coilAdpF: number | null = null, coilBypassFactor: number | null = null;
  let mode = d.fanKw > 0 ? "Fan only" : "Off";
  if (coolingCall) {
    const f = coolingOperatingPoint(d.mixed.db, d.mixed.w, row.temperature!, a.cfmPerTon, system.cooling);
    coolingShr = f.shr; coilAdpF = f.adpC * 1.8 + 32; coilBypassFactor = f.bypassFactor;
    availableCooling = ratedBtu * f.capacity;
    const required = Math.max(d.sensible > 0.01 ? d.sensible / f.shr : 0, d.latent > 0.01 ? d.latent / (1 - f.shr) : 0);
    cooling = Math.min(required, availableCooling);
    runtime = runtimeFraction(cooling / availableCooling, "cooling", system.cooling);
    compressor = availableCooling / BTU_PER_KWH * f.eir / ratedCop(equipment.tonsEach, "cooling") * runtime;
    reheat = Math.max(0, cooling * f.shr - d.sensible) / BTU_PER_KWH;
    bounded = f.bounded;
    mode = reheat > 0.01 ? "Cooling + reheat" : "Cooling";
  } else if (heatingDemand > 0) {
    // Requested heating can never increase the installed output limit.
    heating = Math.min(heatingDemand, usableHeating);
    runtime = usableHeating > 0 && isHeatPump(system.heating) ? runtimeFraction(heating / usableHeating, "heating", system.heating) : 0;
    compressor = hp.compressorKw * runtime;
    if (system.heating === "gas") gasTherms = heating / 0.8 / 100000;
    if (system.heating === "resistance") directHeatKwh = heating / BTU_PER_KWH;
    bounded = hp.bounded; lockout = hp.lockout; mode = lockout ? "Heating lockout" : "Heating";
  }
  const unmetHeating = Math.max(0, heatingDemand - usableHeating);
  const heatingShortfallReason = unmetHeating <= 1 ? "None" : coolingCall ? "Dehumidification priority" : hp.lockout ? "Outdoor temperature below heating lockout" : "Heat demand exceeds available heating capacity";
  const coilElectricInput = compressor + directHeatKwh;
  const operatingCop = coilElectricInput > 0 ? (cooling + heating) / (BTU_PER_KWH * coilElectricInput) : null;
  const unmetCooling = Math.max(0, d.sensible - cooling * (coolingShr ?? 1)) + Math.max(0, d.latent - cooling * (1 - (coolingShr ?? 1)));
  const notes = [bounded ? "Map input held at boundary" : availableCooling > 0 || (heatPump && heatingDemand > 0.01 && hp.capacityBtu > 0) ? "Within map domain" : !heatPump && heating > 0 ? (system.heating === "gas" ? "Gas thermal efficiency 0.80" : "Resistance COP 1.00") : "No active performance map", lockout ? `Heating below ${system.lockoutF} F lockout` : "", unmetHeating > 1 ? heatingShortfallReason : ""].filter(Boolean).join("; ");
  return { electricity: compressor + d.fanKw + reheat + directHeatKwh, gasTherms, directHeatKwh, compressorKwh: compressor, fanKwh: d.fanKw, reheatKwh: reheat, coolingShr, coilAdpF, coilBypassFactor,
    unmetHeating, unmetCooling, deliveredHeating: heating, deliveredCooling: -cooling, heatingDemand, sensibleDemand: -d.sensible, latentDemand: -d.latent,
    availableCooling, availableHeating: hp.capacityBtu, usableHeating, heatingFullLoadKw: hp.inputKw, heatingFullLoadCop: hp.cop, operatingCop, fanHeatCredit, heatingCurveBounded: hp.bounded, heatingShortfallReason, returnF: d.returnF, returnW: d.returnW, mixedDbF: d.mixed.dryBulbF, mixedWbF: d.mixed.wb * 1.8 + 32, outdoorFraction: d.outdoorFraction,
    runtime, curveBounded: bounded, lockout, mode, status: notes };
}

export function selectRtu(rows: SchoolRow[], school: SchoolAssumptions, a: RtuAssumptions = DEFAULT_RTU, system: SystemChoice = DEFAULT_SYSTEM): RtuResult {
  const issue = validateRtu(a) ?? validateSystem(system); if (issue) throw new Error(issue);
  const prepared = rows.map(row => prepare(row, school)).filter((p): p is Prepared => p !== null);
  const peakVent = Math.max(0, ...rows.map(r => r.ventilationCfm));
  const sizes = UNIT_SIZES.filter(v => v <= a.maxTons);
  // Try high-load hours first to reject undersized candidates quickly. Every
  // passing candidate is checked against ALL valid hours, not just these peaks.
  const priority = new Set<Prepared>();
  for (const key of ["totalCooling", "sensibleCooling", "latentCooling"] as const) {
    [...prepared].sort((x, y) => x.row[key]! - y.row[key]!).slice(0, 48).forEach(p => priority.add(p));
  }
  const ordered = [...priority, ...prepared.filter(p => !priority.has(p))];
  let equipment: Equipment | null = null;
  const minCount = Math.max(1, Math.ceil(peakVent / (a.maxTons * a.cfmPerTon * a.maxOutdoorPercent / 100)));
  if (prepared.length) outer: for (let count = minCount; count <= 200; count++) {
    for (const tons of sizes) {
      const candidate = equipmentFor(count, tons, a, peakVent);
      if (candidate.outdoorCapacityCfm + 0.01 < peakVent) continue;
      let fits = true;
      for (const p of ordered) {
        const d = demand(p, candidate, a, school);
        if (d.sensible <= 0.01 && d.latent <= 0.01) continue;
        const f = coolingOperatingPoint(d.mixed.db, d.mixed.w, p.row.temperature!, a.cfmPerTon, system.cooling);
        const capacity = candidate.totalTons * 12000 * f.capacity;
        // No sizing multiplier: both sensible and latent output must cover demand.
        if (capacity * f.shr + 0.01 < d.sensible || capacity * (1 - f.shr) + 0.01 < d.latent) { fits = false; break; }
      }
      if (fits) { equipment = candidate; break outer; }
    }
  }
  const error = equipment ? null : prepared.length ? "No selection meets sensible cooling, latent cooling, and ventilation within 200 identical units. Review building inputs, airflow, and coil latent capacity." : "Valid temperature and humidity are needed to select equipment.";
  if (equipment && !isHeatPump(system.heating)) {
    const peakHeat = Math.max(0, ...prepared.map(p => demand(p, equipment!, a, school).heating));
    equipment.heatingBankBtuEach = Math.ceil(peakHeat / equipment.count / 10000) * 10000;
  }
  const output = rows.map(r => equipment ? simulateRtuHour(r, equipment, a, school, system) : blank(error!));
  if (equipment) equipment.reheatKwEach = Math.ceil(Math.max(0, ...output.map(r => r.reheatKwh ?? 0)) / equipment.count);
  const sum = (key: "electricity" | "fanKwh" | "compressorKwh" | "reheatKwh" | "unmetHeating" | "gasTherms" | "directHeatKwh" | "unmetCooling") => output.reduce((s, r) => s + (r[key] ?? 0), 0);
  const completeHours = output.filter(r => r.electricity !== null).length;
  const heatingCops = output.filter(r => r.mode === "Heating" && r.operatingCop !== null).map(r => r.operatingCop!);
  const coolingShrs = output.flatMap(r => r.coolingShr === null ? [] : [r.coolingShr]);
  const unique = new Set(rows.map(r => `${r.year}-${r.month}-${r.day}-${r.hour}-${r.minute}`));
  return { system: { ...system }, equipment, rows: output, error, summary: {
    gasTherms: sum("gasTherms"), directHeat: sum("directHeatKwh"), siteMMBtu: sum("electricity") * BTU_PER_KWH / 1e6 + sum("gasTherms") * 0.1, unmetCoolingBtu: sum("unmetCooling"),
    electricity: sum("electricity"), fan: sum("fanKwh"), compressor: sum("compressorKwh"), reheat: sum("reheatKwh"),
    coolingShrMin: coolingShrs.length ? Math.min(...coolingShrs) : null, coolingShrMax: coolingShrs.length ? Math.max(...coolingShrs) : null,
    subfreezingCoilHours: output.filter(r => r.coilAdpF !== null && r.coilAdpF < 32).length,
    peakUnmetHeating: Math.max(0, ...output.map(r => r.unmetHeating ?? 0)), unmetHeatingHours: output.filter(r => (r.unmetHeating ?? 0) > 1).length,
    unmetHeatingBtu: sum("unmetHeating"), unmetCoolingHours: output.filter(r => (r.unmetCooling ?? 0) > 1).length,
    capacityLimitedHours: output.filter(r => r.heatingShortfallReason === "Heat demand exceeds available heating capacity").length,
    heatingCopMin: heatingCops.length ? Math.min(...heatingCops) : null, heatingCopMax: heatingCops.length ? Math.max(...heatingCops) : null,
    boundedHours: output.filter(r => r.curveBounded).length, lockoutHours: output.filter(r => r.lockout).length, completeHours,
    fullYear: completeHours === 8760 && rows.length === 8760 && unique.size === 8760 && !rows.some(r => r.month === 2 && r.day === 29),
    simultaneousHours: output.filter(r => (r.heatingDemand ?? 0) > 0.01 && (r.deliveredCooling ?? 0) < -0.01).length,
  } };
}

export function rtuCsv(schoolRows: SchoolRow[], school: SchoolAssumptions, result: RtuResult, a: RtuAssumptions, location: string, zone: string, site?: SolarLocation | null): string {
  const original = parseCsv(schoolCsv(schoolRows, school, location, zone, site));
  const e = result.equipment, system = result.system;
  const hp = isHeatPump(system.heating);
  const metadata: Record<string, string | number> = {
    RTU_model: RTU_VERSION, RTU_family: "Generic CAV packaged system; independently selected NLR heating and DX cooling models; full-output compressor cycling",
    Heating_type: heatingName(system.heating), Cooling_type: coolingName(system.cooling),
    Heating_source: isHeatPump(system.heating) ? familySource(system.heating) : system.heating === "gas" ? FURNACE_SOURCE : RESISTANCE_SOURCE,
    Cooling_source: familySource(system.cooling), Heating_lockout_F: hp ? system.lockoutF : "Not applicable",
    Primary_heating_bank_output_BTU_hr_per_unit: e?.heatingBankBtuEach ?? "",
    Gas_efficiency: system.heating === "gas" ? 0.8 : "Not applicable",
    Curve_source: familySource(system.cooling), Curve_report: CURVE_REPORT, Curve_commit: CURVE_COMMIT,
    Equipment_count: e?.count ?? "", Nominal_tons_per_unit: e?.tonsEach ?? "", Total_nominal_tons: e?.totalTons ?? "", Total_supply_CFM: e?.supplyCfm ?? "", Mechanical_OA_capacity_CFM: e?.outdoorCapacityCfm ?? "",
    Required_dehumidification_reheat_kW_per_unit: e?.reheatKwEach ?? "", Maximum_unit_tons: a.maxTons,
    ...Object.fromEntries(RTU_FIELDS.map(f => [`RTU ${f.label} (${f.unit})`, a[f.key]])),
    Selection: "Fewest identical units then smallest unit size; all valid hours; mechanical ventilation only; sensible and latent capacity checked separately including fan heat; no sizing margin; heat-pump rated heating equals nominal cooling basis; gas/resistance output bank sized to peak coil heat need, rounded up to 10000 BTU/hr per unit",
    SHR_method: "Operating-condition ADP/bypass-factor model; dry-coil capacity evaluated at dry-out humidity; on-cycle SHR, no transient latent degradation or condensate re-evaporation",
    Rated_SHR: RATED_SHR, SHR_method_source: SHR_SOURCE,
    Excluded_equipment_effects: "No sizing safety margin, crankcase heater input, or added frost/defrost capacity and power adjustments; source capacity/EIR temperature curves retained",
    Controls: "Occupied continuous CAV fans; unoccupied full-hour CAV fans on load calls; no economizer; full-stage HP cycling; dehumidification priority; ideal electric reheat; no supplemental space heating; HP lockout as selected; gas/resistance are primary heat",
    RTU_energy_basis: "Positive kWh in each 1-hour interval = compressor/outdoor fan + supply fan + electric dehumidification reheat + primary resistance heat; excludes lighting and plugs",
    Gas_energy_basis: "Therms of gas input = delivered furnace heat / 0.8 / 100000 per hour; ignition/inducer/pilot electricity omitted; shared supply fans included",
    Site_energy_basis: "MMBtu = electricity kWh x 3412.141633 / 1000000 + gas therms x 0.1. Site energy is not source energy, cost, or emissions. Review unmet loads before comparing.",
    Family_adaptation: "Highest-stage operation with cycling and constant fans; variable-speed modulation savings excluded. Cold-climate model is a hypothetical 2027 specification; high stage, boost at or below 17 F. Rated COP uses the common active ComStock size fits for all families.",
    RTU_scope: "Building heating need is exported separately from coil heating need after supply-fan heat credit. Available net heating is potential full-load capacity at each operating point; usable heating is zero when cooling takes priority. Cooling capacity is evaluated in cooling mode only.",
    Heating_balance: "Coil heat need = max(0, building heat need - fan heat credit); unmet heating = max(0, coil heat need - usable available heating capacity); delivered heat = min(coil heat need, usable capacity). No auxiliary heat.",
    Efficiency_basis: "Full-load heating COP = available heating / (3412.141633 x mapped full-load compressor/outdoor-fan kW). Operating electric coil COP uses delivered heat or gross cooling divided by actual coil electricity, including cycling. Gas-heating COP and full-load electric input are blank; thermal efficiency is 0.80. COP excludes supply fan and reheat; RTU electricity includes them.",
    Map_policy: "Bilinear interpolation; clamp outside measured input grids and flag affected operating hours; standard sea-level air; variable operating SHR; no off-cycle condensate re-evaporation; subfreezing coil ADP requires engineering review",
    Weather_coverage: result.summary.fullYear ? "8760 valid unique non-leap hourly records" : "Partial/incomplete weather; totals and selection are provisional",
    Selection_status: result.error ?? "Modeled cooling and ventilation covered; review map-boundary hours and engineering assumptions",
  };
  // The inherited limitations describe the school LOAD model only; equipment
  // effects are explicitly included in the appended RTU results.
  original[0][original[0].indexOf("Limitations")] = "Building_load_model_limitations";
  const headers = ["Mechanical_ventilation_CFM", "Infiltration_CFM", "RTU_mode", "RTU_electricity_kWh", "Unmet_heating_BTU_hr", "Unmet_cooling_BTU_hr", "Delivered_heating_BTU_hr", "Delivered_gross_cooling_BTU_hr", "Coil_heating_demand_BTU_hr", "Coil_sensible_cooling_demand_BTU_hr", "Coil_latent_cooling_demand_BTU_hr", "Available_gross_cooling_BTU_hr", "Available_net_heating_BTU_hr", "Compressor_outdoor_fan_kWh", "Supply_fan_kWh", "Dehumidification_reheat_kWh", "Return_air_F", "Return_humidity_ratio_lb_lb", "Coil_entering_drybulb_F", "Coil_entering_wetbulb_F", "Outdoor_air_fraction", "Compressor_runtime_fraction", "Performance_status", "Supply_fan_heating_credit_BTU_hr", "Usable_heating_capacity_BTU_hr", "Full_load_heating_electric_input_kW", "Full_load_electric_heating_COP", "Operating_electric_coil_COP", "Heating_map_boundary", "Heating_shortfall_reason", "Gas_input_therms", "Primary_resistance_heating_kWh", "Site_energy_MMBtu", "Operating_cooling_SHR", "Coil_apparatus_dew_point_F", "Coil_bypass_factor"];
  const line = (items: unknown[]) => items.map(v => v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`).join(",");
  const round = (v: unknown) => typeof v === "number" ? Number(v.toFixed(6)) : v;
  return [line([...original[0], ...Object.keys(metadata)]), line([...original[1], ...Object.values(metadata)]), "", line([...original[2], ...headers]), ...result.rows.map((r, i) => line([...original[i + 3], ...[
    schoolRows[i].ventilationCfm, schoolRows[i].infiltrationCfm, r.mode, r.electricity, r.unmetHeating, r.unmetCooling, r.deliveredHeating, r.deliveredCooling,
    r.heatingDemand, r.sensibleDemand, r.latentDemand, r.availableCooling, r.availableHeating, r.compressorKwh, r.fanKwh, r.reheatKwh,
    r.returnF, r.returnW, r.mixedDbF, r.mixedWbF, r.outdoorFraction, r.runtime, r.status, r.fanHeatCredit, r.usableHeating, r.heatingFullLoadKw, r.heatingFullLoadCop, r.operatingCop, r.availableHeating === null ? null : r.heatingCurveBounded ? "Yes" : "No", r.heatingShortfallReason, r.gasTherms, r.directHeatKwh, r.electricity === null || r.gasTherms === null ? null : r.electricity * BTU_PER_KWH / 1e6 + r.gasTherms * 0.1, r.coolingShr, r.coilAdpF, r.coilBypassFactor,
  ].map(round)]))].join("\r\n");
}
