"""Two read-only brackets for the v2r runoff volume at ALERT 6443 (run 42555458619). Nothing here is a model input.

A. Curve-number brackets (offline SCS on the solver's own per-face rain, same reconstruction as runoff_volume.py):
   event runoff over the Black Wash 15876815 area, 2026-11-01T14Z..11-02T18Z, for
   - as run: cna, cumulative since tstart 10-30T16Z, Ia = 0.2 S, S from GCN10 fair ARC II undrained;
   - event-only accumulation from 11-01T14Z: the same cna rule with the rain counted only from 14Z, i.e. as if
     the storage were empty again at 14Z. This is a cna bracket. It is not a cnb result and not a bound on cnb:
     cnb (SFINCS CN with recovery) uses its own smax/seff/ks fields and recovery rate, so its runoff can be above
     or below this number;
   - ARC I conversion CN_I = 4.2 CN_II / (10 - 0.058 CN_II) (NEH-4 1972 Table 10.1 formula, Chow et al. 1988 eq. 5.5.4);
   - Ia = 0.05 S with S0.05 = 1.33 S0.2^1.15 (inches) (Hawkins et al. 2002 / Woodward et al. 2003).
B. Transmission-loss exposure: wetted area x time in the Black Wash area from the 15-min map frames (cell mean
   depth vol/area >= threshold), all faces and channel-mask faces only (v2n lidar-centred mask), and the loss a bed
   with effective hydraulic conductivity K would take over that wetted area-time (NEH 630 ch. 19, Lane 1983 bed
   groups: 6-25, 25-76, 51-127 mm/h). This is an upper-bound style exposure, not a loss model: it ignores
   that losses fall as the bed saturates and that a 100 m cell's wet fraction is not the channel bed.

  python -I tools/sfincs/brawley/diagnose/loss_brackets.py --wt E:/FloodPLAIN/wt-model --output <out.json>
"""
import argparse, json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import xarray as xr
from scipy.interpolate import RegularGridInterpolator
from shapely import contains_xy
from shapely.ops import unary_union

p = argparse.ArgumentParser(); p.add_argument('--wt', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
a = p.parse_args(); WT = a.wt
RUN = WT / '.sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact/runs/current'
COMP = WT / 'tools/sfincs/data/brawley-avra-west-v2/components'
q = xr.open_dataset(RUN / 'sfincs.nc'); DX = float(q.attrs['dx']); level = q['level'].values.astype(int); q.close()
area = (DX / 2.0 ** (level - 1)) ** 2
m = xr.open_dataset(RUN / 'sfincs_map.nc'); fx, fy = m.mesh2d_face_x.values, m.mesh2d_face_y.values
scs_in = xr.open_dataset(RUN / 'infiltration.nc').scs.values.astype(np.float64)
net = gpd.read_file(COMP / 'brawley-avra-west-network.geojson'); cat = gpd.read_file(COMP / 'brawley-avra-west-catchments.geojson').to_crs(32612)
by_to = {}
for r in net.itertuples(): by_to.setdefault(int(r.tonode), []).append(int(r.comid))
fromnode = {int(r.comid): int(r.fromnode) for r in net.itertuples()}
up, todo = set(), [15876815]
while todo:
    k = todo.pop()
    if k in up: continue
    up.add(k); todo += by_to.get(fromnode[k], [])
sel = contains_xy(unary_union(cat[cat.featureid.isin(list(up))].geometry.values), fx, fy); A = area[sel]
pr = xr.open_dataset(RUN / 'precip_2d.nc'); PR = pr.Precipitation.values.astype(np.float64); px, py = pr.x.values, pr.y.values
pt = pd.to_datetime(pr.time.values); xs = px + 0.5 * (px[1] - px[0]); ys = py + 0.5 * (py[1] - py[0]); pts = np.c_[fy[sel], fx[sel]]
rate = np.vstack([RegularGridInterpolator((ys[::-1], xs), PR[k][::-1], bounds_error=False, fill_value=np.nan)(pts) for k in range(len(pt))])
# No zero-fill: a NaN would mean a face outside the rain grid; refuse rather than count it as no rain.
assert not np.isnan(rate).any(), f'rain reconstruction has {int(np.isnan(rate).sum())} NaN face-frames; refusing to treat them as dry'
Pc = np.vstack([np.zeros(pts.shape[0]), np.cumsum(rate, 0)]) / 1000.0  # m
tb = list(pt) + [pt[-1] + pd.Timedelta(hours=1)]
i14, iend = tb.index(pd.Timestamp('2026-11-01T14:00')), tb.index(pd.Timestamp('2026-11-02T18:00'))
cn2 = 1000.0 / (10.0 + scs_in[sel])


def Q(P, S, lam):
    Ia = lam * S
    return np.where(P > Ia, (P - Ia) ** 2 / np.maximum(P - Ia + S, 1e-12), 0.0)


S02 = scs_in[sel] * 0.0254
cn1 = 4.2 * cn2 / (10.0 - 0.058 * cn2); S1 = (1000.0 / cn1 - 10.0) * 0.0254
S005 = 1.33 * np.maximum(scs_in[sel], 0) ** 1.15 * 0.0254
Pev = Pc[iend] - Pc[i14]
sc = {'as run (cna, cumulative since 10-30T16Z, Ia 0.2S, ARC II)': (Q(Pc[iend], S02, 0.2) - Q(Pc[i14], S02, 0.2)),
      'cna bracket: event-only accumulation from 11-01T14Z (storage empty at 14Z; not a cnb result or bound), Ia 0.2S, ARC II': Q(Pev, S02, 0.2),
      'ARC I, cumulative since 10-30T16Z, Ia 0.2S': (Q(Pc[iend], S1, 0.2) - Q(Pc[i14], S1, 0.2)),
      'ARC I, event-only from 11-01T14Z': Q(Pev, S1, 0.2),
      'Ia 0.05S with S0.05=1.33 S0.2^1.15, cumulative since 10-30T16Z': (Q(Pc[iend], S005, 0.05) - Q(Pc[i14], S005, 0.05))}
res = {'label': 'DIAGNOSTIC BRACKETS, not model inputs, not tuned', 'area': 'Black Wash 15876815 upstream (603.3 km2)', 'eventRainMm': round(float((Pev * A).sum() / A.sum() * 1000), 2),
       'cnAreaMean': {'ARC II (as run)': round(float((cn2 * A).sum() / A.sum()), 1), 'ARC I': round(float((cn1 * A).sum() / A.sum()), 1)}, 'scsBrackets': {}}
for k, v in sc.items():
    res['scsBrackets'][k] = {'runoffMm': round(float((v * A).sum() / A.sum() * 1000), 2), 'runoffVolMm3': round(float((v * A).sum()) / 1e6, 3),
                             'C': round(float((v * A).sum() / (Pev * A).sum()), 3)}
# B. wetted exposure
cm = gpd.read_file(WT / '.sfincs-runs/brawley-avra-west-parameters-v2n/channel-mask.geojson').to_crs(32612)
inch = contains_xy(unary_union(cm.geometry.values), fx[sel], fy[sel])
faces = np.where(sel)[0]
dt_h = 0.25
wet = {}
for thr in (0.05, 0.10, 0.30):
    tot = 0.0; totc = 0.0
    for i0 in range(0, m.sizes['time'], 10):
        v = m.subgrid_volume.isel(time=slice(i0, i0 + 10)).values[:, faces].astype(np.float64) / A[None, :]
        w = v >= thr; tot += float((w * A[None, :]).sum()) * dt_h; totc += float((w[:, inch] * A[None, inch]).sum()) * dt_h
    wet[f'cellMeanDepth>={thr:.2f}m'] = {'wetAreaHoursKm2h': round(tot / 1e6, 2), 'channelMaskWetAreaHoursKm2h': round(totc / 1e6, 3),
                                          'lossM3_at_K_mmh': {str(K): {'allWetCells': round(tot * K / 1000.0), 'channelMaskOnly': round(totc * K / 1000.0)} for K in (6, 25, 51, 76, 127)}}
res['wettedExposure17Zto18Z'] = {'window': 'map frames 2026-11-01T17:00Z to 2026-11-02T18:00Z (25 h, 15-min frames)', 'frames': int(m.sizes['time']), 'frameHours': dt_h, 'channelMaskFacesInArea': int(inch.sum()),
                                 'channelMaskFaceAreaKm2': round(float(A[inch].sum()) / 1e6, 3), 'byThreshold': wet,
                                 'note': 'frames start 11-01T17Z, so 14-17Z wetting is not counted; model infiltration on these cells is only the rain that falls on them (SFINCS cna does not infiltrate ponded or routed water)'}
m.close()
a.output.write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n')
print('ok', a.output)
