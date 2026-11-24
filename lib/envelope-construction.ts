export type ConstructionKind = "mass" | "steel-framed" | "wood-framed" | "metal-building" | "insulation-above-deck";
export type EnvelopeSurface = "wall" | "roof" | "window" | "slab";
type MaterialLayer = {
  material: string;
  thicknessM: number;
  areaFraction?: number;
  conductivityWmK: number;
  densityKgM3: number;
  specificHeatJKgK: number;
};
export type ConstructionProfile = {
  label: string;
  source: string;
  share?: number;
  layers: readonly MaterialLayer[];
  arealHeatCapacityKjM2K: number | null;
};
export type EnvelopeConstruction = {
  buildingType: string;
  county: string;
  state: string;
  wall: ConstructionProfile | null;
  roof: ConstructionProfile | null;
  window: ConstructionProfile | null;
  slab: ConstructionProfile;
  interiorMassAreaRatio?: number;
};

export const COMSTOCK_CONSTRUCTION_SOURCE = "https://natlabrockies.github.io/ComStock.github.io/assets/files/comstock_reference_documentation_2025_3.pdf";
export const MATERIAL_PROPERTY_SOURCE = "https://eta-publications.lbl.gov/sites/default/files/flexlab_doe_energyplus.pdf";
export const WOOD_FRAMING_SOURCE = "https://www.ashrae.org/File%20Library/Conferences/Specialty%20Conferences/Buildings%20XV%20-%20Papers/C057.pdf";
export const SUPERMARKET_ROOF_SOURCE = "https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-25985.pdf";
export const FLOAT_GLASS_SOURCE = "https://www.pilkington.com/-/media/pilkingtonredesign/downloads/usa/architectural/technical-bulletins/ats-129---properties-of-soda-lime-silica-float-glass.pdf";

// Representative mass layers using LBNL FLEXLAB EnergyPlus material data.
// These layers characterize heat storage. Assembly U-values come from the
// ComStock outputs and do not come from adding these partial layer resistances.
const gypsum = { material: "Gypsum board", thicknessM: 0.0127, conductivityWmK: 0.16, densityKgM3: 801, specificHeatJKgK: 837 };
const plywood = { material: "Plywood", thicknessM: 0.0127, conductivityWmK: 0.115, densityKgM3: 545, specificHeatJKgK: 1213 };
const concrete = { material: "Heavyweight concrete", thicknessM: 0.127, conductivityWmK: 1.311, densityKgM3: 2240, specificHeatJKgK: 836.8 };
const metalPanel = { material: "Steel panel", thicknessM: 0.0011, conductivityWmK: 62, densityKgM3: 7580, specificHeatJKgK: 485 };
const insulation = { material: "Rigid insulation board", thicknessM: 0.1016, conductivityWmK: 0.037, densityKgM3: 29, specificHeatJKgK: 1213 };
// ASHRAE conference paper C057, Table 2 and its 2×4 framing fraction.
const woodStuds = { material: "Wood framing", thicknessM: 0.089, areaFraction: 0.23, conductivityWmK: 0.100, densityKgM3: 539, specificHeatJKgK: 1630 };

const constructions = {
  mass: { label: "Mass", layers: [concrete] },
  "steel-framed": { label: "Steel framed", layers: [plywood, gypsum] },
  "wood-framed": { label: "Wood framed", layers: [plywood, woodStuds, gypsum] },
  "metal-building": { label: "Metal building", layers: [metalPanel] },
  "insulation-above-deck": { label: "Insulation entirely above deck", layers: [insulation, metalPanel] },
} satisfies Record<ConstructionKind, { label: string; layers: readonly MaterialLayer[] }>;

export function wallConstructionKind(label: string): ConstructionKind | null {
  switch (label.toLowerCase().replace(/[\s_-]/g, "")) {
    case "mass": return "mass";
    case "steelframed": return "steel-framed";
    case "woodframed": return "wood-framed";
    case "metalbuilding": return "metal-building";
    default: return null;
  }
}

export function constructionProfile(kind: ConstructionKind | null, source: string, share?: number): ConstructionProfile | null {
  if (!kind) return null;
  const { label, layers } = constructions[kind];
  return profileFromLayers(label, source, layers, share);
}

function profileFromLayers(label: string, source: string, layers: readonly MaterialLayer[], share?: number): ConstructionProfile {
  const arealHeatCapacityKjM2K = layers.reduce((total, layer) =>
    total + layer.densityKgM3 * layer.specificHeatJKgK * layer.thicknessM * (layer.areaFraction ?? 1) / 1000, 0);
  return { label, source, share, layers, arealHeatCapacityKjM2K: layers.length ? arealHeatCapacityKjM2K : null };
}

export const slabConstruction = profileFromLayers("Slab on grade", "ComStock ground-floor assumption", [concrete]);

function windowPaneCount(label: string) {
  return /\b(single|sgl)\b/i.test(label) ? 1 : /\b(double|dbl)\b/i.test(label) ? 2 : /\b(triple|tpl)\b/i.test(label) ? 3 : 0;
}

export function windowConstruction(label: string, share?: number): ConstructionProfile {
  const panes = windowPaneCount(label);
  // Combine the solid glass thickness for heat storage. The assumed 6 mm per
  // pane excludes frames, coatings and cavities from the mass estimate.
  const glass = { material: "Float glass (combined pane thickness)", thicknessM: panes * 0.006, conductivityWmK: 0.937, densityKgM3: 2500, specificHeatJKgK: 880 };
  return profileFromLayers(label, "ComStock county window metadata", panes ? [glass] : [], share);
}

// These screening defaults describe complete assemblies, including insulation and films.
const presetSource = "BEAST screening preset";
const opaquePreset = (kind: ConstructionKind, coefficient: number) => ({
  id: kind, profile: constructionProfile(kind, presetSource)!, coefficient,
});
const windowPreset = (id: string, label: string, coefficient: number) => ({
  id, profile: { ...windowConstruction(label), source: presetSource }, coefficient,
});

export const ENVELOPE_PRESETS = {
  wall: [opaquePreset("steel-framed", 0.06), opaquePreset("wood-framed", 0.055), opaquePreset("mass", 0.08), opaquePreset("metal-building", 0.09)],
  roof: [opaquePreset("insulation-above-deck", 0.04), opaquePreset("mass", 0.045), opaquePreset("wood-framed", 0.035), opaquePreset("metal-building", 0.065)],
  window: [windowPreset("double", "Double pane", 0.50), windowPreset("single", "Single pane", 1.02), windowPreset("triple", "Triple pane", 0.30)],
  slab: [
    { id: "concrete", profile: { ...slabConstruction, label: "Heavyweight concrete", source: presetSource }, coefficient: 0.73 },
    { id: "lightweight", profile: profileFromLayers("Lightweight concrete", presetSource, [{ ...concrete, material: "Lightweight concrete", conductivityWmK: 0.5, densityKgM3: 1600, specificHeatJKgK: 1000 }]), coefficient: 0.73 },
  ],
};

export function envelopePreset(surface: EnvelopeSurface, id?: string) {
  return ENVELOPE_PRESETS[surface].find(preset => preset.id === id) ?? ENVELOPE_PRESETS[surface][0];
}

export function envelopePresetForProfile(surface: EnvelopeSurface, profile?: ConstructionProfile | null) {
  if (!profile) return envelopePreset(surface);
  if (surface === "window") {
    const panes = windowPaneCount(profile.label);
    return ENVELOPE_PRESETS.window.find(preset => windowPaneCount(preset.profile.label) === panes) ?? envelopePreset(surface);
  }
  return ENVELOPE_PRESETS[surface].find(preset => preset.profile.label === profile.label) ?? envelopePreset(surface);
}

// ComStock 2025 R3, Table 57. Grocery uses the PNNL supermarket prototype.
export function roofTemplateKind(buildingType: string, state: string, yearBuilt: number, roofCode: string): ConstructionKind | null {
  if (buildingType === "Grocery") return "insulation-above-deck";
  if (state === "CA") {
    if (["Hospital", "LargeOffice", "MediumOffice", "Outpatient"].includes(buildingType)) return "mass";
    if (!["LargeHotel", "RetailStandalone"].includes(buildingType)) return "wood-framed";
  }
  if (buildingType === "Warehouse") {
    if (yearBuilt >= 1800 && yearBuilt <= 2100) return yearBuilt < 1980 ? "insulation-above-deck" : "metal-building";
    if (!roofCode || /^(999|unknown|n\/?a)$/i.test(roofCode)) return null;
    return /pre[\s_-]*1980/i.test(roofCode) ? "insulation-above-deck" : "metal-building";
  }
  return "insulation-above-deck";
}
