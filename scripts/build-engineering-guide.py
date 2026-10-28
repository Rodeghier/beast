"""Build the BEAST guide for supplied heating/cooling curves and mixed air."""
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/engineering-guide.pdf"
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
p("BEAST compares equipment combinations using the same hourly building loads. Heating options are Rooftop Packaged Heat Pump, Natural Gas and Electric Resistance. Each combination must include cooling; Rooftop Packaged Heat Pump is currently the only cooling option.")
table(["Heating selection","Cooling and sizing","Energy treatment"],[
 ["Heat Pump","Cooling is included automatically. Unit size and count check heating, cooling and scheduled ventilation.","Heating uses integrated capacity/power curves. Cooling uses each family’s nominal system kW with fan separated."],
 ["Natural Gas","A cooling selection is required. Heat-pump units are sized for cooling/ventilation; the gas heater is sized separately.","Entered AHUE / AFUE converts heater output to fuel. Supply-fan heat reduces fuel demand; fan electricity is added once."],
 ["Electric Resistance","A cooling selection is required. Heat-pump units are sized for cooling/ventilation; the resistance heater is sized separately.","Heater input equals element output; fan electricity is separate. Fan heat contributes to building heating."],
],[105,210,189])
h("Automatic labels")
p("There is no editable scenario-name field. Labels follow cooling and heating selections, for example: Heat Pump Cooling + Natural Gas Heating. The same labels appear in result cards, graphs and CSV downloads.")
h("Supplied data and coverage")
p("The supplied cooling tables provide 24 standard/high efficiency cooling-capacity and SHR fit pairs. The supplied heating tables provide 16 heating-capacity/total-power tables. The supplied unit ratings provide nominal cooling system power and gross/net rated cooling capacities for 24 model ratings across both efficiency families, from 3 to 25 tons.")
p("Both standard and high efficiency use their own supplied nominal cooling system power. The full source also lists fan motor nameplate horsepower; that is retained as reference data and not treated as operating electrical watts. All rating-based power and fan estimates remain provisional because an airflow/operating-condition correction is unavailable.")
p("Model: equipment-mixed-air-4.0. Building: building-solar-3.0. These are equipment screening estimates, not a detailed controls or sizing simulation.","small")

page(2,"Calculated mixed-air conditions")
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

page(3,"Nominal cooling power and fans")
h("Published power and inferred fan component")
p("The supplied general-data tables 6-7, printed pages 24-29, list cooling System Power (kW) for standard and high efficiency. It is used directly as the full-output cooling input for each size. No power-temperature curve was supplied, so this input is held constant instead of inventing an off-rating correction.")
eq("Fan heat F_unit = rated gross cooling - rated AHRI net cooling\nFan input P_fan_unit = F_unit / 3412.141633\nNon-supply-fan cooling input = P_system_unit - P_fan_unit\nInstalled values = units x unit values")
p("Fan heat and fan input are estimates inferred from the rating difference, assuming all fan electrical input becomes air heat. They are not a measured fan curve. Nominal and AHRI airflow are retained in the downloadable rating CSV; no fan-law scaling or motor-efficiency assumption is added.")
p("For the published 3-ton rating: gross is 38,000 BTU/hr, net is 37,000 BTU/hr, and system input is 3.36 kW. The inferred supply fan is 1,000 BTU/hr or 0.293 kW; remaining cooling input is 3.067 kW. Rated net COP is approximately 3.23. The capacity curves use maximum airflow, so their reference capacity can differ from this nominal rating.")
h("Cooling COP at full output and actual duty")
eq("Full-output net cooling = installed gross curve capacity - F\nFull-output net COP = net cooling / (3412.141633 x P_system)\nCoil duty d_c = min(1, max(S_fan / Q_sensible, L / Q_latent))\nCooling kWh excluding supply fan = P_nonfan_cooling x d_c\nOperating net COP = max(0, delivered gross cooling - F)\n                    / (3412.141633 x (cooling kWh + fan kWh))")
p("Each record is one hour, so kW times duty is kWh. Full-output COP appears in the hourly table; both COP definitions are exported. Fan input is already within published total system kW: remove that component before duty scaling, then count the operating fan exactly once. At full cooling duty, total input reconciles to installed nominal system kW.")
p("The model has no off-rating cooling-power or fan correction. Both families use nominal cooling-power and inferred fan inputs. Motor nameplate HP is not multiplied by 746 to invent operating watts. The general-data heating ratings do not overwrite the supplied detailed heating curves.","small")

page(4,"Heating curves and catalog basis")
h("Capacity, total power and COP")
p("The supplied heating tables 58-73 contain 1,632 capacity/power pairs. Normalize each model at 47 F outdoor / 70 F entering dry bulb. Capacity uses anchored fourth-degree least squares; total power uses an anchored second-degree polynomial, with higher coefficients zero.")
eq("x = (outdoor DB - 47)/40; y = (entering DB - 70)/20\nTerms = [1,x,y,x^2,xy,y^2,x^3,x^2y,xy^2,y^3,\n         x^4,x^3y,x^2y^2,xy^3,y^4]\nNet unit heat Q_h = Qref x sum(q[i] x term[i])\nTotal unit input P_h = Pref x sum(p[i] x term[i])\nFull-output heating COP = Q_h / (3412.141633 x P_h)")
p("Both normalized outputs equal 1 at the reference. COP is a ratio of fitted heat and total electrical input, not a separate assumed efficiency. Heating wet bulb is not an input.")
h("Source conditions and mapping")
p("Heating capacity is integrated net output. Total power and net capacity already include indoor fan effects at nominal CFM and the table's listed ESP; defrost is integrated and outdoor RH is fixed at 70%. No extra defrost term or outdoor-humidity correction is applied.")
p("Standard 3/4/5-ton units use tables 58-60; high-efficiency counterparts use 61-63. Standard 10-ton WSK uses table 67; high-efficiency WHK uses table 68. Other sizes share their size-only table across the two families. Dual-fuel equipment is excluded.")
h("Fit quality and validity")
p("Heating source coverage is outdoor -8 to 72 F and entering dry bulb 40 to 80 F. Screening estimates hold curve inputs at these limits when actual conditions are outside coverage; see page 6. Maximum source-point capacity error is 4.59%; power error is 3.31%. Interior-plane holdout capacity relative RMSE reaches 2.13%, conditional on retaining the known reference anchor.")
p("Four source reversals are retained and flagged, including 354.8 MBh at 72 F outdoor / 60 F entering in the 25-ton table. Applying nominal-airflow heating data with maximum cooling airflow remains an uncorrected approximation. For both efficiency families, the inferred fan is separated from integrated heating capacity/power before coil duty scaling; see the next page. The catalog’s fan operating point is not independently reproduced by this estimate.","small")

page(5,"Hourly fan heat and heater energy")
h("Fan schedule and thermal balance")
p("The supply fan runs for the full hour on any building heating call, sensible/latent cooling call or scheduled ventilation call. It is off otherwise. Its rated proxy kW does not follow compressor duty. This is a stated screening control assumption; actual cycling and continuous-fan controls can differ.")
eq("Fan kWh = installed P_fan x fan-on fraction (0 or 1)\nFan heat F = fan kWh x 3412.141633\nHeater demand = max(0, original heating demand - F)\nFan-adjusted sensible cooling S_fan = max(0, B_cool + F)")
p("B_cool is the signed building sensible balance before clipping at zero. This preserves the thermostat deadband and allows ventilation-fan heat to create a cooling load. Latent demand L is unchanged. Heating demand is a load; fan heat contributes to satisfying it and must not be billed as gas or element heat again.")
h("Gas and electric resistance")
eq("Heater output capacity = peak remaining heater demand\nGas therms = delivered heater output / (100000 x efficiency)\nResistance element kWh = delivered heater output / 3412.141633\nDelivered building heat = min(load, heater output + fan heat)")
p("Gas efficiency is entered AHUE / AFUE percent divided by 100, above 0% and at or below 100%. Annual efficiency used hourly is an approximation. Resistance is unity efficiency at the element. Both use ideal modulation and the selected cooling unit's supply-fan estimate. There is no heating-only comparison option.")
h("Heat-pump heating and electricity reconciliation")
eq("HP coil heat capacity = installed net Q_h - installed F_unit\nHP coil input = installed P_h - installed P_fan_unit\nHeat duty d_h = min(1, remaining heat demand / coil capacity)\nHeating kWh = HP coil input x d_h (both efficiency families)\nTotal kWh = heating kWh + cooling kWh + supply-fan kWh")
p("No fan is added on top of integrated heating or total cooling system input. Coil components exclude the separately counted fan. The same decomposition is used for both efficiency families. Unmet heat is remaining load after capped delivery. No auxiliary heat or reheat is silently supplied.","small")

page(6,"Cooling curves and automatic sizing")
h("Three-temperature capacity and SHR")
p("The 24 cooling models use maximum listed airflow. Qref is gross cooling at 95 F outdoor / 67 F entering WB / 80 F entering DB for that airflow, not nominal tons times 12,000. Units and all curve temperatures are in Fahrenheit.")
eq("x=(outdoor DB-95)/20; y=(entering WB-67)/6; z=(entering DB-80)/10\nG=1+c1*x+c2*y+c3*z+c4*x*x+c5*x*y+c6*x*z\n  +c7*y*y+c8*y*z+c9*z*z\nGross cooling = Qref x G\nSHR = min(1, max(0, (b0+b1*x+b2*y+b3*z)/G))")
h("Sizing and delivery")
p("For each size, check integer counts starting at the ventilation minimum. Recalculate mixed air and fan heat for each count; check sensible and latent cooling separately. If heat-pump heating is selected, also check net heating capacity. Gas/resistance heater capacity is sized separately after fan heat credit.")
eq("Available sensible cooling = units x gross capacity x SHR\nAvailable latent cooling = units x gross capacity x (1-SHR)\nGross coil need = max(S_fan/SHR, L/(1-SHR))\nDelivered gross cooling = min(gross need, installed gross capacity)\nUnmet cooling = max(0,S_fan-delivered x SHR)\n              + max(0,L-delivered x (1-SHR))")
p("Retain the first passing count per size. Check source-covered and boundary-estimated hours; prefer fewer unavailable load checks, fewer units, then less nominal tonnage. No sizing margin is added. If no candidate passes, retain a labeled reference-condition estimate and report unresolved checks. Missing inputs stay unavailable.")
h("Curve domain and source anomalies")
p("Cooling entering WB is 61-73 F and entering DB 75-90 F. Outdoor DB is generally 85-125 F; standard 10-ton ends at 120 F. Both 25-ton fits require outdoor DB + 2 x entering DB <= 295. Screening mode evaluates the nearest covered point in the valid-point convex hull, using the normalized fit coordinates. Polynomials are not extrapolated. Actual weather and mixed air remain in the load calculation. Heating below -8 F may be overstated; extended data are needed for design sizing.")
p("Manufacturer blanks are missing, not zero. Both 17.5-ton cooling fits retain the flagged 156.6 MBh source entry. Positive demand in a zero-SHR component remains unmet. Excess sensible removal is not corrected by reheat.","small")

page(7,"Interpretation, sources and checks")
h("Building and weather basis")
p("The editable building is a 150,000 square-foot single zone with hourly steady-state loads. Occupancy follows Monday-Friday hours, reduced summer occupancy and unoccupied setpoints. Internal gains and Sup3rCC solar radiation contribute to loads; lighting and plug electricity are excluded from equipment totals.")
eq("K = envelope UA + 1.08 x building outdoor CFM\nHeating load = max(0,K x (heating setpoint-outdoor F)-gains)\nSigned sensible cooling B_cool = K x (outdoor F-cooling setpoint)\n                               + gains")
p("Building outdoor airflow includes infiltration plus occupied ventilation. Only ventilation enters the equipment mixer. Latent loads follow outdoor-air and occupant moisture gains at the indoor RH target. Solar uses dataset coordinates and fixed local time, with GHI on roofs and projected DNI plus sky/ground radiation on walls.")
h("Annual metrics and missing data")
p("Total site energy combines electricity kWh x 3412.141633 / 1e6 and gas therms x 0.1 MMBtu/therm. Electricity prices use a supported tariff or entered rate; gas uses EIA monthly state commercial benchmarks. Emissions use EPA eGRID and gas-combustion factors. Missing tariffs, prices and factors block only dependent metrics.")
p("Annual totals require 8,760 unique, valid, complete hourly energy records. Screening estimates include boundary-held performance. The CSV records estimated-hour counts and the curve temperatures separately from actual weather and mixed air. Missing inputs remain unavailable; they are not zero. Check coverage and unmet loads alongside totals.")
h("Source and verification trail")
p('Supplied equipment datasets: cooling tables 10-33; heating tables 58-73; general-data tables 6-7, pages 24-29. Source hashes and dataset provenance are retained with the internal data records. The rating CSV distinguishes published system power from inferred fan values. Fan inference follows the gross/net method in the <link href="https://www.energycodes.gov/sites/default/files/2024-08/90.1_Secton_11_and%29_Appendix_G_Review_Manual_V04.pdf" color="#286E64">DOE submittal review manual</link>. Psychrometrics follow <link href="https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html" color="#286E64">PsychroLib / ASHRAE</link>.',"small")
p("Checks cover 1,632 heating points, all 24 nominal power values, fan inference, full-output power reconciliation, partial duty, gas/resistance heat credit, fan-only ventilation, fan-induced cooling, required cooling, automatic labels, source domains, both efficiency families, annual energy, CSVs and rendered controls. The guide does not resolve thermal storage, detailed zoning, equipment staging, fan curves or actual controls.","small")

def footer(canvas,doc):
    canvas.saveState(); canvas.setStrokeColor(colors.HexColor("#D9E3EA"));canvas.line(54,43,558,43)
    canvas.setFont(FONT,8);canvas.setFillColor(GRAY);canvas.drawString(54,29,"BEAST | Equipment and mixed air | equipment-mixed-air-4.0");canvas.drawRightString(558,29,str(doc.page));canvas.restoreState()
SimpleDocTemplate(str(OUT),pagesize=letter,rightMargin=54,leftMargin=54,topMargin=45,bottomMargin=58,title="BEAST Engineering Guide - Equipment and Mixed Air",author="BEAST",subject="Selected heating/cooling, nominal system power, fans, autosizing and mixed air").build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)
