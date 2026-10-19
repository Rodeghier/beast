# EnergyPlus 26.2.0 equipment in BEAST

Source release: https://github.com/NatLabRockies/EnergyPlus/releases/tag/v26.2.0

Pinned commit: `4bd7a1f26fb749a83257855aba6760e26c8a3c8f`. Retrieved October 18, 2026.

## What is integrated

The equipment selectors include 25 cooling profiles and 12 heating profiles from `DXCoolingCoil.idf` and `RooftopPackagedHeatPump.idf`. Only air-cooled, single-speed coils with numeric rated capacity, COP, airflow, cooling SHR where applicable, and a complete usable curve set are selected. Other definitions remain available in the CSVs with an explanation.

The Lennox KHA060S4 cooling object specifies rated COP **385 W/W**, whereas the source file's summary table specifies **3.85 W/W**. This conflicting record is excluded from simulation pending authoritative correction. The original 385, its curves and the explicit reason remain in the exports; no replacement is guessed. Its separately valid heating profile remains available.

The source names the KHA060S4 and THA060S2 heating objects with a "Cooling" suffix. Equipment type determines their mode. Matching the heating and cooling capacity basis ignores either trailing mode suffix; exports retain original names, and the selector displays the correct mode. Five other single-speed heating coils belong to units with two-stage cooling. Their nominal-ton basis comes from the source's full-output Stage 1+2 `CoilPerformance:DX:Cooling` capacity. This uses the documented capacity basis without claiming to implement those cooling stage controls. The runtime catalog identifies the exact basis object and rating.

These are **scaled CAV screening profiles**, not complete EnergyPlus object/system simulations or selections of currently available manufacturer products. BEAST still uses its existing single-zone building load model. The generic 5–25 ton sizing search determines installed nominal cooling tons; source equipment names identify the performance dataset, not a fixed purchasable unit.

For each cooling profile, reference tons = source cooling capacity W / 3516.852842. Reference airflow per ton = source m³/s / 0.00047194745 / reference tons. Installed capacity scales linearly with installed nominal tons. A heating profile uses its matched source cooling coil as its nominal capacity basis and retains source heating W / cooling W; its COP and airflow come from the heating coil. Heating and cooling profiles remain independently selectable. A combination is a screening assumption rather than proof that those coils form a real packaged system.

Cooling capacity = installed nominal tons × 12000 BTU/h × capacity-temperature modifier × capacity-airflow modifier. Heating also multiplies by the source heating/cooling capacity ratio. Full-load electric input kW = available thermal capacity BTU/h / 3412.141633 × EIR-temperature modifier × EIR-airflow modifier / source rated COP. Airflow modifier input is BEAST CFM/ton divided by the profile's rated CFM/ton. Cooling temperature inputs are entering wet bulb and outdoor dry bulb in °C; heating inputs are entering dry bulb and outdoor dry bulb in °C.

Heating univariate quadratic/cubic temperature curves use **outdoor dry bulb only**, as specified in the EnergyPlus object dictionary and dataset comments (the source tests hold entering dry bulb at 70°F). They do not invent an entering-air correction. Biquadratic heating curves use entering dry bulb as x and outdoor dry bulb as y.

The original source coefficients are evaluated without refitting or forcing unity at rating. Linear, quadratic, cubic and biquadratic forms follow EnergyPlus coefficient order. Independent variables are held at source min/max bounds and output limits are applied when supplied. Operating hours at temperature or airflow bounds are flagged. Cycling uses source PLF at the part-load ratio, with runtime = min(1, PLR / max(PLR, PLF)). Cooling SHR uses BEAST's existing steady-state apparatus-dew-point/bypass-factor calculation calibrated to the profile's rated SHR and rated airflow. Compressor heating lockout uses the chosen BEAST setpoint and any explicit source minimum, whichever is higher. Blank source minima do not supply a new compressor limit.

CAV supply fan electricity/heat, occupied/unoccupied behavior, ventilation, cooling/latent sizing, dehumidification priority and ideal electric reheat retain BEAST's existing calculation. Heat pumps are not sized to the heating load, and unmet heat is reported. Source fan-rating values are not added to BEAST supply-fan energy. Defrost, frost penalties, crankcase heaters, off-cycle moisture re-evaporation, stage modulation, economizers, heat recovery, auxiliary space heat and source availability/node controls are excluded. These limits appear in the UI and hourly CSV metadata. The existing engineering PDF describes the original ComStock models; this document supplements it for EnergyPlus.

## CSV contents

- `energyplus-curve-fits.csv`: every Curve:* and Table:* definition in the 17 bundled equipment/performance datasets, plus performance objects and equipment with embedded fit coefficients. One row per source object and equipment association; a shared curve may therefore have multiple rows. `source_object_index` identifies its 1-based occurrence within a dataset, preserving repeated names rather than dropping or conflating them. `coefficient_1` through `coefficient_27`, input bounds/units and output bounds/units provide convenient flat fields. `curve_fields_json` retains **all supplied fields** as their original strings, including other coefficients, lookup values, fit controls or equipment performance parameters. Source URLs, release, commit and SHA-256 identify each file. `export-only` means available as data, not executed by BEAST. Orphan library curves have no invented equipment/rating association.
- `energyplus-equipment.csv`: all physical equipment/performance definitions in those datasets, original field values, integration status, rating data where supported, profile ID and reason. Missing/incomplete single-speed profiles have an individual reason. Source examples can contain placeholder schedules, nodes and autosized values; they are not complete runnable buildings.
- `energyplus-coverage.csv`: all 878 EnergyPlus dictionary object types, including the 300 equipment types shown in the UI. `adapted` identifies the two single-speed coil types with supported dataset profiles. `existing-simplification` identifies BEAST's existing natural-gas furnace, resistance coil and CAV fan approximations; this does not mean arbitrary EnergyPlus definitions of those types have been imported. `not-integrated` gives the missing physics/inputs for other equipment. `not-equipment` identifies supporting objects so dictionary coverage is explicit.

The CSVs use UTF-8 with a BOM, quoted fields and CRLF records. Blank means the source did not supply the field, or it is not applicable; blank coefficients or ratings must not be interpreted as zero. `curve_fields_json` is authoritative for original numeric spelling and specialized forms. Units named Temperature in EnergyPlus curve definitions mean °C, unless a particular object's documented independent variable defines another quantity. For an unattached generic curve, units/axis meaning cannot be inferred from its name. Refer to the original file comments and pinned IDD for axes, omitted-field defaults and equation definitions. Curve-fit residuals, training observations and fit uncertainty are not invented when absent upstream.

The scope is the official equipment/performance datasets included in `docs/energyplus/manifest.json`. It includes air-cooled/chilled-water chillers, boilers, commercial/residential DX and heat-pump curves, water-to-air heat pumps, refrigeration, code-compliant curves, economizer curves, generators, PV and solar collector data. It excludes weather/schedules, materials/envelope and economic datasets. It does **not** claim to contain coefficients from every EnergyPlus example model, user-defined program, third-party equipment library or manufacturer. Generic curve libraries often omit the rated values needed to create another selectable profile.

## Why other equipment is not simulated

The full type-by-type reasons are in the coverage CSV and searchable UI table. In particular:

- Chillers, boilers, towers, pumps and water/steam coils require fluid-loop temperatures, flows, dispatch and heat balances.
- Water-source and ground-source heat pumps require source-water/ground-loop physics rather than outdoor dry bulb.
- VRF, multi-speed/stage coils, terminals and packaged system wrappers require coupled equipment and control/topology models.
- Refrigeration requires process/case loads, refrigerant saturation temperatures, circuits and defrost schedules.
- Evaporative, desiccant, humidification and recovery equipment require additional coupled air/moisture paths and controls.
- Storage, domestic hot water, PV/solar and generators require separate loads, state and dispatch models.
- Custom components require the user's physics/programs and do not have universal curves.

Providing coefficients does not resolve those missing models. These records remain explicitly unavailable instead of being silently substituted with DX behavior.

## Reproduce and validate

Unmodified upstream source files and the release license are retained in `docs/energyplus/upstream/`; SHA-256 hashes are listed in `docs/energyplus/manifest.json`. The generated runtime catalog is `lib/data/energyplus/catalog.json`. Run `scripts/import-energyplus.mjs` with `BEAST_ARTIFACT_NODE_MODULES` pointing to the bundled artifact runtime's node_modules directory. It recreates the catalog, manifest, coverage data and all three CSVs. It does not fetch new revisions.

Run `node scripts/check-energyplus.mjs`, `node scripts/check-rtu-model.mjs`, `node scripts/check-beast-scorecard.mjs` and `node node_modules/typescript/bin/tsc --noEmit`. The EnergyPlus checks compare pinned source hashes and independent reference coefficients, verify every source curve/table occurrence is exported, check the conflicting COP record stays excluded with its original rating preserved, check units and original COP/PLF/limits, size every selectable profile and reconcile hourly energy balances. They validate BEAST's adaptation; they do not establish parity with a native EnergyPlus simulation.

EnergyPlus data license: `/references/energyplus-license.txt`. Original source attribution and dataset-specific notices are retained in the unmodified files.
