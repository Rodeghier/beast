# Reheat and airflow selections

Equipment scenarios require populated airflow and reheat dropdowns. Defaults are variable airflow and electric resistance reheat. Cooling defaults to packaged heat-pump equipment and heat-pump backup defaults to electric resistance; the user must still enter a backup switchover temperature. NG reheat has a separate efficiency input, initially 80%, independent of the primary heat source.

Constant airflow uses each unit's AHRI reference CFM, capped at the standard-motor limit, whenever the fan runs. Both modes use the airflow-dependent coil fits, moisture balance, fan heat, supply temperature and reheat calculations. The design search checks ventilation and cooling at the selected airflow mode. Reheat choices affect hourly airflow ranking; the installed-bank search uses the default electric-reheat ranking and does not optimize annual energy or eliminate every possible reheat shortfall.

## MHGRH source and calculation

The user supplied **PKGP-PRC023F-EN, pages 96–119, tables 74–86**. The extracted text is in `public/references/mhgrh-source.txt`. `node scripts/build-mhgrh.mjs` produces the 2,340 data points in `lib/data/mhgrh.json`. Source points cover 13 tables, 3 ambient temperatures, 5 airflows, 4 entering dry bulbs and 3 entering wet bulbs. The two 10-ton tables distinguish WSK120 from W/DHK120 and DSK120 equipment. The existing efficiency-family mapping assigns high efficiency to WSK120 and standard to the other table. Larger units retain the existing 25-ton assembly proxy assumption.

The evaluator interpolates ambient DB, entering DB, entering WB, and airflow. Maximum recovery is `1.08 × CFM × (MAX leaving reheat DB − MAX leaving evaporator DB)`. It is further limited by compressor ON time and estimated heat rejection (delivered cooling plus modeled compressor/condenser input). Fully operating units have full runtime; cycling units have their calculated runtime fraction. No recovery is credited when compressors are off. Recovered heat serves only each group's own reheat demand.

Reheat delivery is the smaller of demand and available recovery. There is no automatic electric or NG supplement. Residual overcooling is reported through unmet reheat and final supply temperature. MHGRH adds no separate resistance or gas energy; compressor energy remains included in cooling electricity. `MHGRH_available_reheat_BTU_hr`, `MHGRH_boundary_estimate`, and group JSON expose the recovery limits and lookup conditions.

## Limits

The tables describe both evaporator and reheat temperatures changing with valve position. This implementation uses their **temperature rise as a recovery limit**, while retaining the existing cooling capacity/SHR and compressor power models. It is an approximate recovery option, not a coupled refrigerant-cycle model. No reheat-mode compressor input map was supplied. Below minimum-valve heat output, bypass/duty modulation is assumed; full-load recovery is scaled by compressor runtime without a stage-specific MHGRH map.

Temperatures outside 60–70°F ambient, 51–59°F entering WB or 60–75°F entering DB use flagged boundary estimates in bounded mode. Strict mode credits no recovery outside these ranges. Airflow is never extrapolated. Large-unit proxies and using the common tables for both efficiency families remain assumptions, not manufacturer certification. Supply temperatures remain calculated CSV outputs; no 55°F control is introduced.

## Verification

`node scripts/check-reheat-options.mjs` checks all source knots, boundary handling, all six airflow/reheat combinations, energy accounting, CSV metadata, and controls. Existing airflow and air-state checks cover cooling curves and physical balances. Legacy fixed-airflow fixtures explicitly omit the new reheat choice to retain their original reference calculation.
