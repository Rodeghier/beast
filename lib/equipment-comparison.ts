import { heatingName, coolingName } from "./equipment-catalog";
import { RTU_VERSION, type RtuResult } from "./rtu";

export function comparisonCsv(results: RtuResult[], location: string, year: number): string {
  const line = (values: unknown[]) => values.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
  return [line(["Model", "Location", "Year", "Scenario", "Heating", "Cooling", "HP_lockout_F", "Units", "Nominal_tons_each", "Supply_CFM", "Primary_heat_bank_BTU_hr_each", "Electricity_kWh", "Gas_therms", "Site_energy_MMBtu", "Unmet_heating_MMBtu", "Unmet_heating_hours", "Peak_unmet_heating_BTU_hr", "Unmet_cooling_MMBtu", "Unmet_cooling_hours", "Map_boundary_hours", "Valid_hours", "Full_year", "Selection_status", "Operating_cooling_SHR_min", "Operating_cooling_SHR_max", "Subfreezing_coil_ADP_hours"]),
    ...results.map((r, i) => line([RTU_VERSION, location, year, String.fromCharCode(65 + i), heatingName(r.system.heating), coolingName(r.system.cooling), r.system.heating === "gas" || r.system.heating === "resistance" ? "" : r.system.lockoutF,
      r.equipment?.count, r.equipment?.tonsEach, r.equipment?.supplyCfm, r.equipment?.heatingBankBtuEach,
      r.equipment ? r.summary.electricity : null, r.equipment ? r.summary.gasTherms : null, r.equipment ? r.summary.siteMMBtu : null,
      r.equipment ? r.summary.unmetHeatingBtu / 1e6 : null, r.equipment ? r.summary.unmetHeatingHours : null, r.equipment ? r.summary.peakUnmetHeating : null,
      r.equipment ? r.summary.unmetCoolingBtu / 1e6 : null, r.equipment ? r.summary.unmetCoolingHours : null, r.equipment ? r.summary.boundedHours : null, r.summary.completeHours, r.summary.fullYear ? "Yes" : "No", r.error ?? "Selected", r.summary.coolingShrMin, r.summary.coolingShrMax, r.summary.subfreezingCoilHours])),
  ].join("\r\n");
}
