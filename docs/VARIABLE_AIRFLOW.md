# Variable-airflow packaged equipment

Packaged heat-pump cooling now uses the original catalog data at every supplied airflow, with variable supply fans and humidity-driven cooling/reheat. The chiller placeholder has no air-handler performance data and retains its separate documented scope. The building heat balance remains a single-zone steady-state model.

## Source and fit

`public/references/packaged-cooling-all-airflows.csv` preserves 7,260 source slots from heat-pump tables 10–33 of PKGP-PRC023F-EN. There are 7,192 accepted nonmissing samples after retaining the existing two 17.5-ton source exclusions. Missing slots and excluded samples are flagged rather than filled. The original PDF SHA-256 is recorded in the fit JSON.

The source lists 300, 360, 400, 440 and 480 CFM per nominal ton for each of 24 sizes/families. `lib/data/precedent-airflow-cooling.json` fits all of them. `public/references/packaged-cooling-airflow-fits.json` is the identical downloadable coefficient file.

One normalized capacity surface applies across all source units with equal total weight per unit. Its reference is each unit's actual maximum-airflow catalog capacity at 95°F outdoor / 67°F entering WB / 80°F entering DB. It is anchored to one at that reference. The inputs are:

```text
x = (outdoor DB F - 95) / 20
y = (entering WB F - 67) / 6
z = (entering DB F - 80) / 10
f = (CFM per nominal ton - 480) / 180
terms = [1,x,y,z,f,x²,xy,xz,xf,y²,yz,yf,z²,zf,f²]
gross capacity = unit reference capacity × dot(shared coefficients, terms)
SHR = clip(dot(unit SHR numerator coefficients, terms) / normalized capacity, 0, 1)
```

All 24 Precedent units have individual fitted SHR numerators. The 19 IntelliPak size and efficiency combinations interpolate gross total and sensible capacities at actual airflow within each table’s source airflow range. SHR is sensible capacity divided by total capacity.

Capacity relative RMS error is 1.983%; leaving one complete unit out of the shared fit gives 2.046% RMS. SHR RMS error is 0.002256; withholding the 400 CFM/ton data gives 0.002125 RMS. These measure agreement with catalog data, not field-calibrated building accuracy.

`scripts/build-airflow-cooling.py` reproduces the data from the source PDF or a hash-matched extraction cache. It needs NumPy/SciPy and, when parsing the PDF, pypdf. Temperature coverage retains each source unit's valid-point hull. Scenario bounded/strict temperature policy still applies. Airflow is never extrapolated beyond the supplied range.

## Fan model

`lib/variable-fan.ts` uses only the standard-motor rows of the user-supplied fan-performance-limit table:

| Size/family | Maximum shaft hp | Maximum rpm |
|---|---:|---:|
| Standard 3 tons, non-575 V | 0.75 | 1,200 |
| Standard 4–5 tons | 1.0 | 1,200 |
| High-efficiency 3–5 tons | 2.9 | 1,850 |
| Either family 6–8.5 tons | 2.9 | 1,850 |
| Standard 10-ton WSK | 2.9 | 1,850 |
| High-efficiency 10 tons | 4.2 | 1,940 |
| Either family 12.5 tons | 4.2 | 1,940 |
| Either family 15–25 tons | 5.8 | 1,850 |

IntelliPak uses the cooling table’s airflow ceiling and scales 25-ton Precedent fan horsepower, reference airflow and power by nominal tons. Reference airflow is capped at the catalog ceiling. High-static motors are excluded. The standard 3-ton 575 V exception is not selected because voltage is not an input.

The existing gross-minus-net rating fan heat gives reference electrical input at AHRI airflow. Electrical power varies with the cube of flow relative to that reference. Maximum hp is a mechanical output limit, converted using provisional 90% motor and 97% drive efficiencies. If this ceiling is reached below the catalog maximum CFM, the model reduces attainable maximum flow instead of inventing flat fan power at greater flow. RPM is retained as a limit; the table does not establish an actual RPM operating curve.

All modeled fan electrical input is assumed to enter the supply air as heat. A provisional 20% maximum-flow floor applies when fans run without compressors; compressor operation stays within source airflow coverage. This cubic model assumes a fixed system-resistance curve. Duct static-pressure reset and part-load motor/drive efficiency curves are not supplied.

## Hourly airside balance

`lib/variable-airside.ts` solves each installed group's assigned nominal-tonnage share. It selects among supported airflow candidates to meet sensible/moisture demand and ventilation, prioritizing service before input energy. Return air is total supply minus admitted outdoor air. Infiltration belongs in zone loads and does not pass through the mixer.

The zone balance removes scheduled mechanical-ventilation heat/moisture contributions before the coil conditions mixed outdoor and return air. This prevents ventilation from being added twice. Mixed air uses humidity ratio and enthalpy, while the building retains standard-air 1.08 and 0.68×7000 coefficients; small differences between their sensible balances remain an approximation.

Sensible and latent loads determine cooling demand. There is no dew-point trigger or fixed supply-air temperature target. The provisional minimum coil leaving temperature remains 45°F as an operating limit. Capacity, airflow and this lower limit can prevent full humidity control; unmet latent demand is exported. Coil-leaving and final supply-air temperatures are outputs for the user to track in the CSV.

Air leaving the coil is checked for nonnegative humidity and saturation consistency while conserving its modeled sensible-plus-latent cooling. Fan heat is added downstream. Final supply temperature is then calculated after primary heating and reheat, as a calculated result. Reheat changes temperature without increasing humidity ratio.

Cooling duty is solved against that final corrected air state. Dividing sensible demand by fitted SHR, or latent demand by one minus SHR, is only an initial estimate: saturation correction can change the split. The controller finds the minimum feasible coil output meeting sensible and latent demand, checks all available output before declaring a shortfall, and enforces the 45°F cooling floor. Per-group `required` is the solved feasible requirement, or null when no output inside the limits meets all targets; `linearRequired` retains the initial estimate for diagnostics.

`Cooling_SHR` reports the capacity-weighted source-curve fit. `Operating_cooling_SHR` reports delivered sensible cooling divided by delivered total cooling after the air-state correction. The CSV also separates raw source-curve capacity from `Deliverable_cooling_at_45F_limit_BTU_hr` and its sensible/latent components. Both new constant- and variable-airflow scenarios export these fields. The original fixed-rating worksheet remains available through the explicit reference calculation.

Both airflow modes use modulating hot gas reheat (MHGRH). When the heat-pump compressors are cooling for dehumidification, recovered heat can serve the remaining heating demand.

Occupied ASHRAE design airside operation estimates peak reheat demand. In the annual run, heat recovery depends on the MHGRH tables and compressor operation. The model reports residual overcooling as unmet reheat. The recovered heat needs no separate purchased reheat energy.

## Sizing and limitations

`lib/variable-sizing.ts` starts with the existing mixed-bank selection and evaluates variable-airflow design performance, including outdoor airflow and sensible/latent demand. It checks expanded seeds and homogeneous alternatives. It reports that global minimum unit count is not proven. Heating capacity remains diagnostic for the cooling-selected bank.

Cooling source fits describe full-output capacity and SHR as functions of temperature and airflow. Compressor stage capacity/power shares and cycling degradation remain provisional. No airflow-dependent compressor input-power data were recovered. Heating curves remain at their nominal-airflow basis; their original rating fan is removed before the actual modeled fan is added, but no heating-capacity airflow correction is invented.

The former maximum-airflow evaluator remains available for strict source checks and explicit fixed-airflow comparison fixtures. The website requires a populated airflow dropdown, defaulting to variable; constant mode holds each running unit at its AHRI reference airflow, capped by standard-motor HP. Both modes use the physical airside/reheat balance and are rechecked at design conditions. CSV metadata identifies the active policy and coefficients.

Verification: `node scripts/check-variable-airflow.mjs` checks every accepted source sample, all 43 size and efficiency combinations, cubic fan power and motor ceilings, air/moisture/energy balances, dehumidification, MHGRH, backup interactions, sizing, numeric exports and a complete annual simulation. `node scripts/check-air-state-control.mjs` independently checks the final-state controller against sensible-plus-latent balances, sensible/moisture loads without a fixed supply target, true capacity limits, reduced overconditioning, and humid-weather regressions. Existing fixed-airflow regression checks remain separate reference checks.
