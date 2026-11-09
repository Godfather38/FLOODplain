"""Negative subgrid volumes in a Brawley SFINCS result, against the live verifier rule (read-only).

The live rule (tools/live/verify_all_route_package.py, NEGATIVE_RESIDUAL_DEPTH_M = 0.001) fails a frame when any cell has
subgrid_volume / cell area < -0.001 m. This script reports every cell that goes below -1 mm (face, size, frames, volume,
neighbours, nearest outflow cell and road station) and counts how many frames would fail under that rule and under
candidate alternatives, on all 15-min map frames and on the :00/:30 frames only. It never changes any array.
Usage: negative_depth.py --run <result dir> --output <json> [--stations <gz>]
"""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np
import xarray as xr

from stability_common import Geometry, TO_UTM, run_dir

p = argparse.ArgumentParser(); p.add_argument('--run', required=True); p.add_argument('--output', required=True)
p.add_argument('--stations', default='tools/live/road-stations/brawley-avra-west-local-v2.json.gz')
a = p.parse_args(); D = run_dir(a.run); G = Geometry(D)
m = xr.open_dataset(D / 'sfincs_map.nc'); vol = m['subgrid_volume'].values.astype(np.float64); m.close()
area = G.area; h = vol / area[None, :]; T = G.T; half = np.array([t[14:16] in ('00', '30') for t in T])
is3 = np.where(G.msk == 3)[0]
st = json.load(gzip.open(a.stations))['columns']; sx, sy = TO_UTM.transform(np.array(st['lon']), np.array(st['lat']))
adj = {}
for i, (c1, c2) in enumerate(zip(G.nm, G.nmu)): adj.setdefault(int(c1), []).append(int(c2)); adj.setdefault(int(c2), []).append(int(c1))
fin = np.isfinite(vol)
res = {'run': str(a.run), 'frames': len(T), 'halfHourFrames': int(half.sum()), 'faces': int(G.NF),
       'samplesNegative': int((fin & (vol < 0)).sum()), 'cellsEverNegative': int((fin & (vol < 0)).any(axis=0).sum()),
       'minDepthM': float(np.nanmin(h)), 'minVolumeM3': float(np.nanmin(vol)),
       'negativeCellsBySizeM': {str(s): int(((fin & (vol < 0)).any(axis=0) & (G.size == s)).sum()) for s in sorted(set(G.size.tolist()))},
       'cellsBySizeM': {str(s): int((G.size == s).sum()) for s in sorted(set(G.size.tolist()))}}
# distribution of the most negative depth per cell (cells that ever go negative)
mn = np.nanmin(np.where(fin, h, np.inf), axis=0); neg = mn < 0
res['minDepthPercentilesMmNegativeCells'] = {q: round(float(np.percentile(mn[neg] * 1000, q)), 4) for q in (0, 1, 5, 50)} if neg.any() else None
bad = np.where(mn < -0.001)[0]; cells = []
for f in bad:
    fr = np.where(h[:, f] < -0.001)[0]; k = int(np.nanargmin(h[:, f]))
    d3 = float(np.min(np.hypot(G.xc[is3] - G.xc[f], G.yc[is3] - G.yc[f]))); ds = np.hypot(sx - G.xc[f], sy - G.yc[f])
    nbr = sorted(set(adj.get(int(f), [])))
    cells.append({'face': int(f), 'cellM': float(G.size[f]), 'areaM2': float(area[f]), 'msk': int(G.msk[f]), 'lonlat': G.lonlat(f),
                  'zb': round(float(G.zb[f]), 3), 'zSubgridMin': round(float(G.z_zmin[f]), 3), 'zSubgridMax': round(float(G.z_zmax[f]), 3), 'zVolmaxM3': round(float(G.z_volmax[f]), 3),
                  'minDepthMm': round(float(h[k, f]) * 1000, 4), 'minVolumeM3': round(float(vol[k, f]), 5), 'minTime': T[k], 'framesBelow1mm': [T[i] for i in fr],
                  'depthMmAround': {T[i]: round(float(h[i, f]) * 1000, 3) for i in range(max(0, k - 3), min(len(T), k + 4))},
                  'neighbours': [{'face': n, 'cellM': float(G.size[n]), 'msk': int(G.msk[n]), 'zSubgridMin': round(float(G.z_zmin[n]), 3),
                                  'depthMmAtMin': round(float(h[k, n]) * 1000, 3)} for n in nbr],
                  'nearestOutflowCellM': round(d3, 1), 'nearestRoadStationM': round(float(ds.min()), 1), 'nearestRoad': str(st['road'][int(np.argmin(ds))])})
res['cellsBelowMinus1mm'] = cells


def fails(mask_bad, sel):
    return int(mask_bad[sel].any(axis=1).sum())


rules = {'strict depth < -1 mm (current)': h < -0.001 * (1 + np.finfo(np.float32).eps),
         'depth < -2 mm': h < -0.002, 'depth < -5 mm': h < -0.005,
         'volume < -0.01 m3': vol < -0.01, 'volume < -0.05 m3': vol < -0.05, 'volume < -0.1 m3': vol < -0.1,
         'depth < -1 mm on cells >= 156 m2 (12.5 m and up) only': (h < -0.001) & (area[None, :] >= 156.0),
         'domain negative total < -1 m3': None}
out = {}
for k, b in rules.items():
    if b is None:
        tot = np.nansum(np.where(vol < 0, vol, 0), axis=1); bb = tot < -1.0
        out[k] = {'framesFail15min': int(bb.sum()), 'framesFailHalfHour': int(bb[half].sum()), 'minNegativeTotalM3': round(float(tot.min()), 4)}
    else:
        b = b & fin; out[k] = {'framesFail15min': fails(b, slice(None)), 'framesFailHalfHour': fails(b, half), 'cells': int(b.any(axis=0).sum())}
res['rules'] = out
res['perFrameMinDepthMm'] = {T[i]: round(float(np.nanmin(h[i])) * 1000, 4) for i in range(len(T))}
Path(a.output).write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n'); print('ok', a.output)
