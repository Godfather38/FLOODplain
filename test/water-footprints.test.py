"""Round-trip exported geographic polygons back to native DEM pixels.

Checks holes, dry/outside cells and categorical depths, not just output schema.
"""
from pathlib import Path
import gzip,json
import numpy as np
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.warp import transform_geom
root=Path(__file__).resolve().parents[1]/'public/simulation/data'
def read(name):
    data=(root/name).read_bytes()
    return json.loads(gzip.decompress(data) if name.endswith('.gz') else data)
m=read('current-sfincs-manifest.json');run=read(m['artifact']['path'].removeprefix('data/'));terrain=read('frozen-terrain-display.json.gz')
v=np.array(terrain['vertices']);rows=v[:,3].astype(int);cols=v[:,4].astype(int)
dem=np.frombuffer(gzip.decompress((root/'frozen-voxel-terrain.f32.gz').read_bytes()),dtype='<f4').reshape(-1,100)
yy=rows[:,None]*10+np.arange(100)//10;xx=cols[:,None]*10+np.arange(100)%10
for index in [10,11]:
    frame=run['frames'][index];asset=read(f'water-footprints-{index}.json.gz')
    assert asset['sourceSha256']==m['artifact']['sha256'] and asset['time']==frame['time']
    depth=np.array(frame['depthM'],dtype=float);zs=np.array(next(f for f in terrain['waterFrames'] if f['time']==frame['time'])['surfaceM'],dtype=float)
    good=np.isfinite(depth)&np.isfinite(zs)&(depth>=.01)
    labels=np.where(good[:,None]&(dem<zs[:,None]),np.searchsorted([.01,.1,.3,1,2,4],depth,side='right')[:,None],0)
    expected=np.zeros(((rows.max()+1)*10,(cols.max()+1)*10),dtype='uint8');expected[yy,xx]=labels
    geometries=((transform_geom('EPSG:4326','EPSG:32612',f['geometry']),f['properties']['depthClass']+1) for f in asset['features'])
    actual=rasterize(geometries,out_shape=expected.shape,transform=Affine(10,0,467700,0,10,3572300),dtype='uint8')
    assert np.array_equal(actual,expected),f'Frame {index} changes wet/dry/domain/depth class pixels'
    print(f'Frame {index}: all {actual.size:,} pixels match terrain intersection, including dry/domain holes')
