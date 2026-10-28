# PsychroLib

The saturation pressure coefficients and humidity-ratio relation in `lib/school.ts` are adapted from PsychroLib's implementation of ASHRAE Fundamentals equations. The dew/frost-point inversion uses an independent bisection implementation. The wet-bulb humidity-ratio equations in `lib/mixed-air.ts` are also adapted from PsychroLib; mixed-air enthalpy uses the corresponding ASHRAE relation.

Source: https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html

MIT License

Copyright (c) 2018-2020 The PsychroLib Contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

# EPA Power Profiler / eGRID data

`lib/data/egrid-2023.json` and `lib/data/egrid-zip-2023.json` contain selected data from U.S. EPA Power Profiler, pinned to commit `f42a47a958325f134a11e609eaa6612893ad3140`, eGRID2023 revision 2. Original source URLs and SHA-256 hashes are embedded in each file. EPA does not endorse this application.

Source: https://github.com/USEPA/power-profiler

Dataset documentation: https://www.epa.gov/egrid/summary-data

Source terms: https://github.com/USEPA/power-profiler/blob/f42a47a958325f134a11e609eaa6612893ad3140/LICENSE.md

The complete MIT license is preserved at `public/references/epa-power-profiler-license.txt`.

# Precedent packaged heat-pump cooling fits

`lib/data/precedent-cooling.json` contains derived gross-capacity and SHR fits from the user-supplied Trane Precedent cooling tables, document PKGP-PRC023F-EN, heat-pump tables 10-33. Dual-fuel tables are excluded. The source PDF hash, fit coefficients, validity domains, fixed maximum airflow are retained in the data. The derived fit report and coefficient CSV are served under `public/references/`. The full source catalog PDF is not bundled.

# Precedent packaged heat-pump heating fits

`lib/data/precedent-heating.json` contains derived integrated net-heating-capacity and total-power fits from user-supplied Heating_Cap.pdf, Trane PKGP-PRC023F-EN, tables 58-73, printed pages 86-95. Source hash, table/page provenance, nominal-airflow/ESP and 70% outdoor-RH basis, integrated fan/defrost effects, coefficients, errors and source flags are preserved. Derived COP is capacity divided by total electric input in consistent units. The coefficient, fit-summary and source-audit CSVs are served under `public/references/`. The source catalog PDF is not bundled. Trane's model-family key confirms WSK/WHK as standard/high heat pumps; size-only tables are shared across those families. Applying nominal-airflow heating data with the cooling airflow is explicitly marked as an uncorrected screening approximation.

# Precedent nominal cooling power and fan reference data

`lib/data/precedent-unit-ratings.json` derives 24 standard/high efficiency heat-pump records from user-supplied Unit_data_full.pdf, Trane PKGP-PRC023F-EN tables 6-7, printed pages 24-29. Source hash, published system kW, gross/net capacity, nominal/AHRI airflow, fan count and motor nameplate HP are retained. Fan heat is inferred from gross minus net rated capacity; fan kW assumes that electrical input becomes air heat. Nameplate HP is reference data and is not used as operating electrical input. The full document's fan-heat footnotes support the gross/net interpretation; the operating-watt estimate remains an approximation with no correction to maximum airflow. Derived records are served in `public/references/precedent-unit-ratings.csv`. No source PDF is bundled.
