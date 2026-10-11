"""Build the engineer-facing PDF from the versioned model and worked example."""
from pathlib import Path
import json, math
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont("GuideSans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("GuideSans-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("GuideMono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))
pdfmetrics.registerFontFamily("GuideSans", normal="GuideSans", bold="GuideSans-Bold", italic="GuideSans", boldItalic="GuideSans-Bold")
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/engineering-guide.pdf'
EX = json.loads((ROOT / 'docs/rtu-madison-example.json').read_text())
COMPARE = json.loads((ROOT / 'docs/equipment-comparison-example.json').read_text())
HEAT = json.loads((ROOT / 'docs/rtu-heating-cases.json').read_text())
MAPS = json.loads((ROOT / 'lib/data/rtu/comstock-standard.json').read_text())['tables']['curves']['table']
NAVY = colors.HexColor('#203B56'); TEAL = colors.HexColor('#286E64'); GRAY = colors.HexColor('#526477'); LIGHT = colors.HexColor('#EEF4F7'); RUST = colors.HexColor('#9C552C')
styles = {
 'body': ParagraphStyle('body', fontName='GuideSans', fontSize=9.6, leading=13.5, textColor=GRAY, spaceAfter=8),
 'small': ParagraphStyle('small', fontName='GuideSans', fontSize=8.25, leading=11.4, textColor=GRAY, spaceAfter=6),
 'h1': ParagraphStyle('h1', fontName='GuideSans-Bold', fontSize=23, leading=28, textColor=NAVY, spaceAfter=15),
 'h2': ParagraphStyle('h2', fontName='GuideSans-Bold', fontSize=13, leading=17, textColor=TEAL, spaceBefore=12, spaceAfter=7),
 'eyebrow': ParagraphStyle('eyebrow', fontName='GuideSans-Bold', fontSize=8, leading=11, textColor=TEAL, spaceAfter=8),
 'eq': ParagraphStyle('eq', fontName='GuideMono', fontSize=8.7, leading=13, textColor=NAVY, spaceAfter=3),
 'cell': ParagraphStyle('cell', fontName='GuideSans', fontSize=8.3, leading=11.2, textColor=GRAY),
 'th': ParagraphStyle('th', fontName='GuideSans-Bold', fontSize=8.3, leading=11.2, textColor=colors.white),
}
story=[]
def p(text, style='body'): story.append(Paragraph(text, styles[style]))
def heading(n, title):
 if n > 1: story.append(PageBreak())
 p(f'CLIMATE TABLE / ENGINEERING GUIDE / {n:02d}', 'eyebrow'); p(title, 'h1')
def h(text): p(text,'h2')
def eq(text):
 t=Table([[Paragraph(escape(line), styles['eq'])] for line in text.split('\n')], colWidths=[522])
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)])); story.append(t); story.append(Spacer(1,8))
def table(headers, rows, widths, padding=6):
 cells=[[Paragraph(str(v),styles['th']) for v in headers]]+[[Paragraph(str(v), styles['cell']) for v in row] for row in rows]
 t=Table(cells,colWidths=widths,repeatRows=1,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,LIGHT]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),padding),('BOTTOMPADDING',(0,0),(-1,-1),padding),('LINEBELOW',(0,-1),(-1,-1),.5,colors.HexColor('#D3E0E5'))])); story.append(t); story.append(Spacer(1,9))
def link(url,label): return f'<link href="{url}" color="#286E64"><u>{label}</u></link>'
def num(v): return f'{v:,.0f}'

heading(1,'HVAC energy comparison')
p('Engineering method | cav-equipment-4.0 | 11 October 2026','small')
p('Two heating/cooling systems are evaluated against the same hourly weather and building inputs. Each cooling family is sized independently. Results report electricity, gas input, and unmet loads; they do not identify a manufacturer product.')
h('Calculation scope')
table(['Included','Excluded'],[
 ['NLR temperature/flow capacity and EIR curves; compressor cycling; CAV supply fans; electric dehumidification reheat; selected gas or resistance heat.','Sizing safety margin; crankcase heater input; added frost/defrost capacity and power corrections; auxiliary space heat.'],
 ['Operating-condition sensible heat ratio (SHR), derived from coil apparatus dew point and bypass factor.','Transient latent degradation and off-cycle condensate re-evaporation. The full EnergyPlus system solver is not run.'],
 ],[261,261])
h('Building defaults')
table(['Input','Default'],[
 ['Floor area / height','150,000 ft² total / 14 ft per story; 2 stories; one aggregate zone'],
 ['People / occupied hours','1,200; weekdays 07:00-17:00; June-August 10%; no holidays'],
 ['Heat / cool setpoints','Occupied 70 / 75°F; unoccupied 60 / 85°F; maximum RH 50%'],
 ['Envelope / infiltration','UA = 15,000 BTU/(hr·°F); infiltration 0.15 ACH = 5,250 CFM'],
 ['Mechanical ventilation','10 CFM/person + 0.12 CFM/ft² when occupied'],
 ['Lighting / equipment','0.9 / 0.6 W/ft²; unoccupied 10% / 25%; occupancy ramp'],
 ['People / solar gains','245 sensible + 155 latent BTU/hr/person; hourly DHI, DNI and GHI drive glazing and opaque-surface solar gains (page 7)'],
 ],[160,362])
p('Building defaults are editable assumptions, not a calibrated representation of a particular building. The 10% summer occupancy and 10% unoccupied lighting values are schedule assumptions, not sizing margins.','small')
h('Weather')
p('Sup3rCC EC-Earth3-CC / SSP2-4.5 is modeled climate, not observed weather or design-day weather. The selected dataset covers the contiguous 48 states and DC, years 2015-2059. Calculations use fixed local standard time and exclude February 29. Annual totals require 8,760 valid unique hourly records.','small')

heading(2,'Loads and variable SHR')
h('Building and coil demand')
eq('H = UA + 1.08 x outdoor CFM\nQheat = max[0, H(Theat - Tout) - sensible gains]\nQs = max[0, H(Tout - Tcool) + sensible gains]\nQl = max[0, 0.68 x outdoor CFM x 7000(Wout - Wlimit)\n         + occupant latent gain]')
p('Q values above are positive BTU/hr magnitudes. Outdoor CFM includes infiltration and mechanical ventilation. Building outputs exclude fan heat; coil demand adds supply-fan heat to sensible cooling and credits it against heating. Indoor Wlimit uses the RH limit at the equilibrium zone temperature, clipped to the thermostat deadband.','small')
p('Return temperature is recalculated with fan heat. Return humidity follows the outdoor-air/occupant moisture balance, capped at Wlimit. Mechanical outdoor air mixes with return air by humidity ratio and enthalpy; infiltration is not mixed at the coil inlet. Ventilation is not added twice.','small')
h('Apparatus dew point and bypass factor')
p('The EnergyPlus-style ADP/BF method uses rated SHR 0.77 and nominal capacity at 80°F dry bulb / 67°F wet bulb. Calibration uses each family’s reference airflow: 404 CFM/ton for standard/lab, 365 for variable/cold. Rated bypass factor is inferred from the saturated apparatus dew point. Source curves are retained without forcing exact unity at the rating point.','small')
eq('h(T,W) = 1.006 T + W(2501 + 1.86 T)  [kJ/kg dry air]\nAo = -m_rated x ln(BF_rated)\nBF = exp(-Ao / m)\nh_ADP = h_in - Qfull_kW / [m x (1 - BF)]\nT_ADP = saturated-air temperature at h_ADP\nSHR = clamp[(h(Tin,W_ADP) - h_ADP)/(h_in - h_ADP), 0, 1]')
p('T is °C, W is kg/kg, and m is dry-air mass flow in kg/s at 101,325 Pa. Qfull is mapped gross cooling capacity. Hourly SHR therefore responds to mixed-air temperature/humidity, airflow and outdoor-temperature-dependent capacity.','small')
p('For a dry coil, SHR is 1. Capacity and EIR are recalculated at the equivalent entering humidity at dry-out, found iteratively at the actual mass flow. For wet operation, latent capacity is Qfull × (1 - SHR). The on-cycle split is used for sizing, cycling, reheat and unmet cooling.','small')
p('Cycling adjusts electrical runtime, not coil geometry. No transient moisture storage is simulated. A predicted apparatus dew point below 32°F is flagged for review; freeze protection is not simulated. See the EnergyPlus coil reference on page 6.','small')

heading(3,'Sizing and hourly energy')
h('Selection without a safety margin')
p('Candidates use identical 5, 7.5, 10, 12.5, 15, 17.5, 20 or 25 nominal-ton units, subject to the selected maximum. The solver minimizes unit count, then size. It checks every valid hour, including fan heat and mixed-air conditions.')
eq('Supply CFM = count x tons/unit x CFM/ton\nMechanical OA capacity = supply CFM x allowed OA fraction\nQfull x SHR >= sensible coil need\nQfull x (1 - SHR) >= latent coil need')
p('No 1.10 or other safety multiplier is applied. Discrete unit sizes can still produce excess capacity. Mechanical ventilation must fit within the allowed outdoor-air fraction; infiltration never satisfies this requirement. A search without a feasible solution stops at 200 units and reports an error.','small')
p('Heat pumps are not sized for heating. Their nominal heating basis follows selected cooling tonnage and is adjusted by the source heating maps. Gas/resistance output is sized separately to peak coil heat need, rounded up in 10,000 BTU/hr per-unit increments, without a percentage margin. Reheat capacity is peak required electric reheat divided by unit count, rounded up to whole kW.','small')
h('Cooling and reheat')
eq('Qrequired = max(Qs / SHR, Ql / (1 - SHR))\nQdelivered = min(Qrequired, Qfull)\nPLR = Qdelivered / Qfull; runtime = min(1, PLR / PLF)\nPcompressor = Qfull / 3412.141633 x EIR / COP_rated\nPreheat = max(0, Qdelivered x SHR - Qs) / 3412.141633')
p('A zero load contributes zero to the requirement. Positive latent demand with SHR 1 cannot be met. PLF uses the source curves. Reheat offsets excess sensible cooling at COP 1; it does not fill a space-heating shortfall. Cooling/dehumidification takes priority over heating.','small')
h('Heating and energy')
eq('Qneed = max(0, building heat need - useful supply-fan heat)\nQdelivered_heat = min(Qneed, usable heating capacity)\nQunmet_heat = max(0, Qneed - usable heating capacity)\nHourly kWh = compressor/outdoor-fan kW x runtime\n           + supply-fan kW + reheat kW + resistance-heat kW\nGas therms = delivered gas heat / (0.80 x 100000)')
p('Fans run at full airflow throughout occupied hours and for a full unoccupied hour with a load call. HP lockout defaults to 0°F. Source temperature effects remain; no additional defrost or frost adjustments are applied. Cold-weather field energy and output can differ because these effects and crankcase heaters are excluded.','small')

heading(4,'Equipment data and efficiency')
base='https://github.com/NatLabRockies/ComStock/blob/f25ac375311acb2448b4ee1665a8680e92abd24b/'
source_base=base+'resources/measures/upgrade_hvac_add_heat_pump_rtu/resources/'
table(['Model family','Treatment'],[
 ['Standard heat pump / DX',link(source_base+'performance_maps_hprtu_std.json','Standard maps')+'. Highest cooling stage; single heating stage.'],
 ['Lab-data heat pump / DX',link(source_base+'performance_maps_hprtu_lab_data.json','Lab-data maps')+'. Alternative capacity and EIR grids.'],
 ['High-performance HP / DX, CAV',link(source_base+'performance_maps_hprtu_variable_speed.json','Variable-speed maps')+'. Stage 4 with full-output cycling; modulation savings excluded.'],
 ['Cold-climate HP concept',link(source_base+'performance_map_CCHP_spec_2027.json','2027 specification')+'. High heating stage; boost at 17°F and below. Uses variable-family cooling. Hypothetical equipment.'],
 ['Gas furnace / resistance',link(base+'documentation/reference_doc/tables/furnace_eff_table.tex','Gas efficiency')+' = 80%; electric resistance COP = 1. Fixed, finite output banks.'],
 ],[165,357])
h('Rated COP is not operating COP')
eq('kWrated = tons/unit x 12000 / 3412.141633\nCOPcool = clamp(3.881009 - 0.01034 kWrated, 3.02, 3.97)\nCOPheat = clamp(3.957724 - 0.008502 kWrated, 3.46, 3.99)\nCOPoperating = delivered thermal output /\n               (3412.141633 x actual electric coil input)')
p('The common rated-COP fits follow the active ComStock measure. Capacity and EIR modifiers vary independently with temperature and airflow. Cooling uses entering wet bulb (or dry-out equivalent); heating uses entering dry bulb. Both use outdoor dry bulb. Cold-climate high/boost capacity and COP stage multipliers are retained.','small')
p('Operating electric coil COP includes cycling but excludes supply-fan and reheat electricity; total HVAC electricity includes both. Gas heating has no electric COP and reports therms separately. Full-load heating COP is evaluated at the hour’s entering/outdoor conditions, independently of demand.','small')
h('Map policy and comparison limits')
p('Lookup tables use linear/bilinear interpolation. Polynomial curves use their stored coefficients and bounds. Out-of-range inputs are clamped and flagged, not extrapolated. Rounded source reference values are preserved. All 18 heating/cooling combinations are generic air-side combinations, not manufacturer packages.','small')
p('Compare unmet loads before energy. A system delivering less heat can consume less without providing equivalent service. Site energy = electricity × 3412.141633 / 1,000,000 + gas therms × 0.1, in MMBtu. This is not source energy, cost or emissions.','small')
p('Chillers, boilers, water-/ground-source systems and VRF/DOAS are outside this CAV model; defensible comparisons require their loops, pumps, condenser conditions, zones and controls.','small')

heading(5,'Worked example: Madison')
p('Madison, Wisconsin, 2025; 8,760 retrieved Sup3rCC hourly records and default building/equipment inputs. This example is a model check, not a calibrated utility forecast.','small')
e=EX['equipment']; ss=EX['summary']; cr=EX['critical']['rtu']
table(['Standard HP / standard DX','Revised output'],[
 ['Selection',f"{e['count']} × {e['tonsEach']} tons = {e['totalTons']} nominal tons"],
 ['Supply / OA capacity',f"{num(e['supplyCfm'])} / {num(e['outdoorCapacityCfm'])} CFM; {num(e['peakVentilationCfm'])} CFM ventilation required"],
 ['Operating cooling SHR',f"{ss['coolingShrMin']:.3f}-{ss['coolingShrMax']:.3f}; {ss['subfreezingCoilHours']} subfreezing-ADP hours"],
 ['Electricity / components',f"{num(ss['electricity'])} kWh total; {num(ss['fan'])} fan, {num(ss['compressor'])} compressor/outdoor fan, {num(ss['reheat'])} reheat"],
 ['Unmet heating / cooling',f"{ss['unmetHeatingHours']} / {ss['unmetCoolingHours']} hours; peak heating shortfall {num(ss['peakUnmetHeating'])} BTU/hr"],
 ['Boundary estimates',f"{num(ss['boundedHours'])} active operating hours"],
 ],[173,349])
h('Most heavily utilized cooling hour')
p(f"September 11, 13:00: {EX['critical']['weather']['temperature']*1.8+32:.2f}°F outdoors. Coil SHR is {cr['coolingShr']:.3f}, not a fixed 0.77. Sensible need is {num(-cr['sensibleDemand'])} BTU/hr and latent need is {num(-cr['latentDemand'])} BTU/hr. Available total capacity is {num(cr['availableCooling'])} BTU/hr; gross delivered cooling is {num(-cr['deliveredCooling'])} BTU/hr. No sizing margin is applied.",'small')
h('Representative equipment comparisons')
labels={'standard':'Standard HP','lab':'Lab-data HP','variable':'High-performance HP','cold':'Cold-climate concept','gas':'Gas furnace + DX','resistance':'Resistance + DX'}
table(['Heating case','Units × tons','Electricity kWh','Gas therms','Unmet heat hours'],[[labels[c['system']['heating']],f"{c['equipment']['count']} × {c['equipment']['tonsEach']}",num(c['summary']['electricity']),num(c['summary']['gasTherms']),str(c['summary']['unmetHeatingHours'])] for c in COMPARE['cases']],[142,72,116,91,101],padding=5)
p('HP cases use their corresponding cooling family; gas/resistance use standard DX. The cold-climate example uses -10°F lockout; others use 0°F. Different heating shortfalls mean these are not equal-service energy comparisons. All listed cases meet modeled cooling and ventilation.','small')
p('With retrieved solar radiation and the stated geometry, the standard selection is 475 nominal tons. This remains a large, latent-constrained CAV selection with ideal reheat; verify manufacturer latent performance and the actual ventilation design.','small')

heading(6,'Outputs, verification and sources')
table(['Result','Interpretation'],[
 ['Building loads','Heating positive; cooling negative, BTU/hr. Total cooling includes sensible and latent demand.'],
 ['Coil loads / capacities','Fan-adjusted demand, potential full-load heating, usable heat, delivered heat and shortfall. Cooling capacity is reported during cooling.'],
 ['Operating cooling SHR','On-cycle sensible/total split. Blank outside cooling. CSV also includes coil apparatus dew point and bypass factor.'],
 ['Electricity / gas','One-hour kWh by component; gas therms separately. Removed heater/defrost components are absent from hourly energy columns.'],
 ['Flags / coverage','Map boundaries, lockout, shortfall reason, subfreezing ADP count, valid-hour count and complete-year status.'],
 ],[155,367])
h('Verification and limitations')
p('Automated checks cover pinned map hashes, lookup nodes, interpolation, psychrometrics, rated SHR recovery, wet/dry coils, airflow sensitivity, no defrost humidity penalty, no margin, energy balances, finite heating capacity, all 18 equipment combinations over Madison’s full year, minimal feasible sizing and CSV alignment. Checks verify implementation, not field accuracy.','small')
p('The model omits thermal storage, warm-up recovery, detailed envelope construction, complex shading and nonrectangular solar geometry, zoning, duct losses, altitude corrections, heat recovery, economizers, humidification, off-cycle moisture re-evaporation, frost/defrost and crankcase energy. Map-boundary outputs and low-ADP operation need review. Removing defrost intentionally omits a real cold-weather effect; manufacturer extended data should guide final design.','small')
h('References')
p('1. NLR ComStock, '+link(base+'resources/measures/upgrade_hvac_add_heat_pump_rtu/measure.rb','HP-RTU measure code')+' and the four numerical files linked on page 4. Pinned commit: f25ac375311acb2448b4ee1665a8680e92abd24b. Raw source files and SHA-256 manifest are retained in the code repository.','small')
p('2. NLR, '+link('https://docs.nlr.gov/docs/fy25osti/89042.pdf','Heat Pump Rooftop Units with Standard Performance')+', NREL/TP-5500-89042 (2025); '+link('https://docs.nlr.gov/docs/fy24osti/86601.pdf','ComStock baseline gas/electric equipment')+'.','small')
p('3. '+link('https://energyplus.readthedocs.io/en/stable/guides/engineering-reference/15.2-coils.html','EnergyPlus Engineering Reference: Coils')+', DX cooling ADP/BF, dry-coil and cycling methods. This application uses a simplified steady-state adaptation, not a complete EnergyPlus simulation.','small')
p('4. '+link('https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html','PsychroLib / ASHRAE psychrometric relations')+' for saturation pressure and wet bulb. Sea-level pressure; ice saturation convention below freezing.','small')
p('5. '+link('https://developer.nlr.gov/docs/climate/sup3rcc/sup3rcc-conus-ecearth3cc-ssp245-r1i1p1f1-v0-2-2-download/','NLR Sup3rCC dataset documentation')+'. City coordinates: '+link('https://www.geonames.org/','GeoNames')+' (CC BY 4.0).','small')
p('The website’s source data and model version are included in export metadata. The NLR license is distributed with the application.','small')

heading(7,'Hourly solar heat gains')
p('The Sup3rCC request now includes temperature_2m, relativehumidity_2m, dhi, dni and ghi. Radiation is in W/m². DHI is diffuse horizontal irradiance, DNI is direct normal irradiance, and GHI is total horizontal irradiance. These are climate-model estimates, not site measurements.','small')
h('Geometry and incident solar radiation')
p('The model uses a rectangular building with equal floor plates and uniform window fraction on four vertical façades. Default: 2 stories, plan aspect ratio 2, 0° rotation (long dimension east-west), 25% windows, SHGC 0.35 and window solar multiplier 1. Roof area = total floor area / stories; wall height = stories × conditioned height.','small')
eq('Roof area = Afloor / stories\nLength = sqrt(roof area x aspect); width = roof area / length\nIwall = DNI x max(0, sun dot outward normal)\n        + DHI / 2 + ground reflectance x GHI / 2\nIroof = GHI')
p('The solar unit vector uses NOAA fractional-year declination and equation of time, the dataset grid latitude/longitude, its fixed local-standard-time UTC offset and the hour midpoint. Beam radiation is zero when the sun is below the horizon. Sky diffuse is isotropic; ground reflectance defaults to 0.20. GHI is not added to DNI as another beam term.','small')
h('Glazing and opaque surfaces')
eq('Qwindow = Iwall x Awindow x SHGC x shade multiplier\nQopaque = sum[Isurface x Aopaque x U x absorptance / ho]\nQsolar = Qwindow + Qopaque\n1 W/m2 = 0.316998331 BTU/(hr ft2)')
p('Convert incident irradiance to BTU/(hr·ft²) before multiplying imperial areas and U/ho. Default roof/wall U = 0.04/0.06 BTU/(hr·ft²·°F), solar absorptance = 0.60 and exterior film coefficient ho = 3 BTU/(hr·ft²·°F). Opaque gains use the solar part of a steady-state sol-air correction. The entered whole-building UA continues to control ordinary temperature-driven conduction; these U-values affect only solar corrections.','small')
p('Solar gain enters the sensible heat balance: it increases cooling or offsets heating. Gains are instantaneous; thermal storage, delayed cooling load, longwave sky exchange, angle-dependent SHGC, detailed overhangs and snow effects are omitted. Missing/invalid radiation or missing solar location metadata leaves dependent loads and energy blank. Zero nighttime irradiance is valid zero.','small')
h('Solar references')
p(link('https://gml.noaa.gov/grad/solcalc/solareqns.PDF','NOAA solar-position equations')+'; '+link('https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.isotropic.html','Isotropic sky transposition')+'; '+link('https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.get_ground_diffuse.html','Ground-reflected irradiance')+'.','small')

heading(8,'Utility rates and electricity CO₂')
h('Electricity tariff information')
p('OpenEI Utility Rate Database v8 retrieves approved commercial tariff candidates near the selected coordinates, effective at retrieval time. The user must select the actual utility and eligible service class. The interface exposes energy tiers, weekday/weekend period schedules, demand charges and intervals, fixed/minimum charges, dates and source links. Records may be incomplete or outdated; verify the published tariff.','small')
p('Tariff structures are displayed, not applied as a complete bill. A bill also depends on all meter loads, utility demand intervals, billing dates, taxes, riders and ratchets. One-hour HVAC data cannot reproduce subhourly billing demand or the full account bill. OpenEI requires OPENEI_API_KEY; the NLR key is not reused automatically.','small')
h('Natural gas')
p('Natural gas benchmarks follow the selected state. Actual natural gas charge structures require the building’s gas provider and its published commercial tariff, including applicable distribution, supply, fixed and demand charges. The app does not assume a local gas utility from the city or electric service territory.','small')
p('The separate EIA API uses EIA_API_KEY to retrieve the latest 12 available monthly state commercial delivered-gas averages in $/Mcf. These are benchmarks, not utility tariff structures or future-price forecasts. They include reported commodity, delivery and other charges. The application does not add fixed charges to that average or automatically convert gas volumes to therms.','small')
h('Location-based electricity generation CO₂')
eq('kg CO2/kWh = (lb CO2/MWh) x 0.45359237 / 1000\nHourly kg CO2 = hourly HVAC kWh x kg CO2/kWh\nPeriod metric tonnes CO2 = sum(hourly kg CO2) / 1000')
p('The bundled EPA Power Profiler / eGRID2023 revision 2 data maps city coordinates to candidate subregions. An optional building ZIP refines utility/subregion mapping; overlapping candidates require a choice. The 2023 total-output CO₂ factor is constant across hours and weather years. It is not marginal emissions, CO₂e, a future-grid projection or a utility-specific contractual factor. No API key is needed.','small')
p('Case totals and the hourly CSV cover electricity generation CO₂ only. Natural gas combustion, transmission losses and upstream emissions are excluded. Do not interpret gas-versus-electric electricity-only CO₂ as a total-emissions ranking. Missing energy is blank; incomplete-year totals are labeled as available hours.','small')
p(link('https://apps.openei.org/services/doc/rest/util_rates/?version=8','OpenEI URDB documentation')+'; '+link('https://www.eia.gov/dnav/ng/ng_pri_sum_a_EPG0_PCS_DMcf_m.htm','EIA commercial natural gas prices')+'; '+link('https://www.epa.gov/egrid/summary-data','EPA eGRID factors')+'.','small')

def page_frame(canvas,doc):
 canvas.saveState(); canvas.setStrokeColor(colors.HexColor('#DCE6EB')); canvas.line(45,43,567,43)
 canvas.setFont('GuideSans',8); canvas.setFillColor(GRAY); canvas.drawString(45,29,'Climate Table | HVAC energy comparison | v4.0'); canvas.drawRightString(567,29,str(doc.page)); canvas.restoreState()
OUT.parent.mkdir(parents=True,exist_ok=True)
SimpleDocTemplate(str(OUT),pagesize=(612,792),rightMargin=45,leftMargin=45,topMargin=42,bottomMargin=54,title='HVAC Energy Comparison Engineering Guide',author='Climate Table').build(story,onFirstPage=page_frame,onLaterPages=page_frame)
print(OUT)
