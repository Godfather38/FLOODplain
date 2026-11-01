"""Independent first-day Stage IV point comparison, not a replacement model/mesh."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import eccodes as ec

UTC=dt.timezone.utc
CACHE=Path('../rainfall-cache')
POINTS={'Trico':(32.4715888889,-111.3019666667),'TUS':(32.1203,-110.938)}
records=[]
for i in range(24):
    end=dt.datetime(2014,9,8,8,tzinfo=UTC)+dt.timedelta(hours=i)
    name=f'ST4.{end:%Y%m%d%H}.01h.grib';url=f'https://mesonet.agron.iastate.edu/archive/data/{end:%Y/%m/%d}/stage4/{name}'
    path=CACHE/name
    if not path.exists():
        with urllib.request.urlopen(url,timeout=30) as response:data=response.read(4_000_001)
        if len(data)>4_000_000:raise ValueError('Stage IV source exceeds 4 MB bound')
        path.write_bytes(data);time.sleep(.2)
    data=path.read_bytes()
    with path.open('rb') as stream:handle=ec.codes_grib_new_from_file(stream)
    try:
        keys=['edition','shortName','units','gridType','dataDate','dataTime','startStep','endStep','stepUnits','stepType','validityDate','validityTime','bitmapPresent','missingValue','Nx','Ny','DxInMetres','DyInMetres']
        metadata={k:ec.codes_get(handle,k) for k in keys}
        if metadata['shortName']!='tp' or metadata['units']!='kg m**-2' or metadata['stepType']!='accum' or metadata['endStep']-metadata['startStep']!=1 or metadata['stepUnits']!=1:raise ValueError('Unexpected Stage IV product/interval')
        valid=dt.datetime.strptime(str(metadata['validityDate'])+f"{metadata['validityTime']:04}",'%Y%m%d%H%M').replace(tzinfo=UTC)
        if valid!=end:raise ValueError('GRIB valid end does not match archive filename')
        points={}
        for label,(lat,lon) in POINTS.items():
            nearest=dict(ec.codes_grib_find_nearest(handle,lat,lon,npoints=1)[0]);value=nearest['value']
            points[label]={**nearest,'depthMm':None if value==metadata['missingValue'] or value<0 else value,'requestedLat':lat,'requestedLon':lon}
        records.append({'start':(end-dt.timedelta(hours=1)).isoformat().replace('+00:00','Z'),'end':end.isoformat().replace('+00:00','Z'),'url':url,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'recordedAt':dt.datetime.now(UTC).isoformat(),'metadata':metadata,'points':points})
        print(i+1,name,{k:v['depthMm'] for k,v in points.items()},flush=True)
    finally:ec.codes_release(handle)
out={'schemaVersion':1,'kind':'independent_rainfall_comparison','source':'NCEP Stage IV hourly analysis, independently archived GRIB via IEM','sourceDocumentation':'https://mesonet.agron.iastate.edu/iemre/','conversion':'1 kg/m2 liquid water is 1 mm; ecCodes verifies tp/accum and the one-hour GRIB interval','sampling':'Nearest native polar-stereographic grid cell; grid spacing and offset retained, not 1 km radar or point-gauge truth','hours':records,'totalsMm':{label:sum(r['points'][label]['depthMm'] for r in records) if all(r['points'][label]['depthMm'] is not None for r in records) else None for label in POINTS},'limitations':['Stage IV is another radar/gauge analysis, not an independent physical rain gauge.','Only the first 24 hours are compared here; not a full 72-hour alternative forcing.','No adjustment to other rainfall products or calibration to this comparison.']}
Path('public/simulation/data/stage4-comparison-20140908.json').write_text(json.dumps(out,indent=2,allow_nan=False)+'\n',encoding='utf-8')
print(out['totalsMm'],flush=True)
