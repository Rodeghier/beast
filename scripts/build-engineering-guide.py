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
    p(f"BEAST / ENGINEERING GUIDE / USER CURVES / {n:02d}","eyebrow");p(title,"h1")
def eq(text):
    rows=[[Paragraph(escape(line),styles["eq"])] for line in text.splitlines()]
    t=Table(rows,colWidths=[504]);t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),LIGHT),("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]));story.append(t);story.append(Spacer(1,9))
def table(headers,rows,widths):
    data=[[Paragraph(escape(x),styles["th"]) for x in headers]]+[[Paragraph(escape(str(x)),styles["cell"]) for x in row] for row in rows]
    t=Table(data,colWidths=widths,repeatRows=1,hAlign="LEFT");t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),9),("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8),("ROWBACKGROUNDS",(0,1),(-1,-1),[LIGHT,colors.white]),("LINEBELOW",(0,0),(-1,0),.5,NAVY)]));story.append(t);story.append(Spacer(1,8))

page(1,"A model driven by your curves")
p("BEAST combines hourly weather and building loads with user-supplied normalized capacity, COP and sensible heat ratio (SHR) surfaces. No equipment performance values are preloaded. Until the required curves and operating conditions are supplied, dependent performance results remain unavailable.")
table(["Step","Input and result"],[
 ["1. Weather and building","Sup3rCC outdoor conditions, solar radiation and editable building inputs produce hourly heating, sensible cooling and latent cooling loads."],
 ["2. Your performance surfaces","Outdoor dry-bulb and entering wet-bulb temperatures select normalized capacity, absolute COP and SHR from your grids."],
 ["3. Curve-based results","Available and delivered loads, unmet loads, and electricity follow directly from the supplied curves. Electricity cost and electricity CO2e use independent tariff and EPA data."],
],[130,374])
h("The only equipment performance inputs")
p("Heating uses normalized capacity and absolute COP. Cooling uses normalized capacity, absolute COP and SHR. Each of the five mode-specific surfaces has two inputs: outdoor dry-bulb temperature and entering wet-bulb temperature, both in degrees Fahrenheit. These are the only equipment-dependent performance inputs.")
h("Two empty placeholders")
p("Download <b>/templates/performance-curves.json</b> from the website for empty curve slots. Each slot starts as null. Download <b>/templates/entering-wet-bulb.csv</b> for an empty hourly operating-condition file. Neither template contains example equipment values.")
h("Operating conditions are explicit")
p("Outdoor dry bulb comes from the selected weather record. Entering wet bulb comes from your hourly CSV, or an optional fixed value that you explicitly enter. The fixed value applies to every hour without an hourly value; it is a screening condition. Entering wet bulb is not inferred from equipment airflow or air mixing.")
p("Verification covers two-temperature interpolation and endpoints, input validation, missing-data propagation, capacity limits, SHR endpoints, electricity balance, CSV alignment, calendar coverage, tariff billing and scorecard rendering. Core implementation: lib/performance-curves.ts and lib/curve-model.ts.","small")
p("Model version: user-curves-1.0. Building model: building-solar-2.0. This guide describes the simplified model in the accompanying source.","small")

page(2,"Curve format and data coverage")
h("A rectangular grid for every surface")
p("Replace a null slot with an object containing outdoorF, enteringWetBulbF and values. Each temperature axis contains at least two finite, strictly increasing numbers. The values matrix has one row per entering wet-bulb temperature and one column per outdoor dry-bulb temperature. Axes may differ between surfaces.")
eq('Surface structure (format only; supply your own numbers):\n{\n  "outdoorF": [ increasing outdoor dry-bulb temperatures ],\n  "enteringWetBulbF": [ increasing entering wet-bulb temperatures ],\n  "values": [ one row of values per wet-bulb temperature ]\n}')
p("Normalized capacity must be nonnegative. COP must be a positive absolute thermal-output/electric-input ratio. SHR must lie between zero and one. Unknown equipment fields, duplicate axis values and malformed matrices are rejected. Select Apply curves to use an edited grid.")
h("Interpolation without extrapolation")
p("Bilinear interpolation uses the four surrounding grid nodes. At an axis endpoint, the endpoint value is retained. If either temperature is outside a required surface domain, the hour's performance outputs remain blank. Values are not extrapolated or held at the nearest boundary. A mode's surfaces need domain coverage only when that mode has a positive load.")
h("Hourly entering wet-bulb CSV")
eq("Date,Time,Entering_wet_bulb_F\nUse YYYY-MM-DD, HH:00 and your measured or specified temperature.")
p("Dates and times must match the weather's local standard-time calendar. Duplicate hours, invalid dates, nonfinite values and February 29 are rejected. Hourly values override the optional fixed temperature. Missing hours without a fixed fallback remain unavailable. The two-temperature curve axes are separate from this time series: one describes performance; the other supplies each hour's operating point.")
h("Capacity normalization convention")
p("Heating reference capacity is the maximum positive heating building load among valid load records in the selected dataset. Cooling reference capacity is the maximum magnitude of total cooling building load among those records. Available capacity equals the applicable reference times your normalized curve value. There is no additional equipment rating or sizing factor. Changing location, year or building inputs changes these references; your capacity curves must use this normalization basis.")

page(3,"Hourly equations and outputs")
p("Use positive heating load H, sensible cooling load S and latent cooling load L in these equations. Building cooling is displayed as negative in the hourly table; its magnitude is used here. All thermal quantities below are BTU/hr. Each record represents one hour.")
eq("Available heat = heating reference x heating capacity curve\nAvailable cool = cooling reference x cooling capacity curve\nDelivered heat = min(H, available heat)\nGross cooling need = max(S / SHR, L / (1 - SHR))\nDelivered cool = min(gross cooling need, available cool)\nUnmet heat = max(0, H - delivered heat)\nUnmet cool = max(0, S - delivered cool x SHR)\n           + max(0, L - delivered cool x (1 - SHR))")
p("Zero component demand contributes zero to the cooling requirement. At SHR = 0 or 1, a positive load in the component with zero share cannot be satisfied; available capacity still limits gross delivery and the remaining load is reported as unmet. Heating and cooling loads are evaluated independently when both occur. Excess sensible cooling is not corrected.","small")
eq("Heating kWh = delivered heat / heating COP / 3412.141633\nCooling kWh = delivered cool / cooling COP / 3412.141633\nCurve-based electricity = heating kWh + cooling kWh")
p("COP is read directly from your surface at the operating temperatures. No additional equipment model or performance variable is used. Any electricity you want represented must be included in the supplied COP basis.")
h("What remains in the website and CSV")
p("Weather and building loads remain available independently. Curve-based outputs include available capacity, delivered heating and gross cooling, heating/cooling COP, SHR, electricity and unmet loads. The hourly CSV records applied surfaces, building-derived references, entering wet-bulb inputs and status. Other equipment-dependent outputs have been removed.")
h("Missing is unavailable; partial is labeled")
p("All five mode-specific surfaces must be supplied. Missing weather, loads or entering wet bulb, or an out-of-domain required surface, leaves dependent hourly results blank. Totals over available hours retain the valid-hour count. Annual scorecards require 8,760 complete, unique, valid hourly records in one year, excluding February 29. An unmet-load hour means more than 1 BTU/hr remains unmet; cumulative unmet energy sums all valid hourly shortfalls.")

page(4,"Building basis and interpretation")
h("Retained building load calculation")
p("The editable model represents a 150,000 square-foot, single-zone building. Occupancy follows Monday-Friday hours with reduced June-August occupancy and unoccupied temperature setbacks. The selected weather uses a fixed local standard-time offset. Lighting, plug loads and occupants add building heat gains; their electricity is not included in curve-based electricity.")
eq("K = envelope UA + 1.08 x building outdoor-air CFM\nHeating = max(0, K x (heating setpoint - outdoor F) - gains)\nSensible cool = max(0, K x (outdoor F - cooling setpoint) + gains)\nTotal cooling = sensible cooling + latent cooling")
p("Latent load follows outdoor-air and occupant moisture gains at the indoor RH limit, using standard sea-level air. Temperature/RH psychrometrics use ASHRAE saturation-pressure relations adapted from PsychroLib; dew/frost point is blank when no finite value exists. Building outdoor air includes infiltration and scheduled ventilation, without specifying equipment airflow.")
h("Solar and climate data")
p("Sup3rCC provides outdoor temperature, humidity and DHI/DNI/GHI in W/m2. NOAA solar geometry uses the hourly midpoint at the dataset grid location and fixed UTC offset. Roof gains use GHI; vertical walls combine projected DNI, isotropic sky and ground reflection. Glazing uses area, SHGC and shading; opaque gains use area, U-value, absorptance and exterior film coefficient. Solar U-values do not replace the independent envelope UA.")
p("The model does not resolve thermal storage, warm-up, delayed solar response, detailed overhangs, zoning or system controls. Missing solar inputs leave dependent loads unavailable. Sup3rCC is modeled climate under EC-Earth3-CC / SSP2-4.5, not observed weather. Compare unmet load coverage as well as electricity.")
h("Electricity cost and electricity emissions")
p("Electricity CO2e = curve-based kWh x the selected eGRID kg CO2e/kWh. A manual nonnegative $/kWh can replace tariff pricing. Missing prices or factors block only their dependent metric. OpenEI rates are separate-meter screening estimates for curve-based consumption. Supported TOU schedules, cumulative tiers, demand charges, adjustments and fixed/minimum charges are applied. Hourly-average peaks may differ from utility demand intervals. Verify tariff eligibility and whole-meter billing terms. Bundled EPA eGRID2023 revision 2 CO2e factors stay constant across hours and weather years; they are not hourly, marginal or future-grid forecasts.")
h("Source and verification trail")
p('Weather: <link href="https://developer.nlr.gov/docs/climate/sup3rcc/" color="#286E64">NLR Sup3rCC</link>. Solar geometry: <link href="https://gml.noaa.gov/grad/solcalc/" color="#286E64">NOAA solar calculator</link>. Psychrometrics: <link href="https://psychrometrics.github.io/psychrolib/" color="#286E64">PsychroLib</link>. Rates: <link href="https://apps.openei.org/services/doc/rest/util_rates/?version=8" color="#286E64">OpenEI URDB</link>. Electricity emissions: <link href="https://www.epa.gov/egrid/summary-data" color="#286E64">EPA eGRID</link>. Bundled-data provenance and licenses remain in the repository. Performance data must come from your curves.',"small")

def footer(canvas,doc):
    canvas.saveState(); canvas.setStrokeColor(colors.HexColor("#D9E3EA"));canvas.line(54,43,558,43)
    canvas.setFont(FONT,8);canvas.setFillColor(GRAY);canvas.drawString(54,29,"BEAST | User-supplied capacity, COP and SHR | user-curves-1.0");canvas.drawRightString(558,29,str(doc.page));canvas.restoreState()
SimpleDocTemplate(str(OUT),pagesize=letter,rightMargin=54,leftMargin=54,topMargin=45,bottomMargin=58,title="BEAST Engineering Guide - User Performance Curves",author="BEAST",subject="Capacity, COP and SHR surfaces with explicit operating conditions").build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)
