import { INTELLIPAK_COOLING_TABLES } from "./intellipak-performance";

export const EXTENDED_UNIT_TONS = [...new Set(INTELLIPAK_COOLING_TABLES.map(table => table.tons))];
export const LARGE_UNIT_BASIS = "IntelliPak cooling uses size- and efficiency-specific gross total and sensible capacity tables. Heat-pump heating uses eFlex tables at reference airflow, interpolated at 55 tons and extrapolated above 60 tons in proportion to nominal tons at equivalent CFM/ton. Heating capacity above 60 tons is a screening estimate. Electrical input, fan power and fractional stages retain 25-ton proxy assumptions.";
