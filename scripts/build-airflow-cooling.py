"""Fit all cooling airflows: pooled normalized capacity and individual unit SHR.
python scripts/build-airflow-cooling.py --source path/to/Precedent_Cooling.pdf
Requires numpy/scipy; pypdf is needed only without a hash-matched extraction cache.
"""
import argparse, ast, csv, hashlib, json, re
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial import ConvexHull
ROOT = Path(__file__).resolve().parents[1]
AXES = ['outdoor_dry_bulb_F', 'entering_wet_bulb_F', 'entering_dry_bulb_F']
TERMS = ['1','x','y','z','f','x*x','x*y','x*z','x*f','y*y','y*z','y*f','z*z','z*f','f*f']

def matrix(rows):
    x,y,z=((np.array([[r[k] for k in AXES] for r in rows])-[95,67,80])/[20,6,10]).T
    f=np.array([(r['cfm']/r['nominal_tons']-480)/180 for r in rows])
    return np.column_stack([np.ones_like(x),x,y,z,f,x*x,x*y,x*z,x*f,y*y,y*z,y*f,z*z,z*f,f*f])

def pooled(a,q,w):
    return np.r_[1.,np.linalg.lstsq(a[:,1:]*w[:,None],(q-1)*w,rcond=None)[0]]

def fit_shr(a,denominator,actual):
    basis=a/denominator[:,None]
    initial=np.linalg.lstsq(basis,actual,rcond=None)[0]
    result=least_squares(lambda b:np.clip(basis@b,0,1)-actual,initial,max_nfev=1000,ftol=1e-11,xtol=1e-11,gtol=1e-11)
    assert result.success
    return result.x

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--extracted',type=Path,default=ROOT/'work/precedent-cooling/extracted.json')
    args=parser.parse_args()
    sha=hashlib.sha256(args.source.read_bytes()).hexdigest()
    if args.extracted.exists():
        cached=json.loads(args.extracted.read_text(encoding='utf-8'))
        assert cached['source_sha256']==sha,'Extraction cache belongs to a different PDF'
        models={m['table']:m for m in cached['models']};extracted=cached['rows']
    else:
        from pypdf import PdfReader
        tree=ast.parse((ROOT/'scripts/fit-precedent-cooling.py').read_text(encoding='utf-8'))
        scope=dict(re=re,PdfReader=PdfReader)
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='extract')
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<existing-parser>','exec'),scope)
        models,extracted=scope['extract'](args.source)
    raw=[dict(r) for r in extracted if r['table']<=33]
    # Retain the two exclusions used by the existing source fits, with flags.
    for r in raw:
        r['accepted_for_fit']=not(r['table'] in [19,31] and r['cfm']==8400 and [r[k] for k in AXES]==[115,61,85] and r['gross_capacity_MBh']==156.6)
    rows=[r for r in raw if r['accepted_for_fit'] and r['gross_capacity_MBh'] is not None]
    reference={t:next(r['gross_capacity_MBh']*1000 for r in rows if r['table']==t and r['selected_max_cfm'] and [r[k] for k in AXES]==[95,67,80]) for t in range(10,34)}
    a=matrix(rows);q=np.array([r['gross_capacity_MBh']*1000/reference[r['table']] for r in rows])
    shr=np.array([r['shr'] for r in rows]);tables=np.array([r['table'] for r in rows])
    counts={t:sum(tables==t) for t in range(10,34)}
    weights=np.array([1/np.sqrt(counts[t]) for t in tables])
    c=pooled(a,q,weights);predicted=a@c
    assert np.all(predicted>0)
    fitted,errors_shr,validation_shr=[],[],[]
    for t in range(10,34):
        mask=tables==t;local=[r for r in rows if r['table']==t]
        b=fit_shr(a[mask],predicted[mask],shr[mask])
        error=np.clip(a[mask]@b/predicted[mask],0,1)-shr[mask];errors_shr.extend(error.tolist())
        mid=np.array([r['cfm']/r['nominal_tons']==400 for r in local])
        held=fit_shr(a[mask][~mid],predicted[mask][~mid],shr[mask][~mid])
        validation_shr.extend((np.clip(a[mask][mid]@held/predicted[mask][mid],0,1)-shr[mask][mid]).tolist())
        points=np.array([[r[k] for k in AXES] for r in local],dtype=float)
        fitted.append(dict(id=f"heat-pump-{models[t]['efficiency']}-{models[t]['nominal_tons']:g}ton",
            table=t,nominal_tons=models[t]['nominal_tons'],efficiency=models[t]['efficiency'],
            reference_capacity_Btu_hr=reference[t],airflows_cfm=sorted({r['cfm'] for r in local}),
            shr_numerator_coefficients=b.tolist(),valid_domain_halfspaces=np.unique(np.round(ConvexHull(points).equations,12),axis=0).tolist(),
            axis_ranges_F={k:[float(points[:,i].min()),float(points[:,i].max())] for i,k in enumerate(AXES)},
            valid_points=len(local),capacity_relative_rmse_percent=100*float(np.sqrt(np.mean((predicted[mask]/q[mask]-1)**2))),
            shr_rmse=float(np.sqrt(np.mean(error**2)))))
    # A held-out unit retains its known reference capacity, matching the original
    # shared-curve validation. No held-out temperature response is fitted.
    held_errors=[]
    for t in range(10,34):
        mask=tables==t;held=pooled(a[~mask],q[~mask],weights[~mask])
        held_errors.extend((a[mask]@held/q[mask]-1).tolist())
    bundle=dict(schema='precedent-airflow-cooling-1.0',
        source=dict(filename=args.source.name,document_code='PKGP-PRC023F-EN',sha256=sha),
        policy='One anchored normalized capacity surface across all 24 source units with equal unit weights; individual quadratic SHR numerators divided by shared capacity. Airflow is continuous inside the supplied CFM range; no airflow extrapolation. Temperature domains retain source hulls. Larger units scale the family 25-ton reference and airflow.',
        terms=TERMS,transforms=dict(x='(outdoorF-95)/20',y='(wetF-67)/6',z='(dryF-80)/10',f='(CFM_per_ton-480)/180'),
        capacity_coefficients=c.tolist(),valid_points=len(rows),source_slots=len(raw),
        capacity_relative_rmse_percent=100*float(np.sqrt(np.mean((predicted/q-1)**2))),
        leave_one_unit_out_capacity_rmse_percent=100*float(np.sqrt(np.mean(np.array(held_errors)**2))),
        shr_rmse=float(np.sqrt(np.mean(np.array(errors_shr)**2))),
        held_out_400_cfm_per_ton_shr_rmse=float(np.sqrt(np.mean(np.array(validation_shr)**2))),models=fitted)
    encoded=json.dumps(bundle,indent=2,allow_nan=False)+'\n'
    (ROOT/'lib/data/precedent-airflow-cooling.json').write_text(encoded,encoding='utf-8')
    (ROOT/'public/references/packaged-cooling-airflow-fits.json').write_text(encoded,encoding='utf-8')
    with (ROOT/'public/references/packaged-cooling-all-airflows.csv').open('w',newline='',encoding='utf-8') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(raw[0]));writer.writeheader();writer.writerows(raw)
    print(json.dumps({k:v for k,v in bundle.items() if k not in ['models','policy','terms','transforms','capacity_coefficients']},indent=2))

if __name__=='__main__':main()

