# Thermostat and minimum-load controls

`DEFAULT_SCHOOL.thermostatDeadbandF` defaults to 2°F. The building assumptions editor exposes the half-width (0–5°F); zero restores the previous setpoint calculation.

Annual sensible loads use the scheduled heating setpoint minus the half-width and the scheduled cooling setpoint plus the half-width. With occupied settings of 70°F heating and 75°F cooling, the effective thresholds are 68°F and 77°F. Unoccupied settings of 60°F/85°F become 58°F/87°F. At a threshold, sensible demand is zero; beyond it, the steady-state load is calculated to that threshold. Internal gains and outdoor air are included in the balance, so these are zone-equilibrium thresholds, not outdoor-temperature cutoffs.

The same effective temperatures are used for signed load balances, return-air conditions and the indoor humidity target. Supply-fan heat can still create a cooling call when it takes the balance beyond the cooling threshold. Latent demand remains independent: humidity control can call cooling inside the sensible deadband.

ASHRAE heating and cooling design days retain the entered setpoints without the allowance. The deadband therefore does not reduce design sizing requirements. CSV metadata exports the half-width and control basis. Building model version: `building-solar-2.4`.

This is an hourly steady-state temperature allowance, not a dynamic thermostat simulation. There is no thermal storage, evolving zone temperature, separate compressor cut-in/cut-out state, or minimum run/off timer. Compressor cycling degradation and hourly runtime estimates remain active. A ±2°F allowance alone cannot establish starts per hour or guarantee prevention of short-cycling; that requires a transient model and subhourly equipment controls.

Verification: `node scripts/check-school-model.mjs` covers thresholds, signs, setbacks, retained latent calls, zero-width behavior, unchanged design rows, validation and metadata. Run `node scripts/check-design-sizing.mjs` for the design-to-equipment path and `node node_modules/typescript/bin/tsc --noEmit` for type consistency.

## Minimum compressor load

`DEFAULT_SCHOOL.minimumCompressorLoadPercent` defaults to 5%. It is editable in Indoor conditions; zero disables the cutoff. During annual packaged heat-pump operation, each group's compressors stay off when its required output is strictly below this percentage of its available capacity at that hour's evaluated conditions. Exactly 5% is permitted. Identical units retain their group's identical nominal-tonnage load shares, so this is also a per-unit check; it is not a whole-bank shedding rule.

Heating compares coil demand after supply-fan heat credit against available heating coil capacity with the rating fan component removed. Cooling compares the larger required sensible/latent gross-output fraction against gross cooling capacity. A latent-only call is subject to the same cutoff. The comparison uses required output before cycling degradation, not nominal tons, electrical power or compressor ON-time.

Locked-out compressors have zero delivered coil output, zero compressor energy and OFF stage records. Fans retain their scheduled operation and their heating credit. Suppressed heating, sensible and latent loads remain unmet; the model does not store them for a later hour. Boilers, resistance heaters and the chiller placeholder are outside this packaged-compressor control. Equipment design selection is unchanged. Cycling-share statistics exclude fully locked-out hours.

Hourly status identifies affected modes; `Equipment_group_performance_JSON` records `minimumLoadLockout` for each group. CSV metadata includes `Minimum_compressor_load_percent` and `Compressor_minimum_load_basis`. Equipment model version: `equipment-reheat-options-21.1`.

`node scripts/check-minimum-compressor-load.mjs` verifies both modes, the exact threshold, disabled control, changing hourly capacity, latent-only calls, group-specific lockouts, fan operation, unmet loads, stage readouts, metadata and the input control. This hourly cutoff does not impose a minimum run/off time.


### Physical airside controller

The current constant-airflow/reheat and variable-airflow scenarios apply the annual cutoff inside `solveVariableAirside`, separately for every airflow candidate and installed group. The comparison uses feasible gross cooling output after the saturation and 45 F leaving-temperature checks, divided by the evaluated full gross capacity at that airflow. A candidate cannot retain positive cooling below the configured fraction, even if a leaving-temperature limit reduces deliverable capacity. This is a thermal-output threshold, not an electrical-power or runtime threshold.

On lockout, leaving air is recalculated with zero cooling before fan heat, primary heat and reheat are evaluated. No moisture removal, compressor input or MHGRH recovery is retained from the rejected operation. Reheat is recalculated from the OFF air state. Group records retain the pre-cutoff `requestedCoolingBtuHr` and `minimumLoadLockout`; the hourly status also identifies lockout. Fully locked-out hours are excluded from compressor cycling-share statistics.

Design airside calls explicitly disable the annual cutoff so reheat sizing is unchanged. The nonlinear design-selection helper also retains its existing no-cutoff design checks. The cutoff regression checks cover the current UI scenario paths for both airflow modes, all reheat options, latent-only demand, mixed groups, OFF air properties, energy, stages, unmet demand, and unchanged design reheat capacity.
