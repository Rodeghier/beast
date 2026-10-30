# BEAST Repository Reading Guide

An engineering handbook for readers with basic Python experience

Prepared from the local repository on October 29 2026

## 1 What this guide helps you do

Read this repository as a set of connected engineering worksheets. The website collects inputs and obtains weather and price data. The building model calculates thermal demands. The equipment model selects units and converts delivered loads into equipment energy. Billing and emissions calculations use that energy afterward.

The central distinction is between **building demand**, **equipment delivery**, and **purchased energy**. These quantities live in different objects and different files. Following those boundaries makes the program much easier to understand than reading every file from the top of the folder tree.

You already know load calculations and equipment selection. This guide explains how the program represents those ideas, where to find them, how its TypeScript resembles Python, and what must be checked when making a change. It describes the implementation that is present in this checkout; it is not a claim of field-calibrated equipment performance.

The companion code annotations explain the purpose of functions, the units crossing a boundary, and the reason for important branches. They are source comments, so they do not appear on the website. The guide and annotations describe the existing calculation behavior.

Keep this Markdown document with the source. The Word handbook contains the same main material in a format suitable for reading or printing. The website's `public/engineering-guide.pdf` is a separate engineering reference about the equations; this handbook explains how the repository implements and connects them.

### A useful reading order

1. Read `lib/equipment.ts` to learn what an equipment combination means.
2. Read `lib/school.ts`, starting with the assumptions and `simulateSchool`.
3. Read `lib/solar.ts` and `lib/mixed-air.ts` for the two supporting physical calculations.
4. Read the cooling and heating evaluators, then `lib/equipment-model.ts`.
5. Read `lib/utility-billing.ts` and `lib/emissions.ts`.
6. Read `app/page.tsx` to see how the website connects those calculations.
7. Read the API routes and Python data-preparation scripts when you need to change a source or troubleshoot a connection.

Do not start by reading installed packages, generated place records, or every reusable visual component. They matter to the application, but they do not explain its heat balance.

## 2 The repository as an engineering system

The program has three operating areas. The **browser** holds the current user inputs and runs the load, mixed-air, equipment, billing and display calculations. The **server routes** locate places and obtain provider data while keeping credentials on the server. The **offline Python tools** prepare equipment datasets, place records and reference documents before the website runs.

The ordinary simulation path is:

```text
City and state
  -> locations API -> selected coordinates
  -> climate API -> weather CSV
  -> parseClimateCsv -> ClimateRow[]
  -> simulateSchool -> SchoolRow[]
  -> autosizePackaged -> PackagedSelection
  -> simulateEquipment -> EquipmentResult
  -> annualPerformance -> annual and monthly metrics
  -> result cards, graphs and CSV downloads
```

`[]` means a list or array. The same hourly position is retained through the weather, building and equipment arrays. For example, weather row 100, building row 100 and equipment row 100 refer to the same hour. Several exports combine them by array position, so changing row ordering in only one stage is unsafe.

The equipment fitting path is separate:

```text
Supplied equipment PDF
  -> Python extraction and fitting
  -> reviewed JSON coefficients and CSV records
  -> application data in lib/data
  -> TypeScript curve evaluation during a simulation
```

The browser does not run Python or fit a fresh curve for each simulation. It evaluates coefficients that have already been prepared.

## 3 How the folders are organized

| Folder or file | What it contains | How to approach it |
| --- | --- | --- |
| `app/page.tsx` | Main screen and calculation coordination | Read after the physical models |
| `app/api/` | Server endpoints for places, weather and location energy data | Read for connection problems |
| `components/` | Building and equipment forms, result cards and charts | Read when changing the interface |
| `components/ui/` | Reusable visual building blocks | Usually leave alone for engineering changes |
| `lib/` | Physical models, curve evaluators, parsing and billing logic | Main engineering reading area |
| `lib/data/` | Equipment JSON, EPA data and generated place records | Inspect schemas and a few records rather than every line |
| `public/` | Files served directly to visitors, including reference PDFs and CSVs | Refresh when associated data change |
| `scripts/` | Python preparation tools, JavaScript checks and launch helpers | Read the relevant tool before running it |
| `wrangler.jsonc` | Direct Cloudflare Worker configuration | Hosting name entry point and runtime compatibility |
| `docs/HOSTING.md` | Local setup secrets and deployment instructions | Read before running or publishing |
| `db/`, `drizzle/`, `examples/d1/` | Optional database scaffold and examples | Not part of the current analysis path |
| `docs/` | This repository handbook | Start here and keep it with the code |
| `package.json` | JavaScript dependencies and named commands | Read before installing or launching |
| `tsconfig.json` | TypeScript/compiler configuration and import aliases | Consult when an import or type check fails |

Folders such as `node_modules`, `dist`, `.wrangler`, `.sites-runtime`, `work` and `outputs` have different roles. `node_modules` contains installed dependencies. `dist` is a generated build. `.wrangler` holds current local runtime state. An older ignored `.sites-runtime` cache may remain on an existing machine, but no project command reads it. `work` and `outputs` are ignored working areas that may exist on this machine but are not guaranteed to exist in a fresh clone.

The original equipment PDFs are not bundled with the public website. A fresh clone therefore has the application datasets but may not have the PDFs or scientific-Python dependencies needed to reproduce those datasets.

## 4 Reading TypeScript with Python knowledge

Most application files end in `.ts` or `.tsx`. TypeScript is JavaScript with declarations that let a compiler check the kinds of values passed around. `.tsx` also permits JSX, the HTML-like screen descriptions used by React. Python remains the language of the extraction and fitting scripts.

### Syntax you will encounter frequently

| TypeScript expression | Python comparison | Meaning in this repository |
| --- | --- | --- |
| `const x = value` | `x = value` | Create a binding that cannot be reassigned |
| `let x = value` | `x = value` | Create a binding that may be reassigned |
| `number` | `float` or `int` | Numeric value; units still need comments or field names |
| `SchoolRow[]` | `list[SchoolRow]` | Array of hourly building records |
| `{ heating: 70 }` | `{"heating": 70}` | Object with named fields |
| `row.heating` | `row["heating"]` | Read a named field |
| `number \| null` | `float \| None` | A number or an explicitly unavailable value |
| `===`, `!==` | `==`, `!=` | Equality or inequality without coercing types |
| `&&`, `\|\|`, `!condition` | `and`, `or`, `not condition` | Boolean logic, with short-circuit evaluation |
| `x ** 2` | `x ** 2` | Exponentiation |
| `Math.max(0, x)` | `max(0, x)` | Limit a load to zero or greater |
| `test ? a : b` | `a if test else b` | Conditional expression |
| `value ?? fallback` | Explicit check for `None` | Use fallback only for null or undefined |
| `object?.field` | Check object before field access | Return undefined when the object is absent |
| `value!` | No direct runtime equivalent | Tell TypeScript that the value is present |

The last expression is especially important. In `r.sensibleCooling!`, the exclamation mark is a compiler assertion and does not change the number. In `!validCooling(r)`, it is a Boolean negation. They look similar but do different jobs.

`const` does not make an object immutable. The code normally replaces React input objects with copies so that changes are visible to React. The spread expression below copies the old fields and replaces one value:

```typescript
onSchool({ ...school, heatingF: 68 });
```

A Python comparison is:

```python
new_school = {**school, "heatingF": 68}
on_school(new_school)
```

### Mapping filtering and summing

`map` transforms every array item, `filter` keeps selected items, and `reduce` combines items into one result. They are familiar operations written with a different syntax:

```typescript
const temperatures = rows.map(row => row.temperatureF);
const heatHours = rows.filter(
  row => row.heating !== null && row.heating > 0
);
const total = values.reduce((sum, value) => sum + value, 0);
```

```python
temperatures = [row["temperatureF"] for row in rows]
heat_hours = [row for row in rows
              if row["heating"] is not None and row["heating"] > 0]
total = sum(values)
```

An arrow function such as `row => row.heating` is a short function. Destructuring such as `const { count, model } = selection` extracts named fields. An `export` makes a function available to other files; an `import` brings it into the current file. The `@/` import prefix resolves from the repository root through the TypeScript configuration.

### Asynchronous code

`async` functions return a Promise, which represents a result that will be available later. `await fetch(...)` waits for a network response without treating it as an immediate local value. Provider failures must be handled with `try/catch` or a settled result.

In the location-energy route, `Promise.allSettled` starts independent provider operations and records whether each succeeded. This is why an unavailable gas-price connection does not automatically erase electricity tariff or EPA region information.

## 5 The three main hourly records

Follow the objects before following the screen. Their type declarations are a compact description of the calculation inputs and outputs.

| Record | Defined in | Main contents |
| --- | --- | --- |
| `ClimateRow` | `lib/csv.ts` | Timestamp, Celsius dry bulb, percent RH and irradiance |
| `SchoolRow` | `lib/school.ts` | Climate fields plus building heat/moisture demands and zone conditions |
| `EquipmentHour` | `lib/equipment-model.ts` | Delivered/unmet loads, available capacity, COP, fan quantities and energy |
| `PackagedSelection` | `lib/equipment-model.ts` | Catalog model, count, supply airflow, reference capacity and coverage |
| `EquipmentResult` | `lib/equipment-model.ts` | Scenario, selection, hourly array, error and summary |
| `AnnualPerformance` | `lib/utility-billing.ts` | Monthly and annual energy, cost, emissions and availability reasons |

An `EquipmentScenario` is an input choice, not a calculated result. It identifies heating type, required cooling choice, efficiency family, gas efficiency and the internal curve-range policy. `newScenario` creates these choices and `scenarioName` derives the display name.

### Units and signs to keep beside you

| Quantity | Representation |
| --- | --- |
| Imported weather temperature | Celsius in `ClimateRow.temperature` |
| Outdoor and entering curve temperatures | Fahrenheit in fields ending in `F` |
| Solar irradiance | W/m² |
| Building heating demand | Positive BTU/hr |
| Stored sensible and latent cooling demands | Zero or negative BTU/hr |
| Equipment cooling demand used internally | Positive BTU/hr after sign conversion |
| Available delivered and unmet capacities | BTU/hr |
| Hourly equipment electricity | kWh for one hour |
| Hourly gas input | Therms for one hour |
| Humidity ratio | kg/kg or lb/lb dry air, numerically equivalent ratios |
| Annual site energy | MMBtu |
| Emissions helper output | kg CO₂e |
| Annual emissions display | Metric tonnes CO₂e |

`null` is an engineering availability statement. A valid zero means no use or no load. An unavailable value means the program cannot establish the quantity from the available inputs. Replacing null with zero can produce an apparently complete but incorrect annual result.

## 6 Reading the building load model

Open `lib/school.ts` and locate these symbols in order: `SCHOOL_AREA`, `DEFAULT_SCHOOL`, `SCHOOL_FIELDS`, `validateSchool`, `simulateSchool`, `summarizeLoads` and `schoolCsv`.

The modeled floor area is the constant `SCHOOL_AREA`, currently 150,000 ft². The internal filename reflects an earlier building use; it is the active single-zone building model. A floor-area change is therefore different from changing a value in `DEFAULT_SCHOOL`: the constant is used by ventilation, envelope, internal gains, geometry and exported metadata.

`DEFAULT_SCHOOL` contains thermostat, occupancy, outdoor-air, internal-gain and solar-geometry assumptions. `SCHOOL_FIELDS` provides form labels, units, limits and input increments. If you add an editable assumption, you need its model field and its form definition, not just a new textbox.

`validateSchool` checks individual ranges and relationships. Heating setpoints must be below cooling setpoints. Unoccupied conditions must represent setbacks in the expected direction. Occupied start time must precede the end time. A returned string is the reason an input set cannot be used; a returned null means the assumptions passed these checks.

### One hour through simulateSchool

1. Determine weekday and whether the hour is occupied. The model uses the weather calendar, weekday occupied hours and reduced June–August occupancy.
2. Calculate occupants, scheduled ventilation, infiltration and active thermostat setpoints.
3. Convert outdoor temperature to Fahrenheit and calculate the overall heat-transfer coefficient.
4. Calculate solar gain, lighting gain, equipment gain and occupant sensible gain.
5. Calculate sensible cooling and heating demands with the steady-state balance.
6. Estimate zone dry bulb from a free-float balance limited by the active setpoints.
7. Calculate latent cooling from outdoor-air moisture and occupant moisture.
8. Store cooling demands with negative signs and heating with a positive sign.

The following is a readable equivalent of the key coefficient calculation, using the variable names an engineer would put on a worksheet:

```python
infiltration_cfm = ach * floor_area * height / 60
ventilation_cfm = people * cfm_per_person + floor_area * cfm_per_ft2
outdoor_cfm = infiltration_cfm + ventilation_cfm
K = envelope_ua_per_ft2 * floor_area + 1.08 * outdoor_cfm
```

Scheduled ventilation is off outside occupied hours; infiltration remains in all hours. The code also applies fractional summer occupancy, so do not copy the example as an unconditional all-hour ventilation instruction.

The internal gain schedules retain 10% of full lighting and 25% of full equipment power when unoccupied. Their watts become sensible heat in the load balance. The equipment-energy result does not separately bill those lighting and plug-load watts.

### A numerical load example

For a hypothetical hour with `K = 10,000 BTU/hr/F`, outdoor DB 90°F, cooling setpoint 75°F and total sensible gains of 100,000 BTU/hr, sensible cooling demand is 250,000 BTU/hr. The stored `sensibleCooling` field is −250,000. If the heating setpoint is 70°F, heating demand is zero for that same example.

The signed cooling balance is retained before clipping. It is used later when fan heat is added. This matters during ventilation-only operation: enough fan heat can create a cooling requirement, but the thermostat deadband must be respected.

For latent demand, outdoor and indoor humidity ratios are converted to grains/lb for the `0.68 × CFM × Δgrains` expression. Occupant latent heat is added. A negative net moisture contribution is limited so the model does not invent humidification demand.

## 7 Solar gain and psychrometrics

`lib/solar.ts` reads the weather grid coordinates and UTC offset with `solarLocation`. These may differ from the searched city-center coordinates. It estimates solar position at the hourly midpoint, then resolves irradiance onto four rotated vertical faces and a horizontal roof.

The rectangular footprint comes from floor area divided by stories and the entered plan aspect ratio. Window gains use glazing area, SHGC and the solar multiplier. Opaque gains use the sol-air temperature effect from absorptance, irradiance and the exterior film coefficient.

The roof and wall U-values in this solar calculation affect the added opaque solar term. The entered total envelope UA continues to control ordinary outdoor-temperature conduction. Changing both without understanding that split can alter two different parts of the load balance.

`school.ts` also contains saturation-pressure, dew-point and humidity-ratio functions. They use Celsius internally. `mixed-air.ts` uses those relations and an enthalpy equation to obtain entering wet bulb. These functions return null for invalid or unsupported physical states rather than guessing a replacement.

A zero-irradiance hour can have a valid zero solar gain without solar-position metadata. A positive-irradiance hour requires usable coordinates and time-zone metadata. Missing radiation is different from nighttime zero radiation.

## 8 Mixed entering air

Read `airContext`, then `mixAir` in `lib/mixed-air.ts`. `airContext` prepares outdoor and return humidity ratio and enthalpy. Return DB is the free-float zone estimate limited by active setpoints; return RH is the entered indoor target.

`mixAir` compares installed supply CFM with scheduled mechanical ventilation. If supply airflow is inadequate or the inputs are invalid, it returns null. Otherwise the outdoor fraction is ventilation divided by installed supply airflow.

For a hypothetical supply of 4,000 CFM and scheduled ventilation of 400 CFM, the outdoor fraction is 0.10. The mixed humidity ratio is 90% return plus 10% outdoor, and mixed enthalpy is blended with the same fractions. The program then solves mixed dry bulb from enthalpy and humidity ratio and inverts the wet-bulb relation by bisection.

Wet bulbs and relative humidities are not directly averaged. CFM fractions approximate dry-air mass fractions at standard conditions. Infiltration remains in the building-load calculation but is excluded from this rooftop mixer.

Installed airflow equals unit count multiplied by the catalog's fixed maximum cooling airflow per unit. This explains why sizing and mixed-air calculation interact: a different count changes outdoor-air fraction and coil entering conditions. A capacity check made before updating that airflow would use the wrong entering state.

Supply-fan heat is applied later in the sensible/heating balances. It is not added to entering air again in this mixer.

## 9 Equipment curves and ratings

The three equipment JSON datasets have different jobs. Keep those jobs distinct when adding or replacing data.

| Application dataset | Runtime reader | Role |
| --- | --- | --- |
| `lib/data/precedent-cooling.json` | `packaged-cooling.ts` | Per-unit gross cooling capacity and SHR fits |
| `lib/data/precedent-heating.json` | `packaged-heating.ts` | Per-unit net heating capacity and total kW fits |
| `lib/data/precedent-unit-ratings.json` | `unit-ratings.ts` | Nominal cooling system kW and inferred fan component |

The internal dataset filenames are retained source identifiers. The user-facing reference downloads use generic `packaged-` filenames. Do not rename data files without also updating their imports and preparation tools.

### Cooling evaluator

`coolingPoint` takes outdoor DB, entering WB and entering DB in Fahrenheit. It checks the valid domain, creates normalized temperature variables and forms polynomial terms. A coefficient/term dot product gives normalized capacity. Multiplication by the unit's reference capacity gives gross BTU/hr.

The normalized reference is outdoor 95°F, entering WB 67°F and entering DB 80°F. The reference capacity is supplied for each model at its fixed airflow; it is not simply nominal tons times 12,000. The SHR numerator is evaluated and divided by the capacity normalization, then limited to the physical range zero through one.

### Heating evaluator

`heatingModelFor` matches nominal size and efficiency family, permitting a shared heating table where the source uses one. `heatingPoint` evaluates fourth-degree normalized capacity and second-degree normalized power terms. Both are anchored at outdoor 47°F and entering DB 70°F.

Heating outputs follow the catalog basis: integrated net capacity and total power at nominal airflow, including the table's fan and defrost treatment. The equipment model separates its inferred fan contribution before applying hourly coil duty. The heating COP is calculated from fitted net capacity divided by fitted total power after the BTU/hr-to-kW conversion.

### Nominal cooling input and fan lookup

`unitRatingFor` matches size and efficiency family. Nominal total cooling kW is held constant at full output because no operating-temperature power correction is supplied. The inferred supply-fan heat is rated gross capacity minus rated net capacity. Inferred fan kW is that heat divided by 3412.141633.

This fan estimate is not motor nameplate horsepower converted to operating watts. It is also not corrected by an airflow fan law. These distinctions explain why an hourly capacity curve and a nominal power rating can be combined only as a screening estimate.

## 10 Temperature range policy

The strict curve evaluators and the operating evaluators are separate on purpose. `coolingPoint` and `heatingPoint` accept only covered inputs. `operatingCoolingPoint` and `operatingHeatingPoint` apply the selected internal range policy.

Bounded screening is the scenario default. It first tries actual conditions. If necessary, it evaluates at covered boundary conditions. Strict mode instead returns null. The policy is represented in `EquipmentScenario.rangeMode`; the current interface does not expose a separate range-mode input panel.

Heating coverage is rectangular, so bounding individual axes is enough. Cooling includes a more restrictive sloping face for the 25-ton models. `closestCoolingInput` projects onto the full covered domain in normalized fit coordinates; a simple rectangular limit could still leave a point outside that domain.

The variables `curveOutdoorF`, `curveWetF` and `curveDryF` record where the equipment curve was evaluated. Actual weather and mixed entering conditions are retained separately. Changing a curve input for screening does not change the physical weather used to calculate the building load.

Cooling source coverage is generally outdoor 85–125°F, entering WB 61–73°F and entering DB 75–90°F. Standard 10-ton outdoor coverage ends at 120°F. Heating source coverage is outdoor −8–72°F and entering DB 40–80°F. Boundary-held performance beyond those limits is an estimate; cold-weather heating performance can be overstated.

## 11 How automatic selection works

Open `autosizePackaged` in `lib/equipment-model.ts`. It enumerates catalog sizes in the selected efficiency family and scans integer unit counts for each size. It is a search through discrete candidates, not a continuous optimization of dollars or energy.

The smallest candidate count must accommodate peak scheduled ventilation using the catalog maximum cooling CFM per unit. Reference-condition capacity produces a search scale. Each candidate then recalculates mixed entering air and fan heat before checking sensible cooling, latent cooling and, for heat-pump heating, net heating capacity.

Cooling is checked by component: sensible availability is installed gross capacity times SHR; latent availability is installed gross capacity times one minus SHR. A unit can have enough total cooling and still fail the latent or sensible requirement.

The model sorts large demand hours early so an undersized candidate can be rejected quickly. For each size it retains the first count that passes the available checks. Across those candidates, it prefers fewer unavailable checks, then fewer units, then less nominal tonnage. This order can favor one large unit over several smaller units. It does not compare first cost, annual cost, redundancy, staging quality or installation constraints.

No sizing percentage margin is applied. A 1 BTU/hr shortfall tolerance is used in candidate checks. The count search has a protective upper limit: the smaller of 10,000 and the larger of the ventilation minimum plus 50 or sixteen times the reference estimate. If the search does not produce a passing operating selection, a labeled reference estimate can remain; hourly delivery and unmet-load results still need review.

Gas and resistance cases select packaged units for cooling and ventilation. Their separate heating coil/element output is sized from the maximum heating demand remaining after fan-heat credit.

## 12 One hour through the equipment model

`simulateEquipment` obtains a selection, its unit rating and installed fan quantities. It calculates each hour using `rows.map`, keeping the result aligned with the building row.

The fan runs for the full hour when there is a building heating call, sensible/latent cooling call or scheduled ventilation call. It is off otherwise. Coil duty is allowed to be less than one while the fan remains on for the entire call hour.

`fanAdjustedLoads` credits operating fan heat against heating and adds it to the signed sensible cooling balance. Latent demand is unchanged. The signed balance matters because adding heat to an already negative cooling balance may still leave no cooling demand.

### Cooling duty example

Consider a hypothetical installed gross cooling capacity of 100,000 BTU/hr, SHR 0.75, nominal system input 10 kW, and inferred fan input 1 kW. Fan heat is 3,412.141633 BTU/hr. Suppose sensible demand after fan heat is 45,000 BTU/hr and latent demand is 10,000 BTU/hr.

Sensible availability is 75,000 BTU/hr and latent availability is 25,000 BTU/hr. The two required duty fractions are 0.60 and 0.40, so duty is 0.60. Gross cooling delivered is 60,000 BTU for that one-hour record. Cooling electricity excluding the supply fan is `(10 - 1) * 0.60 = 5.4 kWh`. Adding the full-hour fan gives 6.4 kWh total cooling-mode electricity.

Full-output net COP is approximately 2.83. Operating net COP is approximately 2.59 because delivered net cooling is 60,000 minus fan heat, while fan input is not reduced with coil duty. The two COP fields answer different questions; they should not be expected to match at part duty.

### Heating duty example

For a hypothetical unit with net catalog heating capacity 31,000 BTU/hr, total catalog power 2.6 kW and inferred fan heat 1,000 BTU/hr, fan input is about 0.2931 kW. At a building heating load of 15,500 BTU/hr, the coil must supply 14,500 BTU/hr and its available capacity is 30,000 BTU/hr.

Heating coil duty is `14500 / 30000`. The program duty-scales the nonfan heating input, then adds the full-hour fan once. Total electricity is about 1.408 kWh for the hour. Delivered building heat is 15,500 BTU and unmet heat is zero. The reported full-output heating COP still uses the catalog net heat and total power, approximately 3.49 for these illustrative values.

For gas at 80% entered heating efficiency, 14,500 BTU/hr of heater output uses 0.18125 therm for that hour, plus fan electricity. For resistance, element electricity plus the fan electricity equals the 15,500 BTU delivered divided by 3412.141633, approximately 4.543 kWh.

Duty is limited to one. An overloaded unit records unmet heating or component cooling rather than receiving unlimited capacity. There is no hidden auxiliary heater or reheat correction. Review unmet hours alongside energy totals: a low-energy case that does not meet the load is not an equivalent service comparison.

## 13 Annual energy cost and emissions

`completeCalendar` and `annualPerformance` protect the annual calculation. A complete non-leap analysis requires 8,760 unique valid hourly timestamps, correct row alignment and complete required electricity/gas values. The program does not establish completeness merely by counting rows.

Available-hour component subtotals are not necessarily annual totals, and different subtotals can cover different hours. The fan subtotal is already included in complete-hour total electricity. Adding it again would double count energy.

`annualPerformance` converts complete equipment energy to site MMBtu, applies electricity billing, calculates monthly gas cost, and calls the emissions functions. A complete annual record can include explicitly recorded boundary estimates. Completeness of the record is different from validation of manufacturer performance at every actual condition.

### Electricity billing

`tierCharge` applies cumulative tier limits. For a hypothetical first tier of 100 kWh at $0.10/kWh and an unlimited second tier at $0.20/kWh, 150 kWh costs $20. A tier's maximum is a cumulative limit, not the width of the tier.

`electricityBill` groups consumption by month and time-of-use period. It sums kWh for energy charges and takes peak hourly-average kW for demand charges. Fixed charges and minimum-bill top-ups are separate. Unsupported tariff terms can prevent a total estimate. Actual short-interval utility billing demand can differ from an hourly-average model.

An entered manual rate replaces API electricity pricing. It does not receive extra demand, fixed or minimum charges from the selected API tariff. A valid zero manual rate is allowed; a blank rate is unavailable.

### Gas prices and emissions

The EIA connection supplies state commercial delivered prices in dollars/Mcf, not a full utility tariff. The billing code converts modeled therms to Mcf using the configured heat-content conversion. For each calendar month it selects the newest available supplied price for that month; the source period can differ from the weather year.

Electricity emissions use a bundled EPA region factor resolved from the selected coordinates. Gas emissions use the configured combustion factors. `energyEmissions` returns kilograms; annual display converts to metric tonnes. Emissions include the configured CO₂-equivalent treatment but do not add refrigerant leakage or upstream fuel impacts.

Cost and emissions depend on different inputs. Missing gas prices can block gas cost without blocking fuel energy. Missing electricity factors can block emissions without blocking equipment kWh. Follow the returned reason fields rather than replacing unavailable outputs with zero.

## 14 How the screen connects the calculations

`app/page.tsx` is the coordinator. A React component is a function that describes a screen. `useState` holds values between renders. A setter such as `setSchool` requests a state change and a new render. `useMemo` caches a derived value until its listed inputs change. It does not make the cached result permanent.

The engineering path is concentrated in three named values: `schoolRows`, `packagedSelections` and `comparisonResults`. They call the building, sizing and equipment functions you have already read. The sizing-request key avoids repeating the expensive selection search for combinations with equivalent cooling/heating sizing requirements.

The `stage` value controls the search/loading screen: idle, locating, choosing, loading, ready, error or unsupported. `startQuery` validates inputs and asks the locations API for matches. `fetchClimate` retrieves and parses the selected weather CSV. The `AbortController` cancels obsolete requests so an older response cannot overwrite a newer search.

Below the component's `return`, JSX describes headings, forms, tables and result components. An expression inside braces inserts a calculated value. A component such as `<EquipmentScenarios ... />` is a function-like visual building block supplied with arguments called props.

Building characteristics and assumptions is the single collapsible default/custom input panel. Its `onSchool` callback replaces the parent's assumptions object. Equipment, year, location, utility and ZIP inputs are directly editable. Input components collect choices; the physical calculations remain in `lib`.

`components/location-energy.tsx` fetches location pricing/EPA context. It waits for the user to apply selections with Load results before producing the annual performance objects. `annual-scorecard.tsx` and `performance-graphs.tsx` format those objects. Changing a chart label there should not change a capacity or energy equation.

`components/school-model.tsx` is a retained alternative editor. The active page imports `AnalysisAssumptions`, not that component. Search for imports before assuming a similarly named file controls the current interface.

## 15 Server routes and connection settings

| Route | Main input | Main output |
| --- | --- | --- |
| `/api/locations` | City and state | Candidate places with coordinates |
| `/api/climate` | Coordinates state and year | Hourly weather CSV |
| `/api/location-energy` | Coordinates state and optional ZIP query value | Tariff gas-price and EPA context |

The place route searches bundled state records. It does not need a weather API key. Weather coverage is checked separately, so a place can be found without a supported climate dataset for that location.

The climate route reads NLR credentials from server bindings or process environment, validates requested coordinates/year, and requests the provider CSV. It permits only a specific trusted CSV download redirect. It checks size and header shape before returning the response. Error responses intentionally do not expose credential-bearing provider URLs.

`parseClimateCsv` then finds the hourly header after metadata lines, checks timestamps and converts weather readings into numeric/null fields. This parsing occurs before the building calculation.

The location-energy route obtains current electricity tariffs and recent state gas prices, while resolving EPA region data from bundled files. The current ZIP input triggers a context request but the route's actual EPA resolution uses coordinates; do not assume that typing a ZIP changes the polygon-selection algorithm. Verify route logic before describing or extending that behavior.

### Environment variable names

The routes look for `NLR_API_KEY` and `NLR_EMAIL` for the weather connection. `NLR_FULL_NAME` and `NLR_AFFILIATION` supply request metadata. `OPENEI_API_KEY` and `EIA_API_KEY` configure the tariff and gas-price connections. The EPA region data used by the route are bundled rather than fetched per analysis.

Configure these values through the local runtime's supported server environment or the hosting platform's secret settings. `.env*` files are ignored by Git. The safe `.env.example` file lists the expected variable names. Copy it to `.env` for local use and enter your own values. Never put real API keys into browser components or this handbook.

## 16 Reading and reproducing the Python preparation tools

The Python scripts are useful entry points because their mathematics will look familiar. Read the module description, input arguments and output paths first. Running a preparation script can replace data files; it is different from running an offline check.

### Cooling fitting

`scripts/fit-precedent-cooling.py` extracts the supplied PDF, selects the accepted maximum-airflow dataset, constructs the three-temperature design matrix, fits anchored capacity and the SHR numerator, evaluates holdout performance, and creates JSON/CSV/report outputs.

Its main numerical functions are `design`, `solve`, `predict` and `metrics`. The matrix has one row per fitting sample and one column per polynomial term. Capacity has a fixed reference coefficient of one. The SHR solve uses the capacity normalization as its denominator. Interior-temperature-plane validation refits using the remaining samples; it is not measured field validation.

### Heating fitting

`scripts/fit-precedent-heating.py` builds two-temperature terms through total degree four. Capacity uses that degree, while power uses terms through degree two with remaining coefficients zero. It calculates per-point results, validation metrics and dense-domain positivity checks.

The order of `POWERS` and `TERMS` must agree with `packaged-heating.ts`. A reordered coefficient list can produce incorrect results without a type error because every coefficient is still just a number.

### Nominal ratings and other preparation tools

`scripts/extract-unit-data.py` reads the supplied rating table, derives the fan component, and writes application JSON plus its public CSV directly. It is different from the fitting scripts, whose output directory must be promoted into application locations explicitly.

`scripts/build-city-index.py` reads a GeoNames US archive and writes state-partitioned records plus a loader/manifest. `scripts/build-engineering-guide.py` creates the public equation reference PDF. Neither is called during a visitor's simulation.

### Reproducing equipment data

The following commands are patterns. Replace the source paths with PDFs you actually possess. Run from the repository root in a Python environment with the required packages:

```text
python scripts/fit-precedent-cooling.py --source PATH_TO_COOLING_PDF
python scripts/fit-precedent-heating.py --source PATH_TO_HEATING_PDF
python scripts/extract-unit-data.py --source PATH_TO_FULL_RATING_PDF
```

The fitting scripts use ignored output folders by default. After reviewing their outputs, copy their `curve-fits.json` into the corresponding application JSON path and their coefficient/source/report files into the matching `public/references/packaged-...` paths. Refresh the public report and engineering guide when their stated metrics or equations depend on the new data. The runtime never automatically searches `outputs/` for the newest fit.

Python dependencies are separate from `package.json`. Fitting uses NumPy, SciPy where required, pypdf, and report/plot libraries. Installing JavaScript packages does not install those Python packages. Local ignored scientific packages used by a previous run may be absent in a new checkout.

## 17 Configuration hosting and generated files

`package.json` defines commands and dependencies. The source currently requires Node at least 22.13 and specifies pnpm 11.25.0. `pnpm dev` and `pnpm build` invoke Vinext directly. `pnpm start` previews the production build locally. `pnpm run deploy` builds and publishes to your own Cloudflare account when you explicitly run it.

`vite.config.ts` is the active build configuration. It combines Vinext and Cloudflare's runtime plugin, using the root `wrangler.jsonc` file. `next.config.ts` remains a minimal framework configuration; changing it is not the same as changing the Vite/Worker setup used by the project commands.

`wrangler.jsonc` declares the Worker name, entry point, compatibility date and Node compatibility flag. The build generates `dist/server/wrangler.json` for preview and deployment. `scripts/runtime-env.mjs` keeps local logs and registries under `.wrangler/`. No Sites plugin, hosting manifest or site-builder service is required. See `docs/HOSTING.md` for local credentials and direct deployment instructions.

`db/`, `drizzle/` and `examples/d1/` are optional database scaffolds. The active building analysis is not stored through that database code. A future use of `getDb` requires a real D1 binding named `DB` in `wrangler.jsonc`. The application does not require a sign-in service.

`dist` is generated output. Edit source, rebuild, and review the resulting output; changes made directly in `dist` will be overwritten. Generated place records and equipment JSON also need their corresponding preparation process when changing data, even though they are committed source assets rather than an ordinary build cache.

Uploading a repository to GitHub stores source. It does not configure hosting credentials or run the Worker API routes. A static file host alone does not implement the server routes in this application.

## 18 Running and checking a change

From a terminal in the repository root, use the project package manager to install dependencies if needed, start development, or build:

```text
pnpm install --frozen-lockfile
pnpm dev
pnpm build
```

The development command requests port 5173. Dependency installation and server startup are environment operations, not simulation steps. API-backed analyses still require the appropriate server environment settings. If the local toolchain is already installed and working, a comment-only edit does not require reinstalling it.

### Offline verification commands

| Command | What it checks |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Types imports and compiler consistency |
| `node scripts/check-school-model.mjs` | Building balance psychrometrics schedule signs and missing data |
| `node scripts/check-equipment-model.mjs` | Accepted fitting data curve evaluation sizing fans COP exports and controls |
| `node scripts/check-beast-scorecard.mjs` | Tariffs annual completeness costs emissions and result displays |
| `node scripts/check-location-energy.mjs` | Provider parsing region resolution and source-data conventions |
| `pnpm build` | Browser/server production compilation |

The scripts exercise actual source functions. They do not prove that external providers are currently reachable or that every real utility tariff is supported. A successful build proves compilation and packaging, not field accuracy or live-service availability.

`check-precedent-curves.mjs` and `evaluate-precedent-curves.mjs` are standalone fitting-package tools. They may expect an ignored `outputs/` bundle. Do not assume their default artifact exists in a fresh checkout; inspect their input-path logic first.

### A practical change sequence

1. Locate the input, calculation and display files for the quantity you want to change.
2. Make one engineering change at a time and identify its expected effect on a small example.
3. Check units, signs, null handling and gross/net definitions at each boundary.
4. Run the verification scripts appropriate to the affected calculation.
5. Run the type check and build, then inspect the actual screen when a preview is available.
6. Review the file diff, including any generated data and matching reference downloads.

For the annotations in this task, unchanged program behavior can also be checked by comparing compiler output without comments and by comparing parsed Python syntax trees. That catches accidental code changes hidden among explanatory comments.

## 19 Tracing a result that looks wrong

Start with a single timestamp and keep its index fixed. Read the original weather values, then the `SchoolRow`, then the `EquipmentHour`. Only after these are understood should you inspect the annual metrics.

| Observation | First place to inspect | Question to answer |
| --- | --- | --- |
| Heating or cooling load is unexpected | `simulateSchool` | Which schedule gains outdoor air and setpoints apply this hour |
| Entering wet bulb is unexpected | `airContext` and `mixAir` | What return state ventilation and installed supply CFM were used |
| Capacity is unexpected | Curve evaluator and model JSON | Which unit reference coefficients and evaluation temperatures apply |
| Selected unit count is unexpected | `autosizePackaged` | Was ventilation sensible latent or heating the limiting check |
| Electricity seems too high | `simulateEquipment` | Is the full-hour fan included once and is coil duty less than one |
| COP fields differ | Cooling COP calculations | Are you comparing full-output and operating net COP |
| Annual total is unavailable | `completeCalendar` and `annualPerformance` | Are all required hours aligned valid and complete |
| Cost is unavailable but energy exists | `electricityBill` and price context | Is the tariff supported and does each used gas month have a price |
| Graph disagrees with the CSV | Display mapping and export field lists | Are labels units rounding and selected combination consistent |

The exported metadata include model version, equipment choice, size/count, airflow, curve coefficients, assumptions and coverage. Hourly exports include actual entering conditions and the temperatures used by the curve policy. Use those records before assuming a displayed number came directly from a single catalog rating.

A CSV contains metadata lines before its hourly header. If opening it in Python, find that header rather than treating the first line as the hourly column names. `lib/csv.ts` follows this principle when importing provider data.

## 20 Where to make common changes

### Change building defaults

Edit `DEFAULT_SCHOOL` in `lib/school.ts`. If the allowed range or field label changes, edit `SCHOOL_FIELDS` as well. Confirm relationships between occupied and setback setpoints. Run the building checks and inspect the default/custom editor.

### Change floor area

The current area is `SCHOOL_AREA`, not an editable assumption. Before turning it into an input, trace every use in building loads, solar geometry and exported metadata. Introduce the field consistently rather than changing only the displayed floor-area text.

### Change a heat or moisture equation

Edit `simulateSchool` for building demand or `mixed-air.ts` for entering state calculations. Keep the output units/signs and availability behavior explicit. Use an analytical one-hour example and the independent psychrometric reference fixture to verify the change.

### Add equipment data

Start with source units, gross/net definitions, fan inclusion, airflow basis, temperature inputs and coefficient order. A new family may require changes to matching logic in `unit-ratings.ts` and `heatingModelFor`, not just a new JSON record. Ensure the chosen cooling model can be matched to all required power/heating data and that imports/evaluation domains are correct.

The present selection code expects the supplied packaged heat-pump schema. It is not yet a general adapter for every equipment technology. If a new manufacturer's identifiers can collide with existing size/family keys, extend the matching identity before adding records; the current rating lookup matches only size and efficiency family.

### Change sizing objectives

Edit the candidate evaluation and final comparison in `autosizePackaged`. Adding annual cost or energy as an objective would require simulation and pricing assumptions for each candidate; changing a displayed label does not perform that optimization.

### Change fan operation

Read `fanRuns`, `fanAdjustedLoads` and the heating/cooling energy branches together. Fan schedule changes affect ventilation delivery, sensible cooling, heating credit, duty and electricity. The fan cannot be independently changed in only the display or in only one mode without checking the shared balance.

### Add an hourly output

Add the field to `EquipmentHour` or `SchoolRow`, calculate it, then decide how to summarize, display and export it. In the equipment CSV, update both `keys` and `headers` in matching order. A type assertion cannot establish that a header describes the right numeric column.

### Change appearance

Edit the relevant component and `app/globals.css`. Keep engineering calculations in `lib`. User-facing copy should describe the current model and choices; implementation history and developer explanations belong in source comments and repository documentation.

## 21 File reference for engineering work

| File | Main symbol or responsibility |
| --- | --- |
| `lib/school.ts` | `simulateSchool` thermal and moisture demand |
| `lib/solar.ts` | `solarGains` solar contribution |
| `lib/mixed-air.ts` | `airContext` and `mixAir` entering conditions |
| `lib/packaged-cooling.ts` | `coolingPoint` strict capacity and SHR |
| `lib/packaged-heating.ts` | `heatingModelFor` and `heatingPoint` |
| `lib/curve-evaluation.ts` | Operating-temperature policy wrappers |
| `lib/unit-ratings.ts` | `unitRatingFor` power and fan lookup |
| `lib/equipment.ts` | Scenario inputs matching names and defaults |
| `lib/equipment-model.ts` | `autosizePackaged` and `simulateEquipment` |
| `lib/utility-billing.ts` | `electricityBill` and `annualPerformance` |
| `lib/emissions.ts` | `energyEmissions` and `totalCo2e` |
| `lib/location-energy.ts` | Provider schemas parsers and EPA geometry |
| `lib/csv.ts` | Provider CSV parsing and weather record type |
| `lib/places.ts` | `findPlaces` and local name matching |
| `lib/climate.ts` | State/year definitions and place contract |

### File reference for the interface

| File | What it controls |
| --- | --- |
| `app/page.tsx` | Main state network sequence and calculation connections |
| `app/layout.tsx` | Page shell metadata and global stylesheet |
| `components/analysis-assumptions.tsx` | Building defaults and custom editor |
| `components/equipment-scenarios.tsx` | Heating/cooling choices and selection cards |
| `components/location-energy.tsx` | Price/EPA selection application and result context |
| `components/annual-scorecard.tsx` | Annual result presentation |
| `components/performance-graphs.tsx` | Annual and monthly charts |
| `components/load-summary.tsx` | Building demand summaries and plots |
| `app/globals.css` | Application visual styling |

`components/ui`, `lib/utils.ts` and `hooks/use-mobile.ts` support reusable controls and layout. `vite.config.ts`, `wrangler.jsonc` and `scripts/runtime-env.mjs` configure compilation and hosting. Generated state-place modules and large EPA geometry files are best understood through their reader functions rather than hand-edited line by line.

## 22 Vocabulary and next reading steps

**API route:** a server function reached through a URL. **Binding:** a configured server resource or environment value. **Component:** a function describing part of a React screen. **Prop:** an argument passed to a component. **State:** values React preserves between screen renders. **Memo:** a cached calculation tied to specified inputs.

**Schema or type:** the expected fields and kinds of values in a record. **Null:** an explicit unavailable result. **Undefined:** a value or argument that was not supplied. **Callback:** a function passed to another function/component to report an event. **Promise:** a future result of an asynchronous operation.

**Build:** compilation and packaging of source into runnable browser/server output. **Dependency:** a library the project imports. **Fixture:** a known reference dataset used by a check. **Generated data:** records or coefficients produced by a preparation tool. **Runtime:** the environment that executes code, such as the browser, Node tooling or a Worker server.

For a first code session, trace one hour through `simulateSchool`, `mixAir` and `simulateEquipment` with the unit/sign table beside you. Next trace one monthly bill through `electricityBill`. Then read `app/page.tsx` to connect those functions to the controls. Use function names to navigate; line numbers move as the code is documented and maintained.

### Keeping the handbook current

This Markdown file is the editable manuscript. `scripts/build-repository-guide.py` generates `docs/BEAST_Repository_Guide.docx` from it using python-docx. Document-generation dependencies are separate from the website's Node dependencies. Refresh both copies when calculation boundaries, commands or active imports change, and visually review the Word document after regenerating it.
