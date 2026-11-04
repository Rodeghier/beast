# BEAST

For an engineering-oriented introduction to the code, start with [Repository Reading Guide](docs/REPOSITORY_GUIDE.md) or its [Word handbook](docs/BEAST_Repository_Guide.docx). Source comments explain calculation stages, units and data flow.

Building Energy Analysis Selection Tool: hourly building loads, selected heating/cooling equipment, supply-fan energy and heat, and utility/emissions comparisons.

## Equipment and names

Heating choices are Rooftop Packaged Heat Pump, Natural Gas and Electric Resistance. Every combination includes cooling. A heat pump includes its cooling automatically; gas and resistance require the user to select cooling, either Rooftop Packaged Heat Pump or the provisional air-cooled chiller. The chiller uses flat 0.6 kW/ton and autosizes to ASHRAE design-day cooling load; separate air-handler fan and pump power are excluded. The interface and calculation validation reject a missing cooling selection. Gas/resistance no longer represent heating-only comparisons.

There is no editable scenario name or stored name field. `scenarioName()` derives labels such as **Heat Pump Cooling + Natural Gas Heating** for cards, tables, graphs and CSVs. Each combination can choose standard or high efficiency for its heat-pump equipment. Natural-gas heating offers a small-boiler path that retains user-entered AFUE and a large commercial path using Cleaver-Brooks CBLE-4D hot-water ratings. The large path selects the smallest listed rated output that meets ASHRAE design heating demand after fan-heat credit, then uses the selected fuel's table consumption/hour multiplied by hourly runtime. Natural gas, propane, and No. 2 light oil are selectable for the large boiler. On/off firing is modeled; modulating is shown as unavailable pending manufacturer data. Small-boiler AFUE is applied as effective hourly efficiency with no additional cycling penalty. Propane/oil fuel quantities and site energy are reported, while fuel cost and combustion emissions remain unavailable until data sources are added. Boiler ratings are in `lib/data/cleaver-brooks-cble-4d-hot-water-ratings.json` and the source-table CSV is under `public/references/`.

The equipment form's **Stage** choice filters the automatically sized heat-pump models to automatic, single-stage or multi-stage operation. Variable-speed is shown as unavailable until stage-specific modulation data is supplied. Equipment sizes remain automatically selected from the loads.

Annual results report the percentage of evaluated heat-pump heating/cooling call hours below the selected unit's minimum stage. For the on/off boiler they report heating-call hours with less-than-full-hour firing. This is an expected cycling share, not a count of starts. Hours without a load call or without an evaluable performance point are excluded.

## Supplied equipment data

- `lib/data/precedent-cooling.json`: 24 heat-pump capacity/SHR fits from Precedent_Cooling.pdf, Trane PKGP-PRC023F-EN tables 10-33. Dual fuel is excluded. Capacity is gross, with unit-specific reference at 95°F outdoor / 67°F entering WB / 80°F entering DB, at the largest listed CFM (480 CFM per nominal ton).
- `lib/data/precedent-heating.json`: 16 heating-capacity/total-power fits from Heating_Cap.pdf, tables 58-73, 1,628 pairs. Fourth-degree capacity and second-degree power, anchored at 47°F outdoor / 70°F entering DB. Heating capacity is integrated net heat; total power and heat already include catalog fan/defrost effects at nominal airflow, listed ESP and 70% outdoor RH. Full-output COP = net BTU/hr / (3412.141633 × total kW).
- `lib/data/precedent-unit-ratings.json`: 24 standard/high ratings from **Unit_data_full.pdf**, tables 6-7, printed pages 24-29. Published nominal cooling system kW, gross/net rated capacity and nominal/AHRI airflow are preserved. Fan count and motor nameplate HP are reference data, not operating electrical input. Source hashes are retained in each JSON file.

Heating table mapping: standard 3/4/5 tons → tables 58-60; high 3/4/5 → 61-63; standard 10-ton WSK → 67; high 10-ton WHK → 68; size-only tables are shared at other sizes. The heating ratings in the new general-data file do not overwrite the detailed heating curves.

Coefficient, source, error and nominal-rating CSVs are served under `public/references/`. The complete source PDFs are not bundled.

## Shared capacity and extended unit sizes

`lib/data/shared-cooling-capacity.json` supplies one anchored normalized capacity polynomial across both efficiency families and all sizes. `scripts/fit-shared-cooling-capacity.py` fits the 1,432 accepted source points with equal total weight per source model: relative RMS error 1.75%, leave-one-size-out RMS error 1.87%. Gross capacity = shared normalized value times the unit's source reference capacity. Original SHR fits retain their original denominator and remain unchanged.

The runtime adds 30, 40, 55, 60, 70, 75, 90, 105, 120, 130 and 150 tons. For each added size, reference capacity, heating capacity/power, cooling kW, fan heat/kW and airflow scale from the selected family's 25-ton data by nominal tonnage. SHR, temperature domain and fractional stage levels reuse the 25-ton patterns. These are authorized modeling assumptions, not independent large-unit manufacturer data. Source-only downloads retain the original supplied tables. CSV metadata identify the shared fit, scaling assumptions and assigned-zone control policy.

## Cooling power, COP and supply fan

Nominal **total** cooling system power is held constant at full output because no off-rating power curve was provided. Fan heat per unit = rated gross cooling minus AHRI net cooling. Inferred fan kW = that heat / 3412.141633, assuming all electrical input becomes air heat. This is a rating-derived estimate, not a measured operating fan curve. Nameplate motor HP is not converted into operating fan watts.

Remove the inferred supply-fan input from total system power before scaling the remaining cooling input. Trane Precedent stage-capacity percentages are used for the selected size and efficiency family. Below the minimum stage, that stage cycles using provisional `Cd = 0.15`. Between adjacent stages, the model time-shares the stages for the hourly average. Because stage-specific power curves are unavailable, stage input is provisionally assumed proportional to stage capacity:

The stage percentages are from Trane catalog PKGP-PRC023E-EN (2026). For example, standard-efficiency 3–5 ton units are single-stage; high-efficiency 3–5 ton units use 67% and 100%; larger sizes use the catalog's listed three- or four-step levels. Stage control is represented as an hourly average, not a minute-by-minute controller simulation. See the [Trane Precedent catalog](https://elibrary.tranetechnologies.com/public/commercial-hvac/Literature/Product%20Catalog/PKGP-PRC023E-EN_05152026.pdf).

- Minimum-stage PLR = cooling duty / minimum-stage capacity fraction.
- Minimum-stage PLF = 1 − Cd × (1 − minimum-stage PLR); minimum-stage runtime = minimum-stage PLR / minimum-stage PLF.
- Below minimum stage, cooling input excluding supply fan = installed nonfan kW × minimum-stage capacity fraction × minimum-stage runtime.
- At or above minimum stage, cooling input excluding supply fan = installed nonfan kW × cooling duty (proportional stage-power estimate).
- Supply-fan kWh = installed inferred fan kW for every occupied scheduled hour or hour with a heating, cooling or ventilation call; zero otherwise.
- Full-output net cooling COP = (installed gross curve capacity − installed fan heat) / (3412.141633 × installed nominal system kW).
- Operating net cooling COP = max(0, delivered gross cooling − hourly fan heat) / (3412.141633 × (cooling input excluding fan + fan kWh)). Both COP definitions are exported; the hourly table displays full-output net COP.

The fan runs through the full call hour, even when coil duty is below 1. This is an explicit screening control assumption. Cycling degradation applies only below the minimum compressor stage; the supply fan remains at its full-hour estimate. At full cooling duty, total input reconciles to nominal system kW. Nominal/AHRI ratings are not adjusted to the selected maximum airflow. No fan-law scaling, power-temperature correction, motor-efficiency assumption or extra outdoor-fan term is invented. Stage-specific power is a provisional proportional estimate.

Fan heat reduces heating demand and enters the **signed** sensible cooling balance: heater demand = max(0, building heating − fan heat); sensible cooling demand = max(0, signed cooling balance + fan heat). Latent demand is unchanged. This retains thermostat deadband and permits fan-only ventilation to create cooling demand.

For small natural-gas boilers, output capacity is provisionally set to ASHRAE design heating demand after fan heat credit. On/off runtime fraction = hourly delivered output / output capacity. Gas therms = capacity × runtime / (100000 × entered AFUE fraction). For the large CBLE-4D path, choose the smallest listed rated hot-water output that meets ASHRAE design heating demand after fan heat credit; use the selected fuel's listed consumption/hour × hourly runtime fraction. Propane is reported in ft³ and No. 2 light oil in gal; their listed heating values convert consumption to site MMBtu. If demand exceeds the 800 HP rating, cap delivered boiler output at that rating and report unmet heat. Modulating firing is not available. Resistance element kWh = element output / 3412.141633. Fan electricity is separate and its heat also serves the building, preventing duplicate heating input.

For heat-pump heating, subtract inferred fan heat/input from integrated heating capacity/power before determining coil duty. Apply `PLF = 1 − Cd × (1 − PLR)` only when load is below the minimum stage; above minimum stage, adjacent stages are time-shared using the provisional proportional-power assumption. Add fan heat to delivered building heat and fan electricity once to total input. `Cd = 0.15` is provisional. No extra defrost term, auxiliary heat or reheat is supplied. Total kWh = heating coil input + cooling input excluding supply fan + supply-fan input.

## Mixed air and automatic unit selection

Entering wet bulb is calculated, not entered. Return dry bulb follows the baseline free-float temperature limited by active setpoints; return RH uses the indoor RH target. Mix scheduled ventilation and return air using humidity ratio and moist-air enthalpy. At 101325 Pa, standard-volume CFM fractions approximate dry-air mass fractions. Solve mixed dry bulb from enthalpy/humidity, then wet bulb by inversion of the ASHRAE water/ice relations (PsychroLib). Wet bulbs and RH are not averaged. Infiltration remains in building loads and is excluded from the mixer.

`autosizePackaged` delegates to `lib/packaged-optimizer.ts`. It selects mixed catalog sizes using integer optimization: minimize total unit count, then installed nominal tonnage. Only sensible and latent cooling constrain heat-pump bank size. Heating capacity and ventilation airflow are diagnostics and cannot increase the unit count or size. Ventilation heat and moisture remain in the building cooling loads. The mixer caps outdoor air at 100% of installed supply and reports requested airflow above supply as a shortfall. Unavailable design checks are omitted from constraints and do not influence ranking. Coverage remains reported; ignored checks do not become known annual performance. No sizing margin is added.

The optimizer enumerates attainable installed airflows, recalculates mixed entering air for each airflow, and solves integer counts of every eligible catalog size. All sizes use one shared normalized cooling-capacity curve, with separate size reference capacities. Each group retains its SHR, heating, nominal power, fan estimate and stages. A browser worker runs the search so controls remain responsive; changing sizing inputs cancels the previous worker. The search has a 15-second main-search budget and per-solve limits. `Optimization_complete` distinguishes a proven minimum from the best feasible bank found at a search limit. Homogeneous seed banks have a 10,000-unit ceiling. Every unit serves an assigned zone share proportional to its nominal tons; spare capacity is not transferred between zones. All units stage/cycle locally and all supply fans retain full-hour operation on heat/cool/ventilation calls. Design feasibility also checks these assigned cooling shares. Per-group performance is exported in the hourly CSV.

Cooling domain: entering WB 61–73°F, entering DB 75–90°F, outdoor generally 85–125°F (standard 10-ton ends at 120°F). Both 25-ton fits require outdoor DB + 2 × entering DB ≤ 295. The strict source evaluators check the valid-point convex hull. Heating domain: outdoor −8–72°F and entering DB 40–80°F. The default screening evaluation uses the nearest covered curve conditions in normalized fit coordinates, without polynomial extrapolation. It preserves actual weather and mixed-air conditions for building loads. Boundary-held heating below −8°F can overstate performance. Missing inputs remain unavailable. The internal strict policy retains source-only results. No reheat correction is applied to excess sensible cooling.

## ASHRAE design-day sizing

Equipment selection uses published **ASHRAE 2017 station design conditions**, not the largest hour or a percentile calculated from the downloaded annual weather. Defaults are **1% cooling and 99% heating**. Other published choices (0.4% or 2% cooling; 99.6% heating) are in Building characteristics and assumptions. Results identify the station, distance, edition and conditions; the engineer can choose another of the ten nearest complete stations within 250 km to account for local climate and elevation.

`lib/design-sizing.ts` creates 24-hour heating, dry-bulb/mean-coincident-wet-bulb, wet-bulb/mean-coincident-dry-bulb and dew-point/mean-coincident-dry-bulb design days. Cooling uses the published daily dry-bulb range, the default ASHRAE/EnergyPlus hourly profile, constant humidity ratio capped at saturation, and ASHRAETau2017 clear-sky solar. Only occupied design hours determine equipment sizes. The existing June-August occupancy percentage applies to people, person-based ventilation and scheduled lighting/plug gains. Area-based ventilation, envelope loads and infiltration retain their physical calculations; the entire load is not multiplied by occupancy percentage. Empty scheduled hours are excluded from heat-pump, boiler, resistance and chiller sizing. Heating holds the occupied heating setpoint with no credit for internal or solar gains. Scheduled ventilation and infiltration remain in the load balance. Existing standard-pressure psychrometrics are retained; station elevation is shown for station selection, not applied as an air-density correction.

Heat-pump counts/capacities, boiler/resistance capacities and chiller capacity all use these design loads. Annual weather still determines hourly energy, capacity/power distributions and unmet loads. Hours above design do not resize equipment, and loads are not clipped to design conditions. Heat-pump heating never governs installed tonnage; heating shortfalls remain unmet without automatic auxiliary heat. Missing design conditions prevent sizing rather than reverting to the annual peak. Model versions are `building-solar-2.3` and `equipment-mixed-air-18.0`.

The 1,724 complete U.S. station records come from the [EnergyPlus team's public ASHRAE 2017 design-condition distribution](https://energyplushelp.freshdesk.com/support/solutions/articles/67000709369-2017-annual-design-conditions-definitions-for-all-ashrae-design-condition-locations). This bundled dataset is explicitly the 2017 edition. Source URLs and SHA-256 are retained in `lib/data/ashrae-design-2017-us.json` and equipment CSV metadata. Rebuild from the regional ZIP with `python scripts/build-ashrae-design-data.py --source PATH_TO_ZIP`. Incomplete station records are excluded; no ASHRAE handbook text is bundled.

## Building, annual energy and interpretation

The building is an hourly steady-state single zone with editable total conditioned floor area and number of floors (defaults: 150,000 ft² across two equal floors) with weekday occupancy, reduced summer use, setback temperatures, internal gains and Sup3rCC solar gains. Infiltration plus scheduled ventilation affect building loads. Roofs use GHI; walls use projected DNI plus sky/ground components at the dataset grid location and fixed local time. There is no thermal storage, detailed zoning, economizer or controls simulation. Sup3rCC is modeled climate, not observed weather. Lighting and plug electricity are excluded from these equipment totals.

Annual site energy = electricity kWh × 3412.141633 / 1e6 + gas therms × 0.1 MMBtu/therm. Electricity cost uses supported OpenEI tariff terms or an entered rate; gas cost uses an EIA monthly state commercial benchmark. EPA eGRID and gas-combustion factors give CO₂e. Fan electricity is part of equipment electricity, including for gas heating. Missing tariffs/prices/factors block only dependent metrics.

Annual totals require 8,760 unique, valid, complete hourly energy records. Missing equipment performance is not zero. Annual screening totals include boundary-estimated performance, with flags, estimated-hour counts and evaluated curve temperatures recorded in CSVs separately from actual weather and mixed air. Component subtotals may cover different available hours; do not add fan subtotal to total electricity again. Review coverage and unmet loads alongside energy/cost/emissions.

## Configuration and verification

Node >=22.13 and pnpm 11.25.0. Install with `pnpm install --frozen-lockfile`, copy `.env.example` to `.env` and enter your server credentials, then run `pnpm dev`. The local application uses port 5173. `pnpm build` produces `dist/`; `pnpm start` previews that build locally. Server secrets remain in ignored `.env` files or Cloudflare secret settings: NLR API key and metadata, optional OpenEI and EIA keys.

Build and hosting use Vinext and Cloudflare directly. See [Local setup and hosting](docs/HOSTING.md) for configuration, secret setup and deployment commands. No external site builder, sign-in service or hosting manifest is required.

- `node node_modules/typescript/bin/tsc --noEmit`
- `node scripts/check-mixed-equipment.mjs`
- `node scripts/check-shared-equipment.mjs`
- `node scripts/check-design-sizing.mjs`
- `node scripts/check-equipment-model.mjs`
- `node scripts/check-equipment-utilization.mjs`
- `node scripts/check-equipment-operation.mjs`
- `node scripts/check-school-model.mjs`
- `node scripts/check-beast-scorecard.mjs`
- `node scripts/check-location-energy.mjs`
- `pnpm build`
- `python scripts/build-engineering-guide.py` (render and inspect the PDF)

Reproduce ratings: `python scripts/extract-unit-data.py --source PATH_TO_FULL_PDF`. Reproduce heating fits: `python scripts/fit-precedent-heating.py --source PATH`. Checks cover all 1,628 heating points, all 24 nominal power records, fan power reconciliation, part duty, fuel/element heat credit, ventilation, fan-induced cooling, required cooling, automatic names, domains, annual accounting, CSVs and rendered controls. The 55 independent wet-bulb reference states remain in `scripts/fixtures/mixed-air-reference.json`.

References: PsychroLib https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html; fan inference https://www.energycodes.gov/sites/default/files/2024-08/90.1_Secton_11_and%29_Appendix_G_Review_Manual_V04.pdf; residential AFUE https://www.energy.gov/cmei/femp/purchasing-energy-efficient-residential-furnaces; commercial boiler rating categories https://www.energy.gov/cmei/femp/purchasing-energy-efficient-boilers. Source provenance and licenses are in `THIRD_PARTY_NOTICES.md`.

## Input controls

Building characteristics and assumptions is a single collapsible panel with one default/custom choice. Defaults restore the complete building input set; custom mode enables editing. Location, year, equipment, utility and ZIP inputs are directly editable. The first input group contains total conditioned floor area, number of floors, height per floor, plan aspect ratio and rotation. Total area includes all floors; conditioned volume is total area times height per floor, and occupancy remains an independently entered building total. Required building fields reveal the panel on validation. UI copy describes current behavior; implementation history stays outside the website.

## Stage and cycling histograms

The Results tab defaults to **Unit stages and ON/OFF time**. Select a size group and inspect units with mode demand, all installed units, or one numbered unit. Units of the same size have identical assumed zone shares and profiles. The default excludes fully idle unit-hours while retaining the cycling OFF portion of units called to run. One unit-hour represents one unit observed for one hour. Compressor operation excludes the separately reported supply fan. Unit ON means at least one compressor is running; this is not the on-time of every individual compressor inside a multi-compressor unit.

The stage histogram accumulates fractional unit-hours at each modeled capacity stage and OFF. Every unit receives its own proportional load share; all units in a group stage or cycle on that same per-unit part-load ratio. Below minimum stage, ON fraction is the existing minimum-stage PLR divided by PLF, with Cd = 0.15. Between stages, time is shared between adjacent stages while unit ON time remains 60 minutes. The paired histogram counts unit-hours by total ON and OFF minutes, using zero and ten-minute intervals through 60. Both series conserve the included unit-hour count; stage time sums to that same count. Missing operation records are excluded, never plotted as OFF.

These are mode-specific hourly estimates for a shared building load sequenced across units, not a zone-by-zone or thermostat time-series simulation. They do not identify individual cycle lengths, starts per hour, lead rotation or individual-compressor switching. Boiler burner charts use the existing on/off runtime fraction. Resistance and the chiller placeholder have no supplied stage/switching model, so their stage view gives a reason rather than inventing operation; their capacity/power view remains available.

The optional **Capacity and power · bank average** view retains the original utilization histograms. Twenty equal units with 5% bank demand each receive 5% unit demand; compressors cycle below minimum stage rather than shedding nineteen whole units. Sensible and latent cooling constrain selection independently. The section displays the highest evaluated cooling design loading. Heating and ventilation airflow ratios are diagnostic only; ratios above 100% show a shortfall without resizing the bank. Hourly airflow deficits are exported as `Unmet_ventilation_CFM` and summarized on the equipment card.

`lib/equipment-staging.ts` records full/idle/partial unit counts and per-unit stage-time fractions; `lib/equipment-operation.ts` aggregates them. Per-group records are exported in `Equipment_group_performance_JSON`; design loading ratios are in `Design_check_loading_JSON`. The charts use these recorded operations without resizing equipment or changing energy calculations. Pricing data and complete-year coverage are not required to display available hours.
