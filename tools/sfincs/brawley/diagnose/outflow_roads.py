"""Road stations and boundary-flux behaviour at every outflow (msk 3) cluster of a Brawley SFINCS result (read-only).

Clusters: each msk 3 cell is assigned to the nearest of the distinct HydroMT outflow points the v2 boundary build
placed (.sfincs-runs/brawley-avra-west-boundaries-v2/outlets.geojson, points closer than 5 m merged); for the v2
boundaries that gives 6 clusters for the 47 cells.

Per cluster:
  - road stations (v2 local station file) by distance from the nearest cluster cell centre: counts within
    250/500/800/1000/2000 m, how many are ever wet (vol/area >= 0.0091 m in a 15-min map frame) and how many go
    over the road (cell zs > roadZ in a wet frame; validate_extended.py rule), the nearest station and the nearest
    station that goes over. Frames that are not wet are never counted as dry evidence.
  - boundary flux at each hourly restart over the msk 1 - msk 3 links of the cluster: the stored flux and the
    head-driven part sqrt(g * huv) * (zs_inside - z_zmin of the outflow cell) * width (the SFINCS bndtype 1 formula
    without the uvmean memory term; huv is the subgrid flux depth, stability_common.Geometry.huv); and the
    drain-and-clamp count: links with zero stored flux while the head-driven part is positive.
Hourly restarts are instantaneous snapshots; they cannot show what the flux does between them.

  python -I tools/sfincs/brawley/diagnose/outflow_roads.py --run <result dir> --output <json> [--stations <gz>] [--outlets <geojson>]
"""
import argparse
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parent))  # stability_common, also under python -I
from stability_common import Geometry, TO_LL, TO_UTM, read_rst, rst_time, run_dir

ROOT = Path(__file__).resolve().parents[4]
p = argparse.ArgumentParser(); p.add_argument('--run', required=True); p.add_argument('--output', required=True)
p.add_argument('--stations', default=str(ROOT / 'tools/live/road-stations/brawley-avra-west-local-v2.json.gz'))
p.add_argument('--outlets', default=str(ROOT / '.sfincs-runs/brawley-avra-west-boundaries-v2/outlets.geojson'))
a = p.parse_args(); D = run_dir(a.run); G = Geometry(D)
DRY = 0.0091

# ---- station -> face (same lookup as validate_extended.py)
q = xr.open_dataset(D / 'sfincs.nc'); level = q['level'].values.astype(int); nn = q['n'].values.astype(int); mm = q['m'].values.astype(int); q.close()
lookup = {(level[i], nn[i], mm[i]): i for i in range(G.NF)}; LV = sorted(set(level.tolist()))


def face_at(x, y):
    for L in LV:
        s = G.DX / 2.0 ** (L - 1); f = lookup.get((L, int(math.floor((y - G.Y0) / s)) + 1, int(math.floor((x - G.X0) / s)) + 1))
        if f is not None: return f
    return -1


mp = xr.open_dataset(D / 'sfincs_map.nc'); zs = mp['zs'].values.astype(np.float64); vol = mp['subgrid_volume'].values.astype(np.float64); mp.close()
wet = (vol / G.area[None, :]) >= DRY
st = json.load(gzip.open(a.stations))['columns']
sx, sy = TO_UTM.transform(np.array(st['lon']), np.array(st['lat'])); sz = np.array([np.nan if v is None else v for v in st['roadZ']], float); road = np.array(st['road'])
sf = np.array([face_at(x, y) for x, y in zip(sx, sy)]); valid = (sf >= 0) & ~np.isnan(sz); ff = np.where(valid, sf, 0)
everwet = valid & wet[:, ff].any(axis=0)
zst = np.where(wet[:, ff], zs[:, ff], -np.inf)
mo = np.where(everwet, zst.max(axis=0) - sz, np.nan)   # max over road in wet frames; NaN = never wet (not dry evidence)
over = everwet & (mo > 0)

# ---- clusters by nearest outflow point
P = []
for f in json.load(open(a.outlets))['features']:
    c = f['geometry']['coordinates']
    if not any(math.hypot(c[0] - u[0], c[1] - u[1]) < 5 for u in P): P.append(c)
P = np.array(P); o3 = np.where(G.msk == 3)[0]
lab = np.argmin(np.hypot(G.xc[o3][:, None] - P[None, :, 0], G.yc[o3][:, None] - P[None, :, 1]), axis=1)
is3 = G.msk == 3; L13 = np.where(is3[G.nm] ^ is3[G.nmu])[0]
lo3 = np.where(is3[G.nm[L13]], G.nm[L13], G.nmu[L13]); li = np.where(is3[G.nm[L13]], G.nmu[L13], G.nm[L13]); sg = np.where(is3[G.nmu[L13]], 1.0, -1.0)
cl_of_cell = np.full(G.NF, -1); cl_of_cell[o3] = lab; lcl = cl_of_cell[lo3]

res = {'run': str(a.run), 'rules': {'wet': f'vol/area >= {DRY} m', 'over': 'cell zs > roadZ in a wet frame', 'never wet': 'not counted as dry evidence',
                                    'distance': 'station to the nearest outflow-cell centre of the cluster',
                                    'headDriven': 'sqrt(g*huv)*(zs_inside - z_zmin(outflow cell))*width over msk1-msk3 links (SFINCS bndtype 1 without uvmean)'},
       'msk3Cells': int(o3.size), 'linksMsk1Msk3': int(L13.size), 'linksBetweenTwoMsk3': int((is3[G.nm] & is3[G.nmu]).sum()), 'clusters': []}
hours = []; stored = {k: [] for k in range(len(P))}; head = {k: [] for k in range(len(P))}; clamp = {k: [] for k in range(len(P))}
for pth in sorted(D.glob('sfincs.*.rst')):
    z, qq, _ = read_rst(pth); qq = qq[:G.NPUV]; hours.append(rst_time(pth))
    hu, _ = G.huv(z, L13)
    s_ = qq[L13] * G.w[L13] * sg; h_ = np.sqrt(9.81 * np.maximum(hu, 0)) * np.maximum(z[li] - G.z_zmin[lo3], 0) * G.w[L13]
    for k in range(len(P)):
        m_ = lcl == k
        stored[k].append(float(s_[m_].sum())); head[k].append(float(h_[m_].sum())); clamp[k].append(int((m_ & (np.abs(s_) <= 1e-9) & (h_ > 1e-6)).sum()))
for k in range(len(P)):
    cells = o3[lab == k]
    if not cells.size: continue
    d = np.min(np.hypot(sx[:, None] - G.xc[cells][None, :], sy[:, None] - G.yc[cells][None, :]), axis=1)
    lo, la = TO_LL.transform(float(G.xc[cells].mean()), float(G.yc[cells].mean()))
    j = int(np.argmin(d)); io = np.where(over)[0]; jo = int(io[np.argmin(d[io])]) if io.size else None
    stn = lambda s: {'m': round(float(d[s]), 1), 'road': str(road[s]), 'roadZ': None if np.isnan(sz[s]) else float(sz[s]), 'everWet': bool(everwet[s]),
                     'over': bool(over[s]), 'maxOverM': None if np.isnan(mo[s]) else round(float(mo[s]), 3)}
    rat = [s / h for s, h in zip(stored[k], head[k]) if h > 0.5]
    res['clusters'].append({
        'outflowPoint': [round(float(P[k, 0]), 1), round(float(P[k, 1]), 1)], 'centreLonLat': [round(lo, 4), round(la, 4)], 'cells': int(cells.size),
        'cellSizesM': sorted(set(G.size[cells].tolist())), 'bedZminM': [round(float(G.z_zmin[cells].min()), 2), round(float(G.z_zmin[cells].max()), 2)],
        'links': int((lcl == k).sum()),
        'nearestStation': stn(j), 'nearestOverStation': None if jo is None else stn(jo),
        'stationsWithin': {str(R): {'stations': int((d <= R).sum()), 'everWet': int((everwet & (d <= R)).sum()), 'over': int((over & (d <= R)).sum())} for R in (250, 500, 800, 1000, 2000)},
        'stationsWithin500m': [stn(s) for s in np.where(d <= 500)[0][np.argsort(d[d <= 500])][:10]],
        'flux': {'storedMaxM3s': round(max(stored[k]), 2), 'headDrivenMaxM3s': round(max(head[k]), 2),
                 'storedOverHeadRange_headGt0p5': [round(min(rat), 2), round(max(rat), 2)] if rat else None,
                 'hoursHeadGt0p5': len(rat), 'hoursStoredZeroWhileHeadGt0p5': sum(1 for s, h in zip(stored[k], head[k]) if h > 0.5 and abs(s) <= 1e-9),
                 'linkHoursClamped': int(sum(clamp[k])), 'linkHours': int((lcl == k).sum()) * len(hours),
                 'hourly': {t[5:16]: [round(s, 2), round(h, 2), c] for t, s, h, c in zip(hours, stored[k], head[k], clamp[k])},
                 'hourlyColumns': ['stored m3/s', 'head-driven m3/s', 'links with zero stored flux while the head-driven part is positive']}})
tot_s = [sum(stored[k][i] for k in stored) for i in range(len(hours))]; tot_h = [sum(head[k][i] for k in head) for i in range(len(hours))]
res['allClusters'] = {'hourly': {t[5:16]: [round(s, 2), round(h, 2), round(s / h, 2) if h > 0 else None] for t, s, h in zip(hours, tot_s, tot_h)},
                      'hourlyColumns': ['stored m3/s', 'head-driven m3/s', 'ratio']}
Path(a.output).write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n'); print('ok', a.output)
for c in res['clusters']:
    print(c['centreLonLat'], c['cells'], c['links'], c['nearestStation'], c['nearestOverStation'], c['stationsWithin']['500'], c['flux']['storedOverHeadRange_headGt0p5'],
          c['flux']['hoursStoredZeroWhileHeadGt0p5'], c['flux']['linkHoursClamped'], c['flux']['linkHours'])
