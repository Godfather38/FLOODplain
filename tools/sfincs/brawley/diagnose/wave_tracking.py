"""Wave tracking along Black Wash (NHD level path 720016019, 15904845 -> 15876815) and the Brawley mainstem
(level path 720005313, inlet reach 15876923 -> Tucker 15876711) in the v2r map (run 42555458619). Read-only.

For points every 1 km along each NHD path (distance measured downstream), the channel face is the face with the
lowest zb within R m of the point (the NHD line is often off the lidar channel: median 36 m, p90 173 m, see
tools/sfincs/brawley/sensitivity/README.md). Per face: zs series (15 min frames 2026-11-01T17Z..11-02T18Z),
peak time of zs, time zs first reaches half of its rise above the 17Z value, max depth zs-zb, cell size, and
cell mean depth vol/area at the peak. Celerity of the peak and of the half-rise is the downstream distance
over the time difference per 5 km reach. Slope is a least-squares fit of zb (channel face minimum) against
distance per reach. Kinematic expectation: c = 5/3 * h^(2/3) * S^(1/2) / n for a wide channel, with h taken
both as the channel max depth (upper bound) and the cell mean depth (lower bound), for n = 0.030 (Chow 1959 sand-bed
normal value, as v2n), 0.043 (mean WorldCover n on the order-5 mainstem) and 0.050 (WorldCover shrubland).

  python -I tools/sfincs/brawley/diagnose/wave_tracking.py --wt E:/FloodPLAIN/wt-model --output <out.json>
"""
import argparse, json, math
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyproj
import xarray as xr
from shapely.geometry import LineString
from shapely.ops import linemerge

p = argparse.ArgumentParser(); p.add_argument('--wt', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
p.add_argument('--radius', type=float, default=75.0); a = p.parse_args(); WT = a.wt
RUN = WT / '.sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact/runs/current'
COMP = WT / 'tools/sfincs/data/brawley-avra-west-v2/components'
TO_LL = pyproj.Transformer.from_crs(32612, 4326, always_xy=True)

q = xr.open_dataset(RUN / 'sfincs.nc'); DX = float(q.attrs['dx']); level = q['level'].values.astype(int); q.close()
size = DX / 2.0 ** (level - 1); area = size ** 2
m = xr.open_dataset(RUN / 'sfincs_map.nc')
fx, fy = m.mesh2d_face_x.values, m.mesh2d_face_y.values; zb = m.zb.values.astype(np.float64)
times = pd.to_datetime(m.time.values); hrs = np.array([(t - pd.Timestamp('2026-11-01T00:00')).total_seconds() / 3600 for t in times])
net = gpd.read_file(COMP / 'brawley-avra-west-network.geojson').to_crs(32612)


def path_line(lp, first=None, last=None):
    s = net[net.levelpathi == lp].sort_values('hydroseq', ascending=False)
    if first is not None:
        c = list(s.comid); s = s.iloc[c.index(first):c.index(last) + 1]
    return linemerge([g for g in s.geometry]), list(s.comid), s


def h2t(h): return (pd.Timestamp('2026-11-01T00:00') + pd.Timedelta(hours=float(h))).strftime('%m-%dT%H:%MZ')


def track(name, lp, first=None, last=None):
    line, comids, s = path_line(lp, first, last)
    if line.geom_type != 'LineString':
        line = LineString([c for g in line.geoms for c in g.coords])
    L = line.length; dists = np.arange(0, L, 1000.0)
    faces = []
    for d in dists:
        pt = line.interpolate(d); r = np.hypot(fx - pt.x, fy - pt.y); c = np.where(r <= a.radius)[0]
        faces.append(int(c[np.argmin(zb[c])]) if c.size else -1)
    faces = np.array(faces); ok = faces >= 0
    zs = m.zs.isel(nmesh2d_face=faces[ok]).values.astype(np.float64)        # (time, k)
    vol = m.subgrid_volume.isel(nmesh2d_face=faces[ok]).values.astype(np.float64)
    zsmax = m.zsmax.isel(nmesh2d_face=faces[ok]).values.max(0).astype(np.float64)
    pts = []
    for j, f in enumerate(faces[ok]):
        z = zs[:, j]; z0 = z[0]; ip = int(np.nanargmax(z)); rise = z[ip] - z0
        ih = int(np.argmax(z >= z0 + 0.5 * rise)) if rise > 0.05 else None
        d = float(dists[ok][j]); lo, la = TO_LL.transform(fx[f], fy[f])
        pts.append({'distKm': round(d / 1000, 1), 'face': int(f), 'cellM': float(size[f]), 'lonlat': [round(lo, 5), round(la, 5)], 'zb': round(float(zb[f]), 2),
                    'depth17Z': round(float(z0 - zb[f]), 3), 'peakDepth': round(float(z[ip] - zb[f]), 3), 'zsmaxWindowDepth': round(float(zsmax[j] - zb[f]), 3),
                    'riseM': round(float(rise), 3), 'peakTime': h2t(hrs[ip]), 'peakH': float(hrs[ip]), 'peakAtWindowEnd': bool(ip == len(hrs) - 1),
                    'halfRiseTime': h2t(hrs[ih]) if ih is not None else None, 'halfRiseH': float(hrs[ih]) if ih is not None else None,
                    'cellMeanDepthAtPeak': round(float(vol[ip, j] / area[f]), 3)})
    # reaches of 5 km
    reaches = []
    for k0 in range(0, len(pts) - 1, 5):
        seg = pts[k0:k0 + 6]
        if len(seg) < 3: continue
        x = np.array([p_['distKm'] for p_ in seg]); z = np.array([p_['zb'] for p_ in seg])
        S = -np.polyfit(x * 1000, z, 1)[0]
        dk = seg[-1]['distKm'] - seg[0]['distKm']
        dtp = seg[-1]['peakH'] - seg[0]['peakH']
        dth = (seg[-1]['halfRiseH'] - seg[0]['halfRiseH']) if (seg[-1]['halfRiseH'] is not None and seg[0]['halfRiseH'] is not None) else None
        hmax = float(np.median([p_['peakDepth'] for p_ in seg])); hmean = float(np.median([p_['cellMeanDepthAtPeak'] for p_ in seg]))
        cell = float(np.median([p_['cellM'] for p_ in seg]))
        kin = {}
        for n in (0.030, 0.043, 0.050):
            kin[f'n{n:.3f}'] = {'hChannelMax': round(5 / 3 * max(hmax, 0) ** (2 / 3) * math.sqrt(max(S, 0)) / n * 3.6, 2),
                                'hCellMean': round(5 / 3 * max(hmean, 0) ** (2 / 3) * math.sqrt(max(S, 0)) / n * 3.6, 2)}
        reaches.append({'fromKm': seg[0]['distKm'], 'toKm': seg[-1]['distKm'], 'slope': round(float(S), 5), 'medianCellM': cell,
                        'medianPeakDepth': round(hmax, 2), 'medianCellMeanDepthAtPeak': round(hmean, 3),
                        'peakFrom': seg[0]['peakTime'], 'peakTo': seg[-1]['peakTime'],
                        'peakCelerityKmH': (round(dk / dtp, 2) if dtp > 0 else ('peak earlier downstream' if dtp < 0 else 'same frame')),
                        'halfRiseCelerityKmH': (round(dk / dth, 2) if (dth is not None and dth > 0) else (None if dth is None else 'earlier/same downstream')),
                        'kinematicCelerityKmH': kin})
    return {'levelPath': lp, 'reaches(NHD comids, upstream first)': comids, 'lengthKm': round(L / 1000, 2), 'radiusM': a.radius, 'points': pts, 'reaches5km': reaches}


def reach_peaks(target):
    # every reach upstream of target: its downstream end, lowest face within R, zs peak time and depth; flow distance to the target's end
    by_to = {}
    for r in net.itertuples(): by_to.setdefault(int(r.tonode), []).append(int(r.comid))
    info = {int(r.comid): r for r in net.itertuples()}
    dist = {target: 0.0}; todo = [target]
    while todo:
        c = todo.pop()
        for u in by_to.get(int(info[c].fromnode), []):
            if u not in dist: dist[u] = dist[c] + float(info[c].lengthkm); todo.append(u)
    out = []
    for c, dk in dist.items():
        g = info[c].geometry; x, y = g.coords[-1][:2]
        cand = np.where(np.hypot(fx - x, fy - y) <= a.radius)[0]
        if not cand.size: continue
        f = int(cand[np.argmin(zb[cand])]); z = m.zs.isel(nmesh2d_face=f).values.astype(np.float64); ip = int(np.nanargmax(z))
        out.append({'comid': c, 'totDaKm2': round(float(info[c].totdasqkm), 1), 'order': int(info[c].streamorde), 'flowKmToTargetEnd': round(dk, 2),
                    'cellM': float(size[f]), 'peakTime': h2t(hrs[ip]), 'peakH': float(hrs[ip]), 'peakDepth': round(float(z[ip] - zb[f]), 3), 'depth17Z': round(float(z[0] - zb[f]), 3)})
    return sorted(out, key=lambda r: -r['flowKmToTargetEnd'])


res = {'label': 'DIAGNOSIS of SENSITIVITY run v2r 42555458619; read-only', 'frames': [str(times[0]), str(times[-1]), len(times)],
       'note': 'map frames start 2026-11-01T17Z; any peak before 17Z is not visible and shows as a 17Z start or a falling series',
       'blackWash': track('Black Wash', 720016019),
       'brawley': track('Brawley', 720005313, 15876923, 15876711),
       'blackWashReachEndPeaks': reach_peaks(15876815)}
m.close()
a.output.write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n')
print('ok', a.output)
