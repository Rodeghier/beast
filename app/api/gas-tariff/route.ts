import { MGE_GAS_SOURCE, parseMgeGas } from "@/lib/gas-tariff";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("provider") !== "mge") return Response.json({ error: "Select a supported gas utility." }, { status: 400 });
  try {
    const response = await fetch(MGE_GAS_SOURCE, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (!response.ok || Number(response.headers.get("Content-Length")) > 1_000_000) throw new Error("upstream");
    const html = await response.text();
    if (html.length > 1_000_000) throw new Error("oversized");
    return Response.json({ ...parseMgeGas(html), retrievedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "MGE’s current tariff page could not be read. Use the utility source link to check its published schedule." }, { status: 502 });
  }
}
