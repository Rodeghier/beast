/**
 * LOCAL CITY SEARCH. Loads only the chosen state, decodes its compact records,
 * then tries exact names, aliases, prefixes and finally close spellings.
 * This runs in the locations API; it is not a weather download or geocoder call.
 */

import { STATES, normalizePlace, type Place } from "./climate";
import { PLACE_LOADERS } from "./place-loaders";

type RecordRow = [id: number, name: string, latitude: number, longitude: number, county: string, population: number, canonical: string, aliases: string];

// Only the selected state's records are decoded for a request.
export async function findPlaces(city: string, state: string): Promise<{ places: Place[]; exact: boolean }> {
  const loader = PLACE_LOADERS[state];
  const query = normalizePlace(city);
  if (!loader || !query) return { places: [], exact: false };
  const records = JSON.parse((await loader()).default) as RecordRow[];
  let matches = records.filter(row => row[6] === query);
  if (!matches.length) matches = records.filter(row => (`|${row[7]}|`).includes(`|${query}|`));
  const exact = matches.length > 0;
  if (!matches.length) matches = records.filter(row => row[6].startsWith(query) || row[7].split("|").some(alias => alias.startsWith(query)));
  if (!matches.length && query.length >= 4 && query.length <= 60) {
    const limit = query.length >= 8 ? 2 : 1;
    matches = records.filter(row => closeSpelling(query, row[6], limit));
  }
  const places = matches.slice(0, 50).map(row => ({ id: row[0], name: row[1], latitude: row[2], longitude: row[3], county: row[4], state: STATES[state], stateCode: state }));
  return { places, exact };
}

function closeSpelling(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...next) > limit) return false;
    previous = next;
  }
  return previous[b.length] <= limit;
}
