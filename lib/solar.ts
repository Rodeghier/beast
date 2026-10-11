import type { ClimateRow } from "./csv";

export type SolarLocation = { latitude: number; longitude: number; utcOffset: number };
export type SolarInputs = { stories: number; aspectRatio: number; rotationDeg: number; ceilingFt: number; windowPercent: number; shgc: number; shadeFactor: number; roofU: number; wallU: number; solarAbsorptance: number; outdoorFilm: number; groundReflectance: number };
const RAD = Math.PI / 180;
const W_M2_TO_BTU_H_FT2 = 0.316998331;

export function solarLocation(metadata: Record<string, string>): SolarLocation | null {
  const raw = [metadata.Latitude, metadata.Longitude, metadata["Local Time Zone"] ?? metadata["Time Zone"]];
  if (raw.some(v => v === undefined || v.trim() === "")) return null;
  const [latitude, longitude, utcOffset] = raw.map(Number);
  return [latitude, longitude, utcOffset].every(Number.isFinite) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && Math.abs(utcOffset) <= 14 ? { latitude, longitude, utcOffset } : null;
}

// NOAA fractional-year approximation; east/north/up unit vector. The hourly
// interval midpoint is used, with the CSV's fixed standard-time UTC offset.
export function sunVector(row: Pick<ClimateRow, "year" | "month" | "day" | "hour" | "minute">, site: SolarLocation) {
  const day = (Date.UTC(row.year, row.month - 1, row.day) - Date.UTC(row.year, 0, 0)) / 86400000;
  const days = (Date.UTC(row.year + 1, 0, 1) - Date.UTC(row.year, 0, 1)) / 86400000;
  const hour = row.hour + row.minute / 60 + 0.5;
  const g = 2 * Math.PI / days * (day - 1 + (hour - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = (hour * 60 + eq + 4 * site.longitude - 60 * site.utcOffset) / 4 * RAD - Math.PI;
  const lat = site.latitude * RAD;
  return { east: -Math.cos(dec) * Math.sin(ha), north: Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(ha), up: Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha) };
}

// Isotropic sky + ground reflection on a vertical face. GHI is the measured
// horizontal total and is never added to DNI as if both were normal irradiance.
export function wallIrradiance(dhi: number, dni: number, ghi: number, albedo: number, azimuthDeg: number, sun: ReturnType<typeof sunVector>) {
  const incidence = sun.east * Math.sin(azimuthDeg * RAD) + sun.north * Math.cos(azimuthDeg * RAD);
  return (sun.up > 0 ? dni * Math.max(0, incidence) : 0) + dhi / 2 + ghi * albedo / 2;
}

export function solarGains(row: ClimateRow, a: SolarInputs, area: number, site?: SolarLocation | null) {
  const missing = { total: null, windows: null, opaque: null, status: "Missing solar radiation" };
  if ([row.dhi, row.dni, row.ghi].some(v => v === null || v === undefined || !Number.isFinite(v) || v < 0)) return missing;
  if (row.dhi === 0 && row.dni === 0 && row.ghi === 0) return { total: 0, windows: 0, opaque: 0, status: "Zero irradiance" };
  if (!site) return { ...missing, status: "Missing solar location or time-zone metadata" };
  const roof = area / a.stories, length = Math.sqrt(roof * a.aspectRatio), width = roof / length;
  const height = a.stories * a.ceilingFt, sun = sunVector(row, site), glass = a.windowPercent / 100;
  let windows = 0, walls = 0;
  for (const [azimuth, faceWidth] of [[0, length], [90, width], [180, length], [270, width]]) {
    const incident = wallIrradiance(row.dhi!, row.dni!, row.ghi!, a.groundReflectance, azimuth + a.rotationDeg, sun) * W_M2_TO_BTU_H_FT2;
    const faceArea = faceWidth * height;
    windows += faceArea * glass * a.shgc * a.shadeFactor * incident;
    walls += faceArea * (1 - glass) * a.wallU * a.solarAbsorptance * incident / a.outdoorFilm;
  }
  const opaque = walls + roof * a.roofU * a.solarAbsorptance * row.ghi! * W_M2_TO_BTU_H_FT2 / a.outdoorFilm;
  return { total: windows + opaque, windows, opaque, status: "Sup3rCC solar; steady-state glazing and sol-air correction" };
}
