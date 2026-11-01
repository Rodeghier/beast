/**
 * WEATHER IMPORT. parseCsv handles the text format; parseClimateCsv interprets
 * the provider columns and metadata as typed hourly records.
 * ClimateRow.temperature is Celsius, humidity is percent RH, and solar inputs
 * are W/m2. Missing readings become null rather than zero.
 */

export type ClimateRow = { year: number; month: number; day: number; hour: number; minute: number; temperature: number | null; humidity: number | null; dhi: number | null; dni: number | null; ghi: number | null };
export type ClimateData = { metadata: Record<string, string>; rows: ClimateRow[] };

// Quoted fields can contain commas, escaped quotes, and embedded newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === "") quoted = !quoted;
      else cell += c;
    } else if (c === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("The source returned an incomplete CSV. Please try again.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

// A provider CSV has metadata lines before the hourly table. Locate the actual
// time header rather than assuming the first line is data.
export function parseClimateCsv(csv: string, requestedYear: number): ClimateData {
  const records = parseCsv(csv);
  const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headerIndex = records.findIndex(r => ["year", "month", "day", "hour", "minute"].every(k => r.some(v => normal(v) === k)));
  if (headerIndex < 0) throw new Error("NLR did not return the expected hourly CSV. Please try again.");
  const headers = records[headerIndex].map(normal);
  const indices = ["year", "month", "day", "hour", "minute"].map(k => headers.indexOf(k));
  const ti = headers.findIndex(h => h.includes("temperature"));
  const hi = headers.findIndex(h => h.includes("relativehumidity"));
  const solarIndices = ["dhi", "dni", "ghi"].map(key => headers.findIndex(h => h === key || h === `${key}wm2`));
  if (ti < 0 || hi < 0) throw new Error("The CSV is missing temperature or relative humidity.");
  const metadata: Record<string, string> = {};
  if (headerIndex >= 2) records[0].forEach((k, i) => { if (k) metadata[k] = records[1][i] ?? ""; });
  for (const key of ["DHI Units", "DNI Units", "GHI Units"]) {
    const unit = metadata[key]?.toLowerCase().replace(/[²^\s]/g, m => m === "²" ? "2" : "");
    if (unit && unit !== "w/m2") throw new Error(`Unsupported ${key}: expected W/m².`);
  }
  // Return null for blank/sentinel readings. This deliberately distinguishes
  // missing temperature/RH/irradiance from a legitimate measured zero.
  const rawNumber = (value: string | undefined) => !value?.trim() || /^(na|n\/a|nan|null|-+|none)$/i.test(value) ? null : Number(value);
  const rows = records.slice(headerIndex + 1).map((r, i): ClimateRow => {
    const values = indices.map(index => rawNumber(r[index]));
    if (values.some(v => v === null || !Number.isInteger(v))) throw new Error(`The CSV has an invalid timestamp on data row ${i + 1}.`);
    const [year, month, day, hour, minute] = values as number[];
    if (year !== requestedYear || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute !== 0 || new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1) throw new Error(`The CSV has an unexpected timestamp on data row ${i + 1}.`);
    const t = rawNumber(r[ti]); const h = rawNumber(r[hi]);
    const [dhi, dni, ghi] = solarIndices.map(index => {
      const v = index < 0 ? null : rawNumber(r[index]);
      return v !== null && Number.isFinite(v) && v >= 0 ? v : null;
    });
    return { year, month, day, hour, minute, temperature: t !== null && Number.isFinite(t) && t > -273.15 ? t : null, humidity: h !== null && Number.isFinite(h) && h >= 0 && h <= 100 ? h : null, dhi, dni, ghi };
  });
  if (!rows.length) throw new Error("NLR returned a CSV without hourly records.");
  return { metadata, rows };
}
