import { env } from "cloudflare:workers";
import { MIN_YEAR, MAX_YEAR, STATES, supportsClimate } from "@/lib/climate";

class ClimateDownloadError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const state = p.get("state");
  if (state && !Object.hasOwn(STATES, state)) return Response.json({ error: "Select a valid US state." }, { status: 400 });
  if (state && !supportsClimate(state)) return Response.json({ error: `The supplied Sup3rCC dataset does not cover ${STATES[state]}. Climate CSVs are available only for the contiguous 48 states and Washington, DC.`, code: "OUTSIDE_DATASET_COVERAGE" }, { status: 422 });
  const lat = Number(p.get("latitude")); const lon = Number(p.get("longitude")); const year = Number(p.get("year"));
  if (!p.get("latitude") || !p.get("longitude") || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 24 || lat > 50 || lon < -125 || lon > -66 || !Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return Response.json({ error: "Choose a location in the contiguous United States and a year from 2015 to 2059." }, { status: 400 });
  const config = env as unknown as Record<string, string | undefined>;
  const key = config.NLR_API_KEY || process.env.NLR_API_KEY;
  const email = config.NLR_EMAIL || process.env.NLR_EMAIL;
  if (!key || !email) return Response.json({ error: "The climate data connection is not configured. Please contact the site owner." }, { status: 503 });
  const url = new URL("https://developer.nlr.gov/api/climate/ncdb/v2/climate/sup3rcc-conus-ecearth3cc-ssp245-r1i1p1f1-v0-2-2-download.csv");
  url.search = new URLSearchParams({ api_key: key, names: String(year), leap_day: "false", interval: "60", utc: "false", full_name: config.NLR_FULL_NAME || process.env.NLR_FULL_NAME || "", email, affiliation: config.NLR_AFFILIATION || process.env.NLR_AFFILIATION || "", mailing_list: "false", reason: "Academic", attributes: "temperature_2m,relativehumidity_2m,dhi,dni,ghi", wkt: `POINT(${lon} ${lat})` }).toString();
  const started = Date.now();
  let phase = "preparing";
  const signal = AbortSignal.timeout(150000);
  try {
    // NLR may return the generated CSV in its public data bucket. Never send
    // the API key, identity fields, or request headers to a redirect target.
    let response = await fetch(url, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (!location) throw new ClimateDownloadError("MISSING_DOWNLOAD_URL", "NLR prepared a response without a download address. Please try again.");
      const target = new URL(location, url);
      const isNlrBucket = target.hostname === "s3.us-west-2.amazonaws.com" && /^\/nsrdb-data\.stratus\.nlr\.gov\/[a-zA-Z0-9_.-]+\.csv$/.test(target.pathname);
      if (target.protocol !== "https:" || !isNlrBucket || target.search || target.username || target.password || target.port) throw new ClimateDownloadError("UNEXPECTED_DOWNLOAD_URL", "NLR returned a download address this site does not support. Please contact the site owner.");
      phase = "downloading";
      // Workers support manual/follow, but reject redirect: "error". A fresh
      // request has no browser cookie jar or inherited authorization headers.
      response = await fetch(target, { signal, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) throw new ClimateDownloadError("DOWNLOAD_REDIRECT", "The climate file moved to a different download address. Please try again.");
    }
    if (!response.ok) {
      const status = response.status;
      const error = status === 429 ? "NLR’s request limit has been reached. Please wait a minute before trying again." : status === 401 || status === 403 ? "NLR could not authorize the data request. The site owner may need to check the API key." : status === 400 || status === 404 || status === 422 ? "NLR could not provide data for this location and year. Try a nearby city or another year." : "NLR’s data service is temporarily unavailable. Please try again shortly.";
      return Response.json({ error }, { status: status === 429 ? 429 : 502 });
    }
    const csv = await response.text();
    if (csv.length > 5000000 || !/(?:^|\n)"?Year"?,"?Month"?,"?Day"?/i.test(csv)) return Response.json({ error: "NLR did not return an hourly CSV. Please wait a moment and try again." }, { status: 502 });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) {
    const timeout = signal.aborted || (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name));
    const code = cause instanceof ClimateDownloadError ? cause.code : timeout ? "NLR_TIMEOUT" : "NLR_CONNECTION_ERROR";
    console.error("Climate download failed", { code, phase, errorType: cause instanceof Error ? cause.name : "unknown", elapsedMs: Date.now() - started });
    const error = cause instanceof ClimateDownloadError ? cause.message : timeout ? "NLR is taking longer than 2½ minutes to prepare this dataset. Please try again in a moment." : "The climate data connection failed while retrieving the CSV. Please try again.";
    return Response.json({ error, code }, { status: cause instanceof ClimateDownloadError ? cause.status : timeout ? 504 : 502 });
  }
}
