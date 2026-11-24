export const INTERNAL_MASS_SOURCE = "https://github.com/NatLabRockies/openstudio-standards/blob/6417dffaa04dd6f60ab2bcae9343569e1194a70b/lib/openstudio-standards/prototypes/common/objects/Prototype.Model.rb";
export const THERMAL_MASS_BASIS = "Hourly implicit heat balance with ideal thermostat control, interior and envelope mass temperatures carried between hours, and reset after missing weather. Hourly loads feed the equipment model without feedback from equipment capacity or runtime.";

// The structure allowance covers interior partitions and elevated decks.
// Ground slab heat storage is represented separately.
export function interiorMassDefaults(buildingType: string, reportedAreaRatio?: number) {
  let structure = 30, furnishings = 35;
  if (["PrimarySchool", "SecondarySchool", "MediumOffice", "SmallOffice"].includes(buildingType)) {
    structure = 55; furnishings = 55;
  } else if (["LargeOffice", "LargeHotel", "SmallHotel", "Hospital", "Outpatient"].includes(buildingType)) {
    structure = 100; furnishings = 65;
  } else if (buildingType === "Warehouse") {
    structure = 10; furnishings = 10;
  }
  const reported = reportedAreaRatio !== undefined;
  // OpenStudio prototypes represent internal-mass objects with 0.15 m
  // wood at 540 kg/m³ and 1210 J/(kg·K), per reported exchange area.
  const capacity = reported ? structure + reportedAreaRatio * (0.15 * 540 * 1210 / 1000) : structure + furnishings;
  return {
    interiorMassKjM2K: Number(capacity.toPrecision(2)),
    interiorMassCouplingWm2K: Number((reported ? 3 + 3 * reportedAreaRatio : 6).toPrecision(2)),
    interiorMassSource: reported ? "ComStock internal mass area ratio with prototype wood properties and BEAST interior structure allowance" : "BEAST building-type estimate for partitions, elevated floors and furnishings",
  };
}

// The solver uses °F, BTU, and hours. All capacities are for an entire node.
export const AREAL_CAPACITY_TO_BTU_F_FT2 = 1000 * 0.09290304 / (1055.05585262 * 1.8);
export const AREAL_CONDUCTANCE_TO_BTU_HR_F_FT2 = 3.412141633 * 0.09290304 / 1.8;

export type MassNode = { capacity: number; toZone: number; toOutdoor: number };
export type MassForcing = { outdoorF: number; heat: number };

/** Eliminate the mass nodes to obtain the signed load as a function of zone temperature. */
export function thermalMassHour(
  nodes: readonly MassNode[], temperatures: readonly number[], forcing: readonly MassForcing[],
  directUa: number, outdoorF: number, directGains: number, heatSetpoint: number, coolSetpoint: number,
) {
  const eliminated = nodes.map(({capacity, toZone, toOutdoor}, i) => {
    const denominator = capacity + toZone + toOutdoor;
    return {
      intercept: (capacity * temperatures[i] + toOutdoor * forcing[i].outdoorF + forcing[i].heat) / denominator,
      zoneFraction: toZone / denominator,
    };
  });
  let heatTransfer = directUa;
  let forcingToZone = directUa * outdoorF + directGains;
  nodes.forEach(({toZone}, i) => {
    heatTransfer += toZone * (1 - eliminated[i].zoneFraction);
    forcingToZone += toZone * eliminated[i].intercept;
  });
  const freeFloatF = heatTransfer > 0 ? forcingToZone / heatTransfer : (heatSetpoint + coolSetpoint) / 2;
  const zoneF = Math.min(coolSetpoint, Math.max(heatSetpoint, freeFloatF));
  const next = eliminated.map(({intercept, zoneFraction}) => intercept + zoneFraction * zoneF);
  return { heatTransfer, freeFloatF, temperatures: next, heatBalance: heatTransfer * heatSetpoint - forcingToZone,
    coolBalance: forcingToZone - heatTransfer * coolSetpoint };
}
