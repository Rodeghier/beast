export type ClimateRow = { year: number; month: number; day: number; hour: number; minute: number; temperature: number | null; humidity: number | null };
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

export function parseClimateCsv(csv: string, requestedYear: number): ClimateData {
  const records = parseCsv(csv);
  const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headerIndex = records.findIndex(r => ["year", "month", "day", "hour", "minute"].every(k => r.some(v => normal(v) === k)));
  if (headerIndex < 0) throw new Error("NLR did not return the expected hourly CSV. Please try again.");
  const headers = records[headerIndex].map(normal);
  const indices = ["year", "month", "day", "hour", "minute"].map(k => headers.indexOf(k));
  const ti = headers.findIndex(h => h.includes("temperature"));
  const hi = headers.findIndex(h => h.includes("relativehumidity"));
  if (ti < 0 || hi < 0) throw new Error("The CSV is missing temperature or relative humidity.");
  const metadata: Record<string, string> = {};
  if (headerIndex >= 2) records[0].forEach((k, i) => { if (k) metadata[k] = records[1][i] ?? ""; });
  const rawNumber = (value: string | undefined) => !value?.trim() || /^(na|n\/a|nan|null|-+|none)$/i.test(value) ? null : Number(value);
  const rows = records.slice(headerIndex + 1).map((r, i): ClimateRow => {
    const values = indices.map(index => rawNumber(r[index]));
    if (values.some(v => v === null || !Number.isInteger(v))) throw new Error(`The CSV has an invalid timestamp on data row ${i + 1}.`);
    const [year, month, day, hour, minute] = values as number[];
    if (year !== requestedYear || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute !== 0 || new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1) throw new Error(`The CSV has an unexpected timestamp on data row ${i + 1}.`);
    const t = rawNumber(r[ti]); const h = rawNumber(r[hi]);
    return { year, month, day, hour, minute, temperature: t !== null && Number.isFinite(t) && t > -273.15 ? t : null, humidity: h !== null && Number.isFinite(h) && h >= 0 && h <= 100 ? h : null };
  });
  if (!rows.length) throw new Error("NLR returned a CSV without hourly records.");
  return { metadata, rows };
}
