"""Bounded, cached IEM September 8–10 2014 MST hourly forcing; never fill missing rain.

Run from repo root with --fetch to populate the public-data cache once, then offline.
Each source gets one attempt; recorded HTTP failures are not retried automatically.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request
from PIL import Image
from decode_rainfall import iem_mm

UTC=dt.timezone.utc
START=dt.datetime(2014,9,8,7,tzinfo=UTC)
HOURS=72
# Pixel centers, inclusive. Regional reusable crop, not a delineated catchment.
WEST,EAST,SOUTH,NORTH=-111.7,-110.5,31.7,32.8
OUT=Path('public/simulation/data/storm-2014')

def iso(t): return t.isoformat(timespec='seconds').replace('+00:00','Z')
def digest(data): return hashlib.sha256(data).hexdigest()
def save(path,value): path.write_text(json.dumps(value,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')

def source_file(cache,stamp,product,suffix,fetch):
    name=f'{product}_{stamp:%Y%m%d%H%M}.{suffix}'
    url=f'https://mesonet.agron.iastate.edu/archive/data/{stamp:%Y/%m/%d}/GIS/mrms/{name}'
    path=cache/name; record_path=cache/(name+'.source.json')
    if path.exists() and record_path.exists():
        record=json.loads(record_path.read_text(encoding='utf-8'))
        if digest(path.read_bytes())!=record['sha256']: raise ValueError('Cached file hash mismatch: '+name)
        return path,record
    prior=None
    if record_path.exists():
        prior=json.loads(record_path.read_text(encoding='utf-8'))
        # One bounded retry for our own undersized local guard, never HTTP/auth failures.
        if not(fetch and product=='p24h' and prior.get('error')=='Source exceeds bounded size limit' and 'priorAttempt' not in prior):return None,prior
    if not fetch: return None,{'url':url,'status':'not_cached'}
    record={'url':url,'retrievedAt':iso(dt.datetime.now(UTC))}
    if prior:record['priorAttempt']=prior
    try:
        request=urllib.request.Request(url,headers={'User-Agent':'FLOODplain-public-rainfall-fixture/1.0'})
        with urllib.request.urlopen(request,timeout=30) as response:
            limit=(6_000_000 if product=='p24h' else 2_000_000) if suffix=='png' else 4096
            data=response.read(limit+1)
            if len(data)>limit: raise ValueError('Source exceeds bounded size limit')
            record.update(status='ok',httpStatus=response.status,bytes=len(data),sha256=digest(data))
            path.write_bytes(data)
    except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError) as error:
        record.update(status='unavailable',error=str(error),httpStatus=getattr(error,'code',None))
        path=None
    finally: time.sleep(.2)
    save(record_path,record)
    return path,record

def crop(png,world):
    transform=[float(v) for v in world.read_text().split()]
    if transform!=[.01,0,0,-.01,-130,55]: raise ValueError('Unexpected source grid; do not silently shift pixels')
    col0=round((WEST+130)/.01);col1=round((EAST+130)/.01)
    row0=round((55-NORTH)/.01);row1=round((55-SOUTH)/.01)
    with Image.open(png) as image:
        if image.mode!='P' or image.size!=(7000,3500): raise ValueError('Require original IEM quantitative indexed grid')
        indices=list(image.crop((col0,row0,col1+1,row1+1)).get_flattened_data())
    return [iem_mm(i) for i in indices],{'crs':'EPSG:4326','pixelReference':'center','west':WEST,'north':NORTH,'dx':.01,'dy':-.01,'rows':row1-row0+1,'cols':col1-col0+1,'sourceRow':row0,'sourceCol':col0}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fetch',action='store_true');parser.add_argument('--cache',default='../rainfall-cache');args=parser.parse_args()
    cache=Path(args.cache);cache.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    entries=[];arrays=[];grid=None;daily=[]
    for index in range(HOURS):
        end=START+dt.timedelta(hours=index+1)
        png,p_record=source_file(cache,end,'p1h','png',args.fetch)
        world,w_record=source_file(cache,end,'p1h','wld',args.fetch)
        entry={'start':iso(end-dt.timedelta(hours=1)),'end':iso(end),'durationMinutes':60,'sources':[p_record,w_record]}
        try:
            if png is None or world is None: raise ValueError('Required public source missing; no zero substitution')
            values,current_grid=crop(png,world)
            if grid is not None and current_grid!=grid: raise ValueError('Grid changed between hours')
            grid=current_grid;valid=[v for v in values if v is not None]
            filename=f'hour-{end:%Y%m%d%H%M}.json'
            save(OUT/filename,{'schemaVersion':1,'start':entry['start'],'end':entry['end'],'units':'mm','depthMm':values})
            entry.update(status='partial' if len(valid)!=len(values) else 'complete',file=filename,sha256=digest((OUT/filename).read_bytes()),validCells=len(valid),missingCells=len(values)-len(valid),minimumMm=min(valid) if valid else None,maximumMm=max(valid) if valid else None)
            arrays.append(values)
        except ValueError as error:
            entry.update(status='unavailable',error=str(error));arrays.append(None)
        entries.append(entry)
        print(index+1,HOURS,entry['end'],entry['status'],entry.get('missingCells'),flush=True)
        if (index+1)%24==0:
            dp,pr=source_file(cache,end,'p24h','png',args.fetch);dw,wr=source_file(cache,end,'p24h','wld',args.fetch)
            check={'end':iso(end),'sources':[pr,wr],'status':'unavailable'}
            if dp and dw and all(a is not None for a in arrays[-24:]):
                totals,dgrid=crop(dp,dw)
                if dgrid!=grid: raise ValueError('Daily comparison grid mismatch')
                daily_file=f'daily-{end:%Y%m%d%H%M}.json'
                save(OUT/daily_file,{'schemaVersion':1,'start':iso(end-dt.timedelta(hours=24)),'end':iso(end),'units':'mm','depthMm':totals})
                check.update(file=daily_file,sha256=digest((OUT/daily_file).read_bytes()))
                differences=[]
                for j,total in enumerate(totals):
                    hours=[a[j] for a in arrays[-24:]]
                    if total is not None and all(v is not None for v in hours):differences.append(sum(hours)-total)
                check.update(status='compared' if differences else 'no_common_valid_cells',comparedCells=len(differences),excludedCells=len(totals)-len(differences),meanHourlyMinusDailyMm=sum(differences)/len(differences) if differences else None,maxAbsoluteDifferenceMm=max(map(abs,differences)) if differences else None,interpretation='Same endpoint and preceding 24 nonoverlapping hours, common valid cells only. Quantization and product differences mean equality is not assumed; no adjustment applied.')
            daily.append(check)
    manifest={'schemaVersion':1,'kind':'radar_rainfall_forcing','title':'September 8–10 2014 Arizona local-time rainfall','timezone':'America/Phoenix (UTC-07:00; no DST)','start':iso(START),'end':iso(START+dt.timedelta(hours=HOURS)),'grid':grid,'depthUnits':'mm','rateUnits':'mm/h','method':'Each p1h ending timestamp represents preceding one hour; constant hourly mean rate equals depth/1h. No overlapping accumulation sum. Index255 stays null.','domain':'Regional Trico/Avra reusable crop, 111.7–110.5 W and 31.7–32.8 N pixel centers; not a full delineated watershed or a SFINCS mesh.','createdAt':iso(dt.datetime.now(UTC)),'source':'Iowa Environmental Mesonet MRMS quantitative PNG archive','mappingUrl':'https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=5','intervalDocumentation':'https://mesonet.agron.iastate.edu/rainfall/','license':'IEM public-use archive; credit IEM and NOAA; derived radar estimates, not gauge truth','hours':entries,'dailyCrossChecks':daily,'quality':{'requestedHours':HOURS,'availableHours':sum(e['status']!='unavailable' for e in entries),'completeHours':sum(e['status']=='complete' for e in entries),'missingHours':[e['end'] for e in entries if e['status']=='unavailable']},'limitations':['Quantized radar estimates; beam blockage and QPE uncertainty remain.','Subhour timing unknown; hourly constant-rate forcing.','Missing rain prevents complete forcing at affected cells; no interpolation or zero fill.','Rainfall replay is not simulated inundation or bridge-failure evidence.']}
    manifest['quality']['forcingReadiness']='unverified_cross_product_difference'
    manifest['quality']['reviewNote']='Hourly sums and matching 24-hour products differ substantially. Product comparability/history and independent gauge rainfall require review; no rescaling applied. Complete coverage is not a validated rainfall reconstruction.'
    save(OUT/'manifest.json',manifest)
    print(json.dumps(manifest['quality']),flush=True)

if __name__=='__main__':main()
