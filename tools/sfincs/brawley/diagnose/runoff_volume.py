"""Runoff-volume diagnosis for brawley-avra-west v2r (run 42555458619) at ALERT 6443 (Mile Wide). Read-only.

What it does (no model input is changed, nothing is tuned):
  1. Delineates the contributing area inside the model from the NHDPlus V2 network and catchments of domain v2,
     for both readings of the gauge: Black Wash 15876815 (the reach 4.8 m from the sensor) and Brawley 15877627
     (the county name "Brawley Wash at Milewide Road"; local part only, the area above inlet reach 15876941 enters
     as the observed USGS 09487000 inflow), and their union.
  2. Rebuilds the per-face rain the solver used from precip_2d.nc. The solver's spatial rule was found empirically:
     bilinear interpolation with the grid coordinates read as the lower-left corner of each 1.04 km cell (i.e. a
     +0.5 cell shift in x and y). Check: against the map's precipitation_rate frames and the solver's cumprcp.
  3. Applies the SFINCS 'cna' rule (Deltares SFINCS source, compute_infiltration_cna): cumulative rain since tstart,
     Ia = sfacinf*S (default 0.2), Q = (P-Ia)^2/(P-Ia+S), infiltration = P - Q, S = scs[in] * 0.0254 m.
     Check: against the solver's cuminf at the end of the run.
  4. Sums rain, infiltration and runoff by area and window, and compares with the ALERT 6443 volume and with
     the model's section volume (hourly restart flux from the committed v2r validation file).

  python -I tools/sfincs/brawley/diagnose/runoff_volume.py --wt E:/FloodPLAIN/wt-model --output <out.json>
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
res = {'label': 'DIAGNOSIS of SENSITIVITY run v2r 42555458619; read-only; nothing tuned', 'run': str(RUN.relative_to(WT)).replace('\\', '/')}

# ---------------- geometry ----------------
q = xr.open_dataset(RUN / 'sfincs.nc'); DX = float(q.attrs['dx']); level = q['level'].values.astype(int); q.close()
size = DX / 2.0 ** (level - 1); area = size ** 2
m = xr.open_dataset(RUN / 'sfincs_map.nc')
fx, fy = m.mesh2d_face_x.values, m.mesh2d_face_y.values
S_m = m.qinf.values.astype(np.float64)                # SFINCS writes S [m] here (scs inches * 0.0254)
cumprcp = m.cumprcp.values[-1].astype(np.float64); cuminf = m.cuminf.values[-1].astype(np.float64)
mtimes = pd.to_datetime(m.time.values)
scs_in = xr.open_dataset(RUN / 'infiltration.nc').scs.values.astype(np.float64)
res['units'] = {'scsFileAttrs': 'units=inches (infiltration.nc)', 'mapQinfOverScs': [float(np.nanmin(S_m[scs_in > 0] / scs_in[scs_in > 0])), float(np.nanmax(S_m[scs_in > 0] / scs_in[scs_in > 0]))],
                'meaning': 'the solver multiplied the file value by 0.0254 (inches -> m), as its source says'}

# ---------------- areas ----------------
net = gpd.read_file(COMP / 'brawley-avra-west-network.geojson'); cat = gpd.read_file(COMP / 'brawley-avra-west-catchments.geojson').to_crs(32612)
up = {}
by_to = {}
for r in net.itertuples(): by_to.setdefault(int(r.tonode), []).append(int(r.comid))
fromnode = {int(r.comid): int(r.fromnode) for r in net.itertuples()}


def upstream(c, stop=()):
    out, todo = set(), [c]
    while todo:
        k = todo.pop()
        if k in out or k in stop: continue
        out.add(k); todo += by_to.get(fromnode[k], [])
    return out


bw = upstream(15876815)
br = upstream(15877627, stop={15876941})
areas = {'Black Wash 15876815 (gauge reach)': bw, 'Brawley 15877627 local (inlet 15876941 excluded)': br, 'Union (both, = combined flow at Mile Wide)': bw | br}
polys, face_sel = {}, {}
for k, s in areas.items():
    g = cat[cat.featureid.isin(list(s))]; poly = unary_union(g.geometry.values); polys[k] = poly
    sel = contains_xy(poly, fx, fy); face_sel[k] = sel
    res.setdefault('areas', {})[k] = {'reaches': len(s), 'catchmentsFound': int(len(g)), 'catchmentAreaKm2': round(poly.area / 1e6, 2),
                                      'modelFaces': int(sel.sum()), 'modelFaceAreaKm2': round(float(area[sel].sum()) / 1e6, 2),
                                      'faceAreaByLevelKm2': {f'L{L} {DX / 2 ** (L - 1):g} m': round(float(area[sel & (level == L)].sum()) / 1e6, 2) for L in range(1, 6)}}

# ---------------- rain per face ----------------
pr = xr.open_dataset(RUN / 'precip_2d.nc'); PR = pr.Precipitation.values.astype(np.float64); px, py = pr.x.values, pr.y.values
ptimes = pd.to_datetime(pr.time.values); NT = len(ptimes)
xs = px + 0.5 * (px[1] - px[0]); ys = py + 0.5 * (py[1] - py[0])
pts = np.c_[fy, fx]
rate = np.empty((NT, fx.size))
for k in range(NT):
    rate[k] = RegularGridInterpolator((ys[::-1], xs), PR[k][::-1], bounds_error=False, fill_value=np.nan)(pts)
chk = []
for fr in range(0, len(mtimes), 4):
    k = int(np.where(ptimes == mtimes[fr])[0][0]) if (ptimes == mtimes[fr]).any() else None
    if k is not None: chk.append(float(np.nanmax(np.abs(rate[k] - m.precipitation_rate.isel(time=fr).values))))
P_end = np.nansum(rate, 0) / 1000.0  # m, block hourly, 74 h = whole run
res['rainReconstruction'] = {'rule': 'bilinear, grid coordinates shifted +0.5 cell (x and y); hourly block', 'maxAbsDiffVsMapRateMmH': round(max(chk), 4),
                             'framesChecked': len(chk), 'cumprcpEndDiffMm_p0_p50_p100': [round(float(v) * 1000, 4) for v in np.nanpercentile(P_end - cumprcp, [0, 50, 100])]}

# ---------------- SCS cna ----------------
SF = 0.2
Pc = np.vstack([np.zeros(fx.size), np.nancumsum(rate, 0) / 1000.0])     # cumulative P at hour boundaries (NT+1)
tb = list(ptimes) + [ptimes[-1] + pd.Timedelta(hours=1)]


def scsQ(P):
    Ia = SF * S_m
    return np.where(P > Ia, (P - Ia) ** 2 / np.maximum(P - Ia + S_m, 1e-12), 0.0)


Qc = np.vstack([scsQ(Pc[i]) for i in range(NT + 1)])
F_end = Pc[-1] - Qc[-1]
res['scsCheck'] = {'formula': 'Q=(P-0.2S)^2/(P+0.8S) on cumulative rain since tstart 2026-10-30T16Z', 'cuminfDiffMm_p0_p50_p100': [round(float(v) * 1000, 5) for v in np.nanpercentile(F_end - cuminf, [0, 50, 100])]}


def idx(t): return tb.index(pd.Timestamp(t))


WIN = {'antecedent 2026-10-30T16Z..11-01T14Z': ('2026-10-30T16:00', '2026-11-01T14:00'), 'burst 11-01T14Z..18Z': ('2026-11-01T14:00', '2026-11-01T18:00'),
       '11-01T18Z..11-02T07Z': ('2026-11-01T18:00', '2026-11-02T07:00'), '11-02T07Z..18Z': ('2026-11-02T07:00', '2026-11-02T18:00'),
       'event 11-01T14Z..11-02T18Z': ('2026-11-01T14:00', '2026-11-02T18:00'), 'whole run': ('2026-10-30T16:00', '2026-11-02T18:00')}
for k, sel in face_sel.items():
    A = area[sel]; Atot = A.sum(); out = {}
    for wn, (t0, t1) in WIN.items():
        i0, i1 = idx(t0), idx(t1)
        dP = Pc[i1, sel] - Pc[i0, sel]; dQ = Qc[i1, sel] - Qc[i0, sel]
        out[wn] = {'rainMm': round(float((dP * A).sum() / Atot * 1000), 2), 'rainVolMm3': round(float((dP * A).sum()) / 1e6, 3),
                   'runoffMm': round(float((dQ * A).sum() / Atot * 1000), 2), 'runoffVolMm3': round(float((dQ * A).sum()) / 1e6, 3),
                   'infiltrationMm': round(float(((dP - dQ) * A).sum() / Atot * 1000), 2),
                   'runoffCoefficient': round(float((dQ * A).sum() / max((dP * A).sum(), 1e-9)), 3)}
    i14 = idx('2026-11-01T14:00')
    Ia = SF * S_m[sel]
    out['retention'] = {'scsInchesAreaMean': round(float((scs_in[sel] * A).sum() / Atot), 3), 'S_mmAreaMean': round(float((S_m[sel] * A).sum() / Atot * 1000), 1),
                        'IaMmAreaMean': round(float((Ia * A).sum() / Atot * 1000), 1),
                        'fractionOfAreaAlreadyPastIaAt14Z': round(float(A[Pc[i14, sel] > Ia].sum() / Atot), 3),
                        'cnEquivalentAreaMean': round(float((1000 / (10 + scs_in[sel]) * A).sum() / Atot), 1)}
    # hourly runoff generation over the area (m3 per hour), event only
    hr = {}
    for i in range(idx('2026-11-01T12:00'), idx('2026-11-02T18:00')):
        hr[str(tb[i])[:13] + 'Z'] = {'rainMm': round(float(((Pc[i + 1, sel] - Pc[i, sel]) * A).sum() / Atot * 1000), 2),
                                     'runoffMm3': round(float(((Qc[i + 1, sel] - Qc[i, sel]) * A).sum()) / 1e6, 4)}
    out['hourly'] = hr
    res.setdefault('budget', {})[k] = out

# ---------------- observed and model volumes ----------------
g = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json').read_text())
s = [x for x in g['sensors'] if x['id'] == 'ALERT 6443'][0]['series']
ot = pd.to_datetime([r['timeUtc'] for r in s]).tz_localize(None); oq = np.array([r['flowM3s'] for r in s], float)


def obs_vol(t0, t1):
    tt = pd.date_range(t0, t1, freq='1min'); v = np.interp(tt.values.astype('int64'), ot.values.astype('int64'), oq)
    return float(np.trapz(v, dx=60.0))


obs = {'reportsInSeries': len(s), 'rule': 'linear between reports (reports are event-driven + hourly; the value between reports is not measured)',
       '11-01T16:20Z..11-02T18Z (whole observed event)': obs_vol('2026-11-01T16:20', '2026-11-02T18:00'),
       '11-01T18Z..11-02T18Z (as in section 13)': obs_vol('2026-11-01T18:00', '2026-11-02T18:00'),
       '11-01T16:20Z..11-02T08:45Z (suspect plateau excluded)': obs_vol('2026-11-01T16:20', '2026-11-02T08:45'),
       'plateau 08:45Z..16:20Z alone': obs_vol('2026-11-02T08:45', '2026-11-02T16:20')}
res['observedVolumeM3'] = {k: (round(v) if isinstance(v, float) else v) for k, v in obs.items()}
vf = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/rain-sensitivity/result-42555458619/validation-full.json').read_text())
sh = vf['sectionsHourlyM3s']; mod = {}
for k in ['Mile Wide Black Wash 15876815 band (ALERT 6443)', 'Mile Wide Brawley 15877627 band', 'Mile Wide both bands', 'Donaldson Ranch (15877627)']:
    vals = np.array(list(sh[k].values()), float); mod[k] = {'18Zto18ZM3': round(float(np.trapz(vals, dx=3600.0))), 'stillFlowingAt18ZM3s': round(float(vals[-1]), 2)}
res['modelSectionVolume18Zto18Z'] = mod
# inflow
dis = np.loadtxt(RUN / 'sfincs.dis'); t0 = pd.Timestamp('2026-10-30T16:00')
dt = t0 + pd.to_timedelta(dis[:, 0], unit='s')
tt = pd.date_range('2026-11-01T14:00', '2026-11-02T18:00', freq='1min')
res['inletInflowM3_11-01T14Z..11-02T18Z'] = round(float(np.trapz(np.interp(tt.values.astype('int64'), dt.values.astype('int64'), dis[:, 1]), dx=60.0)))
res['inletPeak'] = {'m3s': float(dis[:, 1].max()), 'time': str(dt[int(np.argmax(dis[:, 1]))])}

# implied coefficients
imp = {}
for k in face_sel:
    ev = res['budget'][k]['event 11-01T14Z..11-02T18Z']
    imp[k] = {'eventRainVolMm3': ev['rainVolMm3'], 'modelRunoffVolMm3': ev['runoffVolMm3'], 'modelC': ev['runoffCoefficient'],
              'observedC_wholeEvent': round(obs['11-01T16:20Z..11-02T18Z (whole observed event)'] / (ev['rainVolMm3'] * 1e6), 4),
              'observedC_plateauExcluded': round(obs['11-01T16:20Z..11-02T08:45Z (suspect plateau excluded)'] / (ev['rainVolMm3'] * 1e6), 4)}
res['impliedRunoffCoefficients'] = imp

# transmission-loss exposure: channel-mask cells
cm = gpd.read_file(WT / '.sfincs-runs/brawley-avra-west-parameters-v2n/channel-mask.geojson').to_crs(32612)
cpoly = unary_union(cm.geometry.values); inch = contains_xy(cpoly, fx, fy)
res['channelMask'] = {'source': '.sfincs-runs/brawley-avra-west-parameters-v2n/channel-mask.geojson (lidar-centred, order>=3)', 'maskAreaKm2': round(cpoly.area / 1e6, 3),
                      'facesWithCentreInMask': int(inch.sum())}
for k, sel in face_sel.items():
    c = sel & inch; A = area[c]
    i0, i1 = idx('2026-11-01T14:00'), idx('2026-11-02T18:00')
    res['channelMask'][k] = {'faces': int(c.sum()), 'faceAreaKm2': round(float(A.sum()) / 1e6, 3),
                             'eventInfiltrationOnChannelFacesM3': round(float((((Pc[i1, c] - Pc[i0, c]) - (Qc[i1, c] - Qc[i0, c])) * A).sum())),
                             'scsInchesMean': round(float(scs_in[c].mean()), 3) if c.any() else None}
m.close()
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n')
print('ok', a.output)
