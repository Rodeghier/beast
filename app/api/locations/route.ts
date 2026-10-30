/**
 * SERVER PLACE SEARCH. Converts a city/state query into candidate coordinates
 * using lib/places.ts. Multiple matches are returned for the user to choose.
 */

import { STATES, normalizePlace } from "@/lib/climate";
import { findPlaces } from "@/lib/places";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const city = query.get("city")?.trim() || "";
  const state = (query.get("state") || "").toUpperCase();
  if (!normalizePlace(city) || city.length > 100 || !Object.hasOwn(STATES, state)) return Response.json({ error: "Enter a US city or town and select its state." }, { status: 400 });
  try {
    const result = await findPlaces(city, state);
    if (!result.places.length) return Response.json({ error: `No place matching “${city}” was found in ${STATES[state]}. Check the state and spelling, or use the full city or town name.` }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch { return Response.json({ error: "The city index could not be loaded. Please try again." }, { status: 503 }); }
}
