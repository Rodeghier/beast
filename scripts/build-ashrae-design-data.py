"""Prepare U.S. ASHRAE 2017 station design days from the EnergyPlus publication.

Run with --source path/to/2017-region4.zip. All temperatures stay in Celsius;
conversion to the website's Fahrenheit display happens in the runtime reader.
The source ZIP is not part of the application. Its hash and URL identify it.
"""
from pathlib import Path
import argparse, hashlib, json, re
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
SOURCE_URL='https://energyplushelp.freshdesk.com/support/solutions/articles/67000709369-2017-annual-design-conditions-definitions-for-all-ashrae-design-condition-locations'
DOWNLOAD_URL='https://energyplushelp.freshdesk.com/helpdesk/attachments/67051905125'

def build(source):
    raw=source.read_bytes()
    with ZipFile(source) as archive:
        members=[name for name in archive.namelist() if name.lower().endswith('.imf')]
        if len(members)!=1: raise ValueError('Expected one regional IMF file')
        text=archive.read(members[0]).decode('cp1252')
    stations=[];excluded=[]
    for match in re.finditer(r'##ifdef\s+(USA_[^\r\n]+)([\s\S]*?)##endif',text):
        macro,block=match.groups()
        clean=re.sub(r'![^\r\n]*','',block)
        location=re.search(r'Site:Location,([\s\S]*?);',clean)
        if not location: continue
        fields=[v.strip() for v in location[1].split(',')]
        identity=re.fullmatch(r'(.+) ([A-Z]{2}) USA WMO=(\d+)',fields[0])
        if not identity:
            excluded.append({'name':fields[0],'reason':'No U.S. state identifier; offshore or non-state station'})
            continue
        name,state,wmo=identity.groups()
        heating={};cooling={};pressure=None
        for obj in re.findall(r'SizingPeriod:DesignDay,([\s\S]*?);',clean):
            f=[v.strip() for v in obj.split(',')]
            if len(f)<25: raise ValueError('Short design-day object')
            heat=re.search(r'Ann Htg (99\.6|99)% Condns DB$',f[0])
            cool=re.search(r'Ann Clg (\.4|1|2)% Condns (DB=>MWB|WB=>MDB|DP=>MDB)$',f[0])
            if not heat and not cool: continue
            if f[6]!='DefaultMultipliers' or f[8] not in ('Wetbulb','Dewpoint'):
                raise ValueError('Unexpected temperature/humidity profile: '+f[0])
            pressure=float(f[14])
            if heat:
                heating[heat[1]]={'month':int(f[1]),'day':int(f[2]),'dryC':float(f[4])}
            else:
                level=str(float(cool[1])).removesuffix('.0')
                kind={'DB=>MWB':'dryBulb','WB=>MDB':'wetBulb','DP=>MDB':'dewPoint'}[cool[2]]
                if not f[23] or not f[24]: continue
                cooling.setdefault(level,{})[kind]={
                    'month':int(f[1]),'day':int(f[2]),'dryC':float(f[4]),'rangeC':float(f[5]),
                    'humidityType':f[8],'humidityC':float(f[9]),'tauB':float(f[23]),'tauD':float(f[24]),
                }
        # Complete source data are required. Never manufacture missing design states.
        complete=all(k in heating for k in ('99','99.6')) and all(
            k in cooling and all(kind in cooling[k] for kind in ('dryBulb','wetBulb','dewPoint'))
            for k in ('0.4','1','2'))
        if not complete: excluded.append({'id':wmo,'name':name,'reason':'Incomplete published heating/cooling/humidity/solar design data'});continue
        stations.append({'id':wmo,'name':name,'state':state,'latitude':float(fields[1]),'longitude':float(fields[2]),
                         'utcOffset':float(fields[3]),'elevationM':float(fields[4]),'pressurePa':pressure,
                         'heating':heating,'cooling':cooling})
    stations.sort(key=lambda s:(s['state'],s['name'],s['id']))
    assert len({s['id'] for s in stations})==len(stations)
    document={'source':{'edition':2017,'title':'ASHRAE Handbook Fundamentals 2017 annual design conditions',
                       'url':SOURCE_URL,'downloadUrl':DOWNLOAD_URL,'sha256':hashlib.sha256(raw).hexdigest(),
                       'stationCount':len(stations),'excludedStationCount':len(excluded)},'stations':stations}
    target=ROOT/'lib/data/ashrae-design-2017-us.json'
    target.write_text(json.dumps(document,ensure_ascii=True,separators=(',',':'))+'\n',encoding='utf-8')
    report=source.parent/'excluded-stations.json';report.write_text(json.dumps(excluded,indent=2),encoding='utf-8')
    print(f'{len(stations)} complete stations, {len(excluded)} excluded; {target.stat().st_size} bytes')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True)
    build(parser.parse_args().source)
