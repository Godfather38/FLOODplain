"""Export mean terrain for display only, from the actual frozen case storage tables."""
import sys,json,gzip,hashlib
from pathlib import Path
import numpy as np
import xarray as xr
from pyproj import Transformer
root=Path(sys.argv[1]); out=Path('public/simulation/data')
manifest=json.loads((out/'current-sfincs-manifest.json').read_text())
run=json.loads(gzip.decompress(Path('public/simulation',manifest['artifact']['path']).read_bytes()))
with xr.open_dataset(root/'sfincs_map.nc') as ds,xr.open_dataset(root/'sfincs_subgrid.nc') as sub:
    mask=ds.msk.values>0
    cols,rows=np.where(mask.T)
    # At the highest terrain elevation, volume = area * (zmax - mean bed).
    means=sub.z_zmax.values-sub.z_volmax.values/10000
    xy=Transformer.from_crs(4326,32612,always_xy=True)
    lookup={(int(r),int(c)):float(z) for r,c,z in zip(rows,cols,means)}
    vertices=[]
    for cell in run['cells']:
        x,y=xy.transform(cell['lon'],cell['lat'])
        row=int((y-3572300)//100);col=int((x-467700)//100)
        z=lookup[(row,col)]
        assert np.isfinite(z)
        vertices.append([round(x-467700,2),round(y-3572300,2),round(z,3),row,col])
    result={'runId':manifest['runId'],'sourceSha256':manifest['artifact']['sha256'],'terrainSourceSha256':hashlib.sha256((root/'sfincs_subgrid.nc').read_bytes()).hexdigest(),'cellSizeM':100,'quantity':'Mean terrain elevation derived from z_zmax - z_volmax / cell area; NAVD88 metres. Colors show subgrid mean water depth, not a water-surface mesh.','vertices':vertices}
    (out/'frozen-terrain-display.json.gz').write_bytes(gzip.compress(json.dumps(result,separators=(',',':')).encode(),mtime=0))
    print(len(vertices), 'vertices; elevation range',min(v[2] for v in vertices),max(v[2] for v in vertices))
