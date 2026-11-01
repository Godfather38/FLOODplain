"""Record reproducible source-chain and gauge comparisons, without tuning rainfall."""
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
from PIL import Image
from iem_profiles import PROFILE,SOURCES,WARNING
from decode_rainfall import iem_mm

cache=Path('../rainfall-cache');data=Path('public/simulation/data');old=data/'storm-2014';new=data/'storm-2014-legacy'
m=json.loads((old/'manifest.json').read_text());legacy=json.loads((new/'manifest.json').read_text());stations=json.loads((cache/'az-asos-stations.geojson').read_text())
def source(path,url):return {'url':url,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}
def sample(lon,lat,native=False):
    west,north=(-129.995,54.995) if native else (-130,55)
    col=math.floor((lon-west)/.01+.5);row=math.floor((north-lat)/.01+.5)
    values=[]
    for e in m['hours'][:24]:
        with Image.open(cache/e['sources'][0]['url'].split('/')[-1]) as image:values.append(image.getpixel((col,row)))
    with Image.open(cache/'p24h_201409090700.png') as image:daily=iem_mm(image.getpixel((col,row)))
    return {'sourceRow':row,'sourceCol':col,'hourlyRawIndices':values,'knownNonzeroIntegerSumMm':sum(v for v in values if v not in (0,255)),'unknownZeroOrMissingHours':sum(v in (0,255) for v in values),'obsoletePaletteSumMm':sum(iem_mm(v) or 0 for v in values),'dailyMm':daily,'sumMeaning':'Known positive samples only; not a complete accumulation because zeros are ambiguous'}
gauge_results=[]
for sid in ['TUS','RYN','AVQ']:
    station=next(f for f in stations['features'] if f['id']==sid);path=cache/f'{sid.lower()}-daily-20140908.json';raw=json.loads(path.read_text());obs=raw['data'][0] if raw['data'] else None
    rain=obs.get('precip') if obs else None;lon,lat=station['geometry']['coordinates']
    gauge_results.append({'stationId':sid,'stationMetadata':station,'rawDailyResponse':raw,'source':source(path,f'https://mesonet.agron.iastate.edu/api/1/daily.json?station={sid}&network=AZ_ASOS&date=2014-09-08'),'gaugeDay':'2014-09-08 America/Phoenix local calendar day','gaugeMm':rain*25.4 if rain is not None else None,'gaugeInches':rain,'estimatedFlag':obs.get('precip_est') if obs else None,'legacyWorldSampling':sample(lon,lat),'nativeCenterSampling':sample(lon,lat,True),'limitation':'Current station metadata positions used; historical station-location changes not independently checked. Point gauge is not identical to radar-grid area mean.'})
files={'hourlyWriter':'../iem-2014-mrms_raster_p1h.py','dailyWriter':'../iem-2014-mrms_raster_pXXh.py','reader':'../iem-2014-util.py','scheduler':'../iem-2014-run10.sh','historicalMissingWarning':'../iem-2014-rainfall-page.phtml','gridFix':'../rainfall-cache/iem-worldfile-fix.json'}
hashes=[e['sources'][0]['sha256'] for e in m['hours']]
out={'schemaVersion':1,'recordedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'profile':PROFILE,'sourceChain':{k:source(Path(p),SOURCES[k]) for k,p in files.items()},'findings':{'encoding':'Scheduled September 2014 p1h writer computes nonlinear image but stores val.astype(int) in uint8 output. Reader has already divided by header var_scale. Nonzero byte is truncated integer mm, not the current palette. p24h writes its encoded image.','missing':WARNING,'geometry':'Original world-file centers (-130,55) differ from corrected native centers (-129.995,54.995). Both sampling interpretations are reported; correction shifts coordinates, not rainfall values.','repetition':{'hourlyRawFiles':len(hashes),'uniqueRawHashes':len(set(hashes)),'embeddedPngTimestamps':'No timestamp metadata in inspected 18Z PNG; archive filenames and scheduled UTC process provide timing evidence, not raw-header verification.'},'timeWindow':'2014-09-08 07Z to 2014-09-09 07Z, same interval as Arizona Sep 8 and p24h endpoint. No timezone shift or overlapping sum.','unavailableEvidence':{'rawNsslHeadersObtained':False,'hourlyJsonSidecar':{'url':'https://mesonet.agron.iastate.edu/archive/data/2014/09/08/GIS/mrms/p1h_201409081800.json','outcome':'HTTP 404; not retried'}}},'trico':{'legacyWorldSampling':sample(-111.3019666667,32.4715888889),'nativeCenterSampling':sample(-111.3019666667,32.4715888889,True)},'gauges':gauge_results,'stationMetadataSource':source(cache/'az-asos-stations.geojson','https://mesonet.agron.iastate.edu/geojson/network/AZ_ASOS.geojson'),'independentGaugeCorroboration':'https://www.ncei.noaa.gov/stormevents/eventdetails.jsp?id=543215','stageIVComparison':'stage4-comparison-20140908.json','decision':'Use versioned nonzero integer-mm reconstruction for transparent scenarios; zeros remain unknown. Do not supply it as complete SFINCS forcing. Stage IV first-day comparison is an independently encoded alternative; no automatic blending, rescaling or accuracy interval.'}
(data/'rainfall-source-audit.json').write_text(json.dumps(out,indent=2,allow_nan=False)+'\n',encoding='utf-8')
print(json.dumps({'trico':out['trico'],'gauges':[{'id':g['stationId'],'observedMm':g['gaugeMm'],'knownNonzeroMm':g['nativeCenterSampling']['knownNonzeroIntegerSumMm'],'dailyMm':g['nativeCenterSampling']['dailyMm']} for g in gauge_results]},indent=2))
