import source from "./data/rtu/comstock-standard.json";
import lab from "./data/rtu/comstock-lab.json";
import variable from "./data/rtu/comstock-variable.json";
import cold from "./data/rtu/comstock-cold.json";
import { FAMILIES, type PerformanceFamily } from "./equipment-catalog";
import { celsius, fahrenheit, humidityRatio, saturationPressure } from "./school";

export const CURVE_COMMIT = "f25ac375311acb2448b4ee1665a8680e92abd24b";
export const CURVE_URL = `https://github.com/NatLabRockies/ComStock/blob/${CURVE_COMMIT}/resources/measures/upgrade_hvac_add_heat_pump_rtu/resources/performance_maps_hprtu_std.json`;
export const CURVE_REPORT = "https://docs.nlr.gov/docs/fy25osti/89042.pdf";
export const BTU_PER_KWH = 3412.141633;
export const REFERENCE_COOLING_CFM_PER_TON = 404;
export const REFERENCE_HEATING_CFM_PER_TON = 420;
export const HEATING_LOCKOUT_F = 0;

type Curve = Record<string, unknown> & { name: string; form?: string };
const curves = new Map<string, Curve>();
for (const [family, data] of Object.entries({ standard: source, lab, variable, cold })) {
  for (const curve of data.tables.curves.table as Curve[]) curves.set(`${family}:${curve.name}`, curve);
}
type Grid = { xs: number[]; ys: number[]; values: Map<string, number> };
const grids = new Map<string, Grid>();
for (const [name, curve] of curves) {
  if (curve.form !== "MultiVariableLookupTable") continue;
  const points = Object.entries(curve).filter(([key]) => /^data_point\d+$/.test(key)).map(([, v]) => String(v).split(",").map(Number));
  const dimensions = Number(curve.number_independent_variables);
  const xs = [...new Set(points.map(p => p[0]))].sort((a, b) => a - b);
  const ys = dimensions === 1 ? [0] : [...new Set(points.map(p => p[1]))].sort((a, b) => a - b);
  grids.set(name, { xs, ys, values: new Map(points.map(p => [p[0] + "," + (dimensions === 1 ? 0 : p[1]), p.at(-1)!])) });
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function bracket(axis: number[], value: number): [number, number, number] {
  if (axis.length === 1) return [axis[0], axis[0], 0];
  let index = axis.findIndex(v => v >= value);
  if (index < 0) index = axis.length - 1;
  if (index === 0) index = 1;
  const a = axis[index - 1], b = axis[index];
  return [a, b, clamp((value - a) / (b - a), 0, 1)];
}

export function lookup(name: string, x: number, y = 0, family: PerformanceFamily = "standard"): { value: number; bounded: boolean } {
  const grid = grids.get(`${family}:${name}`); if (!grid) throw new Error(`Missing performance map: ${family}:${name}`);
  const [x0, x1, fx] = bracket(grid.xs, x), [y0, y1, fy] = bracket(grid.ys, y);
  const get = (a: number, b: number) => { const v = grid.values.get(a + "," + b); if (v === undefined) throw new Error(`Incomplete performance map: ${name}`); return v; };
  const low = get(x0, y0) * (1 - fx) + get(x1, y0) * fx;
  const high = get(x0, y1) * (1 - fx) + get(x1, y1) * fx;
  // Coordinates in NLR's data strings are rounded to 0.01°C; ignore that
  // rounding when identifying outside-domain conditions.
  return { value: low * (1 - fy) + high * fy, bounded: x < grid.xs[0] - 0.01 || x > grid.xs.at(-1)! + 0.01 || y < grid.ys[0] - 0.01 || y > grid.ys.at(-1)! + 0.01 };
}

export function polynomial(name: string, x: number, y = 0, family: PerformanceFamily = "standard"): { value: number; bounded: boolean } {
  const c = curves.get(`${family}:${name}`); if (!c) throw new Error(`Missing curve: ${family}:${name}`);
  const originalX = x, originalY = y;
  x = clamp(x, Number(c.minimum_independent_variable_1), Number(c.maximum_independent_variable_1));
  if (c.minimum_independent_variable_2 !== null && c.minimum_independent_variable_2 !== undefined) y = clamp(y, Number(c.minimum_independent_variable_2), Number(c.maximum_independent_variable_2));
  let value = Number(c.coeff_1) + Number(c.coeff_2) * x + Number(c.coeff_3) * x * x;
  if (c.form?.toLowerCase() === "biquadratic") value += Number(c.coeff_4 ?? 0) * y + Number(c.coeff_5 ?? 0) * y * y + Number(c.coeff_6 ?? 0) * x * y;
  value = clamp(value, Number(c.minimum_dependent_variable_output), Number(c.maximum_dependent_variable_output));
  return { value, bounded: Math.abs(x - originalX) > 0.01 || Math.abs(y - originalY) > 0.01 };
}

export function ratedCop(tons: number, mode: "cooling" | "heating") {
  const kw = tons * 12000 / BTU_PER_KWH;
  // Pinned ComStock measure.rb: get_rated_cop_cooling / get_rated_cop_heating.
  return mode === "cooling" ? clamp(3.881009 - 0.01034 * kw, 3.02, 3.97) : clamp(3.957724 - 0.008502 * kw, 3.46, 3.99);
}

export function wetBulbC(db: number, w: number): number {
  // ASHRAE thermodynamic wet-bulb equation (PsychroLib formulation), inverted
  // by bisection. W is kg/kg = lb/lb. Sea-level pressure matches school loads.
  let low = -100, high = db;
  for (let i = 0; i < 25; i++) {
    const wb = (low + high) / 2, ws = humidityRatio(wb, 100)!;
    const calculated = wb >= 0
      ? ((2501 - 2.326 * wb) * ws - 1.006 * (db - wb)) / (2501 + 1.86 * db - 4.186 * wb)
      : ((2830 - 0.24 * wb) * ws - 1.006 * (db - wb)) / (2830 + 1.86 * db - 2.1 * wb);
    if (calculated > w) high = wb; else low = wb;
  }
  return (low + high) / 2;
}

export function mixedAir(returnF: number, returnW: number, outsideF: number, outsideW: number, fraction: number) {
  const f = clamp(fraction, 0, 1), tr = celsius(returnF), to = celsius(outsideF);
  const enthalpy = (t: number, w: number) => 1.006 * t + w * (2501 + 1.86 * t);
  const w = returnW * (1 - f) + outsideW * f;
  const h = enthalpy(tr, returnW) * (1 - f) + enthalpy(to, outsideW) * f;
  const db = (h - 2501 * w) / (1.006 + 1.86 * w);
  return { db, wb: wetBulbC(db, w), w, dryBulbF: fahrenheit(db) };
}

export function coolingFactors(enteringWbC: number, outdoorC: number, cfmPerTon: number, family: PerformanceFamily = "standard") {
  const advanced = family === "variable" || family === "cold";
  const capT = advanced ? polynomial("cool_cap_ft4", enteringWbC, outdoorC, family) : lookup("c_cap_high_T", enteringWbC, outdoorC, family);
  const eirT = advanced ? polynomial("cool_eir_ft4", enteringWbC, outdoorC, family) : lookup("c_eir_high_T", enteringWbC, outdoorC, family);
  const ff = cfmPerTon / FAMILIES[family].coolingReferenceCfm;
  const capF = polynomial(advanced ? "cool_cap_ff1" : "c_cap_high_ff", ff, 0, family), eirF = polynomial(advanced ? "cool_eir_ff1" : "c_eir_high_ff", ff, 0, family);
  return { capacity: capT.value * capF.value, eir: eirT.value * eirF.value, bounded: capT.bounded || eirT.bounded || capF.bounded || eirF.bounded };
}

export function heatingFactors(enteringDbC: number, enteringWbC: number, outdoorC: number, outsideW: number, cfmPerTon: number, family: PerformanceFamily = "standard", lockoutF = HEATING_LOCKOUT_F) {
  if (outdoorC < celsius(lockoutF)) return { capacity: 0, powerFactor: 0, defrostPowerFactor: 0, bounded: false, lockout: true };
  const boost = family === "cold" && outdoorC <= -8.33333;
  const stage = boost ? "boost" : "high";
  const capFraction = family === "cold" ? (boost ? 1.388985813 : 1.350190651) : 1;
  const copFraction = family === "cold" ? (boost ? 0.722198906 : 1.097922025) : 1;
  // EnergyPlus DX heating curves use entering DB first, outdoor DB second.
  // The variable-speed JSON's descriptive axis names are reversed; its limits
  // and coefficients follow this EnergyPlus order (55–75°F, −15–65°F).
  const capT = family === "variable" ? polynomial("heat_cap_ft4", enteringDbC, outdoorC, family) : lookup(family === "cold" ? `h_cap_${stage}` : "h_cap_T", enteringDbC, outdoorC, family);
  const eirT = family === "variable" ? polynomial("heat_eir_ft4", enteringDbC, outdoorC, family) : lookup(family === "cold" ? `h_eir_${stage}` : "h_eir_T", enteringDbC, outdoorC, family);
  const ff = cfmPerTon / FAMILIES[family].heatingReferenceCfm;
  const capF = polynomial(family === "variable" ? "heat_cap_ff1" : "h_cap_allstages_ff", ff, 0, family), eirF = polynomial(family === "variable" ? "heat_eir_ff1" : "h_eir_allstages_ff", ff, 0, family);
  let cap = capT.value * capF.value * capFraction, powerFactor = cap * eirT.value * eirF.value / copFraction, defrostPowerFactor = 0;
  let bounded = capT.bounded || eirT.bounded || capF.bounded || eirF.bounded;
  if (outdoorC <= 4.444) {
    const coilC = 0.82 * outdoorC - 8.589;
    const pv = saturationPressure(coilC)!;
    const coilW = 0.621945 * pv / (101325 - pv);
    const delta = Math.max(1e-6, outsideW - coilW), time = delta / (delta + 0.01446);
    const reverseCycle = 0.01 * time * (7.222 - outdoorC) / 1.01667;
    cap = Math.max(0, cap * 0.875 * (1 - time) - reverseCycle * capFraction);
    powerFactor *= 0.954 * (1 - time);
    const defrost = polynomial("defrost_eir", enteringWbC, outdoorC, family);
    defrostPowerFactor = defrost.value * time / 1.01667 * capFraction;
    bounded ||= defrost.bounded;
  }
  return { capacity: cap, powerFactor, defrostPowerFactor, bounded, lockout: false };
}

export function runtimeFraction(plr: number, mode: "cooling" | "heating", family: PerformanceFamily = "standard") {
  if (plr <= 0) return 0;
  const ratio = clamp(plr, 0, 1);
  const plf = mode === "cooling" ? polynomial("cool_plf_plr1", ratio, 0, family).value : lookup("heat_plf_plr1", Math.max(0.02, ratio), 0, family).value;
  return Math.min(1, ratio / Math.max(ratio, plf));
}

// Maximum HEATING output and electrical input at a specified operating point.
// Neither capacity nor full-load power depends on the building's requested load.
// Values include the modeled frost/defrost effects, but exclude the supply fan.
export function heatingOperatingPoint(count: number, tonsEach: number, enteringDbC: number, enteringWbC: number, outdoorC: number, outsideW: number, cfmPerTon: number, family: PerformanceFamily = "standard", lockoutF = HEATING_LOCKOUT_F) {
  const f = heatingFactors(enteringDbC, enteringWbC, outdoorC, outsideW, cfmPerTon, family, lockoutF);
  const ratedBtu = count * tonsEach * 12000, ratedKw = ratedBtu / BTU_PER_KWH;
  const capacityBtu = ratedBtu * f.capacity;
  const compressorKw = ratedKw * f.powerFactor / ratedCop(tonsEach, "heating");
  const defrostKw = ratedKw * f.defrostPowerFactor;
  const inputKw = compressorKw + defrostKw;
  return { capacityBtu, compressorKw, defrostKw, inputKw,
    cop: inputKw > 0 && capacityBtu > 0 ? capacityBtu / (BTU_PER_KWH * inputKw) : null,
    bounded: f.bounded, lockout: f.lockout };
}
