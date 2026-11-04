"""Fill only the exact remaining Gates 10 m context gap from the USGS 3DEP 2015 1 m product; report the 2015/2021 seam."""
import argparse,json,hashlib,shutil
from pathlib import Path
import numpy as np,rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from scipy.ndimage import binary_dilation

SOURCE={'Name':'AZ_Eastern_PimaCO_2015','OBJECTID':125309,'ProductName':'USGS_3DEP 1 m','StartDate':20150220,'EndDate':'20150226','VerticalDatum':'North American Vertical Datum of 1988 (NAVD 88)','URL':'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/AZ_Eastern_PimaCO_2015/TIFF/USGS_one_meter_x47y357_AZ_Eastern_PimaCO_2015.tif','query':'../all-route-ready-v3/gates-terrain-recovery/residual-all-source-query.json'}
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--merged',type=Path,required=True,help='terrain-context-2021-v2.tif');p.add_argument('--mask',type=Path,required=True,help='gates-missing-mask-v2.tif');p.add_argument('--context',type=Path,required=True,help='folder with lulc.tif, cn.tif, esa_worldcover_mapping.csv');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 a.output.mkdir(parents=True,exist_ok=False)
 with rasterio.open(a.merged) as d, rasterio.open(a.mask) as m:
  if (d.transform,d.shape,d.crs)!=(m.transform,m.shape,m.crs):raise ValueError('Mask and context grids differ')
  arr=d.read(1);original=arr.copy();profile=d.profile;nodata=d.nodata;gap=m.read(1).astype(bool)
  if not ((arr[gap]==nodata)|~np.isfinite(arr[gap])).all():raise ValueError('Gap mask covers valid 2021 pixels')
  with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='45',GDAL_HTTP_MAX_RETRY='2'):
   with rasterio.open(SOURCE['URL']) as src, WarpedVRT(src,crs=d.crs,transform=d.transform,width=d.width,height=d.height,resampling=Resampling.bilinear,nodata=nodata) as v:
    rows,cols=np.nonzero(binary_dilation(gap,iterations=20));win=rasterio.windows.Window(cols.min(),rows.min(),cols.max()-cols.min()+1,rows.max()-rows.min()+1)
    patch=v.read(1,window=win);srcCrs=str(src.crs)
 sl=win.toslices();fill=np.full(arr.shape,nodata,dtype=arr.dtype);fill[sl]=patch;valid2015=np.isfinite(fill)&(fill!=nodata)
 if not valid2015[gap].all():raise ValueError(f'2015 source leaves {int((gap&~valid2015).sum())} gap pixels empty')
 arr[gap]=fill[gap]
 keep=np.isfinite(original)&(original!=nodata);assert np.array_equal(arr[keep],original[keep])
 # Seam: 2021 pixels within 200 m of the gap that the 2015 product also covers.
 ring=binary_dilation(gap,iterations=20)&~gap&keep&valid2015;diff=(fill[ring]-original[ring]).astype('float64')
 seam={'pixels':int(ring.sum()),'ringWidthM':200,'diff2015minus2021M':{'median':float(np.median(diff)),'mean':float(diff.mean()),'p05':float(np.percentile(diff,5)),'p95':float(np.percentile(diff,95)),'maxAbs':float(np.abs(diff).max())}}
 profile.update(compress='deflate',tiled=True);out=a.output/'terrain.tif'
 with rasterio.open(out,'w',**profile) as dst:dst.write(arr,1);dst.update_tags(vertical_datum='NAVD88',units='metres',method='2021-v2 context unchanged; only the 74,221 listed gap pixels taken from USGS 3DEP AZ_Eastern_PimaCO_2015 1 m (bilinear to 10 m)')
 profile.update(dtype='uint8',nodata=None)
 with rasterio.open(a.output/'source-2015-mask.tif','w',**profile) as dst:dst.write(gap.astype('uint8'),1)
 for name in ['lulc.tif','cn.tif','esa_worldcover_mapping.csv']:shutil.copyfile(a.context/name,a.output/name)
 report={'status':'complete','kind':'gates_context_terrain_mixed_vintage','filledPixels':int(gap.sum()),'filledKm2':float(gap.sum()*100/1e6),'remainingGapPixels':0,'originalValidPixelsUnchanged':True,'source':SOURCE,'sourceHorizontalCrs':srcCrs,'outputHorizontalCrs':str(d.crs),'method':'Standard GDAL WarpedVRT bilinear 1 m to 10 m, same as the 2021 context patches; no interpolation across the gap, no conditioning or burning','why2015':'USGS AZ_PimaCounty_2021_B21 tile x47y357 returns nodata for all 74,221 gap pixels (checked by window read); the 2015 USGS 3DEP 1 m product covers all of them. The 2011 1/9 arc-second product is older and coarser.','seamCheck':seam,'inputs':{'merged2021':{'path':str(a.merged),'sha256':sha(a.merged)},'mask':{'path':str(a.mask),'sha256':sha(a.mask)},'lulc':sha(a.context/'lulc.tif'),'cn':sha(a.context/'cn.tif')},'output':{'terrain.tif':sha(out),'source-2015-mask.tif':sha(a.output/'source-2015-mask.tif')},'limits':['Gap terrain is a February 2015 survey, not 2021; changes between 2015 and 2021 inside the gap are not represented','10 m context only; route 1 m windows remain 2021']}
 (a.output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:report[k] for k in ['status','filledPixels','seamCheck']}))
if __name__=='__main__':main()
