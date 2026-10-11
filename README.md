# Climate Table — K–12 school loads and CAV heat pumps

Choose a U.S. city, state, and year (2015–2059). The site resolves coordinates locally, retrieves the NLR Sup3rCC EC-Earth3-CC SSP2-4.5 hourly CSV, converts dry-bulb temperature to Fahrenheit, derives dew/frost point from temperature and RH, simulates thermal loads for a 150,000 ft² school, automatically selects generic CAV heat-pump rooftop units, and estimates hourly electricity and unmet heating. The source dataset covers the contiguous 48 states and DC; Alaska/Hawaii locations resolve but have no climate data in this dataset.

## Hourly results

- Air temperature and dew point in °F.
- Sensible cooling and total cooling in BTU/hr, both negative (zero when absent).
- Heating in BTU/hr, positive (zero when absent).
- RTU electricity in kWh per one-hour record, with positive unmet heating in BTU/hr.
- Total cooling includes sensible + latent cooling; never add sensible to total again.
- Peak cards and a daily peak-of-hourly-loads chart use the full dataset.
- Results CSV contains two metadata rows, a blank line, a data header, and every hourly record. Metadata captures all applied assumptions, location, time basis, and model version. Hourly data also includes latent cooling, occupancy, outdoor air, energy components, coil conditions, runtime, and map-boundary flags. School values are exported to four decimals and RTU values to six.
- Original weather CSV remains available with original Celsius/RH and source precision.

## Engineering documentation

The twelve-page [engineering guide](public/engineering-guide.pdf) explains assumptions, equations, curve limits, controls, electricity, CSV fields, and a worked Madison example. It is linked from the website and is written for engineers without a development background.

## School load model

`lib/school.ts` implements an illustrative one-zone steady-state hourly heat balance, not EnergyPlus or a calibrated DOE prototype. All building-specific defaults are assumptions. Weather data does not describe the building.

Default school: 1,200 students/staff; weekdays 07:00–17:00 local standard time; full occupancy September–May and 10% June–August; no holidays. Occupied setpoints 70°F heat / 75°F cool, unoccupied 60°F / 85°F, maximum indoor RH 50%. Lighting 0.9 W/ft², equipment 0.6 W/ft², envelope UA divided by floor area 0.10 BTU/(hr·ft²·°F), conditioned height 14 ft, infiltration 0.15 ACH, outdoor ventilation 10 CFM/person + 0.12 CFM/ft² while occupied. People produce 245 BTU/hr sensible and 155 BTU/hr latent each. Defaults are editable and validated before applying.

At each hour:

1. Compute occupancy, internal gains, infiltration, and ventilation. Unoccupied lighting/equipment remain at 10%/25% of full power, ramping with occupancy. The area ventilation component covers the whole building during occupied hours.
2. Add an explicitly assumed solar gain: peak 4 BTU/(hr·ft²) multiplied by an hourly-averaged sine curve from 06:00 to 18:00 local standard time. This is not measured or retrieved irradiance. Set to zero to exclude solar.
3. Let `H = UA + 1.08 × outdoor CFM`, in BTU/(hr·°F). Heating is `max(0, H × (heating setpoint − outdoor temperature) − gains)`. Sensible cooling is `−max(0, H × (outdoor temperature − cooling setpoint) + gains)`.
4. Clamp the no-HVAC equilibrium zone temperature to the heating/cooling deadband. Derive the indoor humidity-ratio limit at that temperature and the RH limit. Latent removal magnitude is `max(0, 0.68 × outdoor CFM × 7000 × (Wout − Win) + occupant latent gain)`. Total cooling is negative sensible-plus-latent removal. Dry outdoor air offsets occupant moisture. Independent dehumidification may coexist with heating. Equipment reheat is evaluated separately in the RTU calculation below.

ASHRAE saturation-pressure relations and humidity ratio use standard sea-level pressure. Dew-point inversion uses the ice/frost-point convention below freezing, matching PsychroLib. Zero RH has no finite dew point. Missing temperature leaves all dependent loads blank; missing RH leaves total/latent cooling blank but preserves computable sensible/heating loads. Missing hours/values are never invented.

The school load module has no thermal mass, warm-up recovery, separate zones, actual solar radiation, orientation, detailed envelope construction, economizer, heat recovery, humidification, or equipment effects. Its columns describe thermal demand. The RTU module below adds fan heat, capacity, efficiencies, and dehumidification reheat to estimate equipment operation. At high elevations, standard-air factors are an approximation.

References:
- https://psychrometrics.github.io/psychrolib/api_docs.html (psychrometric equations; license in `THIRD_PARTY_NOTICES.md`)
- https://www.energy.gov/cmei/buildings/commercial-reference-buildings (detailed alternative models, not run here)
- https://developer.nlr.gov/docs/climate/sup3rcc/sup3rcc-conus-ecearth3cc-ssp245-r1i1p1f1-v0-2-2-download/

## Automatic CAV rooftop selection

`lib/rtu.ts` searches generic identical arrangements of 5, 7.5, 10, 12.5, 15, 17.5, 20, and 25 nominal tons. It minimizes count first, then unit size; it is not a manufacturer SKU, cost optimum, or full EnergyPlus simulation. Every feasible candidate is checked against all valid hours, including separate sensible and latent requirements and a default 10% cooling margin. Selection is capped at 200 units and reports failure explicitly. Missing weather produces provisional results.

Mechanical ventilation must fit within the selected supply airflow times the allowable OA fraction (default 25%). Infiltration never counts as useful ventilation. Nominal airflow is 404 CFM/ton and fan input is 0.5 W/CFM, both editable. Fans run continuously while occupied and for a full hour on unoccupied load calls. All units are one airflow pool with no diversity or fan-speed reduction. Supply fan heat is included once in equipment demand; school-load columns remain unchanged.

For the default standard heat-pump case, the unmodified NLR ComStock standard-performance maps are pinned in `lib/data/rtu/comstock-standard.json`; provenance, commit, and SHA-256 are adjacent. `lib/rtu-curves.ts` interpolates heating capacity/EIR against coil-entering dry bulb and ambient dry bulb; cooling high-stage maps use entering wet bulb and ambient dry bulb. Return air follows the school deadband and moisture balance; scheduled ventilation is mixed by enthalpy/humidity ratio to obtain entering conditions. Flow factors, current pinned measure COP fits, part-load behavior, defrost and crankcase references are retained. Heating reference airflow is the JSON's 420 CFM/ton. The source's lower cooling stage is not used, because its reduced fan flow does not match this CAV control assumption.

Inputs outside the tabulated map grid are clamped to the nearest boundary and flagged; the app displays the affected operating-hour count. The narrow cooling ambient ranges mean boundary estimates are common. Heating compressor lockout is 0°F, with on-demand reverse-cycle defrost at or below approximately 40°F. No supplemental space heater is assumed. Heating is not an equipment sizing criterion.

Fixed SHR defaults to 0.77. Required gross coil cooling is the greater of sensible demand/SHR and latent demand/(1-SHR). Any surplus sensible cooling is canceled by ideal electric reheat at COP 1. The required reheat bank is rounded up to whole kW per unit, but actual manufacturer availability is not established. Dehumidification takes priority over simultaneous heating; reheat does not fill the space-heating deficit. Off-cycle condensate re-evaporation is excluded. These assumptions can drive a large count and significant reheat energy; the guide explains the resulting limitations.

Hourly energy includes compressor/outdoor fan, CAV supply fan, reverse-cycle defrost, crankcase heaters once per physical unit, and electric dehumidification reheat. Lighting/plug electricity and any external backup heating are excluded. Unmet heating is HP heat need minus usable operating-point heating capacity, clipped at zero. HP heat need is building heat need after the useful fan-heat credit. Delivered heat is capped at usable capacity; unmet demand never increases compressor power above the mapped full-load input. A full-year label requires 8,760 complete, unique, non-February-29 hourly records.

The default Madison 2025 example selects 24 × 25 tons, 242,400 CFM supply, 60,600 CFM maximum OA capability vs 30,000 CFM required, and a 36 kW/unit reheat option. It estimates 1,712,594 kWh and 70 unmet-heating hours. Latent capacity drives this conservative fixed-SHR selection. 4,098 operating hours use a map boundary, so this is a preliminary result, not a validated final design. See `docs/rtu-madison-example.json` and the engineering guide for the governing hour and energy breakdown.

### Heating capacity and efficiency audit (v1.1)

The existing v1.0 dispatch already limited heat-pump output and used NLR temperature-dependent capacity and EIR maps; this revision makes that physics explicit and auditable. `heatingOperatingPoint()` returns installed net heating capacity, full-load compressor/outdoor-fan and defrost input, and full-load COP independently of demand, for the unit count/size, ambient dry bulb, mixed entering dry/wet bulb, humidity, and airflow.

For every valid hour, potential heating capacity is evaluated. Usable heating capacity is zero during heating lockout or cooling/dehumidification priority, and otherwise equals potential capacity. `HP need = max(0, building heating need - useful fan heat)`, `delivered HP heat = min(HP need, usable capacity)`, and `unmet heating = max(0, HP need - usable capacity)`. Once capacity is exhausted the compressor is at full runtime; added building demand adds shortfall without increasing its output or electricity. Full-load mapped power depends on capacity factors, EIR factors, rated COP for the unit size, and defrost. Actual electricity additionally uses NLR part-load runtime and separately adds fans, crankcase and reheat.

The table now exposes building heating need, HP heating need after fan heat, mixed entering dry bulb, usable heating capacity, and operating HP COP. Operating COP is delivered heating (or gross cooling in cooling mode) divided by actual compressor/outdoor-fan-plus-defrost electricity in consistent units; it includes cycling losses but excludes supply-fan, crankcase and reheat electricity. Full-load heating input/COP and potential capacity are exported separately, and are not annual energy consumption. Heating-curve boundary flags apply to the potential heating evaluation; the summary's boundary count remains for the actual operating mode.

`docs/rtu-heating-cases.json` contains independently varied ambient temperature, entering temperature and unit size examples. A deliberately undersized 25-ton test at 17°F outdoors and 70°F entering dry bulb has 153,286 BTU/hr available against 777,769 BTU/hr HP need, leaving 624,482 BTU/hr unmet above lockout. Full-load HP input is 23.61 kW. Raising the demand further leaves capacity and full-load power unchanged. The default Madison selection and 1,712,594 kWh total remain unchanged because v1.0 already used the maps correctly; v1.1 exposes the calculation and expands these regression checks.

## Equipment comparison (v2.0)

Two independently configurable cases use one loaded weather year and the same school/CAV assumptions. The user selects heating and cooling separately and chooses which case appears in the hourly table and results CSV. A summary CSV exports both cases. No additional NLR request is needed for recalculation.

Heating choices: standard heat pump, laboratory-informed heat pump, highest-stage variable-speed-family HP under CAV operation, hypothetical 2027 cold-climate HP, baseline gas furnace at 80% thermal efficiency, and electric resistance at COP 1. Cooling choices: standard, lab-data, and highest-stage variable-speed-family DX coils. Cold-climate source cooling uses the same high-performance curves. All 18 combinations are generic coil combinations, not manufacturer SKUs.

Raw JSON files are pinned to the existing ComStock commit `f25ac375311acb2448b4ee1665a8680e92abd24b`. See `docs/equipment-sources.json` for source paths/checksums, `lib/equipment-catalog.ts` for labels/links/reference airflows, and the website's catalog notes. Source map bytes are unchanged. `public/references/upgrade_hvac_add_heat_pump_rtu-measure.rb` and `tables-furnace_eff_table.tex` preserve the relevant supporting inputs under the existing ComStock license.

The active pinned measure calls the common size-based rated COP regressions for all four HP families. The defined advanced-COP helper functions are not called by its assignment and are not substituted. Source capacity/EIR curves and stage scaling differentiate the models. Highest-stage cycling with constant fans intentionally excludes variable-speed modulation and reduced-flow savings. The variable-speed heating polynomial inputs follow EnergyPlus entering-DB/outdoor-DB order; descriptive source axis names are swapped, but limits and coefficients follow this order.

The cold-climate **hypothetical** specification uses high stage above 17°F and boost at/below 17°F. Relative to its rated heating stage 2, high/boost capacity multipliers are 1.350190651/1.388985813 and rated COP multipliers are 1.097922025/0.722198906. Stage capacity scales defrost penalties and input. All HP choices start at the source measure's 0°F lockout; the UI offers explicit alternative design assumptions. Conditions beyond each map's domain are clamped and flagged. These assumptions do not establish a real product's low-temperature capability.

Gas/resistance primary heating banks are separately sized to peak net coil heat plus 10%, rounded up in 10,000 BTU/hr **output** per-unit increments. Installed output is finite. Gas input is delivered heat divided by 0.80 and 100,000 BTU/therm; resistance input is delivered heat divided by 3,412.141633 BTU/kWh. Furnace pilot/inducer/ignition and cycling losses are excluded; shared CAV fan electricity is included. DX crankcase power remains on while the compressor is off during direct heating. No HP auxiliary heating is silently added. Shared cooling/dehumidification priority is retained.

Annual site energy is electricity × 3,412.141633 / 1,000,000 + gas therms × 0.1, in MMBtu. It is not cost, emissions, or source energy. Comparison metrics include unmet thermal energy, unmet hours, peak shortfall, boundary hours, and valid-hour coverage so different service levels are visible. Missing/failed selection results are not presented as zero-use winners. Generic CSV heating column names replace prior HP-specific labels; full-load electric input and electric COP are blank in gas heating.

`docs/equipment-comparison-example.json` records six representative Madison 2025 cases. The standard reference remains 1,712,594 kWh/70 unmet heating hours. Gas + standard DX uses 1,603,327 kWh plus 7,119.7 therms with zero unmet heating hours; resistance + standard DX uses 1,770,255 kWh with zero unmet heating hours. The cold-climate example explicitly uses a −10°F lockout and has 19 unmet heating hours. These are not equal-service efficiency rankings.

The repository inventory also identified chillers, condensing/electric boilers, ground-/water-source HPs, and VRF/DOAS measures. They are documented but not selectable: a defensible implementation requires water/ground-loop states, pumps/towers, or zonal controls absent from this CAV model. No placeholder efficiency or air-source curve is used for those systems.

## Development and verification

Node >=22.13. The existing Vinext/Cloudflare Sites configuration and lockfile are preserved.

- `node node_modules/typescript/bin/tsc --noEmit`
- `node scripts/check-school-model.mjs` checks conversion, a published PsychroLib example, analytical load cases, moisture, signs, schedules, missing data, validation, and timezone independence.
- `node scripts/check-school-model.mjs /absolute/path/to/2025-source.csv` additionally checks 8,760 source rows, annual peaks, export structure, and recalculation.
- `node scripts/check-rtu-model.mjs /absolute/path/to/2025-source.csv` checks all pinned map hashes, lookup nodes and polynomial axis order, all 18 heating/cooling pairings, electricity/gas/thermal balances, map interpolation/bounds, psychrometrics, lockout, fan heat, reheat balance, full-year energy, minimum feasible selection, missing data, and export.
- `python scripts/build-engineering-guide.py` rebuilds the PDF with ReportLab/Matplotlib and embedded DejaVu fonts. The guide is rendered and visually checked before publishing.
- Use the Sites workflow for source synchronization, build, and publishing. The site ID is in `.openai/hosting.json`.

NLR credentials remain server-side in runtime environment variables. No browser/API change is needed to recalculate the school: applying assumptions updates the cached year's results locally. The API's validated manual CSV redirect handling is retained.
