import data from "./data/intellipak-performance.json";

type CoolingTable = typeof data.cooling[number];
type HeatingTable = typeof data.heating[number];

export const INTELLIPAK_SOURCE = data.source;
export const INTELLIPAK_COOLING_TABLES = data.cooling;

export function intellipakCoolingTable(tons: number, efficiency: string) {
  return INTELLIPAK_COOLING_TABLES.find(table => table.tons === tons && table.efficiency === efficiency);
}

export function axisLimits(axis: number[]): [number, number] {
  return [axis[0], axis[axis.length - 1]];
}

function interpolate(axis: number[], input: number, at: (index: number) => number): number {
  const upper = axis.findIndex(value => value >= input);
  if (upper <= 0) return at(upper === 0 ? 0 : axis.length - 1);
  if (axis[upper] === input) return at(upper);
  const lower = upper - 1;
  const fraction = (input - axis[lower]) / (axis[upper] - axis[lower]);
  const low = at(lower);
  return low + fraction * (at(upper) - low);
}

/** Tabulated gross total and sensible capacity, evaluated separately in MBh. */
export function intellipakCooling(table: CoolingTable, outdoorF: number, wetF: number, dryF: number, cfm: number) {
  const axes = [table.cfm, table.dryF, table.outdoorF, table.wetF];
  const inputs = [cfm, dryF, outdoorF, wetF];
  if (!inputs.every((input, i) => Number.isFinite(input) && input >= axes[i][0] && input <= axes[i][axes[i].length - 1])) return null;
  const value = (component: number) => interpolate(table.cfm, cfm, flow =>
    interpolate(table.dryF, dryF, dry => interpolate(table.outdoorF, outdoorF, outdoor =>
      interpolate(table.wetF, wetF, wet => {
        const point = ((flow * table.dryF.length + dry) * table.outdoorF.length + outdoor) * table.wetF.length + wet;
        return table.mbh[point * 2 + component];
      }))));
  const total = value(0), sensible = value(1);
  return { capacityBtuHr: total * 1000, shr: sensible / total };
}

export function intellipakHeatingTables(tons: number): [HeatingTable, HeatingTable] {
  const lower = data.heating.findLast(table => table.tons <= tons) ?? data.heating[0];
  const upper = data.heating.find(table => table.tons >= tons) ?? lower;
  return [lower, upper];
}

/** Fan-inclusive output at 70% outdoor RH. Compare source sizes at equal CFM/ton. */
export function intellipakHeating(tons: number, outdoorF: number, dryF: number, cfm: number): number {
  const [lower, upper] = intellipakHeatingTables(tons);
  const capacityAt = (table: HeatingTable) => interpolate(table.cfm, cfm * table.tons / tons, flow =>
    interpolate(table.dryF, dryF, dry => interpolate(table.outdoorF, outdoorF, outdoor =>
      table.mbh[(flow * table.dryF.length + dry) * table.outdoorF.length + outdoor]))) * 1000;
  const low = capacityAt(lower);
  if (lower === upper) return low * tons / lower.tons;
  return low + (capacityAt(upper) - low) * (tons - lower.tons) / (upper.tons - lower.tons);
}
