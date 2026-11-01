"""Display-only 10 m terrain intersection; never a hydraulic model refinement.

Uses retained native zs and prepared DEM, preserving missing/dry/outside cells.
Joined polygons remove computational-cell outlines from the inexpensive flat view.
"""
from pathlib import Path
import gzip, json
import numpy as np
from rasterio.features import shapes
from rasterio.transform import Affine
from rasterio.warp import transform_geom

root = Path(__file__).resolve().parents[2] / 'public/simulation/data'
def read(name):
    p = root / name
    return json.loads(gzip.decompress(p.read_bytes()) if name.endswith('.gz') else p.read_text())
manifest = read('current-sfincs-manifest.json')
run = read(manifest['artifact']['path'].removeprefix('data/'))
terrain = read('frozen-terrain-display.json.gz')
assert terrain['sourceSha256'] == manifest['artifact']['sha256']
detail = np.frombuffer(gzip.decompress((root/'frozen-voxel-terrain.f32.gz').read_bytes()), dtype='<f4').reshape(-1,100)
vertices = np.array(terrain['vertices'])
rows, cols = vertices[:,3].astype(int), vertices[:,4].astype(int)
yy, xx = rows[:,None]*10+np.arange(100)//10, cols[:,None]*10+np.arange(100)%10
transform = Affine(10,0,467700,0,10,3572300)
frames = {f['time']: f for f in terrain['waterFrames']}
for index, frame in enumerate(run['frames']):
    depth = np.array(frame['depthM'], dtype=float)
    zs = np.array(frames[frame['time']]['surfaceM'], dtype=float)
    valid = np.isfinite(depth)&np.isfinite(zs)&(depth>=.01)
    categories = np.searchsorted([.01,.1,.3,1,2,4], depth, side='right').astype('uint8')
    labels = np.where(valid[:,None] & np.isfinite(detail) & (detail<zs[:,None]), categories[:,None], 0)
    raster = np.zeros(((rows.max()+1)*10,(cols.max()+1)*10), dtype='uint8')
    raster[yy,xx] = labels
    features=[]
    for geometry,value in shapes(raster, mask=raster>0, connectivity=4, transform=transform):
        features.append({'type':'Feature','properties':{'depthClass':int(value)-1},'geometry':transform_geom('EPSG:32612','EPSG:4326',geometry,precision=7)})
    result={'type':'FeatureCollection','time':frame['time'],'sourceSha256':terrain['sourceSha256'],'displayResolutionM':10,'hydraulicResolutionM':100,'verticalDatum':'NAVD88','method':'Native hourly zs intersected with retained 10 m DEM; cell-average depth class; not a solved 10 m shoreline.','features':features}
    data=gzip.compress(json.dumps(result,separators=(',',':')).encode(),mtime=0)
    (root/f'water-footprints-{index}.json.gz').write_bytes(data)
    print(index,len(features),len(data),flush=True)
