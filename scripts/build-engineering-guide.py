"""Build the BEAST guide for supplied heating/cooling curves and mixed air."""
# REFERENCE PDF BUILDER. Writes public/engineering-guide.pdf from the content
# below and installed curve metadata. It documents the equations; it does not
# run a building simulation or modify the fitted coefficients.

from pathlib import Path
import json
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/engineering-guide.pdf"
HEATING_FITS = json.loads((ROOT / "lib/data/precedent-heating.json").read_text(encoding="utf-8"))["models"]
CAPACITY_ERROR = max(m["fit_metrics"]["capacity"]["max_relative_error_percent"] for m in HEATING_FITS)
POWER_ERROR = max(m["fit_metrics"]["power"]["max_relative_error_percent"] for m in HEATING_FITS)
HEATING_VALIDATION = max(m["interior_plane_validation"]["capacity_relative_rmse_percent"] for m in HEATING_FITS)
FONT, BOLD, MONO = "Helvetica", "Helvetica-Bold", "Courier"
if Path("C:/Windows/Fonts/arial.ttf").exists():
    pdfmetrics.registerFont(TTFont("GuideSans", "C:/Windows/Fonts/arial.ttf"))
    pdfmetrics.registerFont(TTFont("GuideBold", "C:/Windows/Fonts/arialbd.ttf"))
    pdfmetrics.registerFontFamily("GuideSans", normal="GuideSans", bold="GuideBold", italic="GuideSans", boldItalic="GuideBold")
    FONT, BOLD = "GuideSans", "GuideBold"
NAVY=colors.HexColor("#203B56"); TEAL=colors.HexColor("#286E64"); GRAY=colors.HexColor("#526477"); LIGHT=colors.HexColor("#EEF4F7")
styles = {
 "body": ParagraphStyle("body", fontName=FONT, fontSize=10, leading=14, textColor=GRAY, spaceAfter=9),
 "small": ParagraphStyle("small", fontName=FONT, fontSize=8.7, leading=12, textColor=GRAY, spaceAfter=7),
 "h1": ParagraphStyle("h1", fontName=BOLD, fontSize=24, leading=29, textColor=NAVY, spaceAfter=15),
 "h2": ParagraphStyle("h2", fontName=BOLD, fontSize=12.5, leading=17, textColor=TEAL, spaceBefore=10, spaceAfter=7),
 "eyebrow": ParagraphStyle("eyebrow", fontName=BOLD, fontSize=8, leading=11, textColor=TEAL, spaceAfter=8),
 "eq": ParagraphStyle("eq", fontName=MONO, fontSize=8.4, leading=12, textColor=NAVY, spaceAfter=4),
 "cell": ParagraphStyle("cell", fontName=FONT, fontSize=9, leading=12.5, textColor=GRAY),
 "th": ParagraphStyle("th", fontName=BOLD, fontSize=9, leading=12.5, textColor=colors.white),
}
story=[]
def p(text, style="body"): story.append(Paragraph(text,styles[style]))
def h(text): p(text,"h2")
def page(n,title):
    if n>1: story.append(PageBreak())
    p(f"BEAST / ENGINEERING GUIDE / EQUIPMENT / {n:02d}","eyebrow");p(title,"h1")
def eq(text):
    rows=[[Paragraph(escape(line),styles["eq"])] for line in text.splitlines()]
    t=Table(rows,colWidths=[504]);t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),LIGHT),("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]));story.append(t);story.append(Spacer(1,9))
def table(headers,rows,widths):
    data=[[Paragraph(escape(x),styles["th"]) for x in headers]]+[[Paragraph(escape(str(x)),styles["cell"]) for x in row] for row in rows]
    t=Table(data,colWidths=widths,repeatRows=1,hAlign="LEFT");t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),9),("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8),("ROWBACKGROUNDS",(0,1),(-1,-1),[LIGHT,colors.white]),("LINEBELOW",(0,0),(-1,0),.5,NAVY)]));story.append(t);story.append(Spacer(1,8))

page(1,"Heating and cooling combinations")
p("BEAST compares equipment combinations using the same hourly building loads. Heating options are Rooftop Packaged Heat Pump, Natural Gas and Electric Resistance. Cooling options are Rooftop Packaged Heat Pump and a provisional air-cooled chiller.")
table(["Heating selection","Cooling and sizing","Energy treatment"],[
 ["Heat Pump","Cooling is included automatically. Unit size and count check heating, cooling and scheduled ventilation.","Heating uses integrated capacity/power curves. Cooling uses each family’s nominal system kW with fan separated."],
 ["Natural Gas / CBLE-4D","Choose heat-pump cooling or the provisional chiller. Select small boiler (AFUE) or large commercial CBLE-4D hot-water ratings. Large boiler fuel choices are natural gas, propane and No. 2 light oil; firing mode is on/off (modulating is disabled). The large boiler auto-sizes to the smallest listed output meeting design demand.","Small boiler uses entered AFUE. CBLE-4D fuel use uses the selected fuel's listed consumption/hour multiplied by on/off runtime fraction. Propane and oil site energy are reported, but their costs and combustion emissions are not available. Supply-fan heat reduces boiler demand; fan electricity is added once. Chiller uses flat 0.6 kW/ton; separate air-handler fan and pump power are excluded."],
 ["Electric Resistance","Choose heat-pump cooling or the provisional chiller. Heat-pump units are sized for cooling/ventilation; the resistance heater is sized separately.","Heater input equals element output; fan electricity is separate for heat-pump cooling. Fan heat contributes to building heating. Chiller uses flat 0.6 kW/ton; separate air-handler fan and pump power are excluded."],
],[105,210,189])
h("Automatic labels")
p("There is no editable scenario-name field. Labels follow cooling and heating selections, for example: Heat Pump Cooling + Natural Gas Heating. The same labels appear in result cards, graphs and CSV downloads.")
h("Supplied data and coverage")
p("The supplied cooling tables provide 24 standard/high efficiency cooling-capacity and SHR fit pairs. The supplied heating tables provide 16 heating-capacity/total-power tables. The supplied unit ratings provide nominal cooling system power and gross/net rated cooling capacities for 24 model ratings across both efficiency families, from 3 to 25 tons.")
p("Both standard and high efficiency use their own supplied nominal cooling system power. The full source also lists fan motor nameplate horsepower; that is retained as reference data and not treated as operating electrical watts. All rating-based power and fan estimates remain provisional because an airflow/operating-condition correction is unavailable.")
page(2,"Provisional air-cooled chiller")
h("Flat-efficiency placeholder")
eq("Nominal chiller capacity (tons) = ASHRAE design-day total cooling load (Btu/h) / 12,000\nHourly chiller electricity (kWh) = delivered cooling (Btu/h) / 12,000 x 0.6 kW/ton x 1 h")
p("The placeholder autosizes nominal capacity to the ASHRAE design-day total cooling load, then uses flat 0.6 kW per ton of delivered cooling at every condition. It has no manufacturer performance curves. Separate air-handler fan and chilled-water pump electricity are excluded. Replace this assumption when chiller selection and performance data are available.")

page(3,"Calculated mixed-air conditions")
h("Outdoor air and return air")
p("Outdoor dry bulb and RH come from the weather file. Return-air dry bulb is the building free-float temperature limited by its active heating/cooling setpoints; return RH uses the building indoor RH target. This assumes a zone humidity condition rather than resolving moisture storage. Standard pressure is 101,325 Pa.")
p("The mixer uses scheduled mechanical ventilation only. Infiltration remains in the building loads and is excluded from the rooftop outdoor-air mixer. Selected supply airflow is the number of units times the maximum listed cooling CFM per unit: 480 CFM per nominal ton.")
eq("Supply CFM = units x maximum listed cooling CFM per unit\nf = scheduled ventilation CFM / supply CFM\nWmix = (1 - f) x Wreturn + f x Woutdoor\nhmix = (1 - f) x hreturn + f x houtdoor")
p("CFM fractions approximate dry-air mass fractions at standard conditions. Supply airflow must accommodate scheduled ventilation. The fan runs for the full hour whenever ventilation is scheduled, so the average ventilation flow is not silently reduced by coil duty fraction.")
h("Entering dry bulb and wet bulb")
eq("h = 1.006 x T + W x (2501 + 1.86 x T)\nTmix = (hmix - 2501 x Wmix) / (1.006 + 1.86 x Wmix)")
p("These equations use Celsius, humidity ratio in kg/kg dry air and enthalpy in kJ/kg dry air. Convert the resulting dry bulb to Fahrenheit. Solve wet bulb from dry bulb and humidity ratio using ASHRAE water/ice relations and bisection. Wet bulb is calculated, not entered or averaged.")
p("Cooling fits use outdoor dry bulb, mixed entering wet bulb and entering dry bulb. Heating fits use outdoor and entering dry bulb only. Invalid or supersaturated mixtures remain unavailable. Fan heat is applied in the downstream sensible balance; no fan temperature rise is added to coil-entering air a second time.")
p("Psychrometrics are checked against 55 independent PsychroLib reference states plus return-only, outdoor-only and mixed-air humidity/enthalpy balances.","small")

page(4,"Nominal cooling power and fans")
h("Published power and inferred fan component")
p("The supplied general-data tables 6-7, printed pages 24-29, list cooling System Power (kW) for standard and high efficiency. It is used directly as the full-output cooling input for each size. No power-temperature curve was supplied, so this input is held constant instead of inventing an off-rating correction.")
eq("Fan heat F_unit = rated gross cooling - rated AHRI net cooling\nFan input P_fan_unit = F_unit / 3412.141633\nNon-supply-fan cooling input = P_system_unit - P_fan_unit\nInstalled values = units x unit values")
p("Fan heat and fan input are estimates inferred from the rating difference, assuming all fan electrical input becomes air heat. They are not a measured fan curve. Nominal and AHRI airflow are retained in the downloadable rating CSV; no fan-law scaling or motor-efficiency assumption is added.")
p("For the published 3-ton rating: gross is 38,000 BTU/hr, net is 37,000 BTU/hr, and system input is 3.36 kW. The inferred supply fan is 1,000 BTU/hr or 0.293 kW; remaining cooling input is 3.067 kW. Rated net COP is approximately 3.23. The capacity curves use maximum airflow, so their reference capacity can differ from this nominal rating.")
h("Cooling COP at full output and actual duty")
eq("Full-output net cooling = installed gross curve capacity - F\nFull-output net COP = net cooling / (3412.141633 x P_system)\nCoil duty / PLR d_c = min(1, max(S_fan / Q_sensible, L / Q_latent))\nBelow minimum stage m: PLR_m = d_c/m; PLF = 1 - Cd x (1 - PLR_m)\nRuntime_m = PLR_m / PLF; input fraction = m x Runtime_m\nAt/above minimum stage: input fraction = d_c (provisional proportional stage power)\nCooling kWh excluding fan = sum(P_nonfan_group x equivalent units_group)\nOperating net COP = max(0, delivered gross cooling - F)\n                    / (3412.141633 x (cooling kWh + fan kWh))")
p("For each hour, larger units lead. Each group stages/cycles against remaining sensible and latent loads; sum its nonfan kW times power-equivalent units. Both COP definitions are exported; the table shows full-output COP. Supply-fan input is separated from catalog total kW and counted once. Stage power is proportional to capacity; Cd = 0.15 applies below minimum stage.")
p("Cooling power and fan estimates have no off-rating correction. Nameplate HP is reference only; general-data heating ratings do not replace the detailed heating curves.","small")

page(5,"Heating curves and catalog basis")
h("Capacity, total power and COP")
p("The supplied heating tables 58-73 contain 1,628 capacity/power pairs. Normalize each model at 47 F outdoor / 70 F entering dry bulb. Capacity uses anchored fourth-degree least squares; total power uses an anchored second-degree polynomial, with higher coefficients zero.")
eq("x = (outdoor DB - 47)/40; y = (entering DB - 70)/20\nTerms = [1,x,y,x^2,xy,y^2,x^3,x^2y,xy^2,y^3,\n         x^4,x^3y,x^2y^2,xy^3,y^4]\nNet unit heat Q_h = Qref x sum(q[i] x term[i])\nTotal unit input P_h = Pref x sum(p[i] x term[i])\nFull-output heating COP = Q_h / (3412.141633 x P_h)")
p("Both normalized outputs equal 1 at the reference. COP is a ratio of fitted heat and total electrical input, not a separate assumed efficiency. Heating wet bulb is not an input.")
h("Source conditions and mapping")
p("Heating capacity is integrated net output. Total power and net capacity already include indoor fan effects at nominal CFM and the table's listed ESP; defrost is integrated and outdoor RH is fixed at 70%. No extra defrost term or outdoor-humidity correction is applied.")
p("Standard 3/4/5-ton units use tables 58-60; high-efficiency counterparts use 61-63. Standard 10-ton WSK uses table 67; high-efficiency WHK uses table 68. Other sizes share their size-only table across the two families. Dual-fuel equipment is excluded.")
h("Fit quality and validity")
p(f"Heating source coverage is outdoor -8 to 72 F and entering dry bulb 40 to 80 F. Screening estimates hold curve inputs at these limits when actual conditions are outside coverage; see page 6. Maximum source-point capacity error is {CAPACITY_ERROR:.2f}%; power error is {POWER_ERROR:.2f}%. Interior-plane holdout capacity relative RMSE reaches {HEATING_VALIDATION:.2f}%, conditional on retaining the known reference anchor.")
p("Applying nominal-airflow heating data with maximum cooling airflow remains an uncorrected approximation. For both efficiency families, the inferred fan is separated from integrated heating capacity/power before coil duty scaling; see the next page. The catalog’s fan operating point is not independently reproduced by this estimate.","small")

page(6,"Hourly fan heat and heater energy")
h("Fan schedule and thermal balance")
p("The supply fan runs for the full hour on any building heating call, sensible/latent cooling call or scheduled ventilation call. It is off otherwise. Its rated proxy kW does not follow compressor duty. This is a stated screening control assumption; actual cycling and continuous-fan controls can differ.")
eq("Fan kWh = installed P_fan x fan-on fraction (0 or 1)\nFan heat F = fan kWh x 3412.141633\nHeater demand = max(0, original heating demand - F)\nFan-adjusted sensible cooling S_fan = max(0, B_cool + F)")
p("B_cool is the signed building sensible balance before clipping at zero. This preserves the thermostat deadband and allows ventilation-fan heat to create a cooling load. Latent demand L is unchanged. Heating demand is a load; fan heat contributes to satisfying it and must not be billed as gas or element heat again.")
h("Heat-pump heating and electricity reconciliation")
eq("HP coil heat capacity = installed net Q_h - installed F_unit\nHP coil input = installed P_h - installed P_fan_unit\nHeat duty / PLR d_h = min(1, remaining heat demand / coil capacity)\nBelow minimum stage m: PLR_m = d_h/m; PLF = 1 - Cd x (1 - PLR_m)\nInput fraction = m x PLR_m/PLF; Cd = 0.15 (provisional)\nAt/above minimum stage: input fraction = d_h (provisional proportional stage power)\nHeating kWh = sum(coil input_group x equivalent units_group)\nTotal kWh = heating kWh + cooling kWh + supply-fan kWh")
p("No fan is added on top of integrated heating or total cooling system input. Coil components exclude the separately counted fan. The same decomposition is used for both efficiency families. Unmet heat is remaining load after capped delivery. No auxiliary heat or reheat is silently supplied.","small")

page(7,"Hot-water boiler model")
h("Non-condensing on/off hot-water boiler")
eq("Small boiler output capacity = ASHRAE design heater demand after fan heat credit\nSmall-boiler on/off runtime fraction = delivered output / capacity\nSmall-boiler gas therms = capacity x runtime / (100000 x entered AFUE fraction)\nLarge CBLE-4D size = smallest listed output meeting ASHRAE design heater demand\nCBLE-4D runtime fraction = delivered output / rated output\nSelected CBLE-4D fuel quantity = listed fuel consumption/hour x runtime fraction\nSite fuel input (Btu) = fuel quantity x listed fuel heating value")
p("The small-boiler path retains user-entered AFUE, applied as effective hourly efficiency with no additional cycling penalty. The large commercial path uses Cleaver-Brooks CBLE-4D hot-water ratings: select the smallest listed rated output that meets design demand after fan-heat credit, then scale the selected fuel's table consumption/hour by hourly runtime. Natural gas is reported in therms, propane in ft³ and No. 2 light oil in gal. Their fuel input is converted to site MMBtu using the source table's heating values. At demands above 800 HP rated output, cap delivery at the largest listed model and report unmet heat. Only on/off firing is available; modulating is disabled until firing-rate data are available. Propane and light-oil costs and combustion emissions are unavailable. The model does not recalculate building heating loads. Runtime fraction is exported and cycling share counts partial-hour firing, not starts. Return-water effects, standby losses and auxiliary power are not modeled. The boiler receives the selected cooling unit's fan-heat estimate.")
h("Electric resistance")
eq("Resistance element kWh = delivered heater output / 3412.141633\nDelivered building heat = min(load, heater output + fan heat)")
p("Resistance is unity efficiency at the element. It uses the selected cooling unit's supply-fan estimate. There is no heating-only comparison option.")

page(8,"ASHRAE design day sizing")
h("Station and design levels")
p("Sizes use published ASHRAE 2017 station design days, with defaults of 1% cooling and 99% heating. Alternatives are 0.4%/2% cooling and 99.6% heating in building assumptions. Results show the station and allow a nearby station choice. The server bundles 1,724 complete U.S. stations from the EnergyPlus public 2017 distribution. No annual maximum or annual-weather percentile enters sizing.")
p("Check 24-hour winter, DB/MCWB, WB/MCDB and DP/MCDB summer days. Summer uses the published daily range, default ASHRAE/EnergyPlus hourly profile, constant humidity ratio capped at saturation and ASHRAETau2017 clear-sky solar. Retain only occupied design hours and apply the entered June-August occupancy percentage to people, person-based ventilation and scheduled gains. Empty hours do not size equipment. Area-based ventilation and infiltration retain their physical calculations. Winter holds the occupied heating setpoint with no internal/solar gain credit. Ventilation follows occupied hours; infiltration remains active. The existing standard-pressure air basis is retained.")
h("Selection and annual operation")
p("Heat-pump size/count, boiler and resistance output, and chiller capacity use only the design-day loads. The selected installation is then simulated with actual annual hourly loads. An extreme annual hour can produce unmet heating or cooling without increasing installed size. Annual energy and utilization graphs continue to use every available weather-file hour.")
p("The nearest complete station is selected initially; choose a nearby station appropriate to local climate and elevation. Ten choices within 250 km are offered. Missing design data prevent sizing rather than falling back to annual peaks. The data edition, WMO station ID, station distance, design levels, temperatures, loads and source hash appear in equipment CSV metadata.")
h("Scope and source")
p("This remains a steady-state single-zone screening model, without thermal storage, detailed zoning or morning warm-up simulation. No additional sizing margin is added. Heat-pump heating or ventilation can govern selection even when the cooling load is lower. Model: equipment-mixed-air-16.0; building-solar-2.3.")
p('Numerical source: <link href="https://energyplushelp.freshdesk.com/support/solutions/articles/67000709369-2017-annual-design-conditions-definitions-for-all-ashrae-design-condition-locations" color="#286E64">EnergyPlus public ASHRAE 2017 design-condition distribution</link>. The catalog is reproducible with scripts/build-ashrae-design-data.py. Daily temperature and clear-sky solar methods follow the EnergyPlus climate calculations.',"small")
page(9,"Cooling curves and automatic sizing")
h("Three-temperature capacity and SHR")
p("The 24 cooling models use maximum listed airflow. Qref is gross cooling at 95 F outdoor / 67 F entering WB / 80 F entering DB for that airflow, not nominal tons times 12,000. Units and all curve temperatures are in Fahrenheit.")
eq("x=(outdoor DB-95)/20; y=(entering WB-67)/6; z=(entering DB-80)/10\nG=1+c1x+c2y+c3z+c4x^2+c5xy+c6xz+c7y^2+c8yz+c9z^2\nN=b0+b1x+b2y+b3z\nQ_total=Qref x G; SHR=clip(N/G,0,1)\nQ_sensible=Q_total x SHR; Q_latent=Q_total x (1-SHR)")
p("G is the fitted normalized gross-capacity polynomial; N is the normalized sensible-capacity numerator. Model-specific c and b coefficients are stored in the cooling data file. At reference conditions x=y=z=0, G=1 and N=b0.")
h("Design conditions and delivery")
p("Select a bank containing one or several catalog sizes. Minimize total unit count, then total nominal tonnage. At each attainable bank airflow, recalculate mixed air and solve integer counts using individual sensible/latent capacities and fan heat. Heat-pump heating adds a net heating check. Gas/resistance heaters are sized separately after fan heat credit.")
eq("Available sensible = sum(n_group x Q_group x SHR_group)\nAvailable latent = sum(n_group x Q_group x (1-SHR_group))\nS_fan = max(0, signed sensible balance + sum(n_group x fan heat))\nDispatch each group against remaining sensible and latent demand\nUnmet cooling = remaining sensible + remaining latent")
p("Installed sizes remain fixed during annual simulation; extreme hours can produce unmet loads without resizing. Unavailable design checks are ignored in selection and retained in coverage reports. No sizing margin is added. The optimizer runs in a browser worker; a search limit is labeled as the best feasible bank found with an unproven minimum. Each group keeps its own curves, power, stages and fan estimate. Annual unavailable energy stays blank.")
h("Curve domain")
p("Cooling entering WB is 61-73 F and entering DB 75-90 F. Outdoor DB is generally 85-125 F; standard 10-ton ends at 120 F. Both 25-ton fits require outdoor DB + 2 x entering DB <= 295. Screening mode evaluates the nearest covered point in the valid-point convex hull, using the normalized fit coordinates. Polynomials are not extrapolated. Actual weather and mixed air remain in the load calculation. Heating below -8 F may be overstated; extended data are needed for design sizing.")
page(10,"Unit stages and cycling")
h("Read unit operation separately from bank utilization")
p("The stage view selects a size group and units called to run, all installed units or one numbered unit. The default excludes fully idle unit-hours but retains cycling OFF time for called units. Unit numbers follow fixed lead/lag positions; controller rotation is not modeled. Supply fans are separate. Unit ON means at least one compressor is running.")
p("One equal unit at full output in a 20-unit bank is only 5% bank utilization. Heat-pump heating without auxiliary heat, latent cooling and ventilation can govern selection. Winter design takes no internal/solar gain credit while annual operation credits gains. The highest evaluated design loading table identifies which bank checks are closest to available capacity.")
h("Modeled stage and on/off time")
eq("Below minimum stage m: PLR_m = residual unit load / (m x unit capacity)\nPLF = 1 - 0.15 x (1 - PLR_m); ON fraction = PLR_m / PLF\nON minutes per hour = 60 x ON fraction; OFF = 60 - ON\nBetween stages: adjacent stage time fractions sum to 1; ON = 60 min\nFull lead units: highest stage; unused units: OFF")
p("The stage histogram adds fractional unit-hours at each modeled capacity stage and OFF. A unit-hour is one unit observed for one hour. The paired ON/OFF histogram counts unit-hours by their total ON and OFF minutes, in zero and ten-minute bins through 60. Stage time and each histogram series conserve included unit-hours; missing stage data are excluded.")
p("These are hourly, mode-specific estimates. They do not identify individual cycle lengths, starts per hour or individual-compressor switching. Stage power and heating-stage fractions retain the energy model's existing assumptions. Boiler burner charts use its on/off runtime. Resistance and the chiller placeholder have no supplied stage/switching model; use their capacity/power view.")
h("Trace the recorded values")
p("Per-group Equipment_group_performance_JSON includes stage levels, full and idle unit counts, residual unit stage-time fractions and runtime. Design_check_loading_JSON records evaluated bank design ratios. The charts read these records; they do not resize equipment or change modeled energy.","small")
page(11,"Interpretation, sources and checks")
h("Building and weather basis")
p("Total conditioned floor area and number of floors are editable; defaults are 150,000 square feet and two equal floors. Area includes all floors. Footprint = area / floors; conditioned volume = area x height per floor. Area scales conduction, infiltration, area-based ventilation and internal gains. Occupant count remains an entered building total. Hourly single-zone loads include scheduled occupancy and solar gains; lighting and plug electricity are excluded from equipment totals.")
eq("K = envelope UA + 1.08 x building outdoor CFM\nHeating load = max(0,K x (heating setpoint-outdoor F)-gains)\nSigned sensible cooling B_cool = K x (outdoor F-cooling setpoint)\n                               + gains")
p("Building outdoor airflow includes infiltration plus occupied ventilation. Only ventilation enters the equipment mixer. Latent loads follow outdoor-air and occupant moisture gains at the indoor RH target. Solar uses dataset coordinates and fixed local time, with GHI on roofs and projected DNI plus sky/ground radiation on walls.")
h("Annual metrics and missing data")
p("Total site energy combines electricity kWh x 3412.141633 / 1e6 and gas therms x 0.1 MMBtu/therm. Electricity prices use a supported tariff or entered rate; gas uses EIA monthly state commercial benchmarks. Emissions use EPA eGRID and gas-combustion factors. Missing tariffs, prices and factors block only dependent metrics.")
p("Annual totals require 8,760 unique, valid, complete hourly energy records. Screening estimates include boundary-held performance. The CSV records estimated-hour counts and the curve temperatures separately from actual weather and mixed air. Missing inputs remain unavailable; they are not zero. Check coverage and unmet loads alongside totals.")
h("Source and verification trail")
p('Supplied equipment datasets: cooling tables 10-33; heating tables 58-73; general-data tables 6-7, pages 24-29. Source hashes and dataset provenance are retained with the internal data records. The rating CSV distinguishes published system power from inferred fan values. Fan inference follows the gross/net method in the <link href="https://www.energycodes.gov/sites/default/files/2024-08/90.1_Secton_11_and%29_Appendix_G_Review_Manual_V04.pdf" color="#286E64">DOE submittal review manual</link>. Psychrometrics follow <link href="https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html" color="#286E64">PsychroLib / ASHRAE</link>.',"small")
p("Checks cover 1,628 heating points, all 24 nominal power values, fan inference, full-output power reconciliation, partial duty, gas/resistance heat credit, fan-only ventilation, fan-induced cooling, required cooling, automatic labels, source domains, both efficiency families, annual energy, CSVs and rendered controls. The guide does not resolve thermal storage, detailed zoning, actual cycle periods, fan curves or zone-by-zone controls.","small")

def footer(canvas,doc):
    canvas.saveState(); canvas.setStrokeColor(colors.HexColor("#D9E3EA"));canvas.line(54,43,558,43)
    canvas.setFont(FONT,8);canvas.setFillColor(GRAY);canvas.drawString(54,29,"BEAST | Equipment and mixed air | equipment-mixed-air-16.0");canvas.drawRightString(558,29,str(doc.page));canvas.restoreState()
SimpleDocTemplate(str(OUT),pagesize=letter,rightMargin=54,leftMargin=54,topMargin=45,bottomMargin=58,title="BEAST Engineering Guide - Equipment and Mixed Air",author="BEAST",subject="Selected heating/cooling, nominal system power, fans, autosizing and mixed air").build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)
