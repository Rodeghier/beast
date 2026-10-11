export const MGE_GAS_SOURCE = "https://www.mge.com/my-account/rates/natural-gas-rates/business-natural-gas-rates";
export type GasSchedule = { name: string; sourceUrl: string | null; rows: string[][] };
export type GasTariff = { provider: string; effectiveDate: string; sourceUrl: string; retrievedAt: string; schedules: GasSchedule[] };
function plain(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, 1500);
}
/** Parse only the current rate section, never the historical monthly accordion. */
export function parseMgeGas(html: string): Omit<GasTariff, "retrievedAt"> {
  const match = /services rendered on and after\s+([A-Za-z]+ \d{1,2}, \d{4})\./.exec(html);
  const start = html.indexOf("<h2>Distribution service</h2>"), end = html.indexOf("Total Charges for Business Customers", start);
  if (!match || start < 0 || end < start || end - start > 80000) throw new Error("Unrecognized current gas tariff format");
  const schedules: GasSchedule[] = [];
  for (const table of html.slice(start, end).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(table[1])?.[1];
    const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table[1])?.[1];
    if (!head || !body) continue;
    const name = plain(head), rawPath = /href="([^"]+)"/i.exec(head)?.[1];
    const sourceUrl = rawPath && /^\/MGE\/media\/[a-zA-Z0-9_./-]+\.pdf$/i.test(rawPath) && !rawPath.includes("..") ? `https://www.mge.com${rawPath}` : null;
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => plain(cell[1])).filter(Boolean)).filter(row => row.length);
    if (name && rows.length) schedules.push({ name, sourceUrl, rows });
  }
  if (!schedules.some(s => s.name.includes("GSD-1")) || !schedules.some(s => s.name.includes("FS-1")) || schedules.length > 30) throw new Error("Incomplete gas tariff structure");
  return { provider: "Madison Gas and Electric", effectiveDate: match[1], sourceUrl: MGE_GAS_SOURCE, schedules };
}
