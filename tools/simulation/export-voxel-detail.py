"""Bounded 600 m actual 1 m USGS Pima County DEM read for display QA, not a model run."""
import gzip, hashlib, json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from pyproj import Transformer

root=Path(__file__).resolve().parents[2];out=root/'public/simulation/data'
source='https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/AZ_PimaCounty_2021_B21/TIFF/USGS_1M_12_x48y359_AZ_PimaCounty_2021_B21.tif'
x,y=Transformer.from_crs(4326,32612,always_xy=True).transform(-111.16006599590631,32.41862569906363)
west=int(x//100)*100-300;south=int(y//100)*100-300;size=600
destination=np.full((size,size),np.nan,dtype='<f4')
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='60'):
  with rasterio.open(source) as ds:
    assert ds.res==(1.,1.)
    reproject(source=rasterio.band(ds,1),destination=destination,src_transform=ds.transform,src_crs=ds.crs,
      dst_transform=from_origin(west,south+size,1,1),dst_crs='EPSG:32612',resampling=Resampling.bilinear,dst_nodata=np.nan)
assert np.isfinite(destination).all()
# All renderer arrays use south-to-north rows, same as the retained subgrid.
pixels=destination[::-1].copy();target=out/'voxel-detail-1m.f32.gz';target.write_bytes(gzip.compress(pixels.tobytes(),mtime=0))
meta={'schemaVersion':1,'sourceUrl':source,'sourceResolutionM':1,'displayResolutionM':1,'crs':'EPSG:32612',
  'verticalDatum':'NAVD88','units':'metres','width':size,'height':size,'west':west,'south':south,
  'order':'south-to-north rows, west-to-east columns','encoding':'little-endian Float32',
  'artifactSha256':hashlib.sha256(target.read_bytes()).hexdigest(),
  'scope':'Bounded terrain-only detail around native cell 9344; not a 1m hydraulic simulation or full model-domain 1m coverage',
  'sourceProject':'USGS AZ_PimaCounty_2021_B21 lidar-derived bare-earth DEM, public domain',
  'sourceHorizontalCrs':'EPSG:26912; transformed to native model EPSG:32612',
  'sourceMetadata':'https://thor-f5.er.usgs.gov/ngtoc/metadata/waf/elevation/1_meter/geotiff/AZ_PimaCounty_2021_B21/USGS_1M_12_x48y359_AZ_PimaCounty_2021_B21.xml'}
(out/'voxel-detail-1m.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps({'pixels':pixels.size,'gzipBytes':target.stat().st_size,'rangeM':[float(pixels.min()),float(pixels.max())]}))
