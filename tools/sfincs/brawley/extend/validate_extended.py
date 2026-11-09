"""Post-run validation of the brawley-avra-west v2x extended-window run (observed inflow, window to 2026-11-02T18Z).

Adapted from tools/sfincs/brawley/validate_postrun.py and validate_postrun_arrival.py (same restart reader, same SFINCS
u/v-point order, same stair-step sections, same zs-vs-roadZ road rule with the exporter wet flag vol/area >= 0.0091 m).
Changes: v2 mesh origin read from sfincs.nc attrs, v2 inlet face from boundary-placement.json, v2 road-station file, window
length read from the output, the outlet restricted to the outflow cells near node 720060498, and an optional rain-only-ish
baseline (the v2 NWM-inflow frozen run, peak inflow 1.70 m3/s, same mesh/rain to 07Z) used for wave attribution up to 07Z only.
No model input is changed.

  python -I tools/sfincs/brawley/extend/validate_extended.py --wt E:/FloodPLAIN/wt-model --run <dir>/runs/current \
     [--baseline <v2 nwm dir>/runs/current] [--compare <v2 observed dir>/runs/current] --output <out.json>

The outflow balance covers outflow only from the first hourly restart (the run has no his output and map frames start at t0out); see
balanceInputsWholeRunOutflowFromFirstRestart and outflowBeforeFirstRestart. Also written: outflowClusters, alert6443, pondNearOutlet, rainStageIV07to18Z.
"""
import argparse, gzip, json, math
from pathlib import Path
import numpy as np, pyproj, xarray as xr

p = argparse.ArgumentParser(); p.add_argument('--wt', type=Path, required=True); p.add_argument('--run', type=Path, required=True)
p.add_argument('--baseline', type=Path); p.add_argument('--compare', type=Path); p.add_argument('--output', type=Path, required=True); a = p.parse_args()
WT, D = a.wt, a.run
TO_UTM = pyproj.Transformer.from_crs(4326, 32612, always_xy=True); TO_LL = pyproj.Transformer.from_crs(32612, 4326, always_xy=True)
DRY = 0.0091
res = {'run': str(D)}

q = xr.open_dataset(D / 'sfincs.nc')
X0, Y0, DX = float(q.attrs['x0']), float(q.attrs['y0']), float(q.attrs['dx'])
level = q['level'].values.astype(int); nidx = q['n'].values.astype(int); midx = q['m'].values.astype(int)
nb = {k: q[k].values.astype(np.int64) for k in ['mu', 'mu1', 'mu2', 'nu', 'nu1', 'nu2']}; q.close()
NF = level.size; size = DX / 2.0 ** (level - 1); area = size * size
xc = X0 + (midx - 0.5) * size; yc = Y0 + (nidx - 0.5) * size
lookup = {(level[i], nidx[i], midx[i]): i for i in range(NF)}; LEVELS = sorted(set(level.tolist()))


def face_at(x, y):
    for L in LEVELS:
        s = DX / 2.0 ** (L - 1); f = lookup.get((L, int(math.floor((y - Y0) / s)) + 1, int(math.floor((x - X0) / s)) + 1))
        if f is not None: return f
    return None


uv_nm, uv_nmu = [], []
for c in range(NF):
    for fl, a1, a2 in [('mu', 'mu1', 'mu2'), ('nu', 'nu1', 'nu2')]:
        if nb[a1][c] > 0: uv_nm.append(c); uv_nmu.append(nb[a1][c] - 1)
        if nb[fl][c] >= 1 and nb[a2][c] > 0: uv_nm.append(c); uv_nmu.append(nb[a2][c] - 1)
uv_nm = np.array(uv_nm); uv_nmu = np.array(uv_nmu); NPUV = uv_nm.size; uv_w = np.minimum(size[uv_nm], size[uv_nmu])

m = xr.open_dataset(D / 'sfincs_map.nc')
msk = m['msk'].values.astype(int); zb = m['zb'].values.astype(np.float64)
times = m['time'].values; T = [str(t)[:16] + 'Z' for t in times]
fx, fy = m['mesh2d_face_x'].values, m['mesh2d_face_y'].values
zs = m['zs'].values.astype(np.float64); vol = m['subgrid_volume'].values.astype(np.float64)
zsmax = m['zsmax'].values.astype(np.float64)
zsmax_by_interval = zsmax if zsmax.ndim == 2 else None  # zsmax is reset every dtmaxout; one row per interval end
zsmax_times = [str(t)[:16] + 'Z' for t in m['timemax'].values] if 'timemax' in m else None
zsmax = zsmax.max(axis=0) if zsmax.ndim == 2 else zsmax
cumprcp = m['cumprcp'].values.astype(np.float64); cumprcp = cumprcp[-1] if cumprcp.ndim == 2 else cumprcp
cuminf = m['cuminf'].values.astype(np.float64); cuminf = cuminf[-1] if cuminf.ndim == 2 else cuminf
prate = m['precipitation_rate'].values.astype(np.float64); m.close()
res['geometry'] = {'faces': int(NF), 'npuv': int(NPUV), 'areaKm2': float(area.sum() / 1e6), 'faceCentreMaxDiffM': float(max(np.abs(fx - xc).max(), np.abs(fy - yc).max())),
                   'frames': len(T), 'firstFrame': T[0], 'lastFrame': T[-1]}
place = json.loads((WT / '.sfincs-runs/brawley-avra-west-boundaries-v2/boundary-placement.json').read_text())
inlet = int(place['inlets'][0]['nativeFaceIndexZeroBased'])
is3 = msk == 3
links_all = np.where(is3[uv_nm] ^ is3[uv_nmu])[0]; sign_all = np.where(is3[uv_nmu[links_all]], 1.0, -1.0)
ox, oy = TO_UTM.transform(-111.2930, 32.3647)
near_out = is3 & (np.hypot(xc - ox, yc - oy) <= 2000.0)
links_out = np.where((near_out[uv_nm] & ~is3[uv_nmu]) | (near_out[uv_nmu] & ~is3[uv_nm]))[0]; sign_out = np.where(near_out[uv_nmu[links_out]], 1.0, -1.0)
res['geometry'].update(outflowCellsAll=int(is3.sum()), outflowLinksAll=int(links_all.size), outletCells720060498=int(near_out.sum()), outletLinks=int(links_out.size),
                       inletFace={'face': inlet, 'cellM': float(size[inlet]), 'zb': float(zb[inlet]), 'lonlat': [round(v, 5) for v in TO_LL.transform(xc[inlet], yc[inlet])]})
# outflow clusters: single-linkage of outflow-cell (msk == 3) centres, 1,500 m. Each outflow link belongs to the cluster of its msk == 3 side.
CLUSTER_LINK_M = 1500.0
o3 = np.where(is3)[0]; par = list(range(o3.size))


def _root(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i


for i in range(o3.size):
    for j in range(i + 1, o3.size):
        if math.hypot(xc[o3[i]] - xc[o3[j]], yc[o3[i]] - yc[o3[j]]) <= CLUSTER_LINK_M: par[_root(i)] = _root(j)
groups = {}
for i in range(o3.size): groups.setdefault(_root(i), []).append(int(o3[i]))
groups = sorted(groups.values(), key=lambda g: (-len(g), -float(yc[g].mean())))
cell_cluster = np.full(NF, -1); [cell_cluster.__setitem__(g, ci) for ci, g in enumerate(groups)]
link_cluster = np.where(is3[uv_nm[links_all]], cell_cluster[uv_nm[links_all]], cell_cluster[uv_nmu[links_all]])
CLUSTERS = {}
for ci, g in enumerate(groups):
    lo, la = TO_LL.transform(float(xc[g].mean()), float(yc[g].mean()))
    CLUSTERS[f'Outflow cluster {ci + 1} ({len(g)} cells, {lo:.3f} {la:.3f})'] = {'cells': len(g), 'centreLonLat': [round(lo, 3), round(la, 3)], 'links': int((link_cluster == ci).sum()),
                                                                              'sameCellsAsOutlet720060498': bool(set(g) == set(np.where(near_out)[0].tolist())), '_ci': ci}


def read_rst(path):
    b = path.read_bytes(); recs, i = [], 0
    while i < len(b):
        n = int(np.frombuffer(b[i:i + 4], '<i4')[0]); recs.append(b[i + 4:i + 4 + n]); i += 8 + n
    return np.frombuffer(recs[1], '<f4'), np.frombuffer(recs[2], '<f4')


def section_links(lat, lon1, lon2):
    xa, ys = TO_UTM.transform(lon1, lat); xb, _ = TO_UTM.transform(lon2, lat)
    inband = (xc >= min(xa, xb)) & (xc <= max(xa, xb)); south = yc < ys; A = inband & south; B = inband & ~south
    l1 = np.where(A[uv_nm] & B[uv_nmu])[0]; l2 = np.where(B[uv_nm] & A[uv_nmu])[0]
    return np.concatenate([l1, l2]), np.concatenate([np.ones(l1.size), -np.ones(l2.size)])


SECTIONS = {'Donaldson Ranch (15877627)': (32.17568, -111.275, -111.245), 'Mile Wide Brawley 15877627 band': (32.24820, -111.262, -111.2475),
            'Mile Wide Black Wash 15876815 band (ALERT 6443)': (32.24820, -111.2475, -111.236), 'Mile Wide both bands': (32.24820, -111.262, -111.236),
            'Manville (15876771)': (32.29177, -111.285, -111.252), 'Tucker (15876711)': (32.33536, -111.300, -111.268)}
sec = {k: section_links(*v) for k, v in SECTIONS.items()}


def hourly_flux(d):
    rst = sorted(d.glob('sfincs.*.rst')); hours, out = [], {k: [] for k in list(sec) + ['Outlet 720060498 (outflow links)', 'All outflow cells'] + list(CLUSTERS)}
    for pth in rst:
        _, qq = read_rst(pth); assert qq.size >= NPUV
        hours.append(pth.name.split('.')[1] + 'T' + pth.name.split('.')[2][:2] + 'Z')
        for k, (ln, sg) in sec.items(): out[k].append(float((qq[ln] * uv_w[ln] * sg).sum()))
        out['Outlet 720060498 (outflow links)'].append(float((qq[links_out] * uv_w[links_out] * sign_out).sum()))
        out['All outflow cells'].append(float((qq[links_all] * uv_w[links_all] * sign_all).sum()))
        for k, c in CLUSTERS.items():
            sel = links_all[link_cluster == c['_ci']]; sg = sign_all[link_cluster == c['_ci']]; out[k].append(float((qq[sel] * uv_w[sel] * sg).sum()))
    hours = [h[:4] + '-' + h[4:6] + '-' + h[6:8] + 'T' + h[9:11] + ':00Z' for h in hours]
    return hours, out, rst


hours, flux, rst = hourly_flux(D)
res['sectionsHourlyM3s'] = {k: dict(zip(hours, [round(v, 3) for v in s])) for k, s in flux.items()}
res['sectionPeaks'] = {k: {'m3s': round(max(s), 3), 'time': hours[int(np.argmax(s))]} for k, s in flux.items()}
res['outflowClusters'] = {k: {kk: vv for kk, vv in c.items() if kk != '_ci'} | {'peakM3s': round(max(flux[k]), 3), 'peakTime': hours[int(np.argmax(flux[k]))],
                                                                              'volumeFromFirstRestartM3': round(float(np.trapz(flux[k], dx=3600.0)))} for k, c in CLUSTERS.items()}
res['outflowClustersMethod'] = f'single-linkage of msk==3 cell centres within {CLUSTER_LINK_M:.0f} m; hourly restart flux, trapezoid from {hours[0]}'
base = None
if a.baseline:
    bh, bf, _ = hourly_flux(a.baseline)
    res['baselineSectionsHourlyM3s'] = {k: dict(zip(bh, [round(v, 3) for v in s])) for k, s in bf.items()}
    common = [h for h in hours if h in bh]
    res['waveAttributionTo07Z'] = {k: {h: round(flux[k][hours.index(h)] - bf[k][bh.index(h)], 3) for h in common} for k in flux}
    bm = xr.open_dataset(a.baseline / 'sfincs_map.nc'); bT = [str(t)[:16] + 'Z' for t in bm['time'].values]; bzs = bm['zs'].values.astype(np.float64); bm.close()
    base = (bT, bzs)

# ---- inflow, balance ----
dis = np.loadtxt(D / 'sfincs.dis'); t_s, qin = dis[:, 0], dis[:, 1]
qall = np.array(flux['All outflow cells']); qo = np.array(flux['Outlet 720060498 (outflow links)'])
rain = float((cumprcp * area).sum()); inf = float((cuminf * area).sum()); s_end = float(np.nansum(vol[-1])); inflow = float(np.trapz(qin, t_s))
outv = float(np.trapz(qall, dx=3600.0)); resid = inflow + rain - inf - s_end - outv
# Inflow, rain and infiltration cover the whole run (dis file; cumprcp/cuminf are cumulative from tstart). Outflow is only known from the hourly restarts,
# which start at the first restart (18Z Nov 1): the run writes no his file and map frames start at t0out (17Z Nov 1). So outflow before the first restart
# is NOT in this balance. Outflow after it is itself an estimate: a trapezoid over hourly snapshots of the instantaneous flux, so peaks between
# restarts are not sampled. The residual below is therefore an estimate, not a hard bound; missing pre-restart outflow would make it more negative.
res['balanceInputsWholeRunOutflowFromFirstRestart'] = {
    'inflowM3': round(inflow), 'inflowVolumeBasis': 'trapezoid over sfincs.dis (the solver interpolates linearly between the hourly values)',
    'inflowPeakM3s': float(qin.max()), 'rainM3': round(rain), 'rainMeanMm': 1000 * rain / area.sum(), 'infiltrationM3': round(inf), 'infMeanMm': 1000 * inf / area.sum(),
    'storageEndM3': round(s_end), 'outflowAllCellsHourlyRstM3': round(outv), 'outflowWindowStart': hours[0], 'outletOnlyVolumeM3': round(float(np.trapz(qo, dx=3600.0))),
    'residualM3': round(resid), 'residualPctOfInputs': 100 * resid / (inflow + rain), 'residualNote': 'inflow + rain - infiltration - storageEnd - outflow(from first restart). An estimate, not a bound: the outflow term is a trapezoid over hourly snapshots of the instantaneous flux (not a time integral of the solver flux), so its sampling error has either sign; any outflow before the first restart would make the residual more negative by that amount',
    'negativeVolumeEndM3': float(vol[-1][vol[-1] < 0].sum()), 'minCellVolumeM3': float(np.nanmin(vol))}
# ---- what the outputs say about outflow before the first restart (not measured) ----
ref_t = np.datetime64('2026-10-30T16:00'); t_first = np.datetime64(hours[0][:16]); s_first = float((t_first - ref_t) / np.timedelta64(1, 's'))
pq = xr.open_dataset(D / 'precip_2d.nc'); pv = pq['Precipitation'].values.astype(np.float64); pxs = pq['x'].values; pys = pq['y'].values; pts_ = pq['time'].values; pq.close()
ix_ = np.clip(np.round((xc - pxs[0]) / (pxs[1] - pxs[0])).astype(int), 0, pxs.size - 1); iy_ = np.clip(np.round((yc - pys[0]) / (pys[1] - pys[0])).astype(int), 0, pys.size - 1)
p_at = pv[:, iy_, ix_]  # mm/h, interval-start labelled hourly frames, nearest 1 km grid cell to each face centre
hrs_before = np.array([(np.datetime64(str(t)[:16]) < t_first) for t in pts_])
rain_pre = float((p_at[hrs_before] / 1000.0 * area[None, :]).sum()); ii = np.where(t_s <= s_first)[0]; inflow_pre = float(np.trapz(qin[ii], t_s[ii]))
i_first = T.index(hours[0]); s_first_vol = float(np.nansum(vol[i_first]))
h_out = vol[:, is3] / area[None, is3]
res['outflowBeforeFirstRestart'] = {
    'measured': False, 'why': 'no his output; map frames start ' + T[0] + '; hourly restarts start ' + hours[0],
    'outflowAllLinksFirst4RestartsM3s': {hh: round(v, 3) for hh, v in list(zip(hours, flux['All outflow cells']))[:4]},
    'outflowCellsMaxVolOverAreaM_byFrame': {T[i]: round(float(np.nanmax(h_out[i])), 4) for i in range(0, min(len(T), 21), 4)},
    'inflowBeforeM3': round(inflow_pre), 'rainBeforeM3_meshNearest1kmCell': round(rain_pre), 'rainBeforeMeanMm': round(1000 * rain_pre / area.sum(), 2), 'storageAtFirstRestartM3': round(s_first_vol),
    'upperBoundM3': round(inflow_pre + rain_pre - s_first_vol),
    'upperBoundNote': 'inflow + rain before the first restart minus storage then, taking infiltration before it as zero (it is not zero, so the bound is loose) and the pre-restart numerical residual as small; trueResidualRangeM3 inherits the hourly-sampling estimate in the outflow term after the first restart, so both ends are estimates',
    'trueResidualRangeM3': [round(resid - (inflow_pre + rain_pre - s_first_vol)), round(resid)]}
R_frames = (prate / 1000.0 / 3600.0 * area[None, :]).sum(axis=1)
res['rainDomainMeanMmH_hourlyFrames'] = {T[i]: round(float(R_frames[i] / area.sum() * 3600 * 1000), 3) for i in range(0, len(T), 4)}
# ---- 07Z-18Z observed Stage IV domain mean on three bases ----
i07r = T.index('2026-11-02T07:00Z'); mesh_mean = R_frames / area.sum() * 3600 * 1000  # mm/h per frame
ext07 = np.array([(np.datetime64(str(t)[:16]) >= np.datetime64('2026-11-02T07:00')) for t in pts_])
s4 = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/extended/rain-extension-stage4-metadata.json').read_text())['stats']
res['rainStageIV07to18Z'] = {
    'meshAreaWeightedMm_mapFramesLeftRiemann': round(float(mesh_mean[i07r:-1].sum() * 0.25), 3),
    'meshAreaWeightedMm_mapFramesTrapezoid': round(float(np.trapz(mesh_mean[i07r:], dx=0.25)), 3),
    'meshAreaWeightedMm_inputNearest1kmCell': round(float((p_at[ext07] * area[None, :]).sum() / area.sum()), 3),
    'meshAreaWeightedInputMmH_byHour': {str(t)[:13] + 'Z': round(float((p_at[i] * area).sum() / area.sum()), 3) for i, t in enumerate(pts_) if ext07[i]},
    'wholeRunCheck': {'inputNearest1kmCellMeshMeanMm': round(float((p_at * area[None, :]).sum() / area.sum()), 3), 'cumprcpMeshMeanMm': round(1000 * rain / area.sum(), 3)},
    'mapFramesNote': 'precipitation_rate in the map is a 15-min sample of the applied rate, so integrating the frames only approximates the applied rain; cumprcp is the solver total',
    'input1kmGridBboxMeanMm': round(float(np.nanmean(pv[ext07], axis=(1, 2)).sum()), 3),
    'hrapCellMeanMm_metadataStats': round(sum(v['mean'] for k, v in s4.items() if '2026-11-02T07' <= k[:13] <= '2026-11-02T17'), 3),
    'note': 'mesh-area-weighted is the rain the model receives; the HRAP cell mean is an unweighted mean over the mapped Stage IV cells; the bbox mean is an unweighted mean over the 1 km precip_2d grid'}
# ---- negative depth (live verifier limit 1 mm) ----
h = vol / area[None, :]
k = np.unravel_index(np.nanargmin(h), h.shape)
res['negativeDepth'] = {'minVolOverAreaM': float(h[k]), 'frame': T[k[0]], 'face': int(k[1]), 'cellAreaM2': float(area[k[1]]), 'cellsBelowMinus1mm': int((h < -0.001).any(axis=0).sum()), 'framesBelowMinus1mm': int((h < -0.001).any(axis=1).sum()),
                        'note': 'vol/area of subgrid_volume; the live verifier rejects depth < -0.001 m'}
wet = h >= DRY
# ---- points ----
st = json.load(gzip.open(WT / 'tools/live/road-stations/brawley-avra-west-local-v2.json.gz'))['columns']
slon = np.array(st['lon']); slat = np.array(st['lat']); sz = np.array([np.nan if v is None else v for v in st['roadZ']], dtype=float)
sroad = np.array(st['road']); sflag = np.array(st['flags']); sx, sy = TO_UTM.transform(slon, slat)
sface = np.array([(-1 if (f := face_at(x, y)) is None else f) for x, y in zip(sx, sy)])


def channel_face(lon, lat, r=30.0):
    x, y = TO_UTM.transform(lon, lat); cand = np.where(np.hypot(xc - x, yc - y) <= r)[0]
    return face_at(x, y) if cand.size == 0 else int(cand[np.argmin(zb[cand])])


meta = json.loads((WT / 'docs/upgrade/validation-brawley-prerun-20261108.json').read_text())
POINTS = {'Inlet face': inlet}
for c in meta['brawleyCrossings']: POINTS[f"{c['road']} channel"] = channel_face(c['lon'], c['lat'])
POINTS['ALERT 6443 lowest face within 30 m (Black Wash band)'] = channel_face(-111.244446, 32.248611)
POINTS['Brawley 15877627 at Mile Wide (lowest within 30 m)'] = channel_face(-111.25265, 32.24820)
POINTS['Confluence 15876811 start'] = channel_face(-111.2439, 32.2501)
POINTS['Outlet node 720060498 (lowest within 100 m)'] = channel_face(-111.2930, 32.3647, 100.0)
i07 = T.index('2026-11-02T07:00Z'); i03 = T.index('2026-11-02T03:00Z')
pts = {}
for name, f in POINTS.items():
    z = np.where(np.isnan(zs[:, f]), zb[f], zs[:, f]); dep = z - zb[f]
    rec = {'face': int(f), 'cellM': float(size[f]), 'lonlat': [round(v, 5) for v in TO_LL.transform(xc[f], yc[f])], 'zb': round(float(zb[f]), 3),
           'maxZs': round(float(z.max()), 3), 'maxZsTime': T[int(np.argmax(z))], 'maxDepth': round(float(dep.max()), 3),
           'maxZsTo07Z': round(float(z[:i07 + 1].max()), 3), 'maxZsAfter07Z': round(float(z[i07 + 1:].max()), 3) if len(z) > i07 + 1 else None, 'zs07Z': round(float(z[i07]), 3), 'zsEnd': round(float(z[-1]), 3),
           'zs0304Z': round(float(z[i03] + (z[i03 + 1] - z[i03]) * 4 / 15), 3), 'hourly': {T[i][5:16]: round(float(z[i]), 3) for i in range(0, len(T), 4)}}
    if base:
        bT, bzs = base; n = min(len(bT), len(T)); assert bT[:n] == T[:n]
        bz = np.where(np.isnan(bzs[:n, f]), zb[f], bzs[:n, f]); d = z[:n] - bz
        rec['diffVsBaselineFirstGt0p3'] = next((T[i] for i in range(n) if d[i] > 0.3), None); rec['diffVsBaselineMaxTo07Z'] = round(float(d.max()), 3)
    pts[name] = rec
res['points'] = pts
# ---- ALERT 6443: model vs the PRIMARY county series (gauges.json), not a second-hand reading ----
# The owner's ~817 cfs is confirmed in the primary data, but which report was seen is uncertain (817 cfs at 02:45Z Nov 2, 776 cfs at 03:00Z,
# and 817 cfs also at 23:55Z Nov 1), so no single corrected time is used. The comparison is against the primary report at each hour.
# The county names the gauge 'Brawley Wash at Milewide Road' but it snaps to NHD Black Wash 15876815 (4.8 m), so both the Black Wash
# band and both bands are reported.
G6443 = next(s_ for s_ in json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json').read_text(encoding='utf-8'))['sensors']
             if s_['id'] == 'ALERT 6443')
obs6443 = [(r['timeUtc'], r['flowM3s']) for r in G6443['series'] if r.get('flowM3s') is not None]


def obs_at(h):  # the report at the hour, or the latest earlier one with its age; no interpolation
    k = h[:16] + ':00Z'; prev = [o for o in obs6443 if o[0] <= k]
    if not prev: return None
    t_, v_ = prev[-1]; return {'reportUtc': t_, 'ageMin': int((np.datetime64(k[:19]) - np.datetime64(t_[:19])) / np.timedelta64(1, 'm')), 'flowM3s': v_}


def first_reach(series, thr):
    for j in range(1, len(series)):
        if series[j - 1] < thr <= series[j]:
            frac = (thr - series[j - 1]) / (series[j] - series[j - 1]); t0_ = np.datetime64(hours[j - 1][:16]) + np.timedelta64(int(round(frac * 60)), 'm')
            return {'time': str(t0_) + 'Z', 'before': {hours[j - 1]: round(series[j - 1], 3)}, 'after': {hours[j]: round(series[j], 3)}, 'method': 'linear between hourly restarts'}
    return None


BW, BB = 'Mile Wide Black Wash 15876815 band (ALERT 6443)', 'Mile Wide both bands'
h03 = '2026-11-02T03:00Z'; o03 = obs_at(h03); OBS03 = o03['flowM3s']; V817 = round(817 * 0.0283168, 3)
gp = pts['ALERT 6443 lowest face within 30 m (Black Wash band)']
res['alert6443'] = {
    'observedSource': 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json (ALERT 6443 primary county series, provisional; times UTC)',
    'gaugeNaming': "county name 'Brawley Wash at Milewide Road'; NHD snap Black Wash 15876815 at 4.8 m (Brawley 15877627 crossing 0.8 km west). Which model band the gauge sees is not settled, so both are given",
    'ownerReadingNote': '~817 cfs (23.13 m3/s) is confirmed in the primary data, but the report the owner saw is uncertain: 817 cfs at 02:45Z Nov 2, 776 cfs at 03:00Z, and 817 cfs also at 23:55Z Nov 1. No single corrected time is used',
    'observed03Z': o03,
    'model03Z': {'blackWashBand': round(flux[BW][hours.index(h03)], 3), 'bothBands': round(flux[BB][hours.index(h03)], 3)},
    'ratio03Z': {'blackWashBand': round(flux[BW][hours.index(h03)] / OBS03, 3), 'bothBands': round(flux[BB][hours.index(h03)] / OBS03, 3)},
    'modelFirstAtObserved03Z': {'thresholdM3s': OBS03, 'blackWashBand': first_reach(flux[BW], OBS03), 'bothBands': first_reach(flux[BB], OBS03)},
    'modelFirstAt817cfs': {'thresholdM3s': V817, 'blackWashBand': first_reach(flux[BW], V817), 'bothBands': first_reach(flux[BB], V817)},
    'hourly': [{'hourUtc': h, 'observed': obs_at(h), 'modelBlackWashBandM3s': round(flux[BW][i], 3), 'modelBothBandsM3s': round(flux[BB][i], 3)} for i, h in enumerate(hours)],
    'hourlyNote': 'observed = the primary report at the hour, or the latest earlier report with its age in minutes (no interpolation); model = hourly restart flux (m3/s)',
    'modelPeak': {'blackWashBand': res['sectionPeaks'][BW], 'bothBands': res['sectionPeaks'][BB]},
    'gaugeCellZsMax': gp['maxZs'], 'gaugeCellZsMaxTime': gp['maxZsTime'], 'gaugeCellMaxDepth': gp['maxDepth']}
# ---- pond near the outlet: deepest face in the run (zsmax - zb, both zsmax intervals), storage around it ----
with np.errstate(all='ignore'):
    depmax = zsmax - zb
pf = int(np.nanargmax(depmax)); zf = np.where(np.isnan(zs[:, pf]), zb[pf], zs[:, pf]); op = POINTS['Outlet node 720060498 (lowest within 100 m)']
res['pondNearOutlet'] = {'face': pf, 'cellM': float(size[pf]), 'lonlat': [round(v, 5) for v in TO_LL.transform(xc[pf], yc[pf])], 'zb': round(float(zb[pf]), 3),
                         'zsMax': round(float(zsmax[pf]), 3), 'zsMaxFrames': round(float(zf.max()), 3), 'zsMaxFrameTime': T[int(np.argmax(zf))],
                         'zsMaxFirstInterval': round(float(zsmax_by_interval[0][pf]), 3) if zsmax_by_interval is not None else None, 'zsMaxIntervalEnds': zsmax_times,
                         'depthMax': round(float(depmax[pf]), 3), 'zs17Z_Nov2': round(float(zf[T.index('2026-11-02T17:00Z')]), 3), 'zsEnd': round(float(zf[-1]), 3),
                         'stillRisingAtEnd': bool(zf[-1] > zf[-2]),
                         'kmFromOutletNode720060498': round(float(np.hypot(xc[pf] - ox, yc[pf] - oy)) / 1000, 2),
                         'storedWithin1p5kmAtEndM3': round(float(np.nansum(vol[-1][np.hypot(xc - xc[pf], yc - yc[pf]) <= 1500.0]))),
                         'outletChannelFace': int(op), 'outletChannelZb': round(float(zb[op]), 3), 'outletChannelZsMax': pts['Outlet node 720060498 (lowest within 100 m)']['maxZs'],
                         'outletChannelMaxDepth': pts['Outlet node 720060498 (lowest within 100 m)']['maxDepth']}
# ---- front (diff vs baseline to 07Z) ----
if base:
    bT, bzs = base; n = min(len(bT), len(T)); ix, iy = xc[inlet], yc[inlet]; fr = {}
    for i in range(0, n, 2):
        d = np.where(np.isnan(zs[i]), zb, zs[i]) - np.where(np.isnan(bzs[i]), zb, bzs[i]); s3 = d > 0.3
        fr[T[i]] = None if not s3.any() else {'dyKmFromInlet': round((float(yc[s3].max()) - iy) / 1000, 2), 'lat': round(TO_LL.transform(ix, float(yc[s3].max()))[1], 4)}
    res['frontVsBaseline0p3'] = fr
# ---- roads: zs vs roadZ, wet frames only ----


def near(lon, lat, r=25.0):
    x, y = TO_UTM.transform(lon, lat); return np.where(np.hypot(sx - x, sy - y) <= r)[0]


def road_eval(lon, lat, label):
    rows = []
    for s in near(lon, lat):
        f = sface[s]
        if f < 0 or np.isnan(sz[s]): rows.append({'state': 'no-cell' if f < 0 else 'no-road-height'}); continue
        z = np.where(wet[:, f], zs[:, f], np.nan)
        unknown = int((~wet[:, f] & ~np.isnan(zs[:, f]) & (zs[:, f] > sz[s])).sum())
        if np.all(np.isnan(z)): rows.append({'roadZ': float(sz[s]), 'cellM': float(size[f]), 'maxWse': None}); continue
        ov = np.where(z > sz[s])[0]
        rows.append({'roadZ': float(sz[s]), 'cellM': float(size[f]), 'maxWse': float(np.nanmax(z)), 'maxWseTime': T[int(np.nanargmax(z))], 'maxOver': float(np.nanmax(z) - sz[s]),
                     'maxOverTo07Z': None if np.all(np.isnan(z[:i07 + 1])) else float(np.nanmax(z[:i07 + 1]) - sz[s]),
                     'maxOverAfter07Z': None if len(z) <= i07 + 1 or np.all(np.isnan(z[i07 + 1:])) else float(np.nanmax(z[i07 + 1:]) - sz[s]),
                     'firstOver': T[ov[0]] if ov.size else None, 'lastOver': T[ov[-1]] if ov.size else None, 'framesOver': int(ov.size), 'dryFramesZsAboveRoad': unknown})
    good = [r for r in rows if r.get('maxWse') is not None]
    out = {'label': label, 'stations': len(rows), 'noCellOrHeight': sum('state' in r for r in rows)}
    if good:
        b = max(good, key=lambda r: r['maxOver']); fo = sorted(r['firstOver'] for r in good if r['firstOver']); lo = sorted(r['lastOver'] for r in good if r['lastOver'])
        out.update({'roadZmin': min(r['roadZ'] for r in rows if 'roadZ' in r), 'roadZmax': max(r['roadZ'] for r in rows if 'roadZ' in r), 'cellM': sorted({r['cellM'] for r in good}),
                    'maxWse': round(b['maxWse'], 3), 'maxWseTime': b['maxWseTime'], 'maxOver': round(b['maxOver'], 3),
                    'maxOverTo07Z': None if b['maxOverTo07Z'] is None else round(b['maxOverTo07Z'], 3), 'maxOverAfter07Z': None if b['maxOverAfter07Z'] is None else round(b['maxOverAfter07Z'], 3),
                    'firstOver': fo[0] if fo else None, 'lastOver': lo[-1] if lo else None, 'stationsOver': len(fo), 'maxFramesOver': max(r['framesOver'] for r in good),
                    'dryFramesZsAboveRoadMax': max(r['dryFramesZsAboveRoad'] for r in good)})
    return out


res['crossings'] = [road_eval(c['lon'], c['lat'], c['road']) for c in meta['brawleyCrossings']]
res['dips'] = [road_eval(c['lon'], c['lat'], f"{c['road']} {c['depthM']} m") for c in meta['repDips']]
deck = np.where(sflag == 1)[0]
res['deckLidar'] = [{'road': str(sroad[s]), 'roadZ': float(sz[s]), 'maxWse': None if not wet[:, sface[s]].any() else float(np.nanmax(np.where(wet[:, sface[s]], zs[:, sface[s]], np.nan)))} for s in deck if sface[s] >= 0]
valid = (sface >= 0) & ~np.isnan(sz); sf = np.where(valid, sface, 0); zst = np.where(wet[:, sf], zs[:, sf], np.nan)
with np.errstate(all='ignore'):
    mo = np.nanmax(zst, axis=0) - sz; mo07 = np.nanmax(zst[:i07 + 1], axis=0) - sz
over = valid & (mo > 0); over07 = valid & (mo07 > 0)
res['stationsOverByCell'] = {str(c): {'stations': int((valid & (size[sf] == c)).sum()), 'overFullWindow': int((over & (size[sf] == c)).sum()), 'overBy07Z': int((over07 & (size[sf] == c)).sum()),
                                      'overGt0p3': int((valid & (size[sf] == c) & (mo > 0.3)).sum())} for c in sorted(set(size.tolist()))}
res['stationsOverTotal'] = {'stations': int(valid.sum()), 'overFullWindow': int(over.sum()), 'overBy07Z': int(over07.sum()), 'newAfter07Z': int((over & ~over07).sum())}
# ---- stability ----
dz = np.diff(np.where(np.isnan(zs), zb[None, :], zs), axis=0); wetany = wet.any(axis=0)
nanm = np.isnan(zs)
res['stability'] = {'nanZs': int(nanm.sum()), 'nanZsWet': int((nanm & wet).sum()), 'maxAbsDzs15minWet': float(np.abs(dz[:, wetany]).max()),
                    'spikeCells': int(((dz[:-1] > 0.5) & (dz[1:] < -0.5)).any(axis=0).sum()), 'zsBelowZbMin': float(np.nanmin(zs - zb[None, :])), 'maxDepth': float(np.nanmax(zsmax - zb))}
vmax, vat = 0.0, None
for pth in rst:
    zr, qq = read_rst(pth); qa = np.abs(qq[:NPUV]).astype(np.float64); hh = np.maximum(zr[uv_nm], zr[uv_nmu]) - np.maximum(zb[uv_nm], zb[uv_nmu]); ok = hh > 0.1
    vv = np.where(ok, qa / np.where(ok, hh, 1.0), 0.0)
    if vv.max() > vmax: vmax = float(vv.max()); vat = (pth.name, [round(v, 5) for v in TO_LL.transform(xc[uv_nm[int(np.argmax(vv))]], yc[uv_nm[int(np.argmax(vv))]])])
res['stability'].update(velocityProxyMaxMs=vmax, velocityProxyAt=vat)
# ---- reproduce check vs the 63 h observed v2 run ----
if a.compare:
    cm = xr.open_dataset(a.compare / 'sfincs_map.nc'); cT = [str(t)[:16] + 'Z' for t in cm['time'].values]; czs = cm['zs'].values.astype(np.float64); cm.close()
    n = len(cT); assert T[:n] == cT
    dd = np.abs(np.where(np.isnan(zs[:n]), zb, zs[:n]) - np.where(np.isnan(czs), zb, czs))
    res['reproduceV2ObservedTo07Z'] = {'frames': n, 'maxAbsZsDiffM': float(dd.max()), 'p99AbsZsDiffM': float(np.percentile(dd, 99)), 'cellsGt0p01': int((dd > 0.01).any(axis=0).sum())}
# ---- NWM analysis reference ----
ref = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v1/nwm-validation-reaches.json').read_text())['analysisFullWindow']['series']
aa = {s['reachId']: {p['time']: p['flowM3s'] for p in s['points']} for s in ref}
ext = WT / '.sfincs-runs/brawley-avra-west-nwm-v2x-aa/series.json'
if ext.exists():
    for s in json.loads(ext.read_text())['series']: aa.setdefault(s['reachId'], {}).update({p['time']: p['flowM3s'] for p in s['points']})
res['nwmAnalysisRef'] = {}
for r in ['15876941', '15876923', '15876811', '15876815', '15876711']:
    if r not in aa: continue
    s = sorted(aa[r].items()); v = [x[1] for x in s]; i = int(np.argmax(v))
    res['nwmAnalysisRef'][r] = {'peak': round(v[i], 3), 'time': s[i][0], 'hourly': {k[5:13]: round(x, 2) for k, x in s if k >= '2026-11-01T17'}}
a.output.write_bytes(json.dumps(res, indent=1, default=float).encode('utf-8')); print('ok', a.output)  # LF only
