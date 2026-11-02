"""Windowed professional 1m road-neighborhood terrain intake; no filling or burning."""
import argparse,json,hashlib
from pathlib import Path
from contextlib import ExitStack
import geopandas as gpd,numpy as np,rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.features import geometry_mask
from rasterio.warp import transform_bounds
from shapely.geometry import box

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 root=Path('tools/sfincs/data/all-routes-extension-v1');zones=gpd.read_file('public/data/routes.geojson').to_crs(32612);geom=zones.geometry.union_all().buffer(525);bounds=geom.bounds
 blocks=[(x,y) for x in range(int(np.floor(bounds[0]/1000)*1000),int(np.ceil(bounds[2]/1000)*1000),1000) for y in range(int(np.floor(bounds[1]/1000)*1000),int(np.ceil(bounds[3]/1000)*1000),1000) if geom.intersects(box(x,y,x+1000,y+1000))]
 if len(blocks)>250:raise ValueError('Exceeded audited 250-window intake envelope')
 catalog=json.loads((root/'terrain-catalog.json').read_text());tiles=[i for i in catalog['items'] if 'AZ_PimaCounty_2021_B21' in i['title']]+[i for i in catalog['items'] if 'AZ_NorthCentral_B23' in i['title']]
 records=[]
 with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='45',GDAL_HTTP_MAX_RETRY='1'),ExitStack() as stack:
  sources=[]
  for tile in tiles:
   s=stack.enter_context(rasterio.open(tile['downloadURL']));sources.append((tile,s,box(*transform_bounds(s.crs,32612,*s.bounds))))
  for number,(x,y) in enumerate(blocks,1):
   path=a.output/f'terrain-1m-{x}-{y}.tif';meta=path.with_suffix('.json')
   cached=next((Path('.sfincs-runs')/folder/path.name for folder in ['silverbell-terrain-v1','road-terrain-1m-v1'] if (Path('.sfincs-runs')/folder/path.name).exists()),None)
   if cached is not None:
    with rasterio.open(cached) as cr:
     values=cr.read(1);needed=geometry_mask([geom],cr.shape,cr.transform,invert=True,all_touched=True);missing=int((needed&(~np.isfinite(values)|(values==cr.nodata))).sum())
    if missing==0:
     records.append({'path':str(cached.resolve()),'reusedCached':True,'missingRequiredPixels':0});continue
   if meta.exists():records.append(json.loads(meta.read_text()));continue
   transform=from_origin(x,y+1000,1,1);required=geometry_mask([geom],(1000,1000),transform,invert=True,all_touched=True);arr=np.full((1000,1000),-9999,dtype='float32');used=[]
   for tile,src,extent in sources:
    if not extent.intersects(box(x,y,x+1000,y+1000)):continue
    with WarpedVRT(src,crs='EPSG:32612',transform=transform,width=1000,height=1000,resampling=Resampling.bilinear,nodata=-9999) as v:data=v.read(1)
    take=(arr==-9999)&np.isfinite(data)&(data!=-9999)
    if take.any():arr[take]=data[take];used.append({'url':tile['downloadURL'],'sourceId':tile['sourceId'],'title':tile['title']})
    if not (required&(arr==-9999)).any():break
   missing=int((required&(arr==-9999)).sum())
   with rasterio.open(path,'w',driver='GTiff',width=1000,height=1000,count=1,dtype='float32',crs='EPSG:32612',transform=transform,nodata=-9999,compress='deflate',tiled=True) as dst:dst.write(arr,1);dst.update_tags(vertical_datum='NAVD88',vertical_units='metres',source_resolution='1 metre professional USGS product')
   rec={'path':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'requiredPixels':int(required.sum()),'missingRequiredPixels':missing,'sources':used};meta.write_text(json.dumps(rec,indent=2)+'\n',encoding='utf-8');records.append(rec);print(f'{number}/{len(blocks)} road windows; missing required pixels={missing}',flush=True)
 result={'kind':'professional_1m_road_terrain','resolutionM':1,'verticalDatum':'NAVD88','crs':'EPSG:32612','method':'Standard GDAL bilinear horizontal reprojection of actual 1m products; no filling, burning or upscaled 10m source','windows':records,'missingRequiredPixels':sum(r['missingRequiredPixels'] for r in records),'status':'complete' if all(r['missingRequiredPixels']==0 for r in records) else 'coverage_gap'}
 (a.output/'manifest.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps({'status':result['status'],'windows':len(records),'missing':result['missingRequiredPixels']}))
if __name__=='__main__':main()
