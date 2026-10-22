/** The only equipment-dependent inputs. No built-in performance values. */
export type CurveGrid = { outdoorF: number[]; enteringWetBulbF: number[]; values: number[][] };
export type Curve = CurveGrid | null;
export type PerformanceCurves = {
  heating: { capacity: Curve; cop: Curve };
  cooling: { capacity: Curve; cop: Curve; shr: Curve };
};
export type CurveScenario = { name: string; curves: PerformanceCurves; enteringWetBulbF: number | null; hourlyEnteringWetBulbF?: Record<string, number> };
export const emptyCurves = (): PerformanceCurves => ({ heating: { capacity: null, cop: null }, cooling: { capacity: null, cop: null, shr: null } });
export const newScenario = (name: string): CurveScenario => ({ name, curves: emptyCurves(), enteringWetBulbF: null });
export const CURVE_FIELDS = [
  ["heating", "capacity", "Heating normalized capacity"], ["heating", "cop", "Heating COP"],
  ["cooling", "capacity", "Cooling normalized capacity"], ["cooling", "cop", "Cooling COP"], ["cooling", "shr", "Cooling SHR"],
] as const;

export function parseCurves(input: unknown): PerformanceCurves {
  const object = (value: unknown, allowed: string[], where: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where} must be an object.`);
    if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error(`${where} contains an unsupported input. Only capacity, COP and SHR curves are supported.`);
    return value as Record<string, unknown>;
  };
  const root = object(input, ["heating", "cooling"], "Curve set"), result = emptyCurves();
  const heating = object(root.heating, ["capacity", "cop"], "Heating"), cooling = object(root.cooling, ["capacity", "cop", "shr"], "Cooling");
  for (const [mode, kind, label] of CURVE_FIELDS) {
    const raw = (mode === "heating" ? heating : cooling)[kind];
    if (raw === null) continue;
    const grid = object(raw, ["outdoorF", "enteringWetBulbF", "values"], label);
    const axis = (rawAxis: unknown): number[] => {
      if (!Array.isArray(rawAxis) || rawAxis.length < 2 || rawAxis.some((v, i) => typeof v !== "number" || !Number.isFinite(v) || i > 0 && v <= rawAxis[i - 1])) throw new Error(`${label}: each temperature axis needs at least two finite, strictly increasing values.`);
      return [...rawAxis];
    };
    const outdoorF = axis(grid.outdoorF), enteringWetBulbF = axis(grid.enteringWetBulbF);
    if (!Array.isArray(grid.values) || grid.values.length !== enteringWetBulbF.length) throw new Error(`${label}: values needs one row per entering wet-bulb temperature.`);
    const values = grid.values.map(row => {
      if (!Array.isArray(row) || row.length !== outdoorF.length || row.some(v => typeof v !== "number" || !Number.isFinite(v) || (kind === "cop" ? v <= 0 : kind === "shr" ? v < 0 || v > 1 : v < 0))) throw new Error(`${label}: each row needs one value per outdoor temperature; COP must be positive, capacity nonnegative, and SHR between 0 and 1.`);
      return [...row] as number[];
    });
    const surface = { outdoorF, enteringWetBulbF, values };
    if (mode === "heating") result.heating[kind as "capacity" | "cop"] = surface;
    else result.cooling[kind] = surface;
  }
  return result;
}

export function missingCurves(curves: PerformanceCurves): string[] {
  return CURVE_FIELDS.filter(([mode, kind]) => !(mode === "heating" ? curves.heating[kind as "capacity" | "cop"] : curves.cooling[kind])).map(([, , label]) => label);
}

/** Bilinear interpolation only inside both supplied axes; missing is never zero. */
export function curveValue(curve: Curve, outdoorF: number, enteringWetBulbF: number): number | null {
  if (!curve || !Number.isFinite(outdoorF) || !Number.isFinite(enteringWetBulbF)) return null;
  const bracket = (axis: number[], value: number) => {
    if (value < axis[0] || value > axis.at(-1)!) return null;
    const upper = axis.findIndex(v => v >= value);
    const lo = Math.max(0, upper - 1), hi = Math.max(1, upper);
    return { lo, hi, fraction: (value - axis[lo]) / (axis[hi] - axis[lo]) };
  };
  const x = bracket(curve.outdoorF, outdoorF), y = bracket(curve.enteringWetBulbF, enteringWetBulbF);
  if (!x || !y) return null;
  const a = curve.values[y.lo][x.lo] * (1 - x.fraction) + curve.values[y.lo][x.hi] * x.fraction;
  const b = curve.values[y.hi][x.lo] * (1 - x.fraction) + curve.values[y.hi][x.hi] * x.fraction;
  return a * (1 - y.fraction) + b * y.fraction;
}
