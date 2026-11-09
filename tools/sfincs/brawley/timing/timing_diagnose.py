"""Timing diagnosis for ALERT 6443 (Mile Wide): why every model run peaks 12-14 h after the observed 18:20Z Nov 1 peak.
Read-only. Nothing is changed, nothing is tuned. SENSITIVITY diagnosis only.

(a) Rain time axis: the precip_2d.nc frames of base case B (interval STARTS, hourly block in the solver) sampled at
    13 Pima County ALERT rain gauges (tip increments binned by the UTC hour that contains the report; page times are
    MST = UTC-7) and over the 603 km2 Black Wash area above the gauge. Best lag by correlation and by burst centroid.
(b) Where the 18:20Z peak can come from: the Black Wash area split by NHD flow distance to the gauge (rings) and
    by the tributaries that join near the gauge; rain 14-18Z per ring; observed volume of the first pulse.
(c) Model routing (cnb run 42584493432 and base B 42599666617 maps, 15 min frames from 17Z Nov 1): water stored on
    the land per ring (subgrid_volume), and the time the channel water level first rises / peaks along the Black
    Wash path and the near-gauge tributaries. Spin-up: tstart, t0out, restart times and cumulative rain at 17Z.

  python -I tools/sfincs/brawley/timing/timing_diagnose.py --wt E:/FloodPLAIN/wt-model --output <out.json>
"""
import argparse, json, sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyproj
import xarray as xr
from scipy.interpolate import RegularGridInterpolator
from shapely import contains_xy
from shapely.ops import unary_union, linemerge
from shapely.geometry import LineString, Point

p = argparse.ArgumentParser(); p.add_argument('--wt', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
a = p.parse_args(); WT = a.wt
sys.path.insert(0, str(Path(__file__).resolve().parent))
from alert_rain import parse, tips  # noqa: E402

COMP = WT / 'tools/sfincs/data/brawley-avra-west-v2/components'
GDIR = WT / 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101'
TDIR = WT / 'tools/sfincs/data/brawley-avra-west-v2/timing-20261109'
CASE_B = WT / '.sfincs-runs/brawley-avra-west-case-v3l-obsrain'
RUNS = {'cnb 42584493432': WT / '.sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-42584493432/artifact/runs/current',
        'B 42599666617': WT / '.sfincs-runs/brawley-avra-west-result-v3l-obsrain-42599666617/artifact/runs/current'}
T = pyproj.Transformer.from_crs(4326, 32612, always_xy=True)
res = {'label': 'TIMING DIAGNOSIS (read-only) of SENSITIVITY runs; nothing tuned; not for live registration'}


def iso(t): return pd.Timestamp(t).strftime('%Y-%m-%dT%H:%MZ')


# ---------------- network, basin, flow distance to the gauge ----------------
net = gpd.read_file(COMP / 'brawley-avra-west-network.geojson').to_crs(32612)
cat = gpd.read_file(COMP / 'brawley-avra-west-catchments.geojson').to_crs(32612)
by_to, fromnode, tonode, L = {}, {}, {}, {}
for r in net.itertuples():
    by_to.setdefault(int(r.tonode), []).append(int(r.comid)); fromnode[int(r.comid)] = int(r.fromnode); tonode[int(r.comid)] = int(r.tonode); L[int(r.comid)] = float(r.lengthkm)
by_from = {}
for c, f in fromnode.items(): by_from.setdefault(f, []).append(c)
GAUGE = 15876815


def upstream(c):
    out, todo = set(), [c]
    while todo:
        k = todo.pop()
        if k in out: continue
        out.add(k); todo += by_to.get(fromnode[k], [])
    return out


bw = upstream(GAUGE)
# flow distance from the bottom of each reach to the gauge (sum of lengths of the reaches strictly downstream, gauge reach excluded)
dist = {GAUGE: 0.0}
todo = [GAUGE]
while todo:
    c = todo.pop()
    for u in by_to.get(fromnode[c], []):
        if u in bw and u not in dist:
            dist[u] = dist[c] + (L[c] if c != GAUGE else 0.0); todo.append(u)
# catchment centre distance = bottom distance + half own length
cbw = cat[cat.featureid.isin(list(bw))].copy()
cbw['dKm'] = [dist[int(f)] + 0.5 * L[int(f)] for f in cbw.featureid]
cbw['areaKm2'] = cbw.area / 1e6
gx, gy = T.transform(-111.244446, 32.248611)
basin = unary_union(cbw.geometry.values)
res['basin'] = {'reaches': len(bw), 'areaKm2': round(basin.area / 1e6, 2), 'maxFlowDistanceKm': round(max(dist[c] + L[c] for c in bw), 1),
                'note': 'NHDPlus V2 catchments of domain v2 upstream of 15876815 (tonode->fromnode trace); flow distance = NHD length to the gauge reach'}
RINGS = [(0, 5), (5, 10), (10, 15), (15, 20), (20, 30), (30, 40), (40, 60)]

# tributaries that join the Black Wash level path near the gauge: for each reach on the level path, the side inflows
lp = int(net.loc[net.comid == GAUGE, 'levelpathi'].iloc[0])
main = set(net.loc[net.levelpathi == lp, 'comid'].astype(int))
tribs = []
for c in main & bw:
    for u in by_to.get(fromnode[c], []):
        if u not in main and u in bw:
            s = upstream(u); A = float(cbw[cbw.featureid.isin(list(s))].areaKm2.sum())
            tribs.append({'comid': u, 'joinsAtKm': round(dist[c] + L[c], 2) if c != GAUGE else 0.0, 'areaKm2': round(A, 1),
                          'gnis': net.loc[net.comid == u, 'gnis_name'].iloc[0], 'set': s})
tribs.sort(key=lambda t: t['joinsAtKm'])

# ---------------- (a) rain time axis ----------------
pr = xr.open_dataset(CASE_B / 'precip_2d.nc'); PR = pr.Precipitation.values.astype(np.float64); px, py = pr.x.values, pr.y.values
ptimes = pd.to_datetime(pr.time.values)
inp = dict(l.split('=', 1) for l in (CASE_B / 'sfincs.inp').read_text().splitlines() if '=' in l)
inp = {k.strip(): v.strip() for k, v in inp.items()}
res['caseTimeAxis'] = {'precipAttrs': {k: str(v) for k, v in pr.Precipitation.attrs.items()} | {k: str(v) for k, v in pr.attrs.items()},
                       'firstFrame': iso(ptimes[0]), 'lastFrame': iso(ptimes[-1]), 'frames': len(ptimes),
                       'tref': inp['tref'], 'tstart': inp['tstart'], 'tstop': inp['tstop'], 't0out_s': inp['t0out'],
                       'mapStartUtc': iso(pd.Timestamp('2026-10-30T16:00') + pd.Timedelta(seconds=float(inp['t0out']))),
                       'dtwnd_s': inp.get('dtwnd'), 'amprblock': inp.get('amprblock', 'not set (solver default .true. = block)')}
xs = px + 0.5 * (px[1] - px[0]); ys = py + 0.5 * (py[1] - py[0])   # solver rule found in diagnose/runoff_volume.py


def sample(xy):
    xy = np.atleast_2d(xy); pts = np.c_[xy[:, 1], xy[:, 0]]
    return np.stack([RegularGridInterpolator((ys[::-1], xs), PR[k][::-1], bounds_error=False, fill_value=np.nan)(pts) for k in range(len(ptimes))])


cur = json.load(__import__('gzip').open(GDIR / 'raw/alert_currain_20261109.json.gz'))['data']
meta = {r['site']: r for r in cur}
SITES = ['5040', '6430', '6470', '6490', '6500', '6440', '6450', '6410', '6420', '6460', '6480', '6140', '6520']
H0, H1 = pd.Timestamp('2026-10-31T00:00'), pd.Timestamp('2026-11-02T18:00')
hours = pd.date_range(H0, H1 - pd.Timedelta(hours=1), freq='h')
gauges = []
gaugeHourly = {}   # site -> hourly gauge mm over `hours`; NaN = unknown (no report), never zero
for s in SITES:
    f = GDIR / f'raw/alert_showdata_{s}.html.gz'
    if not f.exists(): f = TDIR / f'raw/alert_showdata_{s}.html'
    rows = parse(f); tp = tips(rows)
    rep = [t for t, _ in rows]
    first, last = pd.Timestamp(rep[0]).tz_localize(None), pd.Timestamp(rep[-1]).tz_localize(None)
    # hourly reports: an hour with no report at all is unknown, not zero
    hasrep = {pd.Timestamp(t).tz_localize(None).floor('h') for t in rep}
    g = np.full(len(hours), np.nan)
    for i, h in enumerate(hours):
        if first <= h and h + pd.Timedelta(hours=1) <= last + pd.Timedelta(hours=1) and (h in hasrep or (h + pd.Timedelta(hours=1)) in hasrep):
            g[i] = 0.0
    for t, d in tp:
        h = pd.Timestamp(t).tz_localize(None).floor('h')
        if H0 <= h < H1: g[hours.get_loc(h)] = (0.0 if np.isnan(g[hours.get_loc(h)]) else g[hours.get_loc(h)]) + d * 25.4
    lon, lat = float(meta[s]['longitude']), float(meta[s]['latitude']); x, y = T.transform(lon, lat)
    st = sample([x, y])[:, 0]
    sv = np.array([st[ptimes.get_loc(h)] if h in ptimes else np.nan for h in hours])
    inb = bool(basin.contains(Point(x, y)))
    w = (hours >= pd.Timestamp('2026-11-01T12:00')) & (hours < pd.Timestamp('2026-11-02T00:00'))
    ok = w & ~np.isnan(g)
    lags = {}
    for lag in range(-6, 7):   # model frame shifted by +lag hours vs gauge
        sh = np.array([st[ptimes.get_loc(h - pd.Timedelta(hours=lag))] if (h - pd.Timedelta(hours=lag)) in ptimes else np.nan for h in hours])
        m2 = ok & ~np.isnan(sh)
        lags[lag] = float(np.corrcoef(g[m2], sh[m2])[0, 1]) if m2.sum() > 3 and g[m2].std() > 0 and sh[m2].std() > 0 else None
    best = max((k for k in lags if lags[k] is not None), key=lambda k: lags[k])

    def centroid(v, msk):
        tt = np.arange(len(hours))[msk] + 0.5; vv = v[msk]
        return float((tt * vv).sum() / vv.sum()) if vv.sum() > 0 else None
    cg, cs = centroid(np.nan_to_num(g), ok), centroid(sv, ok)   # ok excludes unknown gauge hours, so nan_to_num fills nothing used
    gaugeHourly[s] = g
    w2 = (hours >= pd.Timestamp('2026-11-01T00:00')) & (hours < pd.Timestamp('2026-11-01T12:00'))
    ok2 = w2 & ~np.isnan(g)
    gauges.append({'site': s, 'name': meta[s]['name'], 'lat': lat, 'lon': lon, 'inBlackWashBasin': inb,
                   'distanceToBasinM': 0 if inb else round(basin.distance(Point(x, y))),
                   'reportsSpanUtc': [iso(first), iso(last)],
                   # gauge and Stage IV are summed over the SAME known gauge hours (ok); unknown gauge hours are left out of both.
                   # With any unknown hour the gauge total is a lower bound on the gauge's full-window rain.
                   'gaugeMm_11-01T12Z_to_02T00Z': round(float(g[ok].sum()), 1), 'stageIVcellMm_same': round(float(sv[ok].sum()), 1),
                   'stageIVcellMm_12Zto00Z_allHours': round(float(sv[w].sum()), 1),
                   'unknownHours12Zto00Z': int((w & np.isnan(g)).sum()),
                   'gaugeTotal12Zto00ZIsLowerBound': bool((w & np.isnan(g)).any()),
                   'gaugeMm_11-01T00Z_to_12Z': round(float(g[ok2].sum()), 1),
                   'stageIVcellMm_11-01T00Z_to_12Z': round(float(sv[ok2].sum()), 1),
                   'unknownHours00Zto12Z': int((w2 & np.isnan(g)).sum()),
                   'gaugeTotal00Zto12ZIsLowerBound': bool((w2 & np.isnan(g)).any()),
                   'bestLagH': best, 'corrByLag': {str(k): (round(v, 3) if v is not None else None) for k, v in lags.items()},
                   'centroidHoursModelMinusGauge_12Zto00Z': round(cs - cg, 2) if cg and cs else None,
                   'hourlyMm': {iso(h)[5:13]: [None if np.isnan(g[i]) else round(g[i], 1), round(sv[i], 1)] for i, h in enumerate(hours)
                                if pd.Timestamp('2026-11-01T00:00') <= h < pd.Timestamp('2026-11-02T12:00') and ((not np.isnan(g[i]) and g[i] > 0) or sv[i] > 0.5)}})
res['rainGauges'] = {'method': 'gauge: accumulator increments binned by the UTC hour containing the report (MST+7); an hour with no report on either side is unknown (null), never zero. '
                               'Window totals: gauge and Stage IV cell summed over the same known gauge hours; gaugeTotal*IsLowerBound marks a gauge with unknown hours in the window. '
                               'model: B precip_2d.nc frame whose interval START is that hour, sampled bilinearly with the solver grid rule; corrByLag k = correlation of gauge hour h with model frame h-k (k>0: model rain would need to be LATER to match)',
                     'hourlyMmFormat': '[gauge, StageIV-frame]', 'gauges': gauges}

# basin-mean hourly rain from the forcing (face-free: sample on a 250 m lattice inside the basin)
bx0, by0, bx1, by1 = basin.bounds
gxx, gyy = np.meshgrid(np.arange(bx0, bx1, 250.0), np.arange(by0, by1, 250.0)); gxx, gyy = gxx.ravel(), gyy.ravel()
inside = contains_xy(basin, gxx, gyy); lx, ly = gxx[inside], gyy[inside]
lat_rate = sample(np.c_[lx, ly])
# ring membership of lattice points
cid = np.full(lx.size, -1, int); cd = np.full(lx.size, np.nan)
for r in cbw.itertuples():
    sel = contains_xy(r.geometry, lx, ly); cid[sel] = int(r.featureid); cd[sel] = r.dKm
res['basinRainHourlyMm'] = {iso(t)[5:13]: round(float(np.nanmean(lat_rate[k])), 2) for k, t in enumerate(ptimes)
                            if pd.Timestamp('2026-11-01T00:00') <= t < pd.Timestamp('2026-11-02T12:00') and np.nanmean(lat_rate[k]) > 0.05}
ib = [g for g in gauges if g['inBlackWashBasin']]
res['basinGaugeMeanHourlyMm'] = {}
for i, h in enumerate(hours):
    if pd.Timestamp('2026-11-01T00:00') <= h < pd.Timestamp('2026-11-02T12:00'):
        # unknown gauge hours (NaN) are left out and not counted in gaugesKnown; nothing is filled with zero
        vals = [gaugeHourly[g['site']][i] for g in ib]
        known = [float(v) for v in vals if not np.isnan(v)]
        if known and np.mean(known) > 0.05: res['basinGaugeMeanHourlyMm'][iso(h)[5:13]] = {'mean': round(float(np.mean(known)), 2), 'gaugesKnown': len(known)}

# ---------------- (b) rings, tributaries, observed first pulse ----------------
k14 = [ptimes.get_loc(pd.Timestamp(f'2026-11-01T{h:02d}:00')) for h in range(14, 18)]
k00 = [ptimes.get_loc(pd.Timestamp(f'2026-11-01T{h:02d}:00')) for h in range(0, 12)]
rain1418 = lat_rate[k14].sum(0); rain0012 = lat_rate[k00].sum(0)
cell = 0.25 * 0.25
rings = []
for r0, r1 in RINGS:
    s = (cd >= r0) & (cd < r1)
    rings.append({'flowKm': f'{r0}-{r1}', 'areaKm2': round(s.sum() * cell, 1), 'rain14to18ZMm': round(float(rain1418[s].mean()), 1) if s.any() else None,
                  'rainVol14to18ZMm3': round(float(rain1418[s].sum() * cell * 1e3) / 1e6, 2), 'rain00to12ZMm': round(float(rain0012[s].mean()), 1) if s.any() else None})
res['rings'] = rings
# straight-line distance to the gauge (a lower bound on the flow distance; NHD distance above treats a whole catchment as
# sitting at its flowline midpoint, which is too near for the large 100-150 km2 catchments)
eu = np.hypot(lx - gx, ly - gy) / 1000.0
rs = []
for r0, r1 in RINGS:
    s = (eu >= r0) & (eu < r1)
    rs.append({'straightKm': f'{r0}-{r1}', 'areaKm2': round(s.sum() * cell, 1), 'rain14to18ZMm': round(float(rain1418[s].mean()), 1) if s.any() else None,
               'rainVol14to18ZMm3': round(float(rain1418[s].sum() * cell * 1e3) / 1e6, 2)})
res['ringsStraightLine'] = rs
tr_out = []
for t in tribs:
    s = np.isin(cid, list(t['set']))
    if t['areaKm2'] >= 5:
        tr_out.append({k: v for k, v in t.items() if k != 'set'} | {'rain14to18ZMm': round(float(rain1418[s].mean()), 1) if s.any() else None,
                       'maxFlowKmToGauge': round(max(dist[c] + L[c] for c in t['set']), 1)})
res['tributariesJoiningBlackWash'] = tr_out
g6443 = json.loads((GDIR / 'gauges.json').read_text(encoding='utf-8'))
ser = [x for x in g6443['sensors'] if x['id'] == 'ALERT 6443'][0]['series']
ot = pd.to_datetime([r['timeUtc'] for r in ser]).tz_localize(None); oq = np.array([r['flowM3s'] for r in ser], float)


def ovol(t0, t1):
    tt = pd.date_range(t0, t1, freq='1min'); v = np.interp(tt.values.astype('int64'), ot.values.astype('int64'), oq)
    return float(np.trapz(v, dx=60.0))


res['observedPulses'] = {'firstRise': '2026-11-01T16:20Z (2.39 ft), first flow 16:35Z', 'peak1': '18:20Z 64.7 m3/s', 'trough1': '20:25Z 24.1 m3/s',
                         'peak2': '21:45-22:00Z 42.0 m3/s', 'peak3': '02:10Z Nov 2 25.7 m3/s',
                         'volPulse1_1620to2025Z_Mm3': round(ovol('2026-11-01T16:20', '2026-11-01T20:25') / 1e6, 3),
                         'volTo2025Z_and_after': {'16:20-20:25Z': round(ovol('2026-11-01T16:20', '2026-11-01T20:25') / 1e6, 3),
                                                  '20:25Z-02:00Z': round(ovol('2026-11-01T20:25', '2026-11-02T02:00') / 1e6, 3),
                                                  '02:00Z-18:00Z': round(ovol('2026-11-02T02:00', '2026-11-02T18:00') / 1e6, 3)},
                         'note': 'linear between reports (assumption); flows are the provisional county rating'}
cum = 0.0; cumA = 0.0; implied = []
for r in rings:
    cumA += r['areaKm2']; cum += r['rainVol14to18ZMm3']
    implied.append({'withinKm': r['flowKm'].split('-')[1], 'areaKm2': round(cumA, 1), 'rainVolMm3': round(cum, 2),
                    'Cneeded_pulse1': round(res['observedPulses']['volPulse1_1620to2025Z_Mm3'] / cum, 3)})
res['impliedRunoffCoefficientIfPulse1ComesOnlyFromWithin'] = implied
cum = 0.0; cumA = 0.0; implied = []
for r in rs:
    cumA += r['areaKm2']; cum += r['rainVol14to18ZMm3']
    implied.append({'withinStraightKm': r['straightKm'].split('-')[1], 'areaKm2': round(cumA, 1), 'rainVolMm3': round(cum, 2),
                    'Cneeded_pulse1': round(res['observedPulses']['volPulse1_1620to2025Z_Mm3'] / cum, 3) if cum else None})
res['impliedRunoffCoefficientStraightLine'] = implied

# ---------------- (c) model maps ----------------
q = xr.open_dataset(RUNS['cnb 42584493432'] / 'sfincs.nc'); DX = float(q.attrs['dx']); level = q['level'].values.astype(int); q.close()
size = DX / 2.0 ** (level - 1)
res['model'] = {}
for name, RUN in RUNS.items():
    m = xr.open_dataset(RUN / 'sfincs_map.nc')
    fx, fy = m.mesh2d_face_x.values, m.mesh2d_face_y.values; zb = m.zb.values.astype(np.float64)
    mt = pd.to_datetime(m.time.values)
    inb = contains_xy(basin, fx, fy)
    fcd = np.full(fx.size, np.nan)
    for r in cbw.itertuples():
        s = contains_xy(r.geometry, fx, fy); fcd[s] = r.dKm
    idx = np.where(inb)[0]
    V = np.stack([m.subgrid_volume.isel(time=k).values[idx] for k in range(len(mt))]).astype(np.float64)
    ZS = np.stack([m.zs.isel(time=k).values[idx] for k in range(len(mt))]).astype(np.float64)
    d = fcd[idx]
    stor = {}
    for r0, r1 in RINGS:
        s = (d >= r0) & (d < r1)
        stor[f'{r0}-{r1}'] = {iso(t)[5:16]: round(float(V[k, s].sum()) / 1e6, 3) for k, t in enumerate(mt) if k % 4 == 0 and k <= 60}
    eud = np.hypot(fx[idx] - gx, fy[idx] - gy) / 1000.0
    for r0, r1 in [(0, 10), (10, 20), (20, 40)]:
        s = (eud >= r0) & (eud < r1)
        stor[f'straight {r0}-{r1} km'] = {iso(t)[5:16]: round(float(V[k, s].sum()) / 1e6, 3) for k, t in enumerate(mt) if k % 4 == 0 and k <= 60}
    # channel arrival along the Black Wash path and the near tributaries: lowest-zb face within 75 m of points every 1 km
    def track(comids, label):
        s = net[net.comid.isin(comids)]
        ln = linemerge(list(s.geometry))
        if ln.geom_type != 'LineString': ln = LineString([c for g in ln.geoms for c in g.coords])
        # orient downstream: end nearest the gauge
        if Point(ln.coords[0]).distance(Point(gx, gy)) < Point(ln.coords[-1]).distance(Point(gx, gy)): ln = LineString(ln.coords[::-1])
        out = []
        for dd in np.arange(0, ln.length, 1000.0):
            pt = ln.interpolate(dd); rr = np.hypot(fx[idx] - pt.x, fy[idx] - pt.y); c = np.where(rr <= 75.0)[0]
            if not c.size: continue
            f = c[np.argmin(zb[idx][c])]; z = ZS[:, f]; rise = z - z[0]
            r5 = np.where(rise >= 0.05)[0]; r20 = np.where(rise >= 0.20)[0]
            out.append({'kmAlong': round(dd / 1000, 1), 'flowKmToGauge': round(float(np.nanmin([fcd[idx][f]])), 1) if not np.isnan(fcd[idx][f]) else None,
                        'cellM': float(size[idx[f]]), 'depthAt17Z': round(float(z[0] - zb[idx][f]), 3),
                        'rise5cm': iso(mt[r5[0]])[5:16] if r5.size else None, 'rise20cm': iso(mt[r20[0]])[5:16] if r20.size else None,
                        'peak': iso(mt[int(np.argmax(z))])[5:16], 'maxRiseM': round(float(rise.max()), 3)})
        return {'path': label, 'points': out}
    paths = [track(list(main & bw), f'Black Wash level path {lp}')]
    for t in tribs:
        if t['areaKm2'] >= 20 and t['joinsAtKm'] <= 20:
            tl = int(net.loc[net.comid == t['comid'], 'levelpathi'].iloc[0])
            paths.append(track(list(set(net.loc[net.levelpathi == tl, 'comid'].astype(int)) & t['set']), f"tributary {t['comid']} ({t['areaKm2']} km2, joins at km {t['joinsAtKm']})"))
    cp = m.cumprcp.values; ci = m.cuminf.values
    res['model'][name] = {'mapFrames': [iso(mt[0]), iso(mt[-1]), len(mt)], 'storageOnLandByRingMm3': stor, 'channelArrival': paths}
    m.close()
res['spinUp'] = {'tstart': inp['tstart'], 'mapStart': res['caseTimeAxis']['mapStartUtc'], 'hoursRunBeforeMapStart': float(inp['t0out']) / 3600,
                 'restartFilesFrom': 'sfincs.20261101.180000.rst (first restart = t0out + dtrstout)',
                 'note': 'The solver runs from tstart; t0out only delays map/restart writing. The rain burst starts 14Z Nov 1, 46 h after tstart.'}
a.output.parent.mkdir(parents=True, exist_ok=True)
with open(a.output, 'w', encoding='utf-8', newline='\n') as f: json.dump(res, f, indent=1)
print('wrote', a.output)
