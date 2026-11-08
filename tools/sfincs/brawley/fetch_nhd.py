"""Fetch NHDPlus V2 flowlines and catchments (USGS fabric pygeoapi, public domain) for brawley-avra-west.
Read-only public GETs. Writes merged raw FeatureCollections (gzip) plus provenance json."""
import argparse,gzip,hashlib,json,time,urllib.request
from datetime import datetime,timezone
from pathlib import Path
BASE='https://api.water.usgs.gov/fabric/pygeoapi/collections/{c}/items?f=json&bbox={b}&limit=1000'
def fetch(collection,bbox,out):
 # API max limit is 1000 (limit=2000 returns HTTP 400 'Limit of 1000 exceeded'); paginate via rel=next
 url=BASE.format(c=collection,b=bbox);features=[];pages=[];seen=set()
 while url:
  t=time.time();raw=urllib.request.urlopen(url,timeout=180).read();data=json.loads(raw)
  pages.append({'url':url,'fetchedUtc':datetime.now(timezone.utc).isoformat(timespec='seconds'),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'features':len(data['features']),'numberMatched':data.get('numberMatched'),'seconds':round(time.time()-t,1)})
  for f in data['features']:
   k=f.get('id',json.dumps(f['properties'],sort_keys=True))
   if k in seen:continue
   seen.add(k);features.append(f)
  nxt=next((l['href'] for l in data.get('links',[]) if l.get('rel')=='next'),None)
  url=nxt if (nxt and data['features']) else None
 fc={'type':'FeatureCollection','features':features}
 body=json.dumps(fc).encode();path=out/f'{collection}.geojson.gz'
 with gzip.open(path,'wb',compresslevel=9) as g:g.write(body)
 prov={'collection':collection,'source':'USGS Water Mission Area geospatial fabric pygeoapi (NHDPlus V2), public domain','bbox':bbox,'pages':pages,'count':len(features),'file':path.name,'uncompressedSha256':hashlib.sha256(body).hexdigest()}
 (out/f'{collection}-provenance.json').write_text(json.dumps(prov,indent=1)+'\n',encoding='utf-8');print(collection,len(features),len(pages))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--bbox',default='-111.70,31.95,-110.95,32.45');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 for c in ('nhdflowline_network','catchmentsp'):fetch(c,a.bbox,a.output)
