# BEAST

Building Energy Analysis Selection Tool. Load Sup3rCC weather, estimate building loads, and compare up to three scenarios using only user-supplied normalized capacity, COP and SHR surfaces.

## Performance inputs

There are no bundled equipment datasets or default performance values. The only equipment performance inputs are:

- Heating normalized capacity and absolute heating COP.
- Cooling normalized capacity, absolute cooling COP and SHR.

All surfaces use **outdoor dry-bulb temperature and entering wet-bulb temperature in °F**. The blank template is `public/templates/performance-curves.json`. Replace each `null` with a rectangular grid containing `outdoorF`, `enteringWetBulbF` and `values`. Both temperature axes need at least two strictly increasing finite numbers. Values are rows by entering wet-bulb temperature and columns by outdoor dry-bulb temperature. Capacity must be nonnegative; COP positive; SHR within [0,1]. Unknown fields are rejected.

The UI provides a grid-format outline without example equipment values. Apply curves explicitly. Bilinear interpolation operates only within the supplied domain on both axes; no extrapolation or boundary holding is applied.

Supply entering wet-bulb operating conditions by importing a CSV with headers `Date,Time,Entering_wet_bulb_F`, dates `YYYY-MM-DD`, and local standard times `HH:00`. An empty CSV template is provided. An optional explicit fixed temperature can cover all hours or fill gaps in hourly data. No wet-bulb value is inferred from equipment airflow, mixing, or outdoor humidity. Each scenario has independent operating inputs.

Normalized capacities scale the selected dataset's peak valid **building heating load** and **building total cooling load**, respectively. These dimensional references come from the building, with no nominal equipment rating or sizing multiplier. Changing the building, weather year or location changes the references. This is a screening convention; supplied capacity surfaces must use that normalization basis.

## Calculations and retained outputs

For each hour, capacity = building peak reference × the supplied capacity multiplier. Delivered heating = min(heating load, available heating capacity). Gross cooling requirement = max(sensible load / SHR, latent load / (1−SHR)); delivery is capped at available cooling capacity. SHR splits that delivery into sensible and latent removal. Unmet cooling is the sum of remaining sensible and latent load. At SHR endpoints, any positive demand in the unavailable component remains unmet. Excess sensible cooling is not corrected. Heating and cooling are evaluated independently if both loads occur.

Electricity (kWh per one-hour record) = delivered heating / heating COP / 3412.141633 + delivered gross cooling / cooling COP / 3412.141633. The COP surfaces define the electricity basis; no extra equipment energy is added. Retained performance outputs are curve-based electricity, capacities, delivered loads, COP, SHR, unmet loads and input/status diagnostics. Electricity cost uses that electricity and either a supported tariff or a manual $/kWh. Electricity CO₂e uses the same electricity and an EPA eGRID factor.

Missing curves, operating conditions, weather, or required domain coverage leave dependent hourly results blank. Available-hour totals identify their valid-hour count. Annual scorecards require 8,760 complete, unique, valid hours in one calendar year excluding February 29. Missing results never become zero.

## Building loads and weather

The editable building model remains a 150,000 ft² single-zone, hourly steady-state estimate. Heating is positive and cooling negative. Total cooling includes sensible and latent cooling. Occupancy follows Monday–Friday local standard time, with reduced June–August occupancy and unoccupied setpoints. Lighting, plug loads and occupants contribute building heat gains; their electricity is not included in the curve-based electricity output.

H = envelope UA + 1.08 × outdoor CFM. Heating = max(0, H × (heating setpoint − outdoor dry bulb) − sensible gains). Sensible cooling = −max(0, H × (outdoor dry bulb − cooling setpoint) + sensible gains). Latent removal follows the outdoor-air and occupant moisture balance at the indoor RH limit, using standard sea-level air. Outdoor airflow here is a building load input, not equipment airflow.

Sup3rCC DHI/DNI/GHI drive solar gains using the dataset grid coordinates and fixed UTC offset. NOAA solar geometry uses the hourly midpoint. Roof irradiance uses GHI; vertical walls use projected DNI plus isotropic sky and ground components. Window gains use area × SHGC × shading. Opaque gains use area × U × absorptance / exterior film coefficient. Solar U-values do not replace the independently entered envelope UA. No thermal storage, delayed load response, detailed overhangs, zoning or control solver is simulated. Missing radiation or grid metadata leaves dependent loads blank.

## Electricity sources

OpenEI URDB supplies commercial tariff candidates; verify eligibility. Supported monthly/TOU tiers, demand charges, adjustments and fixed/minimum charges apply to curve-based electricity as a separate-meter estimate. Unsupported terms prevent a cost estimate. A manual nonnegative $/kWh replaces tariff pricing. Demand uses hourly-average peak kW, which may differ from utility demand intervals. Daily tier limits scale by calendar days; demand-based tier limits use the month's peak hourly-average import kW.

Bundled EPA eGRID2023 revision 2 CO₂e factors provide electricity generation emissions. Source provenance is recorded in `lib/data/egrid*.json`. Select the applicable subregion; an optional ZIP helps identify candidates. Annual factors remain constant across hours and weather years. They are not future-grid or marginal forecasts. These outputs include only the supplied curves' electricity scope.

## Configuration and verification

Node >=22.13. Server-only secrets: `NLR_API_KEY`, NLR request metadata, and optional `OPENEI_API_KEY`. Configure local secrets in an ignored environment file. Never commit credentials. Existing runtime configuration and lockfile are retained.

- `node node_modules/typescript/bin/tsc --noEmit`
- `node scripts/check-performance-curves.mjs`
- `node scripts/check-school-model.mjs` (optional full-year climate CSV argument)
- `node scripts/check-beast-scorecard.mjs`
- `node scripts/check-location-energy.mjs`
- `node scripts/run-framework.mjs build`
- `python scripts/build-engineering-guide.py` rebuilds `public/engineering-guide.pdf`; render and inspect it after edits.

Core files: `lib/performance-curves.ts` validates/interpolates surfaces; `lib/curve-model.ts` calculates outputs and CSVs; `components/curve-scenarios.tsx` provides empty editors and operating-condition inputs. The engineering guide describes the same simplified model. The repository contains no linked Sites deployment; source changes do not publish a website automatically.
