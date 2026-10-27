"""Extract supplied standard/high heat-pump nominal ratings: --source PATH. Requires pypdf."""
from pathlib import Path
import argparse, csv, hashlib, json
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
BTU_PER_KWH=3412.141633
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',required=True,type=Path);args=parser.parse_args()
reader=PdfReader(args.source);assert len(reader.pages) in [1,6]
def row(text,prefix):
    line=next(s for s in text.splitlines() if s.startswith(prefix));return line[len(prefix):].split()
sizes=[3,4,5,6,7.5,8.5,10,12.5,15,17.5,20,25]
models=[]
families=[('standard',0,'WSK',6)]+([('high',3,'WHK',7)] if len(reader.pages)==6 else [])
for efficiency,page,prefix,table in families:
    text=reader.pages[page].extract_text();assert f'Table {table}.' in text
    ids=next(s for s in text.splitlines() if s.startswith(prefix+'036')).split()
    gross=list(map(float,row(text,'Gross Cooling Capacity ')));net=list(map(float,row(text,'AHRI Net Cooling Capacity ')));power=list(map(float,row(text,'System Power (kW) ')))
    flows=next(s for s in text.splitlines() if s.startswith('cfm 1200/1200')).split()[1:]
    assert all(len(values)==12 for values in [ids,gross,net,power,flows])
    if len(reader.pages)==6:
        notes=reader.pages[page+2].extract_text();assert 'Gross capacity does not include the effect of fan motor heat' in notes and 'AHRI capacity is net' in notes
    for index,(size,model,qg,qn,p,flow) in enumerate(zip(sizes,ids,gross,net,power,flows)):
        nominal,ahri=map(int,flow.split('/'));fan_heat=qg-qn;fan_kw=fan_heat/BTU_PER_KWH;assert 0<fan_kw<p
        # Motor nameplate output is reference data only; it is not fan electrical input at this airflow/ESP.
        motor_hp=([.75,1,1,2.9,2.9,2.9,2.9,2.9,2.9,2.9,2.9,2.9] if efficiency=='standard' else [2.9,2.9,2.9,2.9,2.9,2.9,4.2,2.9,2.9,2.9,2.9,2.9])[index]
        models.append(dict(nominal_tons=size,efficiency=efficiency,model=model,source_table=table,power_printed_page=24+page,nominal_cfm=nominal,ahri_cfm=ahri,rated_gross_cooling_Btu_hr=qg,rated_net_cooling_Btu_hr=qn,cooling_system_power_kW=p,inferred_supply_fan_heat_Btu_hr=fan_heat,inferred_supply_fan_power_kW=fan_kw,cooling_non_supply_fan_power_kW=p-fan_kw,rated_net_cooling_COP=qn/(BTU_PER_KWH*p),indoor_fan_count=1 if index<7 else 2,indoor_motor_standard_hp_catalog= motor_hp if len(reader.pages)==6 else None,motor_hp_note='Nameplate mechanical output only; not used as operating watts. Standard 3-ton 575V option uses 1 HP instead of 0.75 HP.' if efficiency=='standard' else 'Nameplate mechanical output only; not used as operating watts.'))
bundle=dict(schema='precedent-unit-ratings-1.1',source=dict(filename='Unit_data_full.pdf' if len(reader.pages)==6 else 'Unit_data.pdf',document_code='PKGP-PRC023F-EN',tables=[f[3] for f in families],printed_pages='24-29' if len(reader.pages)==6 else '24',sha256=hashlib.sha256(args.source.read_bytes()).hexdigest()),policy=dict(power='Nominal total cooling system power held constant at full output; no off-rating power correction curve supplied.',fan='Supply-fan heat = rated gross minus AHRI net cooling capacity. Fan kW = heat / 3412.141633; assumes electrical input becomes air heat. Rating-derived proxy, not a measured fan curve. Nameplate motor HP is not operating electrical input and is not converted to fan watts.',airflow='No adjustment from AHRI rating airflow to maximum cooling airflow; cooling power and fan estimates are provisional.',scope='Standard and high efficiency heat pumps, tables 6 and 7; no dual fuel.' if len(reader.pages)==6 else 'Standard efficiency only.',reference='https://www.energycodes.gov/sites/default/files/2024-08/90.1_Secton_11_and%29_Appendix_G_Review_Manual_V04.pdf'),models=models)
(ROOT/'lib/data/precedent-unit-ratings.json').write_text(json.dumps(bundle,indent=2)+'\n',encoding='utf-8')
with (ROOT/'public/references/packaged-unit-ratings.csv').open('w',newline='',encoding='utf-8-sig') as f:
    writer=csv.DictWriter(f,fieldnames=list(models[0]));writer.writeheader();writer.writerows(models)
print(f'Extracted {len(models)} ratings; source hash retained; inferred fan proxy distinguished from published power and nameplate HP.')
