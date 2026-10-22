# BEAST

Building Energy Analysis Selection Tool: weather-driven building loads, packaged heat-pump autosizing and heating-only equipment comparisons.

## Equipment

Three scenarios start with Rooftop Packaged Heat Pump, Natural Gas and Electric Resistance. Each scenario can select any of those options. Gas and resistance are **heating only**; their cooling loads are explicitly unserved.

The rooftop heat pump uses the 24 standard/high efficiency heat-pump fits from the supplied Precedent_Cooling.pdf, Trane PKGP-PRC023F-EN, tables 10-33. Dual-fuel tables are excluded. The fit data and source hash are in `lib/data/precedent-cooling.json`. Each unit runs at its largest listed catalog airflow (480 CFM per nominal ton); airflow is fixed by selected size and count. Cooling capacity and SHR use outdoor dry bulb plus calculated mixed-air entering wet bulb and dry bulb. The fit report and coefficient CSV are served under `public/references/`.

Heating capacity and total input power use all 16 tables (58-73, printed pages 86-95) in the supplied Heating_Cap.pdf. The 1,632 pairs are retained, with four source reversals flagged without correction. `lib/data/precedent-heating.json` includes source hash, coefficients, domains, errors and mapping. Heating takes outdoor and mixed entering **dry bulb**, not wet bulb. Capacity uses an anchored fourth-degree polynomial and total power an anchored second-degree polynomial; both normalize at 47°F outdoor / 70°F entering DB. COP = net heat BTU/hr / (3412.141633 × total input kW). Maximum source-point errors are 4.59% capacity and 3.31% power; interior-plane conditional validation has capacity relative RMSE up to 2.13% (reference remains a known anchor).

Heating tables already include indoor fan heat/power at nominal CFM and the listed ESP, integrated defrost, and 70% outdoor RH. The excerpt supplies no correction to the maximum cooling airflow used by mixed air. Applying these heating fits there is an **uncorrected screening approximation**, and heating selections remain provisional. No added fan/defrost term or outdoor-humidity correction is invented. Heating reference capacity is a catalog rating, not nominal cooling tons × 12,000. The 3/4/5-ton tables distinguish efficiency; 10-ton standard WSK uses table 67 and high WHK uses table 68. Other sizes share size-only heating tables across families. No dual-fuel system is added.

Hourly heating delivery is min(load, installed net capacity). Unmet heat is the remainder. Ideal duty fraction = delivered / available; hourly kWh = installed catalog total input kW × duty fraction, with no cycling degradation or auxiliary heat. Positive loads outside outdoor -8–72°F or entering DB 40–80°F leave dependent heating outputs blank. Cooling COP still awaits the user's data. Known heating electricity remains available separately; combined electricity is unknown when required cooling electricity is unknown.

Natural-gas heating output is sized to peak building heating demand. Enter AHUE / AFUE efficiency above 0% and at or below 100%; no value is assumed. Hourly input therms = delivered heat / (100000 × efficiency fraction). This uses annual efficiency as a fixed hourly screening conversion. Electric resistance output is also sized to peak heating load; electricity = delivered heat / 3412.141633. Both use ideal modulation up to that heating output and omit separate fan/controls energy.

## Mixed air: entering wet bulb is calculated

Return-air dry bulb follows the building free-float condition limited by active heating/cooling setpoints; return RH uses the building indoor RH target. Outdoor humidity ratio uses weather temperature/RH. Scheduled ventilation / installed catalog supply CFM gives the outdoor-air fraction, using a standard-volume dry-air approximation at 101325 Pa. Infiltration affects building loads but is not routed through the mixer.

Mix humidity ratios and moist-air enthalpies by that fraction. In SI, h = 1.006 T + W(2501 + 1.86 T); mixed dry bulb = (h − 2501 W)/(1.006 + 1.86 W). Solve mixed wet bulb by inversion of the ASHRAE wet-bulb humidity-ratio equations, using water/ice branches adapted from PsychroLib. Wet bulbs and RH are not averaged. Invalid or supersaturated mixed states remain unavailable. Gas/resistance have no defined supply-airflow model and do not display invented coil-entering conditions.

## Automatic rooftop unit selection

For each available size (3–25 tons), check integer unit counts starting with the ventilation minimum. Recalculate mixed air for each candidate, then test heating plus separate sensible/latent cooling capacities at every verifiable load hour. Retain the first passing count for that size; choose among candidates by more covered heating plus cooling hours, fewer units, then less total nominal tonnage. Heating-only load years also produce a packaged selection. No sizing percentage margin is added.

Every candidate must deliver at least scheduled ventilation airflow. Cooling capacity is gross; heating is integrated net capacity. Missing inputs, out-of-domain conditions and the heating airflow approximation make sizing provisional, with coverage shown in the UI and exports. If the bounded search cannot verify a selection, show a clearly marked reference-condition estimate covering reference heating, separate sensible/latent cooling and ventilation. It never creates hourly performance outside the data domain.

Valid entering WB is 61–73°F and entering DB 75–90°F. Outdoor DB is generally 85–125°F; the standard 10-ton fit ends at 120°F. Both 25-ton fits also require outdoor DB + 2 × entering DB ≤ 295. All models check the valid-point convex hull and prohibit extrapolation. The anomalous 156.6 MBh entry in both 17.5-ton tables is retained and flagged.

Gross cooling delivery is capped at installed capacity; its sensible/latent split uses fitted SHR. Remaining sensible and latent loads are reported as unmet. Excess sensible removal is not corrected by reheat. Manufacturer dashes are not zero capacity. Missing performance is not zero energy.

## Building loads and weather

The editable building model remains a 150,000 ft² single-zone, hourly steady-state estimate. Heating is positive and cooling negative. Total cooling includes sensible and latent cooling. Occupancy follows Monday–Friday local standard time, with reduced June–August occupancy and unoccupied setpoints. Lighting, plug loads and occupants contribute building heat gains; their electricity is not included in the curve-based electricity output.

H = envelope UA + 1.08 × outdoor CFM. Heating = max(0, H × (heating setpoint − outdoor dry bulb) − sensible gains). Sensible cooling = −max(0, H × (outdoor dry bulb − cooling setpoint) + sensible gains). Latent removal follows the outdoor-air and occupant moisture balance at the indoor RH limit, using standard sea-level air. Outdoor airflow here is a building load input, not equipment airflow.

Sup3rCC DHI/DNI/GHI drive solar gains using the dataset grid coordinates and fixed UTC offset. NOAA solar geometry uses the hourly midpoint. Roof irradiance uses GHI; vertical walls use projected DNI plus isotropic sky and ground components. Window gains use area × SHGC × shading. Opaque gains use area × U × absorptance / exterior film coefficient. Solar U-values do not replace the independently entered envelope UA. No thermal storage, delayed load response, detailed overhangs, zoning or control solver is simulated. Missing radiation or grid metadata leaves dependent loads blank.

## Utility rates, energy and emissions

Annual site energy = electricity kWh × 3412.141633 / 1e6 + gas input therms × 0.1 MMBtu/therm. Electricity cost applies a supported OpenEI tariff or manual $/kWh. Gas cost uses the newest available EIA state commercial delivered price for each used calendar month, with the EPA heat-content conversion retained. A gas-only model with zero electricity does not receive separate electricity-account charges. EIA is a benchmark, not the building's gas tariff.

CO₂e includes EPA eGRID electricity generation and EPA natural-gas combustion factors. Zero consumption does not require a factor for that unused fuel. Missing prices or EPA factors block only dependent results. Sources and data years are displayed; they are independent of the weather year. No upstream emissions or refrigerant leakage are modeled.

Annual metrics require 8,760 unique valid complete energy records in one year, excluding February 29. Available-hour totals disclose coverage. Heating-only gas/resistance should be compared with their unserved cooling loads; lower energy is not an equal-service efficiency comparison.

## Configuration and verification

Node >=22.13. Server-only secrets: `NLR_API_KEY` and NLR request metadata; optional `OPENEI_API_KEY` and separate `EIA_API_KEY`. Keep credentials in ignored local environment files or hosting runtime secrets. This checkout has no linked Sites deployment.

- `node node_modules/typescript/bin/tsc --noEmit`
- `node scripts/check-equipment-model.mjs`
- `node scripts/check-school-model.mjs`
- `node scripts/check-beast-scorecard.mjs`
- `node scripts/check-location-energy.mjs`
- `node scripts/check-precedent-curves.mjs` (checks the generated curve-fit package)
- `node scripts/run-framework.mjs build`
- `python scripts/build-engineering-guide.py` (render and inspect the resulting PDF)

The 55 independent reference wet-bulb cases are in `scripts/fixtures/mixed-air-reference.json`, generated from PsychroLib 2.5.0. Core implementation: `lib/equipment.ts`, `lib/mixed-air.ts`, `lib/packaged-cooling.ts`, `lib/packaged-heating.ts`, `lib/equipment-model.ts`; controls: `components/equipment-scenarios.tsx`. Reproduce heating fits with `python scripts/fit-precedent-heating.py --source PATH`; generated audit/validation CSVs go under ignored `outputs/precedent-heating/`. Published coefficient CSVs include c0-c14 in `[1,x,y,x²,xy,y²,x³,x²y,xy²,y³,x⁴,x³y,x²y²,xy³,y⁴]` order, with x=(outdoor F-47)/40 and y=(entering F-70)/20.

Psychrometric references: https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html. AFUE definition: https://www.energy.gov/cmei/femp/purchasing-energy-efficient-residential-furnaces. Bundled source provenance and licenses remain in `THIRD_PARTY_NOTICES.md`.

Trane model-family key (W = packaged heat pump; S/H = standard/high efficiency): https://elibrary.tranetechnologies.com/public/commercial-hvac/Literature/Product%20Catalog/PKGP-PRC023D-EN_09122025.pdf. Heating numerical data come exclusively from the user-supplied excerpt.
