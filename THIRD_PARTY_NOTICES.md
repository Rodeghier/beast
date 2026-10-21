# PsychroLib

The saturation pressure coefficients and humidity-ratio relation in `lib/school.ts` are adapted from PsychroLib's implementation of ASHRAE Fundamentals equations. The dew/frost-point inversion uses an independent bisection implementation.

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

# NLR ComStock commercial heat-pump RTU data

`lib/data/rtu/comstock-standard.json` is an unmodified copy of ComStock™ standard-performance heat-pump rooftop lookup data, pinned to commit `f25ac375311acb2448b4ee1665a8680e92abd24b` from NatLabRockies/ComStock. COP regressions, airflow modifiers, part-load data, and control references are attributed to that source. Full source details and the file hash are in `lib/data/rtu/provenance.json`.

Source: https://github.com/NatLabRockies/ComStock

The complete redistribution license is included at `public/references/comstock-license.txt` and is served at `/references/comstock-license.txt`. Climate Table is an independent screening tool, not the ComStock software or an NLR-endorsed equipment selection. PsychroLib's wet-bulb humidity-ratio formulas are also used in `lib/rtu-curves.ts` under the MIT terms above.
