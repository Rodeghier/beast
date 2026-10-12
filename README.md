# Building Energy Analysis Selection Tool (BEAST) — HVAC energy comparison

Select a US city, state and climate year (2015–2059). Sup3rCC EC-Earth3-CC SSP2-4.5 supplies hourly temperature, relative humidity, DHI, DNI and GHI. The app estimates loads for a 150,000 ft² building, sizes generic CAV equipment, compares two heating/cooling combinations, and reports electricity, gas input, unmet loads and electricity-generation CO₂. The weather dataset covers the contiguous US and DC.

## Model and source code

- `app/api/climate/route.ts`: server-side NLR request, validated CSV redirects, credentials kept off the client.
- `lib/csv.ts`: hourly parsing, missing values and irradiance units.
- `lib/solar.ts`: solar position, irradiance transposition and solar gains.
- `lib/school.ts`: single-zone steady-state building heat and moisture balance; internal module name retained for compatibility.
- `lib/rtu-curves.ts`, `lib/rtu.ts`, `lib/equipment-catalog.ts`: variable SHR, operating maps, sizing and hourly equipment energy.
- `app/api/location-energy/route.ts`, `lib/location-energy.ts`: OpenEI electricity tariffs, EIA gas benchmarks and keyless EPA subregion lookup.
- `components/location-energy.tsx`, `lib/emissions.ts`: rate display, electricity CO₂ comparison and hourly CO₂ CSV.

The linked [engineering guide](public/engineering-guide.pdf) contains equations, assumptions, source links and the current worked example. Source synchronization and deployment are managed by Sites; project identity is in `.openai/hosting.json`.

## Hourly building loads and solar

The default building has 1,200 occupants, weekday occupancy 07:00–17:00, and 10% occupancy in June–August. Heating/cooling setpoints are 70/75°F occupied and 60/85°F unoccupied. RH limit is 50%. Defaults are editable assumptions, not a calibrated building. Lighting and equipment are 0.9/0.6 W/ft²; infiltration is 0.15 ACH; ventilation is 10 CFM/person + 0.12 CFM/ft² during occupied hours.

Solar replaces the previous assumed sine profile. Default geometry is two equal floor plates, plan aspect ratio 2, 0° rotation, 14 ft/story, 25% windows, SHGC 0.35 and no window shading. Roof area is total floor area / stories. For vertical walls:
`Iwall = DNI × max(0, sun·normal) + DHI/2 + reflectance×GHI/2`, with beam zero below the horizon. Roof irradiance is GHI. Position uses NOAA equations, dataset coordinates, fixed standard-time offset and hour midpoint. The isotropic sky model and uniform ground reflectance are approximations.

Window gains are irradiance × window area × SHGC × shading multiplier. Opaque gains are irradiance × opaque area × U × absorptance / exterior film coefficient. Convert W/m² to BTU/(hr ft²) with 0.316998331. Roof/wall U default to 0.04/0.06 BTU/(hr ft² °F), absorptance to 0.6 and film coefficient to 3 BTU/(hr ft² °F). These U-values apply only to the solar correction. Ordinary conduction still uses independently entered whole-building UA (default 15,000 BTU/hr °F). Geometry changes do not automatically recalibrate that UA.

Let H = UA + 1.08 × outdoor CFM. Heating is max(0, H × (heating setpoint − outdoor temperature) − sensible gains). Sensible cooling is −max(0, H × (outdoor temperature − cooling setpoint) + sensible gains). Latent removal uses the outdoor-air/occupant moisture balance at the indoor RH limit. Total cooling is sensible plus latent cooling; do not add sensible cooling to total again.

No thermal storage, delayed load response, detailed overhangs, angle-dependent SHGC, longwave sky exchange, zoning, economizers or heat recovery is simulated. Missing radiation/solar coordinates leaves dependent loads and equipment energy blank, never zero. Valid zero irradiance is zero gain. Missing RH preserves computable sensible building loads but prevents complete equipment calculations. Annual labels require 8,760 valid unique non-leap-day hourly records.

## Equipment comparison

Each of two cases independently selects heating and cooling. Heating choices: standard, laboratory-informed, highest-stage variable-speed-family under CAV operation, hypothetical 2027 cold-climate heat pump, 80%-efficient gas furnace, or resistance at COP 1. Cooling choices: standard, lab-data, or highest-stage variable-speed-family DX. These 18 combinations are generic coils, not manufacturer products.

Sizing minimizes identical unit count then size (5–25 nominal tons), checking every valid hour for sensible capacity, latent capacity and mechanical ventilation. No 10% sizing margin is applied. Operating SHR uses an EnergyPlus-style apparatus-dew-point/bypass-factor method calibrated from rated SHR 0.77; it responds to entering air, airflow and mapped capacity, reaching 1 for a dry coil. Required gross cooling is max(sensible need / SHR, latent need / (1−SHR)); excess sensible cooling is offset by ideal electric reheat.

Heat pumps are not sized to heating demand. Delivered heat is limited to mapped installed capacity and lockout (default 0°F). Gas/resistance banks are sized to peak coil heating demand and rounded to 10,000 BTU/hr output per unit, with no percentage margin. Supply fan heat is counted once. Electricity includes compressors/outdoor fans, CAV supply fans, electric reheat and primary resistance heat. Explicit crankcase, frost and defrost additions are excluded. No auxiliary space heat is silently added.

Source capacity/EIR grids, COP fits and part-load curves are pinned to ComStock commit `f25ac375311acb2448b4ee1665a8680e92abd24b`. See `docs/equipment-sources.json` and `lib/data/rtu/provenance.json`. Map inputs are clamped and flagged outside their domains. Cold-climate high/boost stage scaling is retained; variable-speed modulation savings are not modeled under CAV. Compare unmet loads before energy: different service levels are not an equal-service efficiency ranking.

The current Madison 2025 example selects 19 × 25 tons (475 tons), uses 1,455,082 kWh and has 70 unmet-heating hours. Gas + standard DX uses 1,306,660 kWh plus 11,219 therms with no unmet heating. These are modeled results with the stated solar/building assumptions, not field predictions. Current examples are in `docs/*example.json`.

## Utility rates and CO₂

Electricity: OpenEI URDB v8 returns approved commercial candidates effective at retrieval time near city coordinates. Users select an eligible tariff; the app displays tiers, TOU schedules, demand charges/measurement windows, fixed/minimum charges, eligibility, notes and sources. Supported terms are applied to HVAC hourly use as a separate-meter, calendar-month estimate; this is not an actual whole-building account bill. Ratchets, coincident peaks, missing prices/schedules, unsupported units, and delivery-only tariffs block a total rather than silently dropping charges. Demand charges use hourly-average peak kW, with the source demand interval disclosed. Rates may omit riders or be outdated. Results are capped at 100 records, with an explicit truncation notice.

Gas: EIA returns up to 60 monthly state commercial delivered-price records ($/Mcf); BEAST retains the newest valid price for each calendar month, so withheld values do not let repeated months crowd out seasonal coverage; this is a benchmark, not a local tariff breakdown. For each model calendar month, the newest API price for that month is applied using EPA’s default 10.26 therms/Mcf conversion. The exact source month is shown. Fixed charges are not added to this delivered-price benchmark. Missing required months block total cost for gas-consuming scenarios.

EPA: bundled Power Profiler/eGRID2023 revision 2 data (released June 12, 2025) supplies geometry, ZIP/utility mappings and annual total-output CO₂ rates. Data source URLs, pinned commit and source hashes are recorded in the two `lib/data/egrid*.json` provenance records. Coordinates identify approximate candidates; ZIP can refine them, and multiple subregions require user choice. `kg CO₂/kWh = lb CO₂/MWh × 0.45359237 / 1000`. That factor is multiplied by hourly HVAC electricity and summed. The factor is constant across hours and weather years, not an hourly/marginal/future-grid forecast.

Annual scorecard CO₂ includes electricity generation and direct natural gas combustion using EPA factors. It excludes upstream emissions, transmission losses and other greenhouse gases. The separate electricity-only detail and hourly CO₂ CSV retain their clearly labeled electricity-generation scope, including source, data year, subregion and factor. Missing energy remains blank; annual scorecards require a complete year.

## Configuration

Server-only runtime secrets (never NEXT_PUBLIC variables):

| Variable | Purpose |
| --- | --- |
| NLR_API_KEY | Sup3rCC download; existing connection |
| NLR_EMAIL / NLR_FULL_NAME / NLR_AFFILIATION | NLR request metadata |
| OPENEI_API_KEY | [OpenEI / api.data.gov key](https://apps.openei.org/services/api/signup/) for electricity tariffs |
| EIA_API_KEY | [Separate EIA key](https://www.eia.gov/opendata/register.php) for state gas benchmarks |

The app never reuses NLR_API_KEY for OpenEI. Missing keys produce independent provider messages while EPA data and solar remain usable. Configure secrets in Sites and redeploy to apply them. For local development, set the variables in an ignored `.env` file; never commit credentials.

## Validation

Node >=22.13; existing Vinext/Cloudflare configuration and lockfile are preserved.

- `node node_modules/typescript/bin/tsc --noEmit`
- `node scripts/check-school-model.mjs /absolute/path/to/2025-solar.csv`: analytical loads, radiation geometry, solar units, missing inputs, psychrometrics, schedules and full-year export.
- `node scripts/check-rtu-model.mjs /absolute/path/to/2025-solar.csv`: pinned maps, variable SHR, no margin/defrost additions, all equipment combinations, capacity/energy balances and minimum feasible selection.
- `node scripts/check-location-energy.mjs`: tariff structures, gas units, EPA geometry/ZIP ambiguity, CO₂ multiplication, parser failures, missing keys and independent provider errors.
- `python scripts/build-engineering-guide.py`: rebuild the PDF; render and visually inspect before publishing.
- Use the supported Sites source helper to build, commit/push, package and publish. Do not start a preview when browser QA is unavailable.

## BEAST analysis flow

The initial Analysis inputs page collects location/year, editable building and equipment assumptions, and one to three equipment scenarios. There are no manual utility rates or emissions factors. Continue to results validates inputs and opens an annual scorecard before detailed results.

One location-energy API response supplies the source choices for all scorecards and graphs. Users choose the applicable OpenEI tariff and EPA eGRID subregion; unique candidates are preselected. After choosing a tariff, users explicitly click **Load results** to calculate the scorecards and graphs. Changing the tariff or EPA subregion, refreshing providers, or applying a ZIP clears the loaded results and prompts users to load again. Missing or unsupported pricing produces a specific explanation after loading, rather than a silent missing total. Electricity pricing uses monthly TOU energy tiers, weekday/weekend schedules, price and fuel adjustments, monthly/TOU demand tiers, fixed charges, and minimum charges. Annual minimum top-ups occur in December; annual fixed charges are allocated evenly. The local standard-time calendar excludes daylight-saving shifts and holiday exceptions. Confirm full-meter tariff eligibility and billing terms with the utility.

CO₂ combines EPA eGRID2023 electricity factors with the EPA 2025 Emissions Factors Hub natural gas factor (53.06 kg/MMBtu = 5.306 kg/therm). The API returns factor provenance and EPA heat content (0.001026 MMBtu/scf = 10.26 therms/Mcf). These factors are not future-grid projections and exclude upstream emissions and non-CO₂ gases. Sources: [OpenEI URDB v8](https://apps.openei.org/services/doc/rest/util_rates/?version=8), [EPA 2025 Hub, Table 1](https://www.epa.gov/system/files/documents/2025-01/ghg-emission-factors-hub-2025.pdf).

Annual energy, utility cost, and CO₂ comparison bars plus an interactive monthly chart share exactly the same calculations as the scorecards. The monthly table provides accessible values and an electricity charge breakdown. Unavailable values remain blank in charts, never zero. Annual totals require 8,760 unique valid hours (February 29 excluded); unmet-load warnings remain visible. Lighting and plug loads are excluded from these HVAC totals. Latest API rates are applied to the chosen weather year, not reconstructed historical rates or projected future prices.

Run `node scripts/check-beast-scorecard.mjs` for tariff billing, EPA conversions, API failure/missing data, annual/monthly reconciliation, and scorecard/chart rendering checks.

Energy tier limits support `kWh`, `kWh daily`, `kWh/kW`, and `kWh/kW daily`; prices remain $/kWh. Daily limits scale by calendar days in the month, and demand-based limits scale by that month's peak hourly-average HVAC import kW, following the default current-month billing-demand approach in [SAM's billing documentation](https://samrepo.nlr.gov/help/electricity_purchases.html). These estimates do not model historical demand ratchets or subhourly peaks. Distributed-generation export terms do not block consumption-only results: export credits are not applied, and negative import values are rejected. Unknown tier units still block pricing and are identified in the error.
