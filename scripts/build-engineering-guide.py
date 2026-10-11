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

heading(1,'School loads and CAV<br/>equipment comparison')
p('Engineering basis and user guide | Model cav-equipment-2.0 | 27 September 2026','small')
p('Choose heating and DX cooling equipment for two constant-air-volume (CAV) systems serving the same 150,000 ft² K-12 school. The website sizes each case for hourly cooling and ventilation, then compares electricity, gas, and remaining heating demand.')
h('Use the website')
for text in [
 '<b>1. Choose the weather.</b> Enter city, state, and year, then continue to the table. City lookup supports all 50 states and DC. The supplied Sup3rCC climate dataset covers the contiguous 48 states and DC only.',
 '<b>2. Check the school.</b> Apply occupancy, envelope, thermostat, ventilation, and gain assumptions. Weather is retained while assumptions change.',
 '<b>3. Choose two systems.</b> Select heating and cooling for scenarios A and B. Shared equipment assumptions apply to both; each case is sized independently. HP lockout is editable per case.',
 '<b>4. Compare and export.</b> Review energy and unmet loads together. Select A or B for the hourly table and results CSV; download Comparison CSV for both case summaries. Pages 10-12 explain the equipment choices.']:
 p(text)
h('What the selection means')
p('The result is a <b>generic preliminary capacity selection</b>, using NLR ComStock heat-pump maps and gas/electric coil assumptions. It is not a manufacturer model number, a procurement schedule, or a full building simulation. Unit count is minimized first; nominal size is minimized second. Installed cost and annual energy are not optimization objectives.')
table(['Output','How to read it'],[
 ['Cooling and heating','Thermal rates in BTU/hr. Cooling is negative; heating is positive. Total cooling already includes sensible cooling.'],
 ['Energy use','Electricity in kWh; gas input in therms. Combined site energy is MMBtu. Includes fans, defrost, crankcase, electric reheat, and selected primary electric heat.'],
 ['Unmet heating','Positive BTU/hr by which coil heat need exceeds usable heating capacity after fan heat is credited. No auxiliary space heater is assumed.'],
 ['Map-boundary hours','Operating conditions outside a tabulated range use the nearest boundary. These hours make the result less certain.'],
 ],[135,387])
p('The weather is a climate projection, not observed weather or a design-day file. Meeting this one modeled year does not establish design-day adequacy.','small')

heading(2,'School load basis')
p('The school is one aggregate zone with no thermal storage. Loads are steady-state balances for each hour in local standard time; daylight saving time and February 29 are excluded. Weekends and hours outside the occupied schedule use setback temperatures.')
table(['Default input','Value'],[
 ['Floor area / conditioned height','150,000 ft² / 14 ft'],
 ['Occupancy / schedule','1,200 people; Monday-Friday 07:00-17:00; June-August 10%; no holidays'],
 ['Occupied / unoccupied setpoints','70°F heat, 75°F cool / 60°F heat, 85°F cool; maximum indoor RH 50%'],
 ['Envelope UA / floor area','0.10 BTU/(hr·ft²·°F), or total UA = 15,000 BTU/(hr·°F)'],
 ['Infiltration / mechanical ventilation','0.15 ACH = 5,250 CFM always; occupied OA = 10 CFM/person + 0.12 CFM/ft²'],
 ['Lighting / equipment','0.9 / 0.6 W/ft² at full occupancy; unoccupied 10% / 25%; proportional ramp with occupancy'],
 ['People / assumed solar','245 sensible + 155 latent BTU/hr per person; solar peak 4 BTU/(hr·ft²), hourly-averaged sine from 06:00-18:00'],
 ],[170,352])
h('Hourly thermal demand')
p('Let F be infiltration plus mechanical ventilation in CFM, G the sensible internal and solar gains in BTU/hr, and H the total sensible heat-transfer coefficient. Temperatures below are in °F. Positive Qs and Ql below are removal magnitudes; cooling columns in the table use their negatives.')
eq('H = UA + 1.08 F\nQh = max[0, H(Theat - Tout) - G]\nQs = max[0, H(Tout - Tcool) + G]\nQl = max[0, 0.68 F x 7000(Wout - Wlimit) + people latent gain]')
p('W is humidity ratio in lb water/lb dry air. The zone temperature is the free-floating equilibrium Tout + G/H, limited to the heating/cooling deadband. Wlimit is the humidity ratio at that zone temperature and the maximum indoor RH. Dry outside air can offset occupant moisture. The equipment calculation repeats this balance with supply-fan heat included; the original school-load columns remain unchanged.')
h('Weather and psychrometrics')
p('Dry bulb converts as °F = 1.8 × °C + 32. Dew/frost point is obtained by inverting the ASHRAE saturation-pressure equations. Humidity ratio is 0.621945 Pv / (P - Pv), with Pv = RH × saturation pressure and P = 101,325 Pa. RH is a fraction in this equation. Zero RH has no finite dew point; missing weather leaves dependent results blank. Below freezing the saturation convention is over ice. Standard-air approximations apply at every elevation.','small')

heading(3,'Automatic equipment selection')
p('Available nominal sizes are 5, 7.5, 10, 12.5, 15, 17.5, 20, and 25 tons, limited by the selected maximum. These bins are engineering assumptions, not a list of manufacturer products. One nominal ton is 12,000 BTU/hr of gross cooling. Heat-pump rated heating basis equals nominal cooling; cold-climate stage multipliers apply on page 11. Gas/resistance output banks are sized separately (page 11).')
table(['Equipment assumption','Default and purpose'],[
 ['Supply airflow','404 CFM per nominal cooling ton; constant when fans run'],
 ['Maximum outdoor-air fraction','25% of supply flow; screening OA handling limit'],
 ['Supply-fan power','0.50 W/CFM; all input power becomes air heat'],
 ['Cooling sizing margin','10%, applied to the required gross coil cooling'],
 ['Coil sensible heat ratio (SHR)','0.77, held constant; latent fraction is 1 - SHR'],
 ['Dehumidification reheat','Ideal electric resistance reheat, COP 1; required bank rounded up to whole kW per unit'],
 ],[171,351])
h('Two constraints, checked at every valid hour')
eq('Supply CFM = count x tons/unit x CFM/ton\nMechanical OA <= supply CFM x maximum OA fraction\nRequired coil cooling = max[Qs,coil / SHR, Ql,coil / (1 - SHR)]\nAvailable gross cooling >= required coil cooling x (1 + margin)')
p('The coil demand includes supply-fan heat. Capacity is adjusted with the NLR temperature and airflow maps, so nominal tonnage alone is not the acceptance test. The same coil must cover sensible and latent demand; their separate capacity fractions are checked through the maximum above. This also covers total demand.')
p('The search tries unit counts in increasing order and sizes from small to large. It stops at the first feasible arrangement, after checking every valid hour. Search is limited to 200 identical units. Failure is shown explicitly; missing weather produces a provisional result. Heating capacity is deliberately not a sizing constraint.')
h('Ventilation and moisture details')
p('Only scheduled mechanical outdoor air counts toward ventilation. Infiltration adds a thermal/moisture load but does not count as ventilation capacity. The actual outdoor-air flow follows the schedule; the maximum OA fraction is a capacity limit, not an instruction to ventilate continuously at that fraction.')
p('With a fixed SHR, latent demand can force substantial overcooling. Electric reheat offsets that surplus sensible cooling. The reported reheat bank is an additional required option; the generic NLR heat-pump maps do not establish that an actual product supports it. Off-cycle condensate re-evaporation is not modeled.','small')

heading(4,'Standard heat-pump reference')
p('Pages 4-9 detail the standard heat-pump case at its default 0°F lockout. Pages 10-12 extend this basis to the other selectable equipment families. The standard maps come from NLR ComStock. Cooling uses coil-entering wet-bulb temperature and outdoor dry bulb. Heating uses coil-entering dry bulb and outdoor dry bulb. Supply-fan power is added separately to the mapped heat-pump input. The report and pinned source are listed on page 8.')
table(['Map','Entering-air grid','Outdoor dry-bulb grid'],[
 ['Cooling capacity: high stage','58-76°F wet bulb','85-125°F'],
 ['Cooling EIR: high stage','57-72°F wet bulb','75-125°F'],
 ['Heating capacity and EIR','55-80°F dry bulb','-10 to 60°F'],
 ],[204,159,159])
p('Ranges are rounded for readability; the stored data use °C to two decimals. Bilinear interpolation is used between grid points. Each map input is held at its nearest tabulated boundary outside the grid, with an hourly flag. No extrapolated capacity improvement is assumed. Flow and defrost polynomial input limits are also enforced. The compressor heating lockout below 0°F overrides the colder map points.','small')
h('Rated COP and airflow effects')
eq('Rated kW = nominal tons/unit x 12000 / 3412.141633\nCooling COP = clamp(3.881009 - 0.01034 x rated kW, 3.02, 3.97)\nHeating COP = clamp(3.957724 - 0.008502 x rated kW, 3.46, 3.99)')
p('These are rated COP baselines, not constant operating efficiencies. NLR capacity and energy-input-ratio (EIR) maps vary separately with entering-air and outdoor temperatures; defrost and cycling also affect actual COP. Flow modifiers use the source reference flows of 404 CFM/ton for cooling and 420 CFM/ton for heating. The source fits are used directly without forcing unity at a flow ratio of one. Only the high cooling stage is used; compressor cycling adapts that family to the requested CAV operation.','small')
# Exact tabulated heating-capacity factors, before airflow/defrost.
heat=next(c for c in MAPS if c['name']=='h_cap_T')
points=[list(map(float,v.split(','))) for k,v in heat.items() if k.startswith('data_point')]
fig,ax=plt.subplots(figsize=(7.25,2.05)); fig.patch.set_facecolor('white')
for t,label,color in [(12.78,'55°F entering DB','#8296aa'),(21.11,'70°F entering DB','#286e64'),(26.67,'80°F entering DB','#b8794f')]:
 vals=sorted((b*1.8+32,z) for a,b,z in points if a==t); ax.plot([v[0] for v in vals],[v[1] for v in vals],label=label,color=color,linewidth=1.8)
ax.axvspan(-10,0,color='#eef1f4'); ax.axvline(0,color='#95a4b2',ls='--',lw=.8)
ax.set_xlim(-10,60); ax.set_ylim(0,1.5); ax.set_xlabel('Outdoor dry bulb (°F)',fontsize=8); ax.set_ylabel('Capacity / rated',fontsize=8); ax.tick_params(labelsize=8); ax.grid(axis='y',alpha=.2); ax.spines[['right','top']].set_visible(False); ax.legend(fontsize=7.3,frameon=False,loc='upper left'); fig.tight_layout(pad=1)
chart=ROOT/'docs/rtu-heating-map.png'; fig.savefig(chart,dpi=220); plt.close(fig)
story.append(Image(str(chart),width=522,height=148)); p('Source heating-capacity map at three entering temperatures, before airflow and defrost corrections. Shaded region is unavailable under the default case\'s 0°F heating lockout.','small')

heading(5,'Hourly cooling and electricity')
h('Return air and mixed air')
p('The fan runs at full selected flow throughout occupied hours, and for an entire unoccupied hour with a heating, sensible-cooling, or dehumidification call. All selected units are treated as one pool. There is no fan-speed reduction or unit-by-unit staging. Fan input is supply CFM × W/CFM / 1,000 in kW. Its heat is added downstream of the coil and shifts the zone balance.')
eq('Treturn = clamp[Tout + (G + fan heat)/H, Theat, Tcool]\nWreturn = min[Wlimit, Wout + latent gain/(0.68 x 7000 x F)]\nfOA = scheduled mechanical OA / selected supply CFM')
p('Wlimit is evaluated at Treturn. If F is zero, the model uses Wlimit when people generate moisture, otherwise the lower of Wlimit and outdoor W. This assumes a steady moisture balance, no humidifier, and no modeled drying below the limit during excess latent removal. Return-air conditions describe the assumed target zone, not the drifting space temperature during unmet heating.','small')
p('Outside and return air are mixed by humidity ratio and enthalpy. The CFM fraction approximates dry-air mass fraction. For temperature T in °C, h = 1.006 T + W(2501 + 1.86 T) in kJ/kg dry air. Mixed h and W determine entering dry bulb; inversion of the ASHRAE wet-bulb relation determines entering wet bulb. Infiltration does not mix at the rooftop inlet. Ventilation load is already in the school balance and is not added a second time.')
h('Cooling capacity, cycling, and electric reheat')
eq('Qavailable = Qrated x capacity-temperature factor x capacity-flow factor\nPfull = (Qavailable / 3412.141633) x EIR factors / rated COP\nQdelivered = min(required coil cooling, Qavailable)\nPLR = Qdelivered / Qavailable\nCooling PLF = 0.75 + 0.25 PLR; runtime = min(1, PLR/PLF)\nPreheat = max[0, SHR x Qdelivered - Qs,coil] / 3412.141633')
p('Pfull and Preheat are in kW; Q values are positive BTU/hr magnitudes here. Reheat is electric resistance at COP 1. It cancels unwanted sensible cooling, but does not supply positive space-heating demand. When dehumidification and heating are simultaneous, cooling takes priority and the remaining heating is unmet.')
h('Electricity in each one-hour record')
eq('kWh = Pfull x runtime + supply-fan kW + defrost kW\n      + crankcase kW + dehumidification-reheat kW')
p('The numerical one-hour kWh equals the average kW over that hour; it is not instantaneous peak compressor input. Lighting and plug loads contribute thermal gains but their electricity is not included in the RTU energy column.','small')

heading(6,'Heating, defrost, and shortfall')
p('Capacity and EIR depend on entering and outdoor dry bulb. Reverse-cycle defrost uses the EnergyPlus relationships referenced by NLR. Below 0°F, heat-pump heating is zero; fans and crankcase heaters may still consume electricity.')
h('Defrost adjustment at outdoor temperature at or below 40°F')
p('For the equations below, temperatures are °C, W is kg/kg dry air, f is the defrost time fraction, and Qrated is rated heating capacity. Calculate saturation humidity ratio at the estimated outdoor-coil surface temperature.')
eq('Tcoil = 0.82 Tout - 8.589\ndW = max[0.000001, Wout - Wsat(Tcoil)]\nf = dW / (dW + 0.01446)\nCapacity multiplier = 0.875(1 - f)\nPower multiplier = 0.954(1 - f)\nReverse-cycle heating penalty / Qrated = 0.01 f(7.222 - Tout)/1.01667')
p('Net available heating equals mapped gross heating × the capacity multiplier, less the reverse-cycle penalty. Compressor/outdoor-fan input is mapped gross heating divided by rated COP, multiplied by EIR factors and the power multiplier. Above 40°F, both multipliers are one and the penalty is zero.','small')
eq('Additional defrost kW = (Qrated/3412.141633) x f/1.01667\n                       x defrost-EIR(entering WB, Tout) x runtime')
p('The source defrost-EIR biquadratic and its input/output limits are retained. This is a simplified hourly defrost treatment, not a replication of the complete EnergyPlus coil solver. At the freezing transition, psychrometric saturation uses the ice convention.','small')
h('Heating part load and unmet demand')
p('HP heat need is building heat need minus the useful supply-fan heat credit. Delivered heating is capped at the smaller of this need and usable net HP capacity. Heating runtime is PLR/PLF, capped at one, using the NLR heating part-load table. Positive PLR below 0.02 uses the table\'s first PLF value. Heating PLF ranges from 0.3754 at PLR 0.02 to 1 at full load.')
eq('Unmet heating = max[0, HP heat need - usable HP capacity]\nCrankcase kW = count x 0.060(tons/unit / 10)^0.67 x (1 - runtime)')
p('Crankcase power applies below 4.4°C (39.92°F) and is counted once per physical unit. Heat-pump electrical input excludes supply-fan power, which is added separately. The display counts unmet-heating hours when the remaining load exceeds 1 BTU/hr; the energy-weighted thermal shortfall includes all positive values.')
p('<b>No supplemental space heating is assumed.</b> Reheat only offsets dehumidification overcooling. External backup-heating electricity is excluded.','small')

heading(7,'Worked example: Madison, WI, 2025')
p('This example uses the retrieved Sup3rCC EC-Earth3-CC / SSP2-4.5 weather year and all defaults in this guide. It illustrates the screening method; it is not a prediction of a particular school\'s utility bill.')
e=EX['equipment']; ss=EX['summary']; cr=EX['critical']['rtu']
table(['Result','Default model output'],[
 ['Selected arrangement',f"{e['count']} × {e['tonsEach']} nominal tons; {e['totalTons']} total tons"],
 ['Rated capacity per unit','300,000 BTU/hr cooling and 300,000 BTU/hr heating before map adjustments'],
 ['Supply / mechanical outdoor air',f"{num(e['supplyCfm'])} CFM supply; {num(e['outdoorCapacityCfm'])} CFM OA capacity vs {num(e['peakVentilationCfm'])} CFM required"],
 ['Required reheat option',f"{e['reheatKwEach']} kW electric per unit, rounded up"],
 ['Annual RTU electricity',f"{num(ss['electricity'])} kWh across 8,760 valid hours"],
 ['Peak unmet heating',f"+{num(ss['peakUnmetHeating'])} BTU/hr; {ss['unmetHeatingHours']} lockout hours with shortfall; {ss['unmetHeatingBtu']/1e6:.2f} million BTU thermal shortfall"],
 ['Cooling / map checks',f"0 unmet-cooling hours; {num(ss['boundedHours'])} operating hours use a map boundary"],
 ],[170,352])
h('Why 600 nominal tons?')
p('The governing cooling hour is September 11 at 10:00, with outside air 81.03°F and 75.75% RH. Fan-adjusted sensible demand is 2,348,148 BTU/hr; latent demand is 1,537,342 BTU/hr. The constant 0.77 SHR makes latent removal the governing constraint:')
eq('Sensible requirement = 2,348,148 / 0.77 = 3,049,542 BTU/hr\nLatent requirement = 1,537,342 / 0.23 = 6,684,097 BTU/hr\nWith 10% margin: 6,684,097 x 1.10 = 7,352,507 BTU/hr\nAdjusted selected cooling available = 7,422,251 BTU/hr')
p('This capacity check uses a map boundary because outdoor temperature is below the cooling-capacity grid. The large selection is driven by the fixed-SHR moisture constraint, not the school\'s peak total load divided by 12,000. A different verified coil latent performance or dedicated outdoor-air design can materially change the result.','small')
table(['Annual electrical component','kWh','Share'],[[label,num(ss[key]),f"{100*ss[key]/ss['electricity']:.1f}%"] for label,key in [('CAV supply fans (121.2 kW when on)','fan'),('Compressor + outdoor fan','compressor'),('Dehumidification reheat','reheat'),('Crankcase heaters','crankcase'),('Reverse-cycle defrost','defrost')]], [300,115,107])


heading(8,'Reading results and engineering limits')
table(['CSV field group','Meaning'],[
 ['School heating / sensible / total cooling','Original building demand, excluding fan heat. Cooling is negative; heating positive. Latent cooling is also exported.'],
 ['Coil demand / delivered / available capacity','Coil need is after fan heat. Potential heating capacity is evaluated every hour; usable capacity is zero during cooling priority. Delivered heat never exceeds usable capacity. Cooling capacity is evaluated in cooling mode.'],
 ['RTU electricity / component kWh','Hourly electricity and six components, including primary resistance. Gas input is separate. Full-load electric heating input/COP are operating-point values; sum actual kWh for energy.'],
 ['Unmet heating / unmet cooling','Remaining positive BTU/hr. Unmet cooling adds any sensible and latent deficits. Heating shortfall has no assumed backup-heater electricity.'],
 ['Return and entering air / runtime / status','Assumed return DB and W; mixed coil-entering DB/WB; OA and compressor runtime fractions; map-boundary, lockout, and simultaneous-demand notes.'],
 ],[167,355])
h('What to verify before using the selection for design')
p('Confirm the actual school schedule, zoning, thermal mass, envelope, solar exposure, design weather, ventilation standard and distribution effectiveness. The model has no holidays, warm-up recovery, duct losses, heat recovery, economizer, humidification, zonal diversity, altitude correction, or outage/redundancy allowance. Units share one common mode and airflow pool.','small')
p('Check manufacturer extended performance at the actual mixed-air conditions, supply airflow, static pressure, fan heat, SHR, frost/defrost conditions, cycling behavior, low-temperature lockout, outdoor-air hardware, and reheat availability. Constant SHR and ideal electric reheat do not establish humidity control in a real CAV coil. Missing condensate re-evaporation can understate latent demand and energy. Curve-boundary hours are estimates, not validated extended performance.','small')
h('Sources and reproducibility')
p('1. NLR, Kim, CaraDonna and Parker, <i>ComStock Measure Documentation: Heat Pump Rooftop Units with Standard Performance</i>, NREL/TP-5500-89042, June 2025. '+link('https://docs.nlr.gov/docs/fy25osti/89042.pdf','Report PDF')+'.','small')
base='https://github.com/NatLabRockies/ComStock/blob/f25ac375311acb2448b4ee1665a8680e92abd24b/'
p('2. '+link(base+'resources/measures/upgrade_hvac_add_heat_pump_rtu/resources/performance_maps_hprtu_std.json','Pinned ComStock numerical maps')+' and '+link(base+'resources/measures/upgrade_hvac_add_heat_pump_rtu/measure.rb','measure code')+'. Commit f25ac375311acb2448b4ee1665a8680e92abd24b; retrieved September 26, 2026. Source JSON SHA-256:','small')
p('1119708509b5b26cf41f41c2296412f3f1637e2407560c20abcca9799dd0a24b','small')
p('3. '+link('https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/coils.html','EnergyPlus Engineering Reference: DX heating coils')+' (defrost and cycling relationships). 4. '+link('https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html','PsychroLib / ASHRAE psychrometric equations')+' (MIT license). 5. '+link('https://developer.nlr.gov/docs/climate/sup3rcc/sup3rcc-conus-ecearth3cc-ssp245-r1i1p1f1-v0-2-2-download/','NLR Sup3rCC dataset documentation')+'.','small')
p('Verification covers source-file hash, map grid nodes and interpolation, psychrometric reference values, fan-heat balance, lockout, above-lockout shortfalls, variable COP, cooling/reheat balance, full-year energy sums, ventilation excluding infiltration, minimum feasible selection, missing weather, and CSV values. This verifies the implemented equations, not agreement with measured building performance.','small')
p('ComStock™ is the source performance family, not this application. No NLR endorsement is implied. The source redistribution '+link(base+'LICENSE.txt','license')+' is also distributed with the website. Results CSV metadata records every applied assumption and the pinned source version.','small')

heading(9,'Heating capacity and efficiency')
p("Heating capacity and electrical input are calculated independently of the requested load. NLR's capacity map and EIR map are both functions of outdoor dry bulb and coil-entering dry bulb. Unit size sets nominal output and rated COP; unit count scales the total capacity and power.")
eq('Qmap = count x rated BTU/hr per unit x capacity factors\nPmap = Qmap x EIR factors / (3412.141633 x rated COP)\nCOPfull = net available heating / (3412.141633 x full-load kW)')
p('Apply the page 6 frost/defrost corrections to Qmap and Pmap. Full-load kW includes compressor/outdoor-fan input plus defrost, but excludes the supply fan. The following single-unit points use 404 CFM/ton, 40% entering RH, and 60% outdoor RH. All are within the stored map limits.','small')
table(['Unit tons','Outside °F','Entering °F','Net heating BTU/hr','HP input kW','Full-load COP'],[[str(c['tons']),str(c['outdoorF']),str(c['enteringF']),num(c['capacityBtu']),f"{c['inputKw']:.2f}",f"{c['cop']:.2f}"] for c in HEAT['cases']],[54,65,65,130,110,98],padding=4)
h('Load-capacity balance and actual hourly energy')
eq('Qneed = max(0, building heat need - useful fan heat)\nQdelivered = min(Qneed, usable HP capacity)\nQunmet = max(0, Qneed - usable HP capacity)\nkWh_HP = full-load kW x runtime fraction x 1 hour')
p('Usable capacity is zero below the 0°F heating lockout or when cooling/dehumidification takes priority. During heating, runtime follows delivered heat / available heat and the NLR cycling factor. At a capacity shortfall, runtime is 1: excess demand increases unmet heating, not compressor power. Operating COP uses delivered heat and actual HP electricity; it is blank when the compressor is off.','small')
h('Deliberately undersized check at 17°F outdoors')
x=HEAT['undersizedCase']
p(f"One 25-ton unit at {x['mixedDbF']:.0f}°F entering dry bulb and {x['mixedWbF']:.2f}°F entering wet bulb serves a test load of {num(x['buildingNeed'])} BTU/hr. Fan heat supplies {num(x['fanHeatCredit'])} BTU/hr, leaving {num(x['heatingDemand'])} BTU/hr for the heat pump. The unit can provide only {num(x['availableHeating'])} BTU/hr, so unmet heating is <b>+{num(x['unmetHeating'])} BTU/hr</b>. It draws {x['heatingFullLoadKw']:.2f} kW for the heat pump plus {x['fanKwh']:.2f} kW for the supply fan: {x['electricity']:.2f} kWh in that hour.",'small')
p(f"The Madison default selects 600 nominal tons for cooling and has {ss['capacityLimitedHours']} capacity shortfalls above lockout. All {ss['unmetHeatingHours']} shortfall hours are lockout hours. Its operating heating COP spans {ss['heatingCopMin']:.2f}-{ss['heatingCopMax']:.2f} with cycling. The standard case retains the original curve-based annual energy result; the comparison adds other equipment without changing this reference calculation.",'small')


heading(10,'Equipment choices and NLR sources')
p('Six heating choices and three cooling choices can be paired independently. Each case is a generic air-side coil combination on a shared CAV distribution model, not a certified manufacturer package. The same weather and school inputs are used for both cases.')
source_base=base+'resources/measures/upgrade_hvac_add_heat_pump_rtu/resources/'
table(['Heating option','Source and treatment'],[
 ['Standard heat pump',link(source_base+'performance_maps_hprtu_std.json','Standard HP-RTU maps')+'. Highest cooling stage; one heating stage.'],
 ['Lab-data heat pump',link(source_base+'performance_maps_hprtu_lab_data.json','Laboratory-informed HP-RTU maps')+'. Alternative capacity and EIR grids.'],
 ['High-performance HP, CAV',link(source_base+'performance_maps_hprtu_variable_speed.json','Variable-speed family')+'. Stage 4 curves with full-output cycling. Lower-speed modulation is not simulated.'],
 ['Cold-climate HP, concept',link(source_base+'performance_map_CCHP_spec_2027.json','2027 challenge specification maps')+'. Hypothetical equipment: high stage, with boost at 17°F and below. Not a commercially selected product.'],
 ['Gas furnace, 80%',link(base+'documentation/reference_doc/tables/furnace_eff_table.tex','ComStock furnace assumptions')+'. Constant 80% thermal efficiency; gas input is reported separately.'],
 ['Electric resistance, COP 1',link('https://docs.nlr.gov/docs/fy24osti/86601.pdf','NLR gas/electric baseline description')+'. Delivered heat equals electrical input in consistent units.'],
 ],[157,365])
h('Cooling choices')
p('Standard DX and lab-data DX use their respective highest-stage HP-RTU cooling maps. High-performance DX uses stage 4 of the variable-speed family; the cold-climate specification uses the same cooling curve set. These are DX component models, not an independent catalog of conventional AC products.')
h('What is shared and what changes')
p('School load assumptions, supply CFM per nominal ton, W/CFM, maximum outdoor-air fraction, SHR, and cooling sizing margin are common to A and B. Each cooling family independently determines unit count/size and therefore total airflow, fan heat, and fan energy. Heating choice determines heating output and fuel. Weather is fetched once; changing a case recalculates locally.')
p('For every HP family, the default heating lockout is 0°F, matching the pinned measure argument. Lower lockout settings are analyst assumptions, not evidence that a real product can operate there. Inputs beyond a performance range use the nearest boundary and are flagged.','small')
h('How to read a comparison')
p('First compare unmet heating/cooling and valid-hour coverage. Then compare electricity, gas, and combined site energy. Lower energy with more unmet load is not an equal-comfort saving. Gas therms and electric kWh must not be added directly. Neither site energy nor this model establishes cost or emissions.')

heading(11,'Additional equipment equations')
h('Finite gas and resistance heating banks')
p('After cooling/ventilation sizing, find the peak coil heating demand after fan heat. The primary heating bank is sized to that peak plus 10%, rounded up in 10,000 BTU/hr output increments per selected unit. This sizing rule is an explicit application assumption; it is not a manufacturer capacity catalog. No additional HP backup bank is added.')
eq("Qbank,unit = ceil[1.10 x peak(Qneed)/(count x 10000)] x 10000\nQavailable = count x Qbank,unit\nQdelivered = min(Qneed, usable Qavailable)\nQunmet = max(0, Qneed - usable Qavailable)\nGas therms/hour = Qdelivered / (0.80 x 100000)\nResistance kWh/hour = Qdelivered / 3412.141633")
p('Gas and resistance capacities are constant at the installed output rating. They have no outdoor-temperature derating or HP defrost. The gas model omits pilot, inducer, ignition, and burner cycling losses; its shared supply fan remains included. DX cooling crankcase heat remains on when the compressor is off, even during furnace/resistance operation. Cooling/dehumidification priority applies to both cases.','small')
h('High-performance and cold-climate adaptation')
p('The variable-speed family uses highest-stage temperature polynomials, with entering dry bulb as the first heating input and outdoor dry bulb as the second. Its descriptive axis labels are reversed in the JSON; coefficient limits and the EnergyPlus coil convention establish this order. Polynomial bounds are enforced. Reference flows are 365 CFM/ton cooling and 411 CFM/ton heating; the standard/lab families use 404 and 420.')
p('The cold-climate concept uses high stage above 17°F, boost at or below 17°F, subject to the selected lockout. Its source rated stage is stage 2. High/boost capacity multipliers are 1.350190651 / 1.388985813; COP multipliers are 1.097922025 / 0.722198906. The capacity and EIR tables are applied separately. Stage capacity also scales the reverse-cycle capacity penalty and defrost power.','small')
p('All families use the common rated-COP size fits on page 4, as called by the active pinned measure. The advanced COP helper functions defined in that source are not invoked by its active assignment; they are not silently substituted here. Full-output cycling and constant airflow deliberately exclude lower-stage efficiency and fan-speed savings. This is a CAV adaptation, not a reproduction of the NLR variable-speed annual simulation.','small')
h('Comparable energy and exports')
eq("Site energy (MMBtu) = kWh_electric x 3412.141633 / 1000000\n                    + gas_therms x 0.1")
p('The hourly CSV identifies heating/cooling choices, source URLs, lockout, and selected output bank. It adds Gas_input_therms, Primary_resistance_heating_kWh, and Site_energy_MMBtu. Generic heating columns replace the prior HP-only names. Gas-heating electric COP and full-load electric input are blank; gas thermal efficiency is 0.80. A separate Comparison CSV exports both case summaries.','small')

heading(12,'Worked equipment comparison')
p('Madison, Wisconsin, 2025; the same retrieved 8,760-hour weather and default school/CAV assumptions. Each row below pairs an HP with its own cooling family; gas/resistance use standard DX. The cold-climate example explicitly lowers lockout to -10°F; all other HP cases use 0°F.')
labels={'standard':'Standard HP','lab':'Lab-data HP','variable':'High-performance HP, CAV','cold':'Cold-climate concept, -10°F','gas':'Gas furnace + DX','resistance':'Resistance + DX'}
table(['Heating / cooling case','Units × tons','Electricity kWh','Gas therms','Site MMBtu','Unmet heat hours'],[[labels[c['system']['heating']],f"{c['equipment']['count']} × {c['equipment']['tonsEach']}",num(c['summary']['electricity']),f"{c['summary']['gasTherms']:,.0f}",f"{c['summary']['siteMMBtu']:,.1f}",str(c['summary']['unmetHeatingHours'])] for c in COMPARE['cases']],[141,60,93,68,76,84],padding=5)
h('Interpretation')
p('Every case meets modeled cooling and ventilation for this year. The standard HP leaves 70 heating hours unmet; the gas and resistance banks cover all modeled heating hours. The cold-climate concept leaves 19 hours unmet at its -10°F setting. These cases therefore deliver different amounts of heat; the electricity totals alone cannot establish an equal-service saving.','small')
p('High-performance source data do not guarantee lower annual energy in this CAV adaptation. Different capacity curves can change the selected count and constant fan power, while the source system’s variable-speed savings are excluded. This building’s fixed-SHR latent constraint and electric reheat dominate selection; see page 7.','small')
h('Equipment reviewed but not selectable')
table(['NLR model family','Additional model required for a defensible comparison'],[
 ['Air-/water-cooled chillers','Chilled-water temperature and flow, condenser conditions, pump and cooling-tower electricity, part-load plant control.'],
 ['Condensing/electric boilers','Hot-water supply/return temperatures, distribution losses, pumps, coil performance, and boiler part-load control.'],
 ['Ground-/water-source heat pumps','Entering-water temperature and flow; ground or common water-loop heat balance; pumping and auxiliary plant.'],
 ['VRF and DOAS / minisplits','Zone diversity, refrigerant piping, outdoor-air system loads, simultaneous modes, and controls.'],
 ],[166,356],padding=5)
p('These families were identified in the same '+link(base+'resources/measures','ComStock measure repository')+'. They are excluded from the selectable CAV coil comparison; their energy is not approximated with the air-source heat-pump curves.','small')
p('All 18 heating/cooling combinations were checked against the full Madison year. Checks cover finite output, thermal/electric/gas balances, all lookup nodes, polynomial axis order, map-boundary behavior, lockout, selection, and both exports. The original standard-case annual electricity is unchanged. Raw maps, pinned commit, SHA-256 checksums, and the worked cases are versioned with the application.','small')

def page_frame(canvas,doc):
 canvas.saveState(); canvas.setStrokeColor(colors.HexColor('#DCE6EB')); canvas.line(45,43,567,43)
 canvas.setFont('GuideSans',8); canvas.setFillColor(GRAY); canvas.drawString(45,29,'Climate Table  |  CAV equipment comparison  |  v2.0'); canvas.drawRightString(567,29,str(doc.page)); canvas.restoreState()
OUT.parent.mkdir(parents=True,exist_ok=True)
SimpleDocTemplate(str(OUT),pagesize=(612,792),rightMargin=45,leftMargin=45,topMargin=42,bottomMargin=54,title='Climate Table - CAV Equipment Comparison Engineering Guide',author='Climate Table').build(story,onFirstPage=page_frame,onLaterPages=page_frame)
print(OUT)
