/**
 * LOCATION INPUT CONTRACT. Stores allowed years, state names, place fields,
 * name normalization and weather-coverage rules. Locating a place and having
 * weather data available there are separate checks.
 */

export const MIN_YEAR = 2015;
export const MAX_YEAR = 2059;
export const STATES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
export type Place = { id: number; name: string; state: string; stateCode: string; county?: string; latitude: number; longitude: number };
export const normalizePlace = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^(city|town|village|borough|township) of\s+/, "").replace(/\bst[.]?\s+/g, "saint ").replace(/\bft[.]?\s+/g, "fort ").replace(/\bmt[.]?\s+/g, "mount ").replace(/[^a-z0-9]/g, "");

export const supportsClimate = (state: string) => Object.hasOwn(STATES, state) && state !== "AK" && state !== "HI";
