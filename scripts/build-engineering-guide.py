"""Build the engineering guide for the user-curve-only BEAST model."""
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
p("BEAST compares three equipment options using the same hourly building loads: Rooftop Packaged Heat Pump, Natural Gas and Electric Resistance. The heat pump uses the supplied Precedent cooling fits. Gas and resistance are heating-only options and leave cooling loads unserved.")
table(["Equipment","Available behavior","Pending or excluded"],[
 ["Rooftop Packaged Heat Pump","Automatically selects identical unit count and nominal size using cooling capacity, SHR, mixed-air conditions and scheduled ventilation.","Heat-pump heating capacity and COP await user data. Heating size and affected electricity remain unavailable."],
 ["Natural Gas","Heating output sized to peak building heating load; user enters AHUE / AFUE efficiency; fuel input is calculated in therms.","No installed cooling. No separate fan energy, fan heat or equipment control model."],
 ["Electric Resistance","Heating output sized to peak building heating load; electrical input equals delivered heat using unity coil efficiency.","No installed cooling. No separate fan energy, fan heat or equipment control model."],
],[116,210,178])
h("Supplied cooling data")
p("The 24 unit-specific fit pairs cover standard and high efficiency heat pumps from 3 to 25 nominal tons. Only heat-pump tables 10-33 from Precedent_Cooling.pdf are used; dual-fuel tables are excluded. Gross capacity and SHR depend on outdoor dry bulb, entering wet bulb and entering dry bulb. Selected airflow is the largest listed value for each size: 480 CFM per nominal ton.")
p("The cooling fit report is available at /references/precedent-cooling-fits.pdf; coefficients are available at /references/precedent-cooling-coefficients.csv. Manufacturer blanks are retained. Both 17.5-ton fits include a flagged source capacity entry; a selected fit displays that warning.")
h("Calculated entering conditions")
p("Entering wet bulb is not a user input. The model calculates both entering dry bulb and wet bulb from mixed return and outdoor ventilation air. It uses the airflow of the selected rooftop units, so entering conditions are recalculated for each candidate unit size and count.")
p("Model version: equipment-mixed-air-1.0. Building model: building-solar-2.0. This guide describes the accompanying website source.","small")

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

page(3,"Cooling fits and automatic selection")
h("Catalog reference and fit equations")
p("For each unit, Qref is the gross catalog capacity at 95 F outdoor DB, 67 F entering WB and 80 F entering DB, at maximum listed airflow. It is not nominal tons times 12,000 and not the building's peak load. All three temperatures below are in Fahrenheit.")
eq("x = (outdoor DB - 95) / 20; y = (entering WB - 67) / 6\nz = (entering DB - 80) / 10\nF = 1 + c1*x + c2*y + c3*z + c4*x*x + c5*x*y\n      + c6*x*z + c7*y*y + c8*y*z + c9*z*z\nGross unit capacity = Qref x F\nSHR = min(1, max(0, (b0 + b1*x + b2*y + b3*z) / F))")
h("Automatic unit count and size")
p("For each available size in the chosen efficiency family, the model checks integer unit counts starting with the ventilation-airflow minimum. It recalculates mixed air and checks sensible and latent cooling separately. The first count meeting every verifiable cooling-load hour is retained for that size. Across these candidates, it prefers more verified cooling hours, then fewer units, then less total nominal tonnage.")
eq("Available sensible = units x gross unit capacity x SHR\nAvailable latent = units x gross unit capacity x (1 - SHR)")
p("These are gross capacities; indoor fan heat is not subtracted. Heating sizing is pending the user's heating data. If the bounded sizing search cannot verify a candidate, a catalog-reference-condition estimate is shown explicitly as provisional. This fallback does not create hourly performance outside the supplied data.")
h("Validity and incomplete coverage")
p("Entering WB must be 61-73 F; entering DB 75-90 F. Outdoor DB is generally 85-125 F, with the standard 10-ton unit limited to 85-120 F. Both 25-ton fits also require outdoor DB + 2 x entering DB &lt;= 295. The evaluator checks the valid catalog-point convex hull. Out-of-domain or missing-input hours make selection provisional and leave dependent hourly results blank.")
p("No extrapolation or boundary holding is applied. The supplied 17.5-ton anomaly is retained and flagged; users should review the source before relying on that selected fit.","small")

page(4,"Loads served, energy and comparisons")
h("Cooling delivery")
p("Use positive sensible demand S and latent demand L in the following equations. Building cooling is displayed as negative in the hourly table; its magnitude is used here. Thermal quantities are BTU/hr, and each record represents one hour.")
eq("Gross cooling need = max(S / SHR, L / (1 - SHR))\nDelivered cool = min(gross cooling need, available gross cool)\nUnmet cool = max(0, S - delivered cool x SHR)\n           + max(0, L - delivered cool x (1 - SHR))")
p("A zero component demand contributes zero to the requirement. At SHR = 0 or 1, positive demand in the component with zero share remains unmet. No reheat correction is applied for excess sensible removal. Gas and resistance deliver zero cooling; their unmet cooling is the entire known cooling load.","small")
h("Heating and fuel input")
eq("Gas output capacity = peak valid building heating load\nGas input therms = delivered heat / (100000 x efficiency)\nResistance output capacity = peak valid building heating load\nResistance kWh = delivered heat / 3412.141633")
p("Gas efficiency is the entered AHUE / AFUE percentage divided by 100. It must be above 0% and at or below 100%; there is no assumed value. Applying this annual efficiency as a constant hourly fuel-conversion ratio is a screening approximation. Resistance is unity efficiency at the heating element. Gas and resistance use ideal modulation up to the peak-load output capacity; separate supply fans and controls are not modeled.")
h("Pending heat-pump data")
p("Heat-pump heating capacity, heating COP and cooling COP are not supplied by the cooling-capacity/SHR tables. The website does not infer these values. Known cooling capacity, SHR and unmet cooling remain available independently, while affected heating performance and electrical input remain blank. No auxiliary heat is silently added.")
h("Energy, cost and emissions")
p("Annual site energy combines electricity converted to MMBtu and gas input therms times 0.1 MMBtu/therm. Electricity cost uses a supported tariff or manual $/kWh; gas uses the latest available EIA state commercial price for each used calendar month, converted with EPA heat content. Gas-only modeled consumption does not receive separate electricity account charges. EPA eGRID electricity and EPA natural-gas factors provide CO2e. Missing prices or factors block only their dependent metric.","small")

page(5,"Building basis and interpretation")
h("Retained building load model")
p("The editable model represents a 150,000 square-foot single-zone building. Occupancy follows Monday-Friday hours, reduced June-August occupancy and unoccupied setpoints. Lighting, plug loads and occupants add heat gains; their electricity is excluded from these equipment totals.")
eq("K = envelope UA + 1.08 x building outdoor-air CFM\nHeating = max(0, K x (heating setpoint - outdoor F) - gains)\nSensible cool = max(0, K x (outdoor F - cooling setpoint) + gains)\nTotal cooling = sensible cooling + latent cooling")
p("Latent load follows outdoor-air and occupant moisture gains at the indoor RH target. Infiltration and scheduled ventilation affect the building load. Solar gains use Sup3rCC DHI/DNI/GHI, dataset grid coordinates and the fixed UTC offset. Roofs use GHI; walls use projected DNI, isotropic sky and ground reflection. Glazing uses SHGC and shading; opaque gains use surface U-value, absorptance and exterior film coefficient.")
p("The model does not resolve thermal storage, detailed zoning, heat recovery, economizer control, moisture storage or delayed solar response. Sup3rCC is modeled climate under EC-Earth3-CC / SSP2-4.5, not observed weather.")
h("Completeness and comparison scope")
p("Annual energy requires 8,760 unique, valid, complete hourly electricity and gas records in one year, excluding February 29 and daylight-saving shifts. Available-hour totals disclose coverage. Unknown performance is not zero. Heating-only options must be evaluated with their unserved cooling loads; lower energy does not by itself establish comparable service. Unmet-hour counts use a threshold above 1 BTU/hr; total shortfalls include all known positive hourly deficits.")
h("Source and verification trail")
p('Cooling: user-supplied Precedent_Cooling.pdf, Trane PKGP-PRC023F-EN, heat-pump tables 10-33; source hash and fit errors are retained in lib/data/precedent-cooling.json. Psychrometrics: <link href="https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html" color="#286E64">PsychroLib / ASHRAE equations</link>. Gas efficiency terminology: <link href="https://www.energy.gov/cmei/femp/purchasing-energy-efficient-residential-furnaces" color="#286E64">DOE AFUE definition</link>. Rates: OpenEI URDB and EIA. Emissions: pinned EPA eGRID2023 revision 2 and EPA 2025 Hub gas factors. Sources and years are shown in the website.',"small")
p("Checks cover mixed-air mass/enthalpy balances, reference wet bulbs, fixed maximum airflow, automatic cooling selection, source-domain gaps, pending heat-pump inputs, AHUE fuel conversion, resistance energy, heating-only scope, CSV alignment, complete-year validation, utility pricing and emissions.","small")

def footer(canvas,doc):
    canvas.saveState(); canvas.setStrokeColor(colors.HexColor("#D9E3EA"));canvas.line(54,43,558,43)
    canvas.setFont(FONT,8);canvas.setFillColor(GRAY);canvas.drawString(54,29,"BEAST | Equipment and mixed air | equipment-mixed-air-1.0");canvas.drawRightString(558,29,str(doc.page));canvas.restoreState()
SimpleDocTemplate(str(OUT),pagesize=letter,rightMargin=54,leftMargin=54,topMargin=45,bottomMargin=58,title="BEAST Engineering Guide - Equipment and Mixed Air",author="BEAST",subject="Packaged cooling autosizing, mixed-air conditions and heating-only comparisons").build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)
