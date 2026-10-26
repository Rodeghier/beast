# BEAST

Building Energy Analysis Selection Tool: hourly building loads, selected heating/cooling equipment, supply-fan energy and heat, and utility/emissions comparisons.

## Equipment and names

Heating choices are Rooftop Packaged Heat Pump, Natural Gas and Electric Resistance. Every combination includes cooling. A heat pump includes its cooling automatically; gas and resistance require the user to select cooling, currently Rooftop Packaged Heat Pump only. The interface and calculation validation reject a missing cooling selection. Gas/resistance no longer represent heating-only comparisons.

There is no editable scenario name or stored name field. `scenarioName()` derives labels such as **Heat Pump Cooling + Natural Gas Heating** for cards, tables, graphs and CSVs. Each combination can choose standard or high efficiency for its heat-pump equipment. Gas efficiency (AHUE / AFUE) is entered above 0% and at or below 100%, with no assumed value.

## Supplied equipment data

- `lib/data/precedent-cooling.json`: 24 heat-pump capacity/SHR fits from Precedent_Cooling.pdf, Trane PKGP-PRC023F-EN tables 10-33. Dual fuel is excluded. Capacity is gross, with unit-specific reference at 95°F outdoor / 67°F entering WB / 80°F entering DB, at the largest listed CFM (480 CFM per nominal ton).
- `lib/data/precedent-heating.json`: 16 heating-capacity/total-power fits from Heating_Cap.pdf, tables 58-73, 1,632 pairs. Fourth-degree capacity and second-degree power, anchored at 47°F outdoor / 70°F entering DB. Heating capacity is integrated net heat; total power and heat already include catalog fan/defrost effects at nominal airflow, listed ESP and 70% outdoor RH. Full-output COP = net BTU/hr / (3412.141633 × total kW).
- `lib/data/precedent-unit-ratings.json`: 24 standard/high ratings from **Unit_data_full.pdf**, tables 6-7, printed pages 24-29. Published nominal cooling system kW, gross/net rated capacity and nominal/AHRI airflow are preserved. Fan count and motor nameplate HP are reference data, not operating electrical input. Source hashes are retained in each JSON file.

Heating table mapping: standard 3/4/5 tons → tables 58-60; high 3/4/5 → 61-63; standard 10-ton WSK → 67; high 10-ton WHK → 68; size-only tables are shared at other sizes. The heating ratings in the new general-data file do not overwrite the detailed heating curves.

Coefficient, source, error and nominal-rating CSVs are served under `public/references/`. The complete source PDFs are not bundled.

## Cooling power, COP and supply fan

Nominal **total** cooling system power is held constant at full output because no off-rating power curve was provided. Fan heat per unit = rated gross cooling minus AHRI net cooling. Inferred fan kW = that heat / 3412.141633, assuming all electrical input becomes air heat. This is a rating-derived estimate, not a measured operating fan curve. Nameplate motor HP is not converted into operating fan watts.

Remove the inferred supply-fan input from total system power before scaling the remaining cooling input by coil duty. Add the operating supply fan once:

- Cooling input excluding supply fan = installed (nominal system kW − inferred fan kW) × cooling duty.
- Supply-fan kWh = installed inferred fan kW for every full hour with a heating, cooling or scheduled ventilation call; zero otherwise.
- Full-output net cooling COP = (installed gross curve capacity − installed fan heat) / (3412.141633 × installed nominal system kW).
- Operating net cooling COP = max(0, delivered gross cooling − hourly fan heat) / (3412.141633 × (cooling input excluding fan + fan kWh)). Both COP definitions are exported; the hourly table displays full-output net COP.

The fan runs through the full call hour, even when coil duty is below 1. This is an explicit screening control assumption. At full cooling duty, total input reconciles to nominal system kW. Nominal/AHRI ratings are not adjusted to the selected maximum airflow. No fan-law scaling, power-temperature correction, motor-efficiency assumption or extra outdoor-fan term is invented. All power/fan estimates are provisional.

Fan heat reduces heating demand and enters the **signed** sensible cooling balance: heater demand = max(0, building heating − fan heat); sensible cooling demand = max(0, signed cooling balance + fan heat). Latent demand is unchanged. This retains thermostat deadband and permits fan-only ventilation to create cooling demand.

Gas/resistance heater output is sized to peak heating demand after fan heat credit. Gas therms = delivered heater output / (100000 × efficiency fraction). Resistance element kWh = element output / 3412.141633. Fan electricity is separate and its heat also serves the building, preventing duplicate heating input. Gas annual efficiency used hourly and ideal modulation are screening assumptions.

For heat-pump heating, subtract inferred fan heat/input from integrated heating capacity/power before determining coil duty. Add actual fan heat to delivered building heat and fan electricity once to total input. No extra defrost term, auxiliary heat or reheat is supplied. Total kWh = heating coil input + cooling input excluding supply fan + supply-fan input.

## Mixed air and automatic unit selection

Entering wet bulb is calculated, not entered. Return dry bulb follows the baseline free-float temperature limited by active setpoints; return RH uses the indoor RH target. Mix scheduled ventilation and return air using humidity ratio and moist-air enthalpy. At 101325 Pa, standard-volume CFM fractions approximate dry-air mass fractions. Solve mixed dry bulb from enthalpy/humidity, then wet bulb by inversion of the ASHRAE water/ice relations (PsychroLib). Wet bulbs and RH are not averaged. Infiltration remains in building loads and is excluded from the mixer.

For each size, scan integer counts starting at the ventilation minimum. Recalculate mixed air and fan heat, and check sensible and latent cooling separately. Include heating-capacity checks when heat-pump heating is selected; gas/resistance heaters are sized separately. Retain the first passing count per size; prefer more covered load hours, fewer units, then less total nominal tonnage. No sizing margin is added. If no candidate is verified, show a provisional reference estimate without creating out-of-domain performance.

Cooling domain: entering WB 61–73°F, entering DB 75–90°F, outdoor generally 85–125°F (standard 10-ton ends at 120°F). Both 25-ton fits require outdoor DB + 2 × entering DB ≤ 295. Valid-point convex hulls prohibit extrapolation. Heating domain: outdoor −8–72°F and entering DB 40–80°F. Unsupported dependent results remain blank. The 17.5-ton cooling anomaly and four heating source reversals are retained and flagged. No reheat correction is applied to excess sensible cooling.

## Building, annual energy and interpretation

The editable building remains a 150,000 ft² hourly steady-state single zone with weekday occupancy, reduced summer use, setback temperatures, internal gains and Sup3rCC solar gains. Infiltration plus scheduled ventilation affect building loads. Roofs use GHI; walls use projected DNI plus sky/ground components at the dataset grid location and fixed local time. There is no thermal storage, detailed zoning, economizer or controls simulation. Sup3rCC is modeled climate, not observed weather. Lighting and plug electricity are excluded from these equipment totals.

Annual site energy = electricity kWh × 3412.141633 / 1e6 + gas therms × 0.1 MMBtu/therm. Electricity cost uses supported OpenEI tariff terms or an entered rate; gas cost uses an EIA monthly state commercial benchmark. EPA eGRID and gas-combustion factors give CO₂e. Fan electricity is part of equipment electricity, including for gas heating. Missing tariffs/prices/factors block only dependent metrics.

Annual totals require 8,760 unique, valid, complete hourly energy records. Missing equipment performance is not zero. Mild-weather cooling can fall outside the supplied source domains, preventing annual totals even with nominal input power available. Component subtotals may cover different available hours; do not add fan subtotal to total electricity again. Review coverage and unmet loads alongside energy/cost/emissions.

## Configuration and verification

Node >=22.13. Server secrets remain in ignored local environment/hosting configuration: NLR API key and metadata, optional OpenEI and EIA keys. This checkout has no linked Sites deployment.

- `node node_modules/typescript/bin/tsc --noEmit`
- `node scripts/check-equipment-model.mjs`
- `node scripts/check-school-model.mjs`
- `node scripts/check-beast-scorecard.mjs`
- `node scripts/check-location-energy.mjs`
- `node scripts/run-framework.mjs build`
- `python scripts/build-engineering-guide.py` (render and inspect the PDF)

Reproduce ratings: `python scripts/extract-unit-data.py --source PATH_TO_FULL_PDF`. Reproduce heating fits: `python scripts/fit-precedent-heating.py --source PATH`. Checks cover all 1,632 heating points, all 24 nominal power records, fan power reconciliation, part duty, fuel/element heat credit, ventilation, fan-induced cooling, required cooling, automatic names, domains, annual accounting, CSVs and rendered controls. The 55 independent wet-bulb reference states remain in `scripts/fixtures/mixed-air-reference.json`.

References: PsychroLib https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html; fan inference https://www.energycodes.gov/sites/default/files/2024-08/90.1_Secton_11_and%29_Appendix_G_Review_Manual_V04.pdf; AFUE https://www.energy.gov/cmei/femp/purchasing-energy-efficient-residential-furnaces. Source provenance and licenses are in `THIRD_PARTY_NOTICES.md`.

## ComStock county profiles

The results page can load a 2018 AMY ComStock county aggregate for the selected place. BEAST resolves the selected coordinates to a county with the Census Geocoder, lists the building-type CSV files actually present for that county under the public OEDI `timeseries_aggregates/by_county/upgrade=0` prefix, and downloads only the chosen profile. It summarizes monthly site energy and exposes the original 15-minute CSV for download. The profile is a weighted aggregate for the county's selected building type, not a single building; it is displayed as a reference and does not replace the editable building assumptions used by BEAST's analysis.

The NLR Building Energy Profiles Python toolkit currently supports metadata and individual-building time-series downloads; it does not load the pre-aggregated `timeseries_aggregates/by_county` files. BEAST therefore reads those published aggregate CSVs directly from OEDI. No county profile data are bundled in the repository.
