The US city and town index is derived from the complete GeoNames US gazetteer,
downloaded on September 26, 2026 from https://download.geonames.org/export/dump/US.zip.

GeoNames (https://www.geonames.org/) makes this data available under the Creative
Commons Attribution 4.0 International license:
https://creativecommons.org/licenses/by/4.0/

Changes: selected active populated places and additional municipalities in the
50 US states and Washington, DC; normalized names and aliases for search;
partitioned records by state; retained source coordinates and county labels.
The data is provided as-is, without a guarantee of completeness or accuracy.

To regenerate, download the source archive to a temporary location and run
`python scripts/build-city-index.py /absolute/path/to/US.zip`.
