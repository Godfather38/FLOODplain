"""Export retained 10 m subgrid DEM pixels; no hydraulic calculation or download."""
import gzip, hashlib, json, sys
from pathlib import Path
import numpy as np
import rasterio

root = Path(__file__).resolve().parents[2]
source = Path(sys.argv[1])
out = root / 'public/simulation/data'
terrain = json.loads(gzip.decompress((out/'frozen-terrain-display.json.gz').read_bytes()))
with rasterio.open(source) as ds:
    assert ds.crs.to_epsg() == 32612
    assert tuple(ds.transform)[:6] == (10., 0., 467700., 0., 10., 3572300.)
    dem = ds.read(1)
    blocks = []
    for vertex in terrain['vertices']:
        row, col = vertex[3:5]
        block = dem[row*10:row*10+10, col*10:col*10+10]
        assert block.shape == (10,10) and np.isfinite(block).all()
        blocks.append(block)
    values = np.stack(blocks).astype('<f4')
    target = out/'frozen-voxel-terrain.f32.gz'
    target.write_bytes(gzip.compress(values.tobytes(),mtime=0))
    meta = {'schemaVersion':1,'sourceSha256':terrain['sourceSha256'],
      'rasterSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
      'artifactSha256':hashlib.sha256(target.read_bytes()).hexdigest(),
      'cellCount':len(blocks),'subdivision':10,'resolutionM':10,
      'order':'native cell index, south-to-north subrow, west-to-east subcolumn',
      'encoding':'little-endian Float32 metres NAVD88','crs':'EPSG:32612',
      'source':'Retained actual SFINCS case subgrid/dep_subgrid.tif, derived from USGS Pima County 2021 1m lidar DEM, northern edge 2023; resampled to 10m for the model',
      'sourceResolutionM':1,'displayResolutionM':10,
      'limitations':['Terrain detail is not hydraulic model resolution.','Native water levels remain 100m cells; terrain intersection is not a resolved wet footprint.']}
    (out/'frozen-voxel-terrain.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({'cells':len(blocks),'pixels':values.size,'gzipBytes':target.stat().st_size}))
