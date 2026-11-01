import math,csv,datetime as dt,hashlib,io,json,pathlib,urllib.request,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[2]; DATA=ROOT/'public/simulation/data'; RAW=ROOT/'tools/simulation/data/official-forecasts'; RAW.mkdir(parents=True,exist_ok=True)
protocol=json.loads((ROOT/'tools/simulation/official-forecast-protocol.json').read_text())
series={'SCTA3':('b985aa9a337c488fa89f4721c9353748','09486520'),'CSCA3':('54d7b9d97acd4b40954881072b19a1c9','09486500')}
def fetch(url,path):
 if path.exists(): return path.read_bytes()
 with urllib.request.urlopen(url,timeout=90) as r: b=r.read()
 path.write_bytes(b);path.with_suffix(path.suffix+'.retrieval.json').write_text(json.dumps({'url':url,'retrievedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'sha256':hashlib.sha256(b).hexdigest()}));return b
def date(s):return dt.datetime.fromisoformat(s.replace('Z','+00:00'))
def iso(d):return d.isoformat().replace('+00:00','Z')
manifest=[];out=[]
for e in protocol['events']:
 url='https://mesonet.agron.iastate.edu/cgi-bin/request/hml.py?'+urllib.parse.urlencode(dict(station='SCTA3,CSCA3',sts=e['start'],ets=e['end'],fmt='csv',kind='forecasts',tz='UTC'))
 path=RAW/(e['id']+'.csv');raw=fetch(url,path); rows=list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
 forecasts=[];seen={}
 for r in rows:
  if r['secondaryname']!='Flow' or r['secondaryunits']!='kcfs':raise ValueError('Unexpected HML product units')
  if not r['secondary_value'].strip():continue
  value=float(r['secondary_value']);issued=r['issued[UTC]'].replace(' ','T')+':00Z';valid=r['forecast_valid[UTC]'].replace(' ','T')+':00Z'
  if not math.isfinite(value) or value<0:continue
  key=(r['station'],issued,valid)
  if key in seen and seen[key]!=value:raise ValueError('Conflicting duplicate forecast')
  if key in seen:continue
  seen[key]=value;forecasts.append(dict(station=r['station'],issued=issued,time=valid,valueM3s=value*28.316846592))
 observations={};sources={}
 for station,prefix in protocol['stations'].items():
  if e.get('fixture'):
   p=DATA/(prefix+'-'+e['fixture']+'.json');n=json.loads(p.read_text())['normalized'];observations[station]=n['points'];sources[station]={k:n[k] for k in ['siteId','sourceUrl','retrievedAt']};sources[station]['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
  else:
   sid,site=series[station];u='https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?'+urllib.parse.urlencode(dict(f='json',time_series_id=sid,datetime=e['start']+'/'+e['end'],limit=10000));p=RAW/(e['id']+'-'+station+'.json');b=fetch(u,p);j=json.loads(b)
   if any(l.get('rel')=='next' for l in j.get('links',[])):raise ValueError('Pagination not complete')
   pts=[]
   for f in j['features']:
    a=f['properties']
    if a['unit_of_measure']!='ft^3/s' or a['monitoring_location_id']!='USGS-'+site or a['parameter_code']!='00060':raise ValueError('Unexpected USGS identity/units')
    if a['value'] is None:continue
    pts.append(dict(time=iso(date(a['time'])),valueM3s=float(a['value'])*.028316846592,approval=a.get('approval_status'),qualifier=a.get('qualifier')))
   observations[station]=pts;sources[station]=dict(sourceUrl=u,sha256=hashlib.sha256(b).hexdigest(),siteId='USGS-'+site)
 manifest.append(dict(event=e['id'],url=url,rawPath=str(path.relative_to(ROOT)),sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),retrievedAt=(json.loads(path.with_suffix(path.suffix+'.retrieval.json').read_text())['retrievedAt'] if path.with_suffix(path.suffix+'.retrieval.json').exists() else None),retrievalNote='Null timestamp means original cached download had no contemporaneous retrieval sidecar; hash and source are retained, not a fabricated retrieval time.',observations=sources))
 out.append(dict(**e,forecasts=forecasts,observations=observations));print(e['id'],len(forecasts),flush=True)
(DATA/'official-forecast-events.json').write_text(json.dumps(dict(protocol=protocol,events=out,provenance=manifest),separators=(',',':'))+'\n')
