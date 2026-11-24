import { AREAL_CAPACITY_TO_BTU_F_FT2, SLAB_ACTIVE_CAPACITY_FRACTION, assemblyMassConductance } from "./thermal-mass";

export const RTS_SOURCE = "https://handbook.ashrae.org/Handbooks/F25/IP/F25_Ch18/F25_Ch18_ip.aspx";
export const RTS_DESIGN_BASIS = "ASHRAE Handbook—Fundamentals 2025, Ch. 18: 24-hour periodic RTS, Tables 22–23, with separate beam solar and nonsolar factors. Wall and roof CTS derived from BEAST's assembly U-values and heat capacities.";
const HOURS = 24;
const CLASS_NAMES = ["Light", "Medium", "Heavy"] as const;

// Tabulated exterior-zone factors in percent. Each series is ordered by lag, 0–23 hours.
// ASHRAE Handbook—Fundamentals 2025, Chapter 18, Tables 22 and 23.
const NONSOLAR = [
  // Light: carpet 10/50/90% glass, then bare 10/50/90%.
  [47, 19, 11, 6, 4, 3, 2, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [50, 18, 10, 6, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [53, 17, 9, 5, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [41, 20, 12, 8, 5, 4, 3, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [43, 19, 11, 7, 5, 3, 3, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [46, 19, 11, 7, 5, 3, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  // Medium: carpet 10/50/90% glass, then bare 10/50/90%.
  [46, 18, 10, 6, 4, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [49, 17, 9, 5, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
  [52, 16, 8, 5, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [31, 17, 11, 8, 6, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [33, 16, 10, 7, 5, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [35, 15, 10, 7, 5, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
  // Heavy: carpet 10/50/90% glass, then bare 10/50/90%.
  [34, 9, 6, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1],
  [38, 9, 6, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1],
  [42, 9, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1],
  [22, 10, 6, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [25, 9, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [28, 9, 6, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1],
];
const SOLAR = [
  // Light: carpet 10/50/90% glass, then bare 10/50/90%.
  [53, 17, 9, 5, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [55, 17, 9, 5, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [56, 17, 9, 5, 3, 2, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [44, 19, 11, 7, 5, 3, 3, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [45, 20, 11, 7, 5, 3, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [46, 20, 11, 7, 5, 3, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  // Medium: carpet 10/50/90% glass, then bare 10/50/90%.
  [52, 16, 8, 5, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [54, 16, 8, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [55, 15, 8, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [28, 15, 10, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  [29, 15, 10, 7, 6, 5, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  [29, 15, 10, 7, 6, 5, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  // Heavy: carpet 10/50/90% glass, then bare 10/50/90%.
  [47, 11, 6, 4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [49, 12, 6, 4, 3, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [51, 12, 6, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [26, 12, 7, 5, 4, 4, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [27, 13, 7, 5, 4, 4, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1],
  [28, 13, 7, 5, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1],
];

export const RADIANT_FRACTION = {
  people: 0.60, wall: 0.46, roof: 0.60, floor: 0.46,
  window: (shgc: number) => shgc > 0.5 ? 0.33 : 0.46,
};

type RtsZone = { interiorMassKjM2K?: number; interiorMassCouplingWm2K?: number; slabCapacityKjM2K?: number;
  stories: number; windowPercent: number; rtsMassClass?: number; rtsCarpetPercent?: number };

export function radiantTimeFactors(zone: RtsZone) {
  // BEAST's auto thresholds are a screening proxy, not ASHRAE classification limits.
  const activeInterior = (zone.interiorMassCouplingWm2K ?? 6) > 0 ? zone.interiorMassKjM2K ?? 0 : 0;
  const activeCapacity = activeInterior + SLAB_ACTIVE_CAPACITY_FRACTION * (zone.slabCapacityKjM2K ?? 0) / zone.stories;
  const selected = zone.rtsMassClass || (activeCapacity < 75 ? 1 : activeCapacity < 150 ? 2 : 3);
  const construction = CLASS_NAMES[selected - 1];
  const carpet = (zone.rtsCarpetPercent ?? 0) / 100;
  const glass = Math.min(90, Math.max(10, zone.windowPercent));
  const interval = glass >= 50 ? 1 : 0;
  const mix = (glass - (10 + 40 * interval)) / 40;
  const base = (selected - 1) * 6 + interval;
  const interpolate = (table: number[][]) => table[base].map((_, hour) => {
    const carpeted = table[base][hour] * (1 - mix) + table[base + 1][hour] * mix;
    const bare = table[base + 3][hour] * (1 - mix) + table[base + 4][hour] * mix;
    return (carpeted * carpet + bare * (1 - carpet)) / 100;
  });
  return { construction, activeCapacity, carpetPercent: carpet * 100, glassPercent: glass,
    solar: interpolate(SOLAR), nonsolar: interpolate(NONSOLAR) };
}

/** Implicit one-hour 2R1C response, folded to a repeating 24-hour design day. */
export function conductionTimeFactors(u: number, capacityKjM2K: number): number[] {
  if (u <= 0 || capacityKjM2K <= 0) return [1, ...Array<number>(HOURS - 1).fill(0)];
  const capacity = capacityKjM2K * AREAL_CAPACITY_TO_BTU_F_FT2;
  const conductance = 2 * assemblyMassConductance(u);
  const decay = capacity / (capacity + conductance);
  const weights = Array.from({ length: HOURS }, (_, lag) => decay ** lag);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => weight / total);
}

export function periodicLoad(gains: readonly number[], factors: readonly number[]): number[] {
  return gains.map((_, hour) => factors.reduce((load, factor, lag) => load + factor * gains[(hour + HOURS - lag) % HOURS], 0));
}

export type DesignSensibleGains = {
  wall: number; roof: number; floor: number; window: number; outdoorAir: number;
  beam: number; diffuse: number; internalRadiant: number; internalConvective: number;
};

export function rtsDesignSensible(gains: readonly DesignSensibleGains[],
  factors: ReturnType<typeof radiantTimeFactors>, wallFactors: readonly number[],
  roofFactors: readonly number[], shgc: number) {
  const wall = periodicLoad(gains.map(g => g.wall), wallFactors);
  const roof = periodicLoad(gains.map(g => g.roof), roofFactors);
  const beamLoad = periodicLoad(gains.map(g => g.beam), factors.solar);
  const nonsolarGains = gains.map((g, hour) => g.diffuse + g.internalRadiant
    + wall[hour] * RADIANT_FRACTION.wall + roof[hour] * RADIANT_FRACTION.roof
    + g.window * RADIANT_FRACTION.window(shgc) + g.floor * RADIANT_FRACTION.floor);
  const nonsolarLoad = periodicLoad(nonsolarGains, factors.nonsolar);
  return gains.map((g, hour) => {
    const convective = wall[hour] + roof[hour] + g.floor + g.window + g.diffuse
      + g.internalRadiant + g.internalConvective + g.outdoorAir - nonsolarGains[hour];
    return { sensible: convective + beamLoad[hour] + nonsolarLoad[hour], solarRadiant: beamLoad[hour], nonsolarRadiant: nonsolarLoad[hour] };
  });
}
