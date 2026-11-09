import json, numpy as np, xarray as xr, geopandas as gpd
from pathlib import Path
from shapely import contains_xy
from shapely.ops import unary_union
B = Path('.sfincs-runs/brawley-avra-west-result-v3l-obsrain-42583445548-cnbagent/artifact/runs/current')
R = Path('.sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact/runs/current')
def read_rst(path):
    b = path.read_bytes(); recs, i = [], 0
    while i < len(b):
        n = int(np.frombuffer(b[i:i + 4], '<i4')[0]); recs.append(b[i + 4:i + 4 + n]); i += 8 + n
    return np.frombuffer(recs[1], '<f4'), np.frombuffer(recs[2], '<f4')
m = xr.open_dataset(R / 'sfincs_map.nc'); fx, fy = m.mesh2d_face_x.values, m.mesh2d_face_y.values; m.close()
COMP = Path('tools/sfincs/data/brawley-avra-west-v2/components')
net = gpd.read_file(COMP / 'brawley-avra-west-network.geojson'); cat = gpd.read_file(COMP / 'brawley-avra-west-catchments.geojson').to_crs(32612)
by_to = {}
for r in net.itertuples(): by_to.setdefault(int(r.tonode), []).append(int(r.comid))
fromnode = {int(r.comid): int(r.fromnode) for r in net.itertuples()}
def up(c, stop=()):
    out, todo = set(), [c]
    while todo:
        k = todo.pop()
        if k in out or k in stop: continue
        out.add(k); todo += by_to.get(fromnode[k], [])
    return out
s = up(15876815) | up(15877627, stop={15876941})
sel = contains_xy(unary_union(cat[cat.featureid.isin(list(s))].geometry.values), fx, fy)
out = {}
for p in sorted(B.glob('sfincs.*.rst')):
    zb, qb = read_rst(p); zr, qr = read_rst(R / p.name)
    d = np.abs(zb.astype(float) - zr.astype(float))[sel]; d = d[np.isfinite(d)]
    out[p.name] = {'maxAbsZsDiffM_MileWideUnionArea': round(float(d.max()), 4), 'p99': round(float(np.percentile(d, 99)), 5)}
print(json.dumps(out, indent=0))
