"""Fit the supplied heating tables; use the accepted dataset and catalog test basis.

Usage: python scripts/fit-precedent-heating.py --source PATH [--output PATH]
Requires numpy and pypdf. Writes auditable JSON/CSV, without changing application files.
"""
from pathlib import Path
import argparse, csv, hashlib, json, re, sys

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / 'work/precedent-cooling/python-packages'
if LOCAL.exists(): sys.path.insert(0, str(LOCAL))
import numpy as np
from pypdf import PdfReader

DB = [40, 50, 60, 70, 75, 80]
POWERS = [(degree-j, j) for degree in range(5) for j in range(degree+1)]
TERMS = ['1', 'x', 'y', 'x^2', 'x*y', 'y^2', 'x^3', 'x^2*y', 'x*y^2', 'y^3', 'x^4', 'x^3*y', 'x^2*y^2', 'x*y^3', 'y^4']
BTU_PER_KWH = 3412.141633

def extract(source):
    models, rows, current = {}, [], None
    for page_num, page in enumerate(PdfReader(source).pages, 1):
        for line in (page.extract_text() or '').splitlines():
            match = re.match(r'Table (\d+)\. Heating capacities .*?([\d.]+) tons?(.*)', line)
            if match:
                current = int(match[1]); size = float(match[2]); suffix = match[3]
                efficiency = 'standard' if 'standard efficiency' in suffix or current == 67 else 'high' if 'high efficiency' in suffix or current == 68 else 'shared'
                models.setdefault(current, dict(table=current, nominal_tons=size, efficiency=efficiency,
                    id=f'heating-table-{current}', model_scope='WSK only' if current == 67 else 'WHK heat pump; dual-fuel uses excluded' if current == 68 else 'heat pump',
                    nominal_esp_inches=.50 if size <= 5 else .25 if size < 10 else .30 if size == 10 else .35 if size < 20 else .40))
            tokens = line.split()
            if len(tokens) == 13 and all(re.fullmatch(r'-?\d+(?:\.\d+)?', t) for t in tokens):
                assert current is not None
                outdoor = float(tokens[0]); assert outdoor in range(-8, 73, 5)
                for j, dry in enumerate(DB):
                    capacity, power = float(tokens[j+1]), float(tokens[j+7])
                    assert capacity > 0 and power > 0
                    rows.append(dict(table=current, pdf_page=page_num, printed_page=page_num+85,
                        outdoor_dry_bulb_F=outdoor, entering_dry_bulb_F=dry, net_capacity_MBh=capacity,
                        total_power_kW=power, catalog_cop=capacity*1000/(BTU_PER_KWH*power)))
    assert set(models) == set(range(58, 74)), 'Expected tables 58-73.'
    assert len(rows) == 16*17*6
    assert len({(r['table'], r['outdoor_dry_bulb_F'], r['entering_dry_bulb_F']) for r in rows}) == len(rows)
    for number in models:
        subset = [r for r in rows if r['table'] == number]
        assert len(subset) == 102
    return models, rows

def design(rows):
    x = (np.array([r['outdoor_dry_bulb_F'] for r in rows])-47)/40
    y = (np.array([r['entering_dry_bulb_F'] for r in rows])-70)/20
    return np.column_stack([x**i*y**j for i,j in POWERS])

def fit(a, values, degree):
    n = (degree+1)*(degree+2)//2
    assert np.linalg.matrix_rank(a[:, 1:n]) == n-1
    coefficients = np.zeros(len(POWERS)); coefficients[0] = 1
    coefficients[1:n] = np.linalg.lstsq(a[:, 1:n], values-1, rcond=None)[0]
    return coefficients

def metrics(actual, predicted):
    delta = predicted-actual
    return dict(rmse=float(np.sqrt(np.mean(delta**2))), relative_rmse_percent=float(100*np.sqrt(np.mean((delta/actual)**2))),
        max_relative_error_percent=float(100*max(abs(delta/actual))), max_absolute_error=float(max(abs(delta))))

def write_csv(path, rows):
    with path.open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT/'outputs/precedent-heating')
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    models, rows = extract(args.source)
    omitted = {(59,7,75,19.2), (70,7,75,73.8), (71,7,80,93.1), (73,72,60,354.8)}
    sample_key = lambda r: (r['table'],r['outdoor_dry_bulb_F'],r['entering_dry_bulb_F'],r['net_capacity_MBh'])
    assert omitted <= {sample_key(r) for r in rows}
    rows = [r for r in rows if sample_key(r) not in omitted]
    coefficients, summary, validation = [], [], []
    for number, model in models.items():
        selected = [r for r in rows if r['table'] == number]; a = design(selected)
        reference = next(r for r in selected if r['outdoor_dry_bulb_F'] == 47 and r['entering_dry_bulb_F'] == 70)
        qref, pref = reference['net_capacity_MBh']*1000, reference['total_power_kW']
        q = np.array([r['net_capacity_MBh']*1000/qref for r in selected]); power = np.array([r['total_power_kW']/pref for r in selected])
        qc, pc = fit(a, q, 4), fit(a, power, 2)
        model.update(reference_capacity_Btu_hr=qref, reference_power_kW=pref,
            capacity_coefficients=qc.tolist(), power_coefficients=pc.tolist(), source_pdf_pages=sorted({r['pdf_page'] for r in selected}),
            outdoor_range_F=[-8,72], entering_dry_bulb_range_F=[40,80], points=len(selected), warnings=[])
        qm, pm = metrics(q, a@qc), metrics(power, a@pc)
        model['fit_metrics'] = dict(capacity=qm, power=pm)
        qerrors, perrors = [], []
        for axis in ['outdoor_dry_bulb_F', 'entering_dry_bulb_F']:
            levels = sorted({r[axis] for r in selected})[1:-1]
            for level in levels:
                held = np.array([r[axis] == level for r in selected]); trained = ~held
                cq, cp = fit(a[trained], q[trained], 4), fit(a[trained], power[trained], 2)
                qhat, phat = a[held]@cq, a[held]@cp
                qerrors.extend(((qhat-q[held])/q[held]).tolist()); perrors.extend(((phat-power[held])/power[held]).tolist())
                for r, qv, pv in zip([r for r,h in zip(selected,held) if h],qhat,phat):
                    validation.append(dict(table=number,held_axis=axis,held_value=level,outdoor_F=r['outdoor_dry_bulb_F'],entering_F=r['entering_dry_bulb_F'],
                        actual_capacity_Btu_hr=r['net_capacity_MBh']*1000,predicted_capacity_Btu_hr=float(qv*qref),actual_power_kW=r['total_power_kW'],predicted_power_kW=float(pv*pref)))
        model['interior_plane_validation'] = dict(points=len(qerrors),capacity_relative_rmse_percent=float(100*np.sqrt(np.mean(np.array(qerrors)**2))),power_relative_rmse_percent=float(100*np.sqrt(np.mean(np.array(perrors)**2))))
        for i,r in enumerate(selected):
            r.update(model_id=model['id'],fitted_net_capacity_Btu_hr=float((a@qc)[i]*qref),fitted_total_power_kW=float((a@pc)[i]*pref),
                fitted_cop=float((a@qc)[i]*qref/(BTU_PER_KWH*(a@pc)[i]*pref)))
        common = dict(model_id=model['id'],table=number,nominal_tons=model['nominal_tons'],efficiency=model['efficiency'],reference_capacity_Btu_hr=qref,reference_power_kW=pref,
            outdoor_min_F=-8,outdoor_max_F=72,entering_db_min_F=40,entering_db_max_F=80,reference_outdoor_F=47,reference_entering_F=70,nominal_esp_inches=model['nominal_esp_inches'],
            airflow_basis='Published nominal CFM; no airflow/fan correction available in supplied excerpt.',outdoor_RH_percent=70)
        for name, values, metric in [('capacity_normalized',qc,qm),('power_normalized',pc,pm)]:
            coefficients.append(dict(**common,curve=name,x_definition='(outdoor_dry_bulb_F - 47)/40',y_definition='(entering_dry_bulb_F - 70)/20',term_order=';'.join(TERMS),
                equation='reference_capacity_Btu_hr * sum(c[i]*term[i])' if name=='capacity_normalized' else 'reference_power_kW * sum(c[i]*term[i])',
                output_units='BTU/hr net heating' if name=='capacity_normalized' else 'kW total input',fit_error_units='Normalized curve output; relative errors in percent',
                cop_equation='net_capacity_Btu_hr / (3412.141633 * total_power_kW)',**{f'c{i}':float(v) for i,v in enumerate(values)},**metric))
        summary.append(dict(**common,**{f'capacity_{k}':v for k,v in qm.items()},**{f'power_{k}':v for k,v in pm.items()},**{f'validation_{k}':v for k,v in model['interior_plane_validation'].items()},warnings=' '.join(model['warnings'])))
        grid = [dict(outdoor_dry_bulb_F=o,entering_dry_bulb_F=d) for o in np.linspace(-8,72,161) for d in np.linspace(40,80,81)]
        dense = design(grid); assert np.all(dense@qc>0) and np.all(dense@pc>0)
    bundle=dict(schema='precedent-heating-polynomial-1.0',source=dict(filename='Heating_Cap.pdf',document_code='PKGP-PRC023F-EN',
        sha256=hashlib.sha256(args.source.read_bytes()).hexdigest(),tables='58-73',printed_pages='86-95'),
        terms=TERMS,term_powers=POWERS,transforms=dict(x='(outdoor_dry_bulb_F - 47)/40',y='(entering_dry_bulb_F - 70)/20'),
        formulas=dict(net_capacity_Btu_hr='reference_capacity_Btu_hr * sum(capacity_coefficients[i]*terms[i])',total_power_kW='reference_power_kW * sum(power_coefficients[i]*terms[i])',
            heating_COP='net_capacity_Btu_hr / (3412.141633 * total_power_kW)'),
        policy=dict(fitting='Anchored least squares: fourth-degree total-degree capacity, second-degree power. Uses the accepted fitting dataset.',
            validation='Interior outdoor/entering plane holdout refits; the 47/70 reference remains a known anchor, so validation is conditional on it.',
            domain='Outdoor -8 to 72 F; entering dry bulb 40 to 80 F. No extrapolation, humidity correction, added defrost or fan term.',
            catalog_basis='Net integrated heating capacity and total power include indoor fan heat/power at nominal CFM and listed ESP; defrost integrated; 70% outdoor RH.',
            application_basis='Mixed air continues to use installed maximum cooling CFM. Applying nominal-airflow heating fits there is an uncorrected screening approximation; sizing remains provisional when heating is required.',
            mapping='Tables 58-60 standard 3/4/5 ton; 61-63 high 3/4/5 ton; table 67 standard 10-ton WSK; 68 high 10-ton WHK. Other sizes share their size-only table across families. No dual-fuel equipment added.'),models=list(models.values()))
    (args.output/'curve-fits.json').write_text(json.dumps(bundle,indent=2)+'\n',encoding='utf-8')
    write_csv(args.output/'curve-fit-coefficients.csv',coefficients);write_csv(args.output/'source-data.csv',rows)
    write_csv(args.output/'fit-summary.csv',summary);write_csv(args.output/'interior-plane-validation.csv',validation)
    (args.output/'README.md').write_text('# Precedent heating fits\n\n'+ '\n\n'.join(f'**{k}:** {v}' for k,v in bundle['policy'].items())+'\n\nTerms: '+', '.join(TERMS)+'\n\nTransforms: x=(outdoor F-47)/40; y=(entering F-70)/20. Both normalized curves equal 1 at the reference. Capacity is in BTU/hr; power is kW; COP is their dimensionless heat/power ratio.\n',encoding='utf-8')
    print(json.dumps(dict(models=len(models),source_points=len(rows),
        max_capacity_fit_error_percent=max(m['fit_metrics']['capacity']['max_relative_error_percent'] for m in models.values()),
        max_power_fit_error_percent=max(m['fit_metrics']['power']['max_relative_error_percent'] for m in models.values()),
        max_capacity_validation_rmse_percent=max(m['interior_plane_validation']['capacity_relative_rmse_percent'] for m in models.values())),indent=2))

if __name__ == '__main__': main()
