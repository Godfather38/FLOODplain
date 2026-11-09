"""Hourly discharge on transects along the lower Black Wash (NHD level path 720016019) above ALERT 6443, dense near the
gauge, for any run folder (default cnb 42584493432). Same transect rule, restart reader and u/v-point order as
tools/sfincs/brawley/diagnose/flux_transects.py (copied, with --run, and every hour kept). Read-only.

  python -I tools/sfincs/brawley/timing/lower_reach_flux.py --wt E:/FloodPLAIN/wt-model [--run <run folder>] --output <out.json>
"""
import argparse, json, math
from pathlib import Path

import geopandas as gpd
import numpy as np
import pyproj
import xarray as xr
from shapely.geometry import LineString, Point
from shapely.ops import linemerge

p = argparse.ArgumentParser(); p.add_argument('--wt', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
p.add_argument('--half', type=float, default=600.0)
p.add_argument('--run', default='.sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-42584493432/artifact/runs/current')
a = p.parse_args(); WT = a.wt; RUN = WT / a.run
TO_UTM = pyproj.Transformer.from_crs(4326, 32612, always_xy=True)
q = xr.open_dataset(RUN / 'sfincs.nc')
X0, Y0, DX = float(q.attrs['x0']), float(q.attrs['y0']), float(q.attrs['dx'])
level = q['level'].values.astype(int); nidx = q['n'].values.astype(int); midx = q['m'].values.astype(int)
nb = {k: q[k].values.astype(np.int64) for k in ['mu', 'mu1', 'mu2', 'nu', 'nu1', 'nu2']}; q.close()
NF = level.size; size = DX / 2.0 ** (level - 1); xc = X0 + (midx - 0.5) * size; yc = Y0 + (nidx - 0.5) * size
# u/v points in solver order: per face, mu1 (then mu2 if mu>=1), then nu1 (then nu2 if nu>=1) - vectorised version of
# the loop in flux_transects.py (same order)
cols_nm, cols_nmu = [], []
for fl, a1, a2 in [('mu', 'mu1', 'mu2'), ('nu', 'nu1', 'nu2')]:
    k1 = nb[a1] > 0; k2 = (nb[fl] >= 1) & (nb[a2] > 0)
    cols_nm += [np.where(k1, np.arange(NF), -1), np.where(k2, np.arange(NF), -1)]
    cols_nmu += [np.where(k1, nb[a1] - 1, -1), np.where(k2, nb[a2] - 1, -1)]
NM = np.stack(cols_nm, 1).ravel(); NMU = np.stack(cols_nmu, 1).ravel(); ok = NM >= 0
uv_nm = NM[ok]; uv_nmu = NMU[ok]; NPUV = uv_nm.size; uv_w = np.minimum(size[uv_nm], size[uv_nmu])
mx = 0.5 * (xc[uv_nm] + xc[uv_nmu]); my = 0.5 * (yc[uv_nm] + yc[uv_nmu])


def read_rst(path):
    b = path.read_bytes(); recs, i = [], 0
    while i < len(b):
        n = int(np.frombuffer(b[i:i + 4], '<i4')[0]); recs.append(b[i + 4:i + 4 + n]); i += 8 + n
    return np.frombuffer(recs[1], '<f4'), np.frombuffer(recs[2], '<f4')


net = gpd.read_file(WT / 'tools/sfincs/data/brawley-avra-west-v2/components/brawley-avra-west-network.geojson').to_crs(32612)
cx, cy = TO_UTM.transform(-111.2439, 32.2501)  # confluence 15876811 start
gx, gy = TO_UTM.transform(-111.244446, 32.248611)  # ALERT 6443


def transect(line, d):
    pt = line.interpolate(d); p2 = line.interpolate(min(d + 100.0, line.length)); p1 = line.interpolate(max(d - 100.0, 0.0))
    tx, ty = p2.x - p1.x, p2.y - p1.y; L = math.hypot(tx, ty); tx, ty = tx / L, ty / L
    H = 300.0 if math.hypot(pt.x - cx, pt.y - cy) < 1500.0 else a.half
    s_c = (xc - pt.x) * tx + (yc - pt.y) * ty
    along = np.abs(-(mx - pt.x) * ty + (my - pt.y) * tx)
    up, dn = s_c[uv_nm] < 0, s_c[uv_nmu] < 0
    sel = (up != dn) & (along <= H)
    sign = np.where(up[sel] & ~dn[sel], 1.0, -1.0)
    return np.where(sel)[0], sign, {'x': round(pt.x, 1), 'y': round(pt.y, 1), 'halfLengthM': H}


rst = sorted(RUN.glob('sfincs.*.rst')); hours = [r.name.split('.')[1][4:8] + 'T' + r.name.split('.')[2][:2] + 'Z' for r in rst]
QQ = [read_rst(r)[1] for r in rst]
for qq in QQ: assert qq.size >= NPUV

s = net[net.levelpathi == 720016019].sort_values('hydroseq', ascending=False)
g = linemerge(list(s.geometry)); line = g if g.geom_type == 'LineString' else LineString([c for gg in g.geoms for c in gg.coords])
if Point(line.coords[0]).distance(Point(gx, gy)) < Point(line.coords[-1]).distance(Point(gx, gy)): line = LineString(line.coords[::-1])
G = line.project(Point(gx, gy))
out = []
for km in (20, 15, 12, 10, 8, 6, 5, 4, 3, 2, 1, 0.05):
    ln, sg, meta = transect(line, G - km * 1000.0)
    Q = np.array([float((qq[ln] * uv_w[ln] * sg).sum()) for qq in QQ]); ip = int(np.argmax(Q))
    first = {}
    for thr in (5.0, 23.1, 50.0):
        k = np.where(Q >= thr)[0]
        first[str(thr)] = None if not k.size else (hours[k[0]] if k[0] == 0 else f'{hours[k[0] - 1]}..{hours[k[0]]} ({Q[k[0] - 1]:.1f}->{Q[k[0]]:.1f})')
    out.append({'kmAboveGauge': km, **meta, 'links': int(ln.size), 'peakM3s': round(float(Q[ip]), 2), 'peakHour': hours[ip],
                'firstAtOrAbove': first, 'q': {h: round(float(v), 2) for h, v in zip(hours, Q)}})
res = {'label': 'DIAGNOSIS (read-only) of a SENSITIVITY run; not for live registration', 'run': a.run, 'restarts': [hours[0], hours[-1], len(hours)],
       'note': 'hourly restart flux; restarts exist only from 18Z Nov 1 (first restart = map start t0out 17Z + dtrstout 1 h)', 'blackWashAboveGauge': out}
a.output.parent.mkdir(parents=True, exist_ok=True)
with open(a.output, 'w', encoding='utf-8', newline='\n') as f: json.dump(res, f, indent=1)
print('ok', a.output)
