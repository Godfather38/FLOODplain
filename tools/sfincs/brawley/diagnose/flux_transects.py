"""Hourly discharge hydrographs on transects along Black Wash (NHD level path 720016019) and the Brawley mainstem
(level path 720005313, inlet reach 15876923 -> Tucker 15876711) from the v2r hourly restarts (run 42555458619).
Read-only.

Each transect is perpendicular to the NHD line at a point (distance downstream along the path), with a half-length
H (default 600 m, 300 m within 1.5 km of the Black Wash / Brawley confluence so that the two washes are not mixed).
Discharge = sum over u/v links whose two cells lie on opposite sides of the transect line (stair-step, as in
tools/sfincs/brawley/extend/validate_extended.py) and whose midpoint lies within H of the point along the transect,
of q * link width, signed positive downstream. The restart reader and u/v-point order are the same as there.

Per transect: peak and time, time of the hydrograph centroid, volume 18Z..18Z, and flow at 18Z/22Z/03Z/07Z.

  python -I tools/sfincs/brawley/diagnose/flux_transects.py --wt E:/FloodPLAIN/wt-model --output <out.json>
"""
import argparse, json, math
from pathlib import Path

import geopandas as gpd
import numpy as np
import pyproj
import xarray as xr
from shapely.geometry import LineString
from shapely.ops import linemerge

p = argparse.ArgumentParser(); p.add_argument('--wt', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
p.add_argument('--half', type=float, default=600.0); a = p.parse_args(); WT = a.wt
RUN = WT / '.sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact/runs/current'
TO_UTM = pyproj.Transformer.from_crs(4326, 32612, always_xy=True)
q = xr.open_dataset(RUN / 'sfincs.nc')
X0, Y0, DX = float(q.attrs['x0']), float(q.attrs['y0']), float(q.attrs['dx'])
level = q['level'].values.astype(int); nidx = q['n'].values.astype(int); midx = q['m'].values.astype(int)
nb = {k: q[k].values.astype(np.int64) for k in ['mu', 'mu1', 'mu2', 'nu', 'nu1', 'nu2']}; q.close()
NF = level.size; size = DX / 2.0 ** (level - 1); xc = X0 + (midx - 0.5) * size; yc = Y0 + (nidx - 0.5) * size
uv_nm, uv_nmu = [], []
for c in range(NF):
    for fl, a1, a2 in [('mu', 'mu1', 'mu2'), ('nu', 'nu1', 'nu2')]:
        if nb[a1][c] > 0: uv_nm.append(c); uv_nmu.append(nb[a1][c] - 1)
        if nb[fl][c] >= 1 and nb[a2][c] > 0: uv_nm.append(c); uv_nmu.append(nb[a2][c] - 1)
uv_nm = np.array(uv_nm); uv_nmu = np.array(uv_nmu); NPUV = uv_nm.size; uv_w = np.minimum(size[uv_nm], size[uv_nmu])
mx = 0.5 * (xc[uv_nm] + xc[uv_nmu]); my = 0.5 * (yc[uv_nm] + yc[uv_nmu])


def read_rst(path):
    b = path.read_bytes(); recs, i = [], 0
    while i < len(b):
        n = int(np.frombuffer(b[i:i + 4], '<i4')[0]); recs.append(b[i + 4:i + 4 + n]); i += 8 + n
    return np.frombuffer(recs[1], '<f4'), np.frombuffer(recs[2], '<f4')


net = gpd.read_file(WT / 'tools/sfincs/data/brawley-avra-west-v2/components/brawley-avra-west-network.geojson').to_crs(32612)
cx, cy = TO_UTM.transform(-111.2439, 32.2501)  # confluence 15876811 start


def path_line(lp, first=None, last=None):
    s = net[net.levelpathi == lp].sort_values('hydroseq', ascending=False)
    if first is not None:
        c = list(s.comid); s = s.iloc[c.index(first):c.index(last) + 1]
    g = linemerge(list(s.geometry))
    return g if g.geom_type == 'LineString' else LineString([c for gg in g.geoms for c in gg.coords])


def transect(line, d):
    pt = line.interpolate(d); p2 = line.interpolate(min(d + 100.0, line.length)); p1 = line.interpolate(max(d - 100.0, 0.0))
    tx, ty = p2.x - p1.x, p2.y - p1.y; L = math.hypot(tx, ty); tx, ty = tx / L, ty / L
    H = 300.0 if math.hypot(pt.x - cx, pt.y - cy) < 1500.0 else a.half
    s_c = (xc - pt.x) * tx + (yc - pt.y) * ty
    along = np.abs(-(mx - pt.x) * ty + (my - pt.y) * tx)
    up, dn = s_c[uv_nm] < 0, s_c[uv_nmu] < 0
    sel = (up != dn) & (along <= H)
    sign = np.where(up[sel] & ~dn[sel], 1.0, -1.0)  # nm upstream, nmu downstream -> +q
    return np.where(sel)[0], sign, {'x': round(pt.x, 1), 'y': round(pt.y, 1), 'halfLengthM': H}


rst = sorted(RUN.glob('sfincs.*.rst')); hours = [r.name.split('.')[1][4:8] + 'T' + r.name.split('.')[2][:2] + 'Z' for r in rst]
QQ = [read_rst(r)[1] for r in rst]
for qq in QQ: assert qq.size >= NPUV
hh = np.arange(len(hours), dtype=float)  # hours since 11-01T18Z


def run(name, line, step):
    out = []
    for d in np.arange(step, line.length, step).tolist() + [line.length - 20.0]:
        ln, sg, meta = transect(line, d)
        Q = np.array([float((qq[ln] * uv_w[ln] * sg).sum()) for qq in QQ])
        ip = int(np.argmax(Q)); pos = np.clip(Q, 0, None)
        cen = float((pos * hh).sum() / pos.sum()) if pos.sum() > 0 else None
        out.append({'distKm': round(d / 1000, 2), **meta, 'links': int(ln.size), 'peakM3s': round(float(Q[ip]), 2), 'peakHour': hours[ip],
                    'centroidHoursAfter18Z': None if cen is None else round(cen, 2), 'vol18to18M3': round(float(np.trapz(Q, dx=3600.0))),
                    'q': {h: round(float(v), 2) for h, v in zip(hours, Q) if h in ('1101T18Z', '1101T20Z', '1101T22Z', '1102T00Z', '1102T03Z', '1102T07Z', '1102T12Z', '1102T18Z')}})
    return out


res = {'label': 'DIAGNOSIS of SENSITIVITY run v2r 42555458619; read-only', 'restarts': [hours[0], hours[-1], len(hours)],
       'blackWash': run('Black Wash', path_line(720016019), 2000.0),
       'brawley': run('Brawley', path_line(720005313, 15876923, 15876711), 2000.0)}
a.output.write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n')
print('ok', a.output)
