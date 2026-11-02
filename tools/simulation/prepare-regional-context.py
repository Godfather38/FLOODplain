import json, math, gzip, hashlib, io, urllib.request, datetime
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]/'public'/'simulation'/'data'/'regional-context'
ROOT.mkdir(parents=True,exist_ok=True)
west,south,east,north=-111.8,31.95,-110.7,32.85
zoom=10;n=2**zoom;cols=rows=257
def xy(lon,lat):
    return (lon+180)/360*n,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
tiles={};sources=[]
x0,y1=xy(west,south);x1,y0=xy(east,north)
for y in range(math.floor(y0),math.floor(y1)+1):
 for x in range(math.floor(x0),math.floor(x1)+1):
  url=f'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{zoom}/{x}/{y}.png'
  with urllib.request.urlopen(url,timeout=45) as r: data=r.read()
  im=Image.open(io.BytesIO(data)).convert('RGB');im.load();tiles[x,y]=im
  sources.append({'url':url,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
values=[]
for row in range(rows):
 lat=south+(north-south)*row/(rows-1)
 for col in range(cols):
  lon=west+(east-west)*col/(cols-1);x,y=xy(lon,lat);tx,ty=math.floor(x),math.floor(y)
  # Nearest source pixel; no fabricated elevations or hydraulic resampling.
  r,g,b=tiles[tx,ty].getpixel((min(255,int((x-tx)*256)),min(255,int((y-ty)*256))))
  values.append(round((r*256+g+b/256-32768)*10))
grid={'schemaVersion':1,'purpose':'regional geographic context only; not hydraulic terrain or road-depth evidence','bounds':[west,south,east,north],'columns':cols,'rows':rows,'order':'south-to-north rows, west-to-east columns','elevationUnit':'decimetres','elevations':values,'verticalExaggeration':1}
raw=json.dumps(grid,separators=(',',':')).encode();packed=gzip.compress(raw,mtime=0)
(ROOT/'terrain.json.gz').write_bytes(packed)
manifest={'schemaVersion':1,'source':'Mapzen/Tilezen Terrain Tiles on AWS, USGS 3DEP/GMTED/SRTM source family','sourceZoom':zoom,'accessedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'artifact':{'path':'terrain.json.gz','sha256':hashlib.sha256(packed).hexdigest(),'bytes':len(packed)},'bounds':[west,south,east,north],'columns':cols,'rows':rows,'elevationRangeM':[min(values)/10,max(values)/10],'sourceTiles':sources,'attribution':'Terrain Tiles by Mapzen; USGS 3DEP, GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.','licenseDocumentation':'https://github.com/tilezen/joerd/blob/master/docs/attribution.md','registry':'https://registry.opendata.aws/terrain-tiles/','formatDocumentation':'https://github.com/tilezen/joerd/blob/master/docs/formats.md','limitations':['Regional context sampled on a roughly400m grid; no claim of survey or hydraulic resolution.','Source dates and orthometric vertical references vary; not asserted equivalent to the native model NAVD88 terrain.','Never used to derive water depth, flood extent, crossing safety or source velocity.','Render at1x true elevation; any future exaggeration must be labeled.']}
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'tiles':len(sources),'vertices':len(values),'bytes':len(packed),'elevationRangeM':manifest['elevationRangeM']}))

