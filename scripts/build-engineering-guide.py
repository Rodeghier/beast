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

page(1,"Equipment options and scope")
p("BEAST compares three equipment options using the same hourly building loads: Rooftop Packaged Heat Pump, Natural Gas and Electric Resistance. The heat pump uses supplied Precedent heating capacity/power and cooling capacity/SHR fits. Gas and resistance are heating-only options and leave cooling loads unserved.")
table(["Equipment","Available behavior","Pending or excluded"],[
 ["Rooftop Packaged Heat Pump","Selects unit count and size using heating, sensible/latent cooling and ventilation. Heating COP and electricity follow supplied capacity and total power.","Cooling COP is pending. Heating retains nominal-airflow catalog conditions; airflow correction is unavailable."],
 ["Natural Gas","Heating output sized to peak building heating load; user enters AHUE / AFUE efficiency; fuel input is calculated in therms.","No installed cooling. No separate fan energy, fan heat or equipment control model."],
 ["Electric Resistance","Heating output sized to peak building heating load; electrical input equals delivered heat using unity coil efficiency.","No installed cooling. No separate fan energy, fan heat or equipment control model."],
],[116,210,178])
h("Supplied cooling data")
p("The 24 unit-specific fit pairs cover standard and high efficiency heat pumps from 3 to 25 nominal tons. Only heat-pump tables 10-33 from Precedent_Cooling.pdf are used; dual-fuel tables are excluded. Gross capacity and SHR depend on outdoor dry bulb, entering wet bulb and entering dry bulb. Selected airflow is the largest listed value for each size: 480 CFM per nominal ton.")
p("The cooling fit report is available at /references/precedent-cooling-fits.pdf; coefficients are available at /references/precedent-cooling-coefficients.csv. Manufacturer blanks are retained. Both 17.5-ton fits include a flagged source capacity entry; a selected fit displays that warning.")
h("Calculated entering conditions")
p("Entering wet bulb is not a user input. The model calculates both entering dry bulb and wet bulb from mixed return and outdoor ventilation air. It uses the airflow of the selected rooftop units, so entering conditions are recalculated for each candidate unit size and count.")
h("Supplied heating data")
p("Heating_Cap.pdf supplies 16 tables and 1,632 capacity/power pairs. Heating depends on outdoor and entering dry bulb only. The fits retain integrated net heating and total power, including catalog fan and defrost effects. The website provides heating coefficient, source-data and fit-summary CSV downloads.")
p("Model version: equipment-mixed-air-2.0. Building model: building-solar-2.0. This guide describes the accompanying website source.","small")

page(2,"Mixed-air calculation")
h("Return air and outdoor air")
p("Return-air dry bulb is the building free-float temperature limited by the active heating and cooling setpoints. Return-air RH uses the building indoor RH target. This is an assumed zone humidity condition, not a moisture-storage simulation. Outdoor temperature and RH come from the weather file. Standard sea-level pressure is 101,325 Pa.")
p("Humidity ratios come from ASHRAE saturation-pressure relations. The mixer uses scheduled mechanical ventilation only. Infiltration remains in the building load and is not passed through the rooftop outdoor-air mixer.")
eq("Supply CFM = number of units x maximum catalog CFM per unit\nf = mechanical ventilation CFM / supply CFM\nWmix = (1 - f) x Wreturn + f x Woutdoor\nhmix = (1 - f) x hreturn + f x houtdoor")
p("Standard-volume CFM fractions approximate dry-air mass fractions, consistent with the building's standard-air assumptions. Candidate selections must provide enough supply airflow for the maximum scheduled ventilation. There is no economizer, humidity averaging, or extra outdoor-air fraction input.")
h("Dry bulb from mixed enthalpy and humidity ratio")
eq("h = 1.006 x T + W x (2501 + 1.86 x T)\nTmix = (hmix - 2501 x Wmix) / (1.006 + 1.86 x Wmix)")
p("These equations use temperature in Celsius, humidity ratio in kg water/kg dry air, and enthalpy in kJ/kg dry air. The calculated temperatures are converted to Fahrenheit for the catalog fits.")
h("Wet bulb is solved, not averaged")
p("The mixed dry bulb and humidity ratio are inverted through the ASHRAE wet-bulb humidity-ratio equations using bisection. Water and ice branches follow PsychroLib. Wet bulb is never formed by averaging the entering wet bulbs of the two air streams. Invalid or supersaturated mixed states remain unavailable; condensation is not simulated.")
p("The implementation is checked against 55 independent PsychroLib reference states spanning -10 to 120 F and 0-100% RH, in addition to return-only, outdoor-only and mixed-air enthalpy/humidity balances.","small")

page(3,"Heating curves, power and COP")
h("Reference and two-temperature fits")
p("Heating tables 58-73 cover 3-25 nominal tons. Each model is normalized at 47 F outdoor and 70 F entering dry bulb. Qref and Pref are the published integrated net heating capacity in BTU/hr and total input power in kW. Wet bulb is not a heating-curve input.")
eq("x = (outdoor DB - 47) / 40; y = (entering DB - 70) / 20\nTerms = [1,x,y,x^2,xy,y^2,x^3,x^2y,xy^2,y^3,\n         x^4,x^3y,x^2y^2,xy^3,y^4]\nNet unit heat Q = Qref x sum(q[i] x term[i])\nTotal unit power P = Pref x sum(p[i] x term[i])\nHeating COP = Q / (3412.141633 x P)")
p("Capacity uses a fourth-degree polynomial; power uses a second-degree polynomial with the remaining coefficients zero. Anchored least squares keeps both normalized curves equal to 1 at the reference. COP is derived from heat and total power, not a separate assumed or independently fitted efficiency.")
h("Coverage, fit error and source flags")
p("The evaluator accepts outdoor dry bulb from -8 to 72 F and entering dry bulb from 40 to 80 F. It does not extrapolate. Across all source points, maximum relative capacity error is 4.59% and maximum relative power error is 3.31%. Interior-plane holdout refits have capacity relative RMSE up to 2.13%; the published reference anchor remains known during this conditional validation.")
p("All 1,632 points remain in the fit. Four entries that increase capacity with entering dry bulb are flagged, including the 25-ton table's 354.8 MBh entry at 72 F outdoor / 60 F entering. No source value is silently corrected. CSVs retain source table/page, measured values, fitted values and flags.","small")
h("Catalog conditions and application approximation")
p("Published net capacity and total power include indoor fan effects at nominal CFM and the table's listed ESP, and defrost is already integrated. Outdoor RH is fixed at the catalog's 70%; no humidity or extra defrost correction is applied. Do not add fan power or fan heat a second time.")
p("Mixed-air calculations continue to use the selected maximum cooling airflow. The excerpt supplies no nominal-to-maximum airflow/fan correction. Applying these heating fits at those entering conditions is an uncorrected screening approximation; selections requiring heating are labeled provisional even when all temperature points are covered.")
p("Tables 58-60 map to standard 3/4/5-ton units; 61-63 to high efficiency. The 10-ton WSK table 67 maps to standard and WHK in table 68 to high efficiency. Size-only tables serve both families at other sizes. No dual-fuel equipment is added.","small")

page(4,"Cooling fits and automatic selection")
h("Catalog reference and fit equations")
p("For each unit, Qref is the gross catalog capacity at 95 F outdoor DB, 67 F entering WB and 80 F entering DB, at maximum listed airflow. It is not nominal tons times 12,000 and not the building's peak load. All three temperatures below are in Fahrenheit.")
eq("x = (outdoor DB - 95) / 20; y = (entering WB - 67) / 6\nz = (entering DB - 80) / 10\nF = 1 + c1*x + c2*y + c3*z + c4*x*x + c5*x*y\n      + c6*x*z + c7*y*y + c8*y*z + c9*z*z\nGross unit capacity = Qref x F\nSHR = min(1, max(0, (b0 + b1*x + b2*y + b3*z) / F))")
h("Automatic unit count and size")
p("For each size in the chosen efficiency family, the model checks integer unit counts starting with the ventilation-airflow minimum. It recalculates mixed air, checks heating and checks sensible/latent cooling separately. The first count meeting every verifiable load hour is retained for that size. Across candidates, it prefers more covered heating plus cooling load hours, then fewer units, then less total nominal tonnage.")
eq("Available sensible = units x gross unit cooling x SHR\nAvailable latent = units x gross unit cooling x (1 - SHR)\nAvailable heating = units x net unit heating")
p("Cooling capacities are gross; indoor fan heat is not subtracted. Heating uses integrated net capacity on the published catalog basis. If the bounded search cannot verify a candidate, a reference-condition estimate is shown as provisional. It uses the greater of heating, separate sensible/latent cooling, and ventilation count requirements, and does not create out-of-domain hourly performance.")
h("Validity and incomplete coverage")
p("Entering WB must be 61-73 F; entering DB 75-90 F. Outdoor DB is generally 85-125 F, with the standard 10-ton unit limited to 85-120 F. Both 25-ton fits also require outdoor DB + 2 x entering DB &lt;= 295. The evaluator checks the valid catalog-point convex hull. Out-of-domain or missing-input hours make selection provisional and leave dependent hourly results blank.")
p("No extrapolation or boundary holding is applied. The supplied 17.5-ton anomaly is retained and flagged; users should review the source before relying on that selected fit.","small")

page(5,"Loads served, energy and comparisons")
h("Cooling delivery")
p("Use positive sensible demand S and latent demand L in the following equations. Building cooling is displayed as negative in the hourly table; its magnitude is used here. Thermal quantities are BTU/hr, and each record represents one hour.")
eq("Gross cooling need = max(S / SHR, L / (1 - SHR))\nDelivered cool = min(gross cooling need, available gross cool)\nUnmet cool = max(0, S - delivered cool x SHR)\n           + max(0, L - delivered cool x (1 - SHR))")
p("A zero component demand contributes zero to the requirement. At SHR = 0 or 1, positive demand in the component with zero share remains unmet. No reheat correction is applied for excess sensible removal. Gas and resistance deliver zero cooling; their unmet cooling is the entire known cooling load.","small")
h("Heating and fuel input")
eq("Available HP heat = units x Q; delivered = min(load, available)\nUnmet HP heat = max(0, load - delivered)\nHP duty = delivered / available; HP kWh = units x P x duty\nGas input therms = delivered heat / (100000 x efficiency)\nResistance kWh = delivered heat / 3412.141633")
p("Heat-pump input uses ideal duty fraction, without cycling degradation or a staging model. Delivery is capped at available capacity and the remainder is unmet; auxiliary heat is not supplied. Out-of-domain heating results remain unknown. At zero heat demand, heating electricity is zero.","small")
p("Gas efficiency is entered AHUE / AFUE percent divided by 100, above 0% and at or below 100%. Using annual efficiency hourly is a screening approximation. Resistance is unity efficiency at the element. Both are sized to peak heating load, use ideal modulation and omit separate fan/controls energy.")
h("Pending cooling COP")
p("Cooling COP is still not supplied. Cooling capacity, SHR and shortfalls remain available, but cooling electricity is blank when cooling is required. Known heating electricity remains available separately; total hourly electricity is blank if either required mode is unknown.")
h("Energy, cost and emissions")
p("Annual site energy combines electricity converted to MMBtu and gas input therms times 0.1 MMBtu/therm. Electricity cost uses a supported tariff or manual $/kWh; gas uses the latest available EIA state commercial price for each used calendar month, converted with EPA heat content. Gas-only modeled consumption does not receive separate electricity account charges. EPA eGRID electricity and EPA natural-gas factors provide CO2e. Missing prices or factors block only their dependent metric.","small")

page(6,"Building basis and interpretation")
h("Retained building load model")
p("The editable model represents a 150,000 square-foot single-zone building. Occupancy follows Monday-Friday hours, reduced June-August occupancy and unoccupied setpoints. Lighting, plug loads and occupants add heat gains; their electricity is excluded from these equipment totals.")
eq("K = envelope UA + 1.08 x building outdoor-air CFM\nHeating = max(0, K x (heating setpoint - outdoor F) - gains)\nSensible cool = max(0, K x (outdoor F - cooling setpoint) + gains)\nTotal cooling = sensible cooling + latent cooling")
p("Latent load follows outdoor-air and occupant moisture gains at the indoor RH target. Infiltration and scheduled ventilation affect the building load. Solar gains use Sup3rCC DHI/DNI/GHI, dataset grid coordinates and the fixed UTC offset. Roofs use GHI; walls use projected DNI, isotropic sky and ground reflection. Glazing uses SHGC and shading; opaque gains use surface U-value, absorptance and exterior film coefficient.")
p("The model does not resolve thermal storage, detailed zoning, heat recovery, economizer control, moisture storage or delayed solar response. Sup3rCC is modeled climate under EC-Earth3-CC / SSP2-4.5, not observed weather.")
h("Completeness and comparison scope")
p("Annual energy requires 8,760 unique, valid, complete hourly electricity and gas records in one year, excluding February 29 and daylight-saving shifts. Available-hour totals disclose coverage. Unknown performance is not zero. Heating-only options must be evaluated with their unserved cooling loads; lower energy does not by itself establish comparable service. Unmet-hour counts use a threshold above 1 BTU/hr; total shortfalls include all known positive hourly deficits.")
h("Source and verification trail")
p('Cooling: Precedent_Cooling.pdf, tables 10-33. Heating: Heating_Cap.pdf, tables 58-73, printed pages 86-95. Both are user-supplied excerpts of Trane PKGP-PRC023F-EN. Hashes, coefficients and errors are retained in lib/data/precedent-cooling.json and lib/data/precedent-heating.json. Model-family code: <link href="https://elibrary.tranetechnologies.com/public/commercial-hvac/Literature/Product%20Catalog/PKGP-PRC023D-EN_09122025.pdf" color="#286E64">Trane Precedent model key</link>. Psychrometrics: <link href="https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html" color="#286E64">PsychroLib / ASHRAE</link>. Gas efficiency: <link href="https://www.energy.gov/cmei/femp/purchasing-energy-efficient-residential-furnaces" color="#286E64">DOE AFUE</link>. Rates: OpenEI URDB and EIA. Emissions: pinned EPA eGRID2023 revision 2 and EPA 2025 Hub gas factors.',"small")
p("Checks cover all 1,632 heating points, model-family mapping, normalization, COP/power reconciliation, dense-domain positivity, heating-driven sizing, shortfalls, domain gaps, mixed air, reference wet bulbs, AHUE/resistance conversion, heating-only scope, CSV alignment, complete-year validation, utility pricing and emissions.","small")

def footer(canvas,doc):
    canvas.saveState(); canvas.setStrokeColor(colors.HexColor("#D9E3EA"));canvas.line(54,43,558,43)
    canvas.setFont(FONT,8);canvas.setFillColor(GRAY);canvas.drawString(54,29,"BEAST | Equipment and mixed air | equipment-mixed-air-2.0");canvas.drawRightString(558,29,str(doc.page));canvas.restoreState()
SimpleDocTemplate(str(OUT),pagesize=letter,rightMargin=54,leftMargin=54,topMargin=45,bottomMargin=58,title="BEAST Engineering Guide - Equipment and Mixed Air",author="BEAST",subject="Heat-pump heating/cooling curves, autosizing, mixed air and heating-only comparisons").build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)
