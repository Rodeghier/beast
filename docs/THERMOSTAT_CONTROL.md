# Thermostat and minimum-load controls

`DEFAULT_SCHOOL.thermostatDeadbandF` defaults to 2°F. The building assumptions editor exposes the half-width (0–5°F); zero restores the previous setpoint calculation.

Annual sensible loads use the scheduled heating setpoint minus the half-width and the scheduled cooling setpoint plus the half-width. With occupied settings of 70°F heating and 75°F cooling, the effective thresholds are 68°F and 77°F. Unoccupied settings of 60°F/85°F become 58°F/87°F. At a threshold, sensible demand is zero; beyond it, the steady-state load is calculated to that threshold. Internal gains and outdoor air are included in the balance, so these are zone-equilibrium thresholds, not outdoor-temperature cutoffs.

The same effective temperatures are used for signed load balances, return-air conditions and the indoor humidity target. Supply-fan heat can still create a cooling call when it takes the balance beyond the cooling threshold. Latent demand remains independent: humidity control can call cooling inside the sensible deadband.

ASHRAE heating and cooling design days retain the entered setpoints without the allowance. The deadband therefore does not reduce design sizing requirements. CSV metadata exports the half-width and control basis. Building model version: `building-solar-2.4`.

This is an hourly steady-state temperature allowance, not a dynamic thermostat simulation. There is no thermal storage, evolving zone temperature, separate compressor cut-in/cut-out state, or minimum run/off timer. Compressor cycling degradation and hourly runtime estimates remain active. A ±2°F allowance alone cannot establish starts per hour or guarantee prevention of short-cycling; that requires a transient model and subhourly equipment controls.

Verification: `node scripts/check-school-model.mjs` covers thresholds, signs, setbacks, retained latent calls, zero-width behavior, unchanged design rows, validation and metadata. Run `node scripts/check-design-sizing.mjs` for the design-to-equipment path and `node node_modules/typescript/bin/tsc --noEmit` for type consistency.

## Minimum compressor ON-time

`DEFAULT_SCHOOL.minimumCompressorOnMinutes` defaults to 20 minutes per hour and replaces the former capacity-percentage cutoff. Indoor conditions exposes the control from 0 to 60 minutes; zero disables it.

Each packaged unit's heating or cooling demand is first converted into stage times using the existing cycling degradation model. A positive total ON-time below the configured minimum locks out that mode for the hour. Exactly 20 minutes is allowed. Between stages a unit runs for 60 total minutes; the minimum applies to total compressor ON-time, not time at each individual stage or compressor. Identical units retain their group's common nominal-tonnage load share and runtime profile. The comparison is per unit, not the sum of minutes across a group.

The physical constant- and variable-airflow cooling paths apply the check after solving feasible output, separately for every airflow candidate and group. Lockout recomputes the leaving-air state at zero cooling before fan heat, primary heat and reheat. No compressor energy, moisture removal or MHGRH recovery survives a lockout. The legacy cooling and packaged heating dispatch paths apply the same runtime rule. Locked-out modes show zero ON minutes and their suppressed demand is reported unmet, without accumulating it for later hours or forcing extra runtime and overconditioning.

Fans retain their schedule. Boilers, resistance heaters, backup heat and the chiller placeholder are excluded. Design bank selection and design reheat sizing disable this annual cutoff. Hourly runtime is calculated after cycling PLF, rather than being inferred from nominal tons or electrical power. The model still cannot resolve individual cycles or guarantee a continuous 20-minute run.

Hourly status identifies lockout. Group JSON exports `minimumRuntimeLockout` and `requestedOnMinutesPerUnit` (the proposed runtime before lockout). CSV metadata uses `Minimum_compressor_on_minutes` and `Compressor_minimum_runtime_basis`.

Run `node scripts/check-minimum-compressor-load.mjs` to verify runtime thresholds, exact equality, disabled control, group-specific dispatch, both airflow modes, MHGRH, latent-only calls, energy, OFF states, unmet demand and unchanged design reheat capacity.
