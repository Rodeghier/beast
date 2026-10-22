"""Extract the selected catalog PDF and fit cooling capacity and SHR at maximum listed airflow.

Requires numpy, scipy, matplotlib, pypdf and reportlab. No website data is changed.
Run with --source PATH [--output PATH] [--include-dual-fuel].
"""
from pathlib import Path
import argparse, csv, hashlib, json, re, sys, zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCAL_PACKAGES = ROOT / 'work/precedent-cooling/python-packages'
if LOCAL_PACKAGES.exists(): sys.path.insert(0, str(LOCAL_PACKAGES))
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial import ConvexHull
from pypdf import PdfReader

TERMS = ['1', 'x', 'y', 'z', 'x^2', 'x*y', 'x*z', 'y^2', 'y*z', 'z^2']
AXES = ['outdoor_dry_bulb_F', 'entering_wet_bulb_F', 'entering_dry_bulb_F']

def extract(source):
    models, rows = {}, []
    current = ambient = cfm = pending = None
    def flush():
        nonlocal pending
        if pending is None: return
        values = pending['tokens']
        assert len(values) == len(pending['ambient']) * 6, pending
        for i, temperature in enumerate(pending['ambient']):
            for j, wb in enumerate([61, 67, 73]):
                q, shc = values[i*6+j*2:i*6+j*2+2]
                assert (q == '-') == (shc == '-'), pending
                gross, sensible = (None, None) if q == '-' else (float(q), float(shc))
                assert gross is None or 0 < sensible <= gross, (pending, gross, sensible)
                rows.append(dict(table=pending['table'], pdf_page=pending['page'], printed_page=pending['page']+40,
                    cfm=pending['cfm'], entering_dry_bulb_F=pending['db'], entering_wet_bulb_F=wb,
                    outdoor_dry_bulb_F=temperature, gross_capacity_MBh=gross, sensible_capacity_MBh=sensible,
                    shr=None if gross is None else sensible/gross))
        pending = None
    for page_index, page in enumerate(PdfReader(source).pages, 1):
        for raw in (page.extract_text() or '').splitlines():
            line = raw.strip()
            match = re.match(r'Table (\d+)\. .*?([\d.]+) tons? (standard|high) efficiency, (heat pump|dual fuel)', line)
            if match:
                flush(); number = int(match[1])
                if number != current: current, ambient, cfm = number, None, None
                models[number] = dict(table=number, nominal_tons=float(match[2]), efficiency=match[3], equipment=match[4])
            elif line.startswith('Ambient Temperature'):
                flush(); ambient = [int(v) for v in re.findall(r'Ambient Temperature (\d+)', line)]
            elif re.fullmatch(r'\d{3,5}', line): flush(); cfm = int(line)
            elif re.fullmatch(r'(75|80|85|90)(?:\s+(?:[\d.]+|-)){4,}', line):
                flush(); assert current and ambient and cfm, (page_index, line)
                tokens = line.split()
                pending = dict(table=current, page=page_index, cfm=cfm, db=int(tokens[0]), ambient=list(ambient), tokens=tokens[1:])
            elif pending and re.fullmatch(r'(?:-\s*)+', line): pending['tokens'].extend(line.split())
        flush()
    assert set(models) == set(range(10, 58)), 'Expected all 48 catalog tables.'
    maximum = {t: max(r['cfm'] for r in rows if r['table'] == t) for t in models}
    seen = set()
    for r in rows:
        key = tuple(r[k] for k in ['table', 'cfm', *AXES])
        assert key not in seen, key
        seen.add(key); r.update(models[r['table']]); r['max_cfm'] = maximum[r['table']]
        r['selected_max_cfm'] = r['cfm'] == maximum[r['table']]
    return models, rows

def design(rows):
    values = np.array([[r[k] for k in AXES] for r in rows], dtype=float)
    x, y, z = ((values - [95, 67, 80]) / [20, 6, 10]).T
    return np.column_stack([np.ones_like(x), x, y, z, x*x, x*y, x*z, y*y, y*z, z*z])

def solve(a, capacity, shr):
    assert np.linalg.matrix_rank(a[:, 1:]) == 9
    c = np.r_[1., np.linalg.lstsq(a[:, 1:], capacity - 1, rcond=None)[0]]
    denominator = a @ c
    assert np.all(denominator > 0)
    b = a[:, :4] / denominator[:, None]
    initial = np.linalg.lstsq(b, shr, rcond=None)[0]
    optimized = least_squares(lambda s: np.minimum(b @ s, 1) - shr, initial,
        jac=lambda s: b * (b @ s < 1)[:, None], max_nfev=2000, ftol=1e-12, xtol=1e-12, gtol=1e-12)
    assert optimized.success, optimized.message
    return c, optimized.x

def predict(a, capacity_coefficients, shr_coefficients):
    capacity = a @ capacity_coefficients
    shr = np.clip(a[:, :4] @ shr_coefficients / capacity, 0, 1)
    return capacity, shr

def metrics(y, prediction):
    delta = prediction - y
    total = np.sum((y - np.mean(y)) ** 2)
    return dict(n=len(y), rmse=float(np.sqrt(np.mean(delta ** 2))), mae=float(np.mean(abs(delta))),
        max_absolute_error=float(max(abs(delta))), r_squared=float(1 - np.sum(delta ** 2) / total) if total > 0 else None)

def csv_write(path, rows):
    with path.open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT/'outputs/precedent-cooling')
    parser.add_argument('--include-dual-fuel', action='store_true')
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    models, raw = extract(args.source)
    selected = [dict(r) for r in raw if r['selected_max_cfm'] and (r['equipment'] == 'heat pump' or args.include_dual_fuel)]
    fit_models, coefficients, summary, flagged = [], [], [], []
    diagnostics, validation = [], []
    for table in sorted({r['table'] for r in selected}):
        slots = [r for r in selected if r['table'] == table]
        rows = [r for r in slots if r['gross_capacity_MBh'] is not None]
        reference_row = next(r for r in rows if tuple(r[k] for k in AXES) == (95, 67, 80))
        reference = reference_row['gross_capacity_MBh']; a = design(rows)
        q = np.array([r['gross_capacity_MBh']/reference for r in rows]); s = np.array([r['shr'] for r in rows])
        c, b = solve(a, q, s); pq, ps = predict(a, c, b)
        m = {**models[table], 'id': f"{models[table]['equipment'].replace(' ', '-')}-{models[table]['efficiency']}-{models[table]['nominal_tons']:g}ton",
            'fixed_cfm': slots[0]['cfm'], 'reference_capacity_MBh': reference, 'reference_capacity_Btu_hr': reference*1000,
            'valid_points': len(rows), 'missing_slots': len(slots)-len(rows),
            'capacity_coefficients': c.tolist(), 'shr_numerator_coefficients': b.tolist(),
            'axis_ranges_F': {key: [min(r[key] for r in rows), max(r[key] for r in rows)] for key in AXES},
            'source_pdf_pages': sorted(set(r['pdf_page'] for r in slots)), 'source_printed_pages': sorted(set(r['printed_page'] for r in slots))}
        points = np.array([[r[k] for k in AXES] for r in rows], dtype=float)
        equations = ConvexHull(points).equations
        m['valid_domain_halfspaces'] = np.unique(np.round(equations, 12), axis=0).tolist()
        m['fit_metrics'] = {'capacity_normalized': metrics(q, pq), 'shr': metrics(s, ps)}
        m['capacity_relative_rmse_percent'] = float(100*np.sqrt(np.mean(((pq-q)/q)**2)))
        m['capacity_max_relative_error_percent'] = float(100*max(abs((pq-q)/q)))
        m['warnings'] = []
        cv_errors_q, cv_errors_s = [], []
        for axis in [AXES[0], AXES[2]]:
            # Interior planes only: retained training points still bracket the held-out temperature.
            for value in sorted(set(r[axis] for r in rows))[1:-1]:
                mask = np.array([r[axis] == value for r in rows]); cc, bb = solve(a[~mask], q[~mask], s[~mask])
                training_domain = ConvexHull(points[~mask]).equations
                inside = np.all(points @ training_domain[:, :3].T + training_domain[:, 3] <= 1e-7, axis=1)
                eligible = mask & inside
                cq, cs = predict(a[eligible], cc, bb)
                cv_errors_q.extend(cq-q[eligible]); cv_errors_s.extend(cs-s[eligible])
                for r, qv, sv in zip(np.array(rows, dtype=object)[eligible], cq, cs):
                    validation.append(dict(model_id=m['id'], held_out_axis=axis, held_out_temperature_F=value,
                        **{k:r[k] for k in AXES}, capacity_actual_normalized=r['gross_capacity_MBh']/reference,
                        capacity_predicted_normalized=float(qv), shr_actual=r['shr'], shr_predicted=float(sv)))
        m['interior_plane_validation'] = dict(n=len(cv_errors_q), capacity_normalized_rmse=float(np.sqrt(np.mean(np.array(cv_errors_q)**2))), shr_rmse=float(np.sqrt(np.mean(np.array(cv_errors_s)**2))))
        for i, r in enumerate(rows):
            r.update(reference_capacity_MBh=reference, capacity_normalized=float(q[i]), fitted_capacity_normalized=float(pq[i]), fitted_gross_capacity_MBh=float(pq[i]*reference),
                fitted_shr=float(ps[i]), capacity_error_percent=float(100*(pq[i]-q[i])/q[i]), shr_error=float(ps[i]-s[i]), source_flag='')
            if abs((pq[i]-q[i])/q[i]) > .05:
                r['source_flag'] = 'Catalog value differs from smooth fit by more than 5%; retained without correction.'
                flagged.append(dict(model_id=m['id'], **{k:r[k] for k in ['table','pdf_page','printed_page','cfm',*AXES,'gross_capacity_MBh','fitted_gross_capacity_MBh','capacity_error_percent','source_flag']}))
            diagnostics.append(dict(model_id=m['id'], efficiency=m['efficiency'], actual_capacity_normalized=float(q[i]), fitted_capacity_normalized=float(pq[i]), actual_shr=float(s[i]), fitted_shr=float(ps[i])))
        if any(r['source_flag'] for r in rows): m['warnings'].append('A source value has >5% capacity residual. Inspect flagged-source-values.csv; no source value was removed or corrected.')
        for r in slots:
            r.setdefault('reference_capacity_MBh',reference)
            for key in ['capacity_normalized','fitted_capacity_normalized','fitted_gross_capacity_MBh','fitted_shr','capacity_error_percent','shr_error']: r.setdefault(key,None)
            r.setdefault('source_flag','Manufacturer dash: missing, not zero. No model output for this catalog slot.')
        common = dict(model_id=m['id'], equipment=m['equipment'], efficiency=m['efficiency'], nominal_tons=m['nominal_tons'], fixed_cfm=m['fixed_cfm'], reference_capacity_MBh=reference,
            table=table, pdf_pages=';'.join(map(str,m['source_pdf_pages'])), printed_pages=';'.join(map(str,m['source_printed_pages'])),
            outdoor_min_F=m['axis_ranges_F'][AXES[0]][0], outdoor_max_F=m['axis_ranges_F'][AXES[0]][1], entering_wb_min_F=61, entering_wb_max_F=73, entering_db_min_F=75, entering_db_max_F=90,
            domain_note='Inside supplied valid-point convex hull only; 25-ton heat-pump fits additionally require outdoor_F + 2*entering_db_F <= 295.' if m['equipment']=='heat pump' and m['nominal_tons']==25 else 'Inside supplied valid-point convex hull only.')
        for name, coefs, fit_metric in [('capacity_normalized',c,m['fit_metrics']['capacity_normalized']),('shr_numerator',np.r_[b,np.zeros(6)],m['fit_metrics']['shr'])]:
            coefficients.append(dict(**common, curve=name, **{f'c{i}':float(v) for i,v in enumerate(coefs)}, error_metric_output='Final SHR after division and limiting' if name=='shr_numerator' else 'Normalized total capacity', fit_rmse=fit_metric['rmse'], fit_max_absolute_error=fit_metric['max_absolute_error'],
                fit_r_squared=fit_metric['r_squared'], interior_validation_rmse=m['interior_plane_validation']['capacity_normalized_rmse' if name=='capacity_normalized' else 'shr_rmse']))
        summary.append(dict(**common, valid_points=len(rows), missing_slots=m['missing_slots'], capacity_rmse_percent_of_reference=100*m['fit_metrics']['capacity_normalized']['rmse'],
            capacity_relative_rmse_percent=m['capacity_relative_rmse_percent'], capacity_max_relative_error_percent=m['capacity_max_relative_error_percent'], shr_rmse=m['fit_metrics']['shr']['rmse'],
            shr_max_absolute_error=m['fit_metrics']['shr']['max_absolute_error'], capacity_validation_rmse_percent_of_reference=100*m['interior_plane_validation']['capacity_normalized_rmse'],
            shr_validation_rmse=m['interior_plane_validation']['shr_rmse'], status='Review flagged source entry' if m['warnings'] else 'Fit complete'))
        fit_models.append(m)
        # Rows are shared with the selected data list, preserving source slots and their diagnostics.
        for source_row in selected:
            if source_row['table']==table:
                matching = next(r for r in slots if all(r[k]==source_row[k] for k in AXES)); source_row.update(matching)
    assert len(selected) == sum(m['valid_points']+m['missing_slots'] for m in fit_models)
    source_info = dict(filename='Precedent_Cooling.pdf', document_code='PKGP-PRC023F-EN', sha256=hashlib.sha256(args.source.read_bytes()).hexdigest(),
        source_path=r'G:\Shared drives\ME 351 - Senior Design - B.E.A.S.T Mode\Project Data\Data Parsing\Precedent_Cooling.pdf',
        included_scope='heat-pump and separately labeled dual-fuel tables' if args.include_dual_fuel else 'heat-pump tables 10-33 only; dual-fuel tables 34-57 excluded')
    bundle = dict(schema='precedent-cooling-polynomial-1.0', source=source_info,
        input_order=AXES, transforms={'x':'(outdoor_dry_bulb_F - 95)/20','y':'(entering_wet_bulb_F - 67)/6','z':'(entering_dry_bulb_F - 80)/10'}, terms=TERMS,
        formulas={'capacity_normalized':'sum(c[i]*term[i]); c[0]=1', 'gross_capacity_Btu_hr':'reference_capacity_Btu_hr * capacity_normalized',
            'shr':'clip((b[0]+b[1]*x+b[2]*y+b[3]*z)/capacity_normalized,0,1)'},
        policy={'airflow':'Largest CFM listed for each unit size and efficiency; fixed per model, never a runtime input.',
            'capacity':'Gross total cooling before indoor fan heat; normalized at 95 F outdoor DB, 67 F entering WB, 80 F entering DB at selected airflow.',
            'missing':'Manufacturer dashes retained as null; no extrapolation beyond valid catalog points convex hull.',
            'fitting':'All valid source entries retained. Anchored ordinary least-squares capacity; bounded-output nonlinear least-squares SHR numerator.',
            'validation':'Refit after holding out each interior outdoor-DB or entering-DB plane; capacity reference remains a known input. WB has only 3 levels; no independent WB-plane holdout test.',
            'scope':'Cooling only. No electrical power/COP data are inferred. Unit-specific functions, not one universal heat-pump curve.'}, models=fit_models)
    out=args.output
    (out/'curve-fits.json').write_text(json.dumps(bundle,indent=2,allow_nan=False),encoding='utf-8')
    csv_write(out/'curve-fit-coefficients.csv',coefficients)
    csv_write(out/'selected-max-cfm-data.csv',selected)
    csv_write(out/'fit-summary.csv',summary)
    csv_write(out/'interior-plane-validation.csv',validation)
    if flagged: csv_write(out/'flagged-source-values.csv',flagged)
    (out/'extraction-audit.json').write_text(json.dumps(dict(source=source_info,total_source_points=len(raw),all_catalog_tables=len(models),selected_models=len(fit_models),selected_source_slots=len(selected),selected_valid_points=len(diagnostics),missing_slots=sum(m['missing_slots'] for m in fit_models)),indent=2),encoding='utf-8')
    write_readme(out,bundle,summary)
    plots(out,diagnostics)
    report(out,bundle,summary,flagged)
    print(json.dumps(dict(models=len(fit_models),valid_points=len(diagnostics),missing_slots=sum(m['missing_slots'] for m in fit_models),flagged_source_entries=len(flagged),
        pooled_capacity_rmse_percent_of_reference=100*float(np.sqrt(np.mean([(r['fitted_capacity_normalized']-r['actual_capacity_normalized'])**2 for r in diagnostics]))),
        pooled_shr_rmse=float(np.sqrt(np.mean([(r['fitted_shr']-r['actual_shr'])**2 for r in diagnostics]))),output=str(out)),indent=2))

def write_readme(out,bundle,summary):
    text=f'''# Precedent packaged heat-pump cooling fits

Source: {bundle['source']['source_path']}; document PKGP-PRC023F-EN. The PDF page index and printed catalog page are recorded for each source row. Source SHA-256: {bundle['source']['sha256']}.

Scope: {bundle['source']['included_scope']}. Separate functions are provided for each size and efficiency. Airflow is fixed at the largest value actually listed, which is 480 CFM per nominal ton in these tables. It is metadata, not a function input. No lower-CFM points are averaged into the fit.

Inputs in degrees Fahrenheit:

    x = (outdoor dry bulb - 95) / 20
    y = (entering wet bulb - 67) / 6
    z = (entering dry bulb - 80) / 10
    F = c0 + c1*x + c2*y + c3*z + c4*x*x + c5*x*y
        + c6*x*z + c7*y*y + c8*y*z + c9*z*z
    Q_gross_Btu_hr = Q_reference_Btu_hr * F
    SHR = min(1, max(0, (b0 + b1*x + b2*y + b3*z) / F))

Capacity c0 is fixed at 1. Q_reference is the actual catalog gross total cooling capacity at outdoor DB=95 F, entering WB=67 F, entering DB=80 F and selected maximum airflow. It is not nominal tons times 12,000 and not the peak building-load reference used by the earlier website placeholders. SHR source values are sensible capacity / total gross capacity. b coefficients are an internal sensible-capacity numerator; no additional operating input is required. This rational form captures the dry-coil SHR=1 plateau with fewer parameters than a standalone quadratic SHR fit.

Use the capacity_normalized row's c0-c9 for F. For SHR, use the shr_numerator row's c0-c3 as b0-b3, and divide by F before limiting the result to [0,1]. Remaining numerator coefficients are zero. Units for both catalog capacity columns are MBh (1,000 Btu/hr). Capacities are gross, with no indoor-fan-heat correction, as stated in the source notes.

Valid inputs: entering WB 61-73 F, entering DB 75-90 F; outdoor DB generally 85-125 F. Standard-efficiency 10-ton heat pump is limited to 85-120 F. Both 25-ton heat-pump fits additionally require outdoor DB + 2*entering DB <= 295 (the convex-hull boundary around omitted 125 F / 90 F entries). The evaluator applies the complete valid-point convex hull. No extrapolation or holding at a temperature boundary is allowed. Manufacturer dashes remain blank. Do not interpret catalog gaps as zero capacity or zero SHR.

All valid data are retained in fitting. The 17.5-ton heat-pump tables contain 156.6 MBh at 8,400 CFM, outdoor DB 115 F, entering WB 61 F, entering DB 85 F. This unusually low value appears in both standard and high efficiency tables, was visually checked, and is retained without correction. These two capacity fits need source confirmation; see flagged-source-values.csv. Errors are calculated against all retained catalog entries, including these flagged points.

Validation: fit errors describe agreement with the supplied catalog, not measured field accuracy. Interior-temperature-plane validation holds out each interior outdoor-DB and entering-DB plane, refits the curves, then predicts the omitted data. The reference capacity remains a known input. This tests interpolation across temperature planes. WB only has three levels; no independent entering-WB validation was performed. A simple quadratic capacity fit was retained because increasing polynomial order did not consistently improve plane holdout performance. The reported SHR fit uses a four-coefficient numerator to reduce unstable curvature at dry-coil transitions.

Files:
- curve-fit-coefficients.csv: coefficients, reference capacity, fixed airflow, domain and error metrics.
- selected-max-cfm-data.csv: all selected source slots, including blanks, derived SHR, normalized capacity and fit errors.
- curve-fits.json: full model definitions and convex-hull domain boundaries.
- fit-summary.csv and interior-plane-validation.csv: per-unit accuracy and omitted-plane predictions.
- Precedent_Cooling_Curve_Fits.pdf: equations, fit review, charts and per-unit summary.
- evaluate-precedent-curves.mjs: standalone evaluator. Run `node evaluate-precedent-curves.mjs heat-pump-standard-6ton 95 67 80`; argument order is model ID, outdoor DB, entering WB, entering DB (F).

This is a curve-fit package only. No COP is inferred and the website's live performance inputs are not changed. Its earlier two-temperature grid placeholders require a three-temperature polynomial adapter and a matching catalog capacity normalization before these functions can be used there.
'''
    (out/'README.md').write_text(text,encoding='utf-8')

def plots(out,rows):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.labelcolor':'#203b56','text.color':'#203b56'})
    fig,axes=plt.subplots(1,2,figsize=(10,4.3),layout='constrained')
    for efficiency,color in [('standard','#2878a1'),('high','#b56b32')]:
        items=[r for r in rows if r['efficiency']==efficiency]
        for ax,key,fit in [(axes[0],'actual_capacity_normalized','fitted_capacity_normalized'),(axes[1],'actual_shr','fitted_shr')]:
            ax.scatter([r[key] for r in items],[r[fit] for r in items],s=14,alpha=.45,label=efficiency.title(),color=color,edgecolors='none')
    for ax,limits,title,label in [(axes[0],[.6,1.4],'Gross normalized capacity','Capacity / catalog reference'),(axes[1],[.25,1.03],'Sensible heat ratio','SHR')]:
        ax.plot(limits,limits,color='#526477',lw=1,ls='--',label='Perfect agreement');ax.set(xlim=limits,ylim=limits,title=title,xlabel='Catalog '+label,ylabel='Fitted '+label);ax.grid(alpha=.15);ax.legend(fontsize=8)
    fig.savefig(out/'fit-diagnostics.png',dpi=210);plt.close(fig)

def report(out,bundle,summary,flagged):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    font,bold='Helvetica','Helvetica-Bold'
    if Path('C:/Windows/Fonts/arial.ttf').exists():
        pdfmetrics.registerFont(TTFont('FitSans','C:/Windows/Fonts/arial.ttf'));pdfmetrics.registerFont(TTFont('FitBold','C:/Windows/Fonts/arialbd.ttf'))
        pdfmetrics.registerFontFamily('FitSans',normal='FitSans',bold='FitBold',italic='FitSans',boldItalic='FitBold');font,bold='FitSans','FitBold'
    navy=colors.HexColor('#203B56');teal=colors.HexColor('#286E64');gray=colors.HexColor('#526477');light=colors.HexColor('#EEF4F7')
    styles={k:ParagraphStyle(k,fontName=f,fontSize=size,leading=lead,textColor=color,spaceAfter=gap) for k,f,size,lead,color,gap in [
        ('body',font,10,14,gray,9),('small',font,8.5,11.5,gray,7),('title',bold,24,29,navy,15),('h',bold,12.5,17,teal,7),('tag',bold,8,11,teal,8),('eq','Courier',8.7,12,navy,3),('cell',font,8.5,11,gray,0),('th',bold,8.5,11,colors.white,0)]}
    story=[]
    def p(s,style='body'):story.append(Paragraph(s,styles[style]))
    def h(s):story.append(Spacer(1,8));p(s,'h')
    def page(n,title):
        if n>1:story.append(PageBreak())
        p(f'BEAST / PRECEDENT COOLING / CURVE FITS / {n:02d}','tag');p(title,'title')
    def eq(s):
        t=Table([[Paragraph(line,styles['eq'])] for line in s.splitlines()],colWidths=[504]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),light),('LEFTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]));story.append(t);story.append(Spacer(1,8))
    def table(headers,rows,widths):
        t=Table([[Paragraph(str(x),styles['th']) for x in headers]]+[[Paragraph(str(x),styles['cell']) for x in r] for r in rows],colWidths=widths,repeatRows=1)
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[light,colors.white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]));story.append(t)
    page(1,'Cooling capacity and SHR')
    count=len(bundle['models']);valid=sum(m['valid_points'] for m in bundle['models']);missing=sum(m['missing_slots'] for m in bundle['models'])
    p(f'{count} unit-specific curve pairs fitted to {valid:,} valid catalog points, using the largest listed airflow for each size. {missing} manufacturer blanks remain unavailable. The fitted inputs are outdoor dry bulb, entering wet bulb and entering dry bulb; airflow is fixed, not an input.')
    h('Three temperature inputs, one fixed airflow selection')
    p('Separate fits retain the catalog size and efficiency labels. Selected airflow is 480 CFM per nominal ton in every included table. Source SHR is sensible cooling capacity divided by total gross cooling capacity. Capacity is gross, before indoor fan heat, following the source notes.')
    h('Equations - all temperatures in degrees Fahrenheit')
    eq('x = (outdoor DB - 95) / 20\ny = (entering WB - 67) / 6\nz = (entering DB - 80) / 10\nF = 1 + c1*x + c2*y + c3*z + c4*x*x + c5*x*y\n      + c6*x*z + c7*y*y + c8*y*z + c9*z*z\nGross capacity (Btu/hr) = Q_reference * F\nSHR = min(1, max(0, (b0 + b1*x + b2*y + b3*z) / F))')
    p('Q_reference is each unit\'s catalog capacity at 95 F outdoor DB, 67 F entering WB and 80 F entering DB, at the selected maximum airflow. It is neither nominal tonnage times 12,000 nor the peak building load. Capacity is normalized to exactly 1 at that reference. The four b coefficients are part of the SHR function; they introduce no additional operating input.','small')
    h('Where the functions can be used')
    p('Entering WB: 61-73 F. Entering DB: 75-90 F. Outdoor DB: generally 85-125 F; standard 10-ton heat pump: 85-120 F. For both 25-ton heat-pump fits, also require outdoor DB + 2 x entering DB &lt;= 295. These limits describe the convex hull of valid catalog points. No extrapolation is allowed.')
    p('Coefficients, catalog references, exact domain checks, source rows and validation are provided in the accompanying CSV/JSON files and standalone evaluator. This package does not infer COP or automatically populate the website.','small')
    page(2,'Accuracy and source review')
    story.append(Image(str(out/'fit-diagnostics.png'),width=504,height=216.72))
    p('Each marker compares one catalog point with its fitted result. Dashed lines show perfect agreement. Standard and high-efficiency points often overlap because several source datasets are identical.','small')
    all_q=np.array([r['capacity_rmse_percent_of_reference'] for r in summary]);all_s=np.array([r['shr_rmse'] for r in summary])
    table(['Measure','Range across fitted units'],[
        ['Capacity RMSE / reference capacity',f'{min(all_q):.2f}% to {max(all_q):.2f}%'],
        ['SHR RMSE (absolute ratio)',f'{min(all_s):.4f} to {max(all_s):.4f}'],
        ['Interior-plane validation: capacity RMSE / reference',f"{min(r['capacity_validation_rmse_percent_of_reference'] for r in summary):.2f}% to {max(r['capacity_validation_rmse_percent_of_reference'] for r in summary):.2f}%"],
        ['Interior-plane validation: SHR RMSE',f"{min(r['shr_validation_rmse'] for r in summary):.4f} to {max(r['shr_validation_rmse'] for r in summary):.4f}"],
    ],[300,204])
    h('Validation method')
    p('Capacity uses anchored ordinary least squares. SHR uses bounded-output least squares for its numerator, with the fitted capacity as denominator. Interior-plane validation removes each interior outdoor-DB or entering-DB temperature plane, refits the model, and predicts the omitted points. The reference capacity stays known. Only three wet-bulb levels are supplied, so independent wet-bulb-plane validation is not claimed. These errors measure catalog agreement, not field performance.','small')
    h('Source values requiring review')
    p('Both 17.5-ton heat-pump tables show 156.6 MBh at 8,400 CFM, outdoor DB 115 F, entering WB 61 F and entering DB 85 F (printed catalog pages 50 and 61). Visual review confirms that this is printed in the supplied PDF. The value is retained without correction, creates the largest capacity residual, and requires source confirmation. Review flagged-source-values.csv before relying on these two capacity fits.','small')
    p(f"Source: Precedent_Cooling.pdf, Trane document PKGP-PRC023F-EN; {bundle['source']['included_scope']}. The selected maximum-airflow data retain PDF and printed page references, manufacturer blanks and all raw values. Source hash is recorded in curve-fits.json.",'small')
    page(3,'Unit-by-unit fit summary')
    for efficiency in ['standard','high']:
        h(f'{efficiency.title()} efficiency - heat pump')
        items=[r for r in summary if r['efficiency']==efficiency and r['equipment']=='heat pump']
        table(['Tons','Fixed CFM','Qref MBh','Cap. RMSE %','SHR RMSE','Table'],[[f"{r['nominal_tons']:g}",f"{r['fixed_cfm']:,}",f"{r['reference_capacity_MBh']:.1f}",f"{r['capacity_rmse_percent_of_reference']:.2f}"+('*' if r['nominal_tons']==17.5 else ''),f"{r['shr_rmse']:.4f}",r['table']] for r in items],[45,80,80,110,100,89])
    p('* Source anomaly retained; see page 2. Capacity RMSE is percent of the catalog reference, not percent of each individual data point. SHR RMSE is an absolute ratio. Per-point errors, relative-capacity errors and held-out predictions are supplied in the CSV files.','small')
    if count>24:p('Separately labeled dual-fuel curves are included in the data files; this page summarizes heat-pump tables only.','small')
    def footer(canvas,doc):
        canvas.saveState();canvas.setStrokeColor(colors.HexColor('#D9E3EA'));canvas.line(54,43,558,43);canvas.setFont(font,8);canvas.setFillColor(gray);canvas.drawString(54,29,'BEAST | Precedent cooling | Catalog fits at maximum listed airflow');canvas.drawRightString(558,29,str(doc.page));canvas.restoreState()
    SimpleDocTemplate(str(out/'Precedent_Cooling_Curve_Fits.pdf'),pagesize=(612,792),leftMargin=54,rightMargin=54,topMargin=45,bottomMargin=58,
        title='Precedent Packaged Heat Pump Cooling - Capacity and SHR Fits',author='BEAST',subject='Three-temperature cooling fits at maximum listed airflow').build(story,onFirstPage=footer,onLaterPages=footer)

if __name__=='__main__': main()
