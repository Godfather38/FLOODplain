"""Independent re-read of original GRIBs against the completed 2013 export."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import urllib.request
import urllib.parse
import eccodes as ec

ROOT=Path('public/simulation/data');CACHE=Path('../rainfall-cache')
rain=json.loads((ROOT/'sfincs-reach-stage4-2013-july-96h.json').read_text())
manifest=json.loads((ROOT/'stage4-reach-2013-july-96h-provenance.json').read_text())
points={'TUS':(32.1203,-110.938),'RYN':(32.1422,-111.1746),'Cortaro':(32.3507222222,-111.095875),'Trico':(32.4715888889,-111.3019666667)}
nearest=None;records=[];compared=0
for i,source in enumerate(manifest['sources']):
 path=CACHE/source['url'].split('/')[-1];raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==source['sha256']
 with path.open('rb') as stream:h=ec.codes_grib_new_from_file(stream)
 try:
  meta={k:ec.codes_get(h,k) for k in ['edition','dataDate','dataTime','validityDate','validityTime','startStep','endStep','stepUnits','stepType','units','indicatorOfParameter','table2Version','centre','subCentre','gridType','Nx','Ny','DxInMetres','DyInMetres','scanningMode','bitmapPresent','missingValue','md5GridSection']}
  end=dt.datetime.strptime(str(meta['validityDate'])+f"{meta['validityTime']:04}",'%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
  assert end==dt.datetime(2013,7,19,8,tzinfo=dt.timezone.utc)+dt.timedelta(hours=i)
  assert meta['units']=='kg m**-2' and meta['indicatorOfParameter']==61 and meta['stepType']=='accum' and meta['endStep']-meta['startStep']==1 and meta['stepUnits']==1
  assert meta['md5GridSection']==manifest['nativeGridHash']
  if nearest is None:
   nearest={name:dict(ec.codes_grib_find_nearest(h,lat,lon,npoints=1)[0]) for name,(lat,lon) in points.items()}
   for row,col in [(0,0),(11,16),(21,32)]:assert ec.codes_grib_find_nearest(h,rain['lat'][row],rain['lon'][col],npoints=1)[0]['index']==manifest['mapping'][row][col]['index']
  values=ec.codes_get_values(h);mask=ec.codes_get_array(h,'bitmap')
  for y,row in enumerate(manifest['mapping']):
   for x,cell in enumerate(row):
    idx=cell['index'];v=float(values[idx]) if mask[idx] else None
    assert v==rain['frames'][i]['precipMmH'][y][x];compared+=1
  records.append({'end':end.isoformat(),'metadata':meta,'pointDepthMm':{name:float(values[p['index']]) if mask[p['index']] else None for name,p in nearest.items()}})
 finally:ec.codes_release(h)
gauges=[]
for station in ['TUS','RYN']:
 for day in range(19,23):
  date=f'2013-07-{day:02}';url=f'https://mesonet.agron.iastate.edu/api/1/daily.json?station={station}&network=AZ_ASOS&date={date}'
  with urllib.request.urlopen(url,timeout=30) as response:raw=response.read()
  data=json.loads(raw);start=dt.datetime(2013,7,day,7,tzinfo=dt.timezone.utc);end=start+dt.timedelta(days=1)
  vals=[r['pointDepthMm'][station] for r in records if start<dt.datetime.fromisoformat(r['end'])<=end]
  gauges.append({'station':station,'localDate':date,'timezone':'America/Phoenix','url':url,'responseSha256':hashlib.sha256(raw).hexdigest(),'rawResponse':data,'stage4NearestDailyMm':sum(vals) if len(vals)==24 and all(v is not None for v in vals) else None,'stage4Sample':nearest[station]})
output={'schemaVersion':1,'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'comparedCellHours':compared,'mismatches':0,'originalFileHashesVerified':96,'cacheIdentity':'Full YYYYMMDDHH filenames, every validity time checked against July 2013; no 2014 cache collision','conversion':'Raw parameter 61 accumulation kg/m2, exactly one hour; numerical value is mm and hourly mean mm/h','nearestPointChecks':nearest,'rawMetadataByHour':records,'publicGaugeComparisons':gauges,'limitations':['ASOS point gauges differ from Stage IV native-cell averages and may contribute to the analysis; not independent validation of all rainfall cells.','TUS and RYN are outside or south of the local reach; differences do not imply a correction factor for the reach.','No scaling, time shifting, missing fill or model parameter changes were applied.']}
for g in gauges:
 value=(g['rawResponse'].get('data') or [{}])[0].get('precip')
 g['gaugeUnit']='inch';g['gaugeValueKind']='trace' if value==.0001 else 'missing' if value is None else 'numeric_summary'
 g['gaugeMm']=None if value is None or value==.0001 else value*25.4
 if g['station']=='RYN':g['comparisonCaveat']='Daily zero is not independently verified dry; sparse raw METAR reports omit explicit precipitation groups.'
params=[('station','RYN'),('station','TUS'),('data','p01i'),('data','metar'),('year1','2013'),('month1','7'),('day1','20'),('year2','2013'),('month2','7'),('day2','21'),('tz','America/Phoenix'),('format','onlycomma'),('latlon','no'),('elev','no'),('missing','M'),('trace','T'),('direct','no'),('report_type','3'),('report_type','4')]
url='https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?'+urllib.parse.urlencode(params)
metar=CACHE/'asos-20130720-TUS-RYN.csv'
if not metar.exists():
 with urllib.request.urlopen(url,timeout=45) as response:metar.write_bytes(response.read())
raw=metar.read_bytes();output['rawMetarCheck']={'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'rawCsv':raw.decode(),'interpretation':'Do not sum overlapping special reports or interpret absent precipitation groups as measured dry.'}
output['gaugeDocumentation']=['https://mesonet.agron.iastate.edu/request/hourlyprecip.phtml','https://mesonet.agron.iastate.edu/request/download.phtml']
(ROOT/'stage4-2013-source-audit.json').write_text(json.dumps(output,indent=2,allow_nan=False)+'\n',encoding='utf-8')
print('Verified',compared,'cell-hours; zero export mismatches. Gauge responses retained.')
for g in gauges:print(g['station'],g['localDate'],'Stage IV',g['stage4NearestDailyMm'],'gauge',g['rawResponse'].get('data'))
