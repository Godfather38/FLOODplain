"""Compare the btfilter = -1 boundary SENSITIVITY run (v3l-obsrain-btf) with base case B (v3l-obsrain), read-only.

Both runs use the same mesh, rain, inflow and infiltration; only sfincs.inp btfilter differs (60.0 -> -1). Reads each run's
hourly restarts (zs, q, uvmean) and sfincs_map.nc. Works on runs stopped by the execution cap (the map file then has no zsmax,
cumprcp, cuminf or runtime; only frames with a valid time are used, and both runs must have the same frames). Writes one JSON with:
  - per outflow cluster (msk 3 cells single-linked within 1500 m, the validate_extended.py rule): stored boundary flux, the
    head-driven part sqrt(g*huv)*(zs_inside - z_zmin(outflow cell))*width (SFINCS bndtype 1 without uvmean), the stored
    uvmean record of the restart (sum over the cluster's links, converted to m3/s with the link width), and the ratio;
  - boundary-link speed q/huv (huv = subgrid flux depth) at every hourly restart, and the largest |q|/huv per run;
  - zs at every outflow cell and at the msk 1 cell inside each boundary link (max over map frames, and max |btf - base|);
  - road stations within 600 m of any outflow cell (v2 local station file): per station max zs in wet frames, max |dzs| over
    all frames where the cell is wet in either run, over-road status in each run (cell zs > roadZ in a wet frame);
  - how far the change reaches: max |zs btf - base| over all frames by distance band from the nearest outflow cell;
  - ALERT 6443 against the PRIMARY county series (gauges.json), both bands, with and without the suspect plateau, 16Z and 18Z
    observed starts (same rules as variants/result-v3l-obsrain-42583445548/score_v3l.py);
  - sections (Mile Wide, Manville, Tucker, Donaldson; validate_extended.py SECTIONS and stair-step rule) from the restarts;
  - a difference mass balance: rain and inflow are identical inputs, so (storage change btf - base) + (outflow btf - base)
    should be ~0 if only the boundary changed; infiltration rate qinf (last state) is compared cell by cell;
  - negative depth (vol/area < -1 mm) and stability (NaN in wet cells, 15-min zs jumps) per run, from the map frames;
  - solver time from the two GitHub job logs (timestamps of the 5% progress lines; the map runtime is empty when the cap stops a run).
Wet = vol/area >= 0.0091 m (exporter rule). Frames where a cell is not wet are never counted as dry evidence. No NaN filling:
NaN zs in a wet cell is asserted absent.

  python -I compare_btf.py --wt . --btf <btf>/artifact/runs/current --base <base>/artifact/runs/current \
     --btf-log <btf GitHub job log> --base-log <base GitHub job log> --output <json>
"""
import argparse, gzip, json, math, sys
from pathlib import Path
import numpy as np, xarray as xr

p = argparse.ArgumentParser()
for k in ('--wt', '--btf', '--base', '--output'): p.add_argument(k, type=Path, required=True)
p.add_argument('--btf-log', type=Path); p.add_argument('--base-log', type=Path)
p.add_argument('--base-label', default='base B v3l-obsrain 42583445548')
a = p.parse_args(); WT = a.wt
sys.path.insert(0, str(WT / 'tools/sfincs/brawley/diagnose'))
_open = xr.open_dataset
xr.open_dataset = lambda *x, **k: _open(*x, **{'decode_times': False, **k})  # capped runs leave fill values in timemax
from stability_common import Geometry, TO_LL, TO_UTM, rst_time  # noqa: E402

DRY, G9 = 0.0091, 9.81
G = Geometry(a.btf)
Gb = Geometry(a.base, subgrid=False)
assert np.array_equal(G.msk, Gb.msk) and np.array_equal(G.nm, Gb.nm), 'meshes differ'


def read_rst(path):
    b = Path(path).read_bytes(); recs, i = [], 0
    while i < len(b):
        n = int(np.frombuffer(b[i:i + 4], '<i4')[0]); recs.append(b[i + 4:i + 4 + n]); i += 8 + n
    zs = np.frombuffer(recs[1], '<f4').astype(np.float64); q = np.frombuffer(recs[2], '<f4').astype(np.float64)[:G.NPUV]
    um = np.frombuffer(recs[3], '<f4').astype(np.float64) if len(recs) > 3 else None
    return zs, q, um


# ---- outflow cells, links, clusters
is3 = G.msk == 3; o3 = np.where(is3)[0]
L13 = np.where(is3[G.nm] ^ is3[G.nmu])[0]
lo3 = np.where(is3[G.nm[L13]], G.nm[L13], G.nmu[L13]); li = np.where(is3[G.nm[L13]], G.nmu[L13], G.nm[L13])
sg = np.where(is3[G.nmu[L13]], 1.0, -1.0)  # + = out of the model
lab = -np.ones(o3.size, int); c = 0
for s in range(o3.size):
    if lab[s] >= 0: continue
    st = [s]; lab[s] = c
    while st:
        j = st.pop(); d = np.hypot(G.xc[o3] - G.xc[o3[j]], G.yc[o3] - G.yc[o3[j]])
        for k in np.where((d <= 1500) & (lab < 0))[0]: lab[k] = c; st.append(k)
    c += 1
NC = c; cl_cell = np.full(G.NF, -1); cl_cell[o3] = lab; lcl = cl_cell[lo3]
cname = {}
for k in range(NC):
    cells = o3[lab == k]; lo, la = TO_LL.transform(float(G.xc[cells].mean()), float(G.yc[cells].mean()))
    cname[k] = f'cluster {k + 1} ({cells.size} cells, {lo:.3f} {la:.3f})'

# ---- restarts
def restarts(d):
    out = []
    for pth in sorted(Path(d).glob('sfincs.*.rst')):
        z, q, um = read_rst(pth); out.append((rst_time(pth), z, q, um))
    return out


R = {'btf': restarts(a.btf), 'base': restarts(a.base)}
assert [t for t, *_ in R['btf']] == [t for t, *_ in R['base']], 'restart times differ'
HOURS = [t for t, *_ in R['btf']]
flux = {}; speed = {}
for tag, rr in R.items():
    per = {cname[k]: {} for k in range(NC)}; tot = {}; vmax = {'ms': 0.0}
    umax = 0.0
    for t, z, q, um in rr:
        hu, _ = G.huv(z, L13)
        s_ = q[L13] * G.w[L13] * sg
        h_ = np.sqrt(G9 * np.maximum(hu, 0)) * np.maximum(z[li] - G.z_zmin[lo3], 0) * G.w[L13]
        if um is not None: umax = max(umax, float(np.abs(um).max()))
        with np.errstate(divide='ignore', invalid='ignore'):
            v = np.where(hu > 1e-3, np.abs(q[L13]) / hu, 0.0)
        j = int(np.argmax(v))
        if v[j] > vmax['ms']:
            vmax = {'ms': round(float(v[j]), 3), 'hour': t, 'qM2s': round(float(q[L13][j]), 4), 'huvM': round(float(hu[j]), 4),
                    'outflowFace': int(lo3[j]), 'cluster': cname[int(lcl[j])], 'lonlat': G.lonlat(int(lo3[j]))}
        for k in range(NC):
            m_ = lcl == k
            per[cname[k]][t[5:16]] = [round(float(s_[m_].sum()), 3), round(float(h_[m_].sum()), 3), round(float(v[m_].max()), 3)]
        tot[t[5:16]] = [round(float(s_.sum()), 3), round(float(h_.sum()), 3)]
    ss = {}
    for k in range(NC):
        hrs = per[cname[k]]; rat = [s / h for s, h, _ in hrs.values() if h > 0.5]
        ss[cname[k]] = {'storedMaxM3s': max(s for s, _, _ in hrs.values()), 'headDrivenMaxM3s': max(h for _, h, _ in hrs.values()),
                        'storedOverHeadRange_headGt0p5': [round(min(rat), 2), round(max(rat), 2)] if rat else None,
                        'storedVolumeM3': round(sum((x[0] + y[0]) / 2 * 3600 for x, y in zip(list(hrs.values())[:-1], list(hrs.values())[1:]))),
                        'headVolumeM3': round(sum((x[1] + y[1]) / 2 * 3600 for x, y in zip(list(hrs.values())[:-1], list(hrs.values())[1:]))),
                        'maxLinkSpeedMs': max(v for _, _, v in hrs.values()), 'hourly': hrs}
    flux[tag] = {'clusters': ss, 'allLinksHourly': tot, 'maxAbsUvmeanRecordM2s': round(umax, 6),
                 'allStoredVolumeM3': round(sum((x[0] + y[0]) / 2 * 3600 for x, y in zip(list(tot.values())[:-1], list(tot.values())[1:]))),
                 'allHeadVolumeM3': round(sum((x[1] + y[1]) / 2 * 3600 for x, y in zip(list(tot.values())[:-1], list(tot.values())[1:])))}
    speed[tag] = vmax

# ---- map frames (valid times only)
def mapd(d):
    m = xr.open_dataset(Path(d) / 'sfincs_map.nc')
    t = m['time'].values.astype(np.float64); ok = t < 1e30; assert ok[:ok.sum()].all(), 'fill value before a valid frame'
    ref = np.datetime64(m['time'].attrs['units'].split('since ')[1].replace(' ', 'T'))
    T = [str(ref + np.timedelta64(int(v), 's'))[:16] + 'Z' for v in t[ok]]
    zs = m['zs'].values[ok].astype(np.float64); vol = m['subgrid_volume'].values[ok].astype(np.float64); qinf = m['qinf'].values.astype(np.float64)
    m.close(); wet = (vol / G.area[None, :]) >= DRY
    assert not np.isnan(zs[wet]).any(), 'NaN zs in a wet cell'
    return T, zs, wet, vol, qinf


Tb, ZB, WB, VOLB, QIB = mapd(a.btf); Ta, ZA, WA, VOLA, QIA = mapd(a.base)
assert Tb == Ta, 'map frames differ'
both = WB & WA  # zs differences only where the cell is wet in both runs; wet in one only is counted separately
dz_both = np.where(both, np.abs(ZB - ZA), 0.0)
d3 = np.full(G.NF, np.inf)
for f in o3: d3 = np.minimum(d3, np.hypot(G.xc - G.xc[f], G.yc - G.yc[f]))
reach = {}
for lo_, hi_ in ((0, 100), (100, 250), (250, 600), (600, 1000), (1000, 2000), (2000, 5000), (5000, 1e9)):
    sel = (d3 >= lo_) & (d3 < hi_)
    mx = dz_both[:, sel].max(axis=0)
    reach[f'{int(lo_)}-{"inf" if hi_ > 1e8 else int(hi_)} m'] = {'cells': int(sel.sum()), 'maxAbsDzsBothWetM': round(float(mx.max()), 4),
        'cellsGt1mm': int((mx > 0.001).sum()), 'cellsGt1cm': int((mx > 0.01).sum()),
        'cellsWetInOneRunOnly': int(((WB ^ WA)[:, sel]).any(axis=0).sum())}
far = np.where(dz_both.max(axis=0) > 0.01)[0]
reachNote = {'farthestCellGt1cmM': round(float(d3[far].max()), 1) if far.size else None,
             'farthestCellGt1mmM': round(float(d3[np.where(dz_both.max(axis=0) > 0.001)[0]].max()), 1) if (dz_both.max(axis=0) > 0.001).any() else None}

# zs at outflow cells and the inside cell of each boundary link
inside = np.unique(li)
zsout = {}
for k in range(NC):
    cells = o3[lab == k]; ins = np.unique(li[lcl == k])
    def mx(Z, W, cc):
        v = np.where(W[:, cc], Z[:, cc], -np.inf).max(axis=0); return v
    zsout[cname[k]] = {
        'outflowCells': {'bedZminRangeM': [round(float(G.z_zmin[cells].min()), 3), round(float(G.z_zmin[cells].max()), 3)],
                         'maxZsMinusZminBtf': round(float(np.max(np.where(WB[:, cells], ZB[:, cells], -np.inf).max(axis=0) - G.z_zmin[cells])), 4) if WB[:, cells].any() else None,
                         'maxZsMinusZminBase': round(float(np.max(np.where(WA[:, cells], ZA[:, cells], -np.inf).max(axis=0) - G.z_zmin[cells])), 4) if WA[:, cells].any() else None,
                         'maxAbsDzsBothWetM': round(float(dz_both[:, cells].max()), 4)},
        'insideCells': {'n': int(ins.size), 'maxDepthAboveZminBtf': round(float(np.max(np.where(WB[:, ins], ZB[:, ins], -np.inf).max(axis=0) - G.z_zmin[ins])), 4) if WB[:, ins].any() else None,
                        'maxDepthAboveZminBase': round(float(np.max(np.where(WA[:, ins], ZA[:, ins], -np.inf).max(axis=0) - G.z_zmin[ins])), 4) if WA[:, ins].any() else None,
                        'maxZsBtfMinusBaseAtSameFrameM': round(float(np.max(np.where(both[:, ins], ZB[:, ins] - ZA[:, ins], -np.inf))), 4) if both[:, ins].any() else None,
                        'minZsBtfMinusBaseAtSameFrameM': round(float(np.min(np.where(both[:, ins], ZB[:, ins] - ZA[:, ins], np.inf))), 4) if both[:, ins].any() else None,
                        'framesWetBtf': int(WB[:, ins].any(axis=1).sum()), 'framesWetBase': int(WA[:, ins].any(axis=1).sum())}}

# ---- road stations within 600 m of an outflow cell
q0 = xr.open_dataset(a.btf / 'sfincs.nc'); level = q0['level'].values.astype(int); nn = q0['n'].values.astype(int); mm = q0['m'].values.astype(int); q0.close()
lookup = {(level[i], nn[i], mm[i]): i for i in range(G.NF)}; LV = sorted(set(level.tolist()))


def face_at(x, y):
    for L in LV:
        s = G.DX / 2.0 ** (L - 1); f = lookup.get((L, int(math.floor((y - G.Y0) / s)) + 1, int(math.floor((x - G.X0) / s)) + 1))
        if f is not None: return f
    return -1


stf = json.load(gzip.open(WT / 'tools/live/road-stations/brawley-avra-west-local-v2.json.gz'))['columns']
sx, sy = TO_UTM.transform(np.array(stf['lon']), np.array(stf['lat']))
sz = np.array([np.nan if v is None else v for v in stf['roadZ']], float); road = np.array(stf['road'])
dmin = np.full(sx.size, np.inf); dcl = np.full(sx.size, -1)
for f in o3:
    d = np.hypot(sx - G.xc[f], sy - G.yc[f]); b = d < dmin; dmin[b] = d[b]; dcl[b] = cl_cell[f]
near = np.where(dmin <= 600)[0]
stations = []
for s in near[np.argsort(dmin[near])]:
    f = face_at(sx[s], sy[s])
    rec = {'road': str(road[s]), 'lonlat': [round(float(stf['lon'][s]), 5), round(float(stf['lat'][s]), 5)], 'distanceM': round(float(dmin[s]), 1),
           'cluster': cname[int(dcl[s])], 'face': int(f), 'roadZ': None if np.isnan(sz[s]) else float(sz[s])}
    if f < 0 or np.isnan(sz[s]):
        rec['note'] = 'no mesh cell or no road height: not rated'; stations.append(rec); continue
    for tag, Z, W in (('btf', ZB, WB), ('base', ZA, WA)):
        w = W[:, f]; rec[f'{tag}EverWet'] = bool(w.any())
        rec[f'{tag}MaxZs'] = round(float(Z[w, f].max()), 4) if w.any() else None
        rec[f'{tag}Over'] = bool(w.any() and Z[w, f].max() > sz[s])
    rec['maxAbsDzsBothWetM'] = round(float(dz_both[:, f].max()), 4)
    rec['framesWetOneRunOnly'] = int((WB[:, f] ^ WA[:, f]).sum())
    stations.append(rec)
rated = [r for r in stations if 'note' not in r]
roads600 = {}
for r in rated:
    g = roads600.setdefault(r['road'], {'stations': 0, 'nearestM': r['distanceM'], 'everWetBtf': 0, 'everWetBase': 0, 'overBtf': 0, 'overBase': 0, 'maxAbsDzsM': 0.0})
    g['stations'] += 1; g['nearestM'] = min(g['nearestM'], r['distanceM']); g['everWetBtf'] += r['btfEverWet']; g['everWetBase'] += r['baseEverWet']
    g['overBtf'] += r['btfOver']; g['overBase'] += r['baseOver']; g['maxAbsDzsM'] = max(g['maxAbsDzsM'], r['maxAbsDzsBothWetM'])
stsum = {'within600m': len(stations), 'rated': len(rated), 'everWetBtf': sum(r['btfEverWet'] for r in rated), 'everWetBase': sum(r['baseEverWet'] for r in rated),
         'overBtf': sum(r['btfOver'] for r in rated), 'overBase': sum(r['baseOver'] for r in rated),
         'overStatusChanged': sum(r['btfOver'] != r['baseOver'] for r in rated), 'wetStatusChanged': sum(r['btfEverWet'] != r['baseEverWet'] for r in rated),
         'maxAbsDzsBothWetM': max((r['maxAbsDzsBothWetM'] for r in rated), default=None), 'byRoad': roads600}

# all stations domain-wide: over status change
allf = np.array([face_at(x, y) for x, y in zip(sx, sy)]); okd = (allf >= 0) & ~np.isnan(sz); ff = np.where(okd, allf, 0)
def over_of(Z, W):
    zt = np.where(W[:, ff], Z[:, ff], -np.inf).max(axis=0); return okd & (zt > sz), okd & W[:, ff].any(axis=0), zt
ob, wb, zb_ = over_of(ZB, WB); oa, wa, za_ = over_of(ZA, WA)
bothmax = okd & wb & wa
allst = {'rated': int(okd.sum()), 'overBtf': int(ob.sum()), 'overBase': int(oa.sum()), 'overChanged': int((ob ^ oa).sum()),
         'everWetBtf': int(wb.sum()), 'everWetBase': int(wa.sum()),
         'maxAbsMaxZsDiffM': round(float(np.abs(zb_[bothmax] - za_[bothmax]).max()), 4),
         'stationsMaxZsDiffGt1mm': int((np.abs(zb_[bothmax] - za_[bothmax]) > 0.001).sum()),
         'stationsMaxZsDiffGt1cm': int((np.abs(zb_[bothmax] - za_[bothmax]) > 0.01).sum())}
if allst['stationsMaxZsDiffGt1mm']:
    j = np.where(bothmax & (np.abs(zb_ - za_) > 0.001))[0]
    allst['farthestFromOutflowGt1mmM'] = round(float(dmin[j].max()), 1)
    allst['changedGt1mm'] = [{'road': str(road[s]), 'distanceM': round(float(dmin[s]), 1), 'dMaxZsM': round(float(zb_[s] - za_[s]), 4)} for s in j[np.argsort(dmin[j])][:25]]
chg = np.where(ob ^ oa)[0]
allst['overChangedList'] = [{'road': str(road[s]), 'distanceM': round(float(dmin[s]), 1), 'btfOver': bool(ob[s]), 'baseOver': bool(oa[s]),
                             'maxOverBtf': round(float(zb_[s] - sz[s]), 4), 'maxOverBase': round(float(za_[s] - sz[s]), 4)} for s in chg[:50]]

# ---- sections from the restarts (validate_extended.py SECTIONS, stair-step rule)
def section_links(lat, lon1, lon2):
    xa, ys = TO_UTM.transform(lon1, lat); xb, _ = TO_UTM.transform(lon2, lat)
    inband = (G.xc >= min(xa, xb)) & (G.xc <= max(xa, xb)); south = G.yc < ys; A = inband & south; B = inband & ~south
    l1 = np.where(A[G.nm] & B[G.nmu])[0]; l2 = np.where(B[G.nm] & A[G.nmu])[0]
    return np.concatenate([l1, l2]), np.concatenate([np.ones(l1.size), -np.ones(l2.size)])


SECTIONS = {'Donaldson Ranch (15877627)': (32.17568, -111.275, -111.245), 'Mile Wide Brawley 15877627 band': (32.24820, -111.262, -111.2475),
            'Mile Wide Black Wash 15876815 band (ALERT 6443)': (32.24820, -111.2475, -111.236), 'Mile Wide both bands': (32.24820, -111.262, -111.236),
            'Manville (15876771)': (32.29177, -111.285, -111.252), 'Tucker (15876711)': (32.33536, -111.300, -111.268)}
secl = {k: section_links(*v) for k, v in SECTIONS.items()}
SH = {}
for tag, rr in R.items():
    SH[tag] = {k: {t: round(float((q[ln] * G.w[ln] * sg_).sum()), 3) for t, _, q, _ in rr} for k, (ln, sg_) in secl.items()}
    SH[tag]['All outflow cells'] = {t: round(float((q[L13] * G.w[L13] * sg).sum()), 3) for t, _, q, _ in rr}
sections = {}
pk = lambda s_: {'m3s': max(s_.values()), 'time': max(s_, key=s_.get)}
for k in SH['btf']:
    b, s0 = SH['btf'][k], SH['base'][k]; dd = [abs(b[h] - s0[h]) for h in b]
    sections[k] = {'peakBtf': pk(b), 'peakBase': pk(s0), 'maxAbsHourlyDiffM3s': round(max(dd), 4), 'maxAbsHourlyDiffAt': list(b)[int(np.argmax(dd))],
                   'hourlyBtfBase': {h[5:16]: [b[h], s0[h]] for h in b}}

# ---- difference mass balance
FR = Tb; i18 = FR.index(HOURS[0]); iend = FR.index(HOURS[-1])
assert not np.isnan(VOLB).any() and not np.isnan(VOLA).any(), 'NaN subgrid_volume'
stor = {'btf': VOLB.sum(axis=1), 'base': VOLA.sum(axis=1)}
outv = {t: flux[t]['allStoredVolumeM3'] for t in flux}
dS = float(stor['btf'][iend] - stor['base'][iend]) - float(stor['btf'][i18] - stor['base'][i18]); dO = outv['btf'] - outv['base']
massBalance = {'storageM3': {t: {FR[0]: round(float(stor[t][0])), FR[i18]: round(float(stor[t][i18])), FR[iend]: round(float(stor[t][iend]))} for t in stor},
               'outflowAllLinksFromFirstRestartM3': outv,
               'storageChangeDiffBtfMinusBaseM3': round(dS), 'outflowDiffBtfMinusBaseM3': round(dO), 'sumShouldBeNearZeroM3': round(dS + dO),
               'storageDiffAtFirstFrameM3': round(float(stor['btf'][0] - stor['base'][0])),
               'qinfLastStateMaxAbsDiff': float(np.nanmax(np.abs(QIB - QIA))) if np.isfinite(QIB).any() else None,
               'note': 'rain, inflow and (cna) infiltration are the same inputs in both runs, so storage change + outflow should differ by ~0 between them; the outflow term is a trapezoid over hourly snapshots, so its sampling error has either sign. A whole-run balance with cumprcp/cuminf is not possible: the cap stopped both runs before SFINCS wrote them. subgrid_volume has no NaN (asserted)'}


def negstab(Z, W, VOL):
    va = VOL / G.area[None, :]; i, f = np.unravel_index(np.nanargmin(va), va.shape)
    with np.errstate(invalid='ignore'):
        dzz = np.where(W[1:] & W[:-1], np.abs(Z[1:] - Z[:-1]), 0.0)
    return {'minVolOverAreaM': round(float(va[i, f]), 6), 'frame': FR[i], 'face': int(f), 'cellsBelowMinus1mm': int((va < -0.001).any(axis=0).sum()),
            'framesBelowMinus1mm': int((va < -0.001).any(axis=1).sum()), 'nanZsWet': int(np.isnan(Z[W]).sum()), 'maxAbsDzs15minWetBoth': round(float(dzz.max()), 3)}


def solver_log(pth):
    if pth is None or not pth.exists(): return None
    import re
    txt = pth.read_text(encoding='utf-8', errors='replace')
    pts = [(int(m.group(2)), np.datetime64(m.group(1))) for m in re.finditer(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d+Z\s+(\d+)% complete', txt)]
    if not pts: return None
    t0 = pts[0][1]
    ex = re.search(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d+Z ##\[error\]Process completed with exit code (\d+)', txt)
    return {'elapsedSecondsAtPercent': {str(pc): int((t - t0) / np.timedelta64(1, 's')) for pc, t in pts},
            'stoppedAt': None if not ex else {'utc': ex.group(1) + 'Z', 'exitCode': int(ex.group(2)), 'elapsedSeconds': int((np.datetime64(ex.group(1)) - t0) / np.timedelta64(1, 's'))}}


# ---- ALERT 6443 (primary county series), score_v3l.py rules
BW, BB = 'Mile Wide Black Wash 15876815 band (ALERT 6443)', 'Mile Wide both bands'
gauges = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json').read_text(encoding='utf-8'))
GA = next(s for s in gauges['sensors'] if s['id'] == 'ALERT 6443')
obs = [(np.datetime64(r['timeUtc'][:19]), r['flowM3s']) for r in GA['series'] if r.get('flowM3s') is not None]
assert all(not math.isnan(v) for _, v in obs)
PL0, PL1, END18 = np.datetime64('2026-11-02T08:45:00'), np.datetime64('2026-11-02T16:20:00'), np.datetime64('2026-11-02T18:00:00')
END = np.datetime64(HOURS[-1][:16])  # last restart both capped runs reached


def otrap(t0, t1):
    o = [(t, v) for t, v in obs if t0 <= t <= t1]; assert o[0][0] == t0 and o[-1][0] == t1
    return float(sum((o[i][1] + o[i + 1][1]) / 2 * ((o[i + 1][0] - o[i][0]) / np.timedelta64(1, 's')) for i in range(len(o) - 1)))


gv = gauges['mileWideComparison']['volumeM3']
for st in ('16Z', '18Z'):  # the method reproduces the committed gauges.json numbers on the full window
    full = otrap(np.datetime64(f'2026-11-01T{st[:2]}:00:00'), END18); pl = otrap(PL0, PL1)
    assert abs(full - gv[f'observed{st}to18Z']) < 1.0 and abs(full - pl - gv[f'observed{st}to18ZWithoutPlateau']) < 1.0
PLE = min(PL1, END); plateau = otrap(PL0, PLE); ovol = {}
for st in ('16Z', '18Z'):
    full = otrap(np.datetime64(f'2026-11-01T{st[:2]}:00:00'), END); ovol[st] = {'withPlateau': full, 'withoutPlateau': full - plateau}
obs_at_hour = {str(t)[:16] + 'Z': v for t, v in obs}
in_pl = lambda h: PL0 <= np.datetime64(h[:16]) <= PL1
mvol = lambda s: float(sum((s[h] + s[h2]) / 2 * 3600 for h, h2 in zip(list(s)[:-1], list(s)[1:])))
OBSPEAK = GA['summaryTaskWindow']['max']['flowM3s']; OBS03 = obs_at_hour['2026-11-02T03:00Z']


def metrics(sec, excl):
    pr = [(obs_at_hour[h], sec[h]) for h in sec if h in obs_at_hour and not (excl and in_pl(h))]
    o = np.array([x for x, _ in pr]); m = np.array([y for _, y in pr]); assert not np.isnan(o).any() and not np.isnan(m).any()
    return {'hours': len(pr), 'nse': round(float(1 - ((m - o) ** 2).sum() / ((o - o.mean()) ** 2).sum()), 3), 'rmseM3s': round(float(np.sqrt(((m - o) ** 2).mean())), 3),
            'meanModelOverMeanObserved': round(float(m.mean() / o.mean()), 3)}


alert = {'observedSource': 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json ALERT 6443 primary county series (provisional, UTC)',
         'observedPeak': {'m3s': OBSPEAK, 'timeUtc': GA['summaryTaskWindow']['max']['timeUtc']}, 'observed03Z': OBS03,
         'plateau': {'fromUtc': '2026-11-02T08:45Z', 'toUtc': str(PLE)[:16] + 'Z', 'volumeM3': round(plateau), 'note': 'suspect low-stage rating step; without-plateau totals are a bracket, not a measurement'},
         'windowEnd': str(END)[:16] + 'Z',
         'note': 'both runs were stopped by the 7200 s execution cap; volumes and fits end at the last common restart, not 18Z Nov 2. Model flux from 18Z Nov 1 only; the 16Z-start ratio is a lower bound (model 16-18Z not in outputs, not filled)', 'runs': {}}
for tag in ('btf', 'base'):
    r = {}
    for band, key in (('blackWashBand', BW), ('bothBands', BB)):
        sec = SH[tag][key]; mv = mvol(sec); pk_ = sections[key]['peakBtf' if tag == 'btf' else 'peakBase']
        r[band] = {'peak': pk_, 'q03Z': round(sec['2026-11-02T03:00Z'], 3), 'ratio03Z': round(sec['2026-11-02T03:00Z'] / OBS03, 3),
                   'volumes': {f'{st}start{"" if pl == "withPlateau" else "NoPlateau"}': {'observedM3': round(ovol[st][pl]), 'modelM3': round(mv), 'ratio': round(mv / ovol[st][pl], 3)}
                               for st in ('16Z', '18Z') for pl in ('withPlateau', 'withoutPlateau')},
                   'hourlyFit18Zto18Z': {'withPlateau': metrics(sec, False), 'withoutPlateauHours': metrics(sec, True)}}
    alert['runs'][tag] = r

res = {'btfRun': str(a.btf), 'baseRun': str(a.base), 'baseLabel': a.base_label,
       'onlyInputDifference': 'sfincs.inp btfilter 60.0 (base) -> -1 (btf)',
       'rules': {'wet': f'vol/area >= {DRY} m', 'over': 'cell zs > roadZ in a wet frame', 'headDriven': 'sqrt(g*huv)*(zs_inside - z_zmin(outflow cell))*width',
                 'clusters': 'msk 3 cells single-linked within 1500 m', 'restarts': 'hourly instantaneous snapshots; they cannot show the flux between them',
                 'linkSpeed': '|q|/huv at msk1-msk3 links with huv > 1 mm (huv = subgrid flux depth); not a measured speed'},
       'msk3Cells': int(o3.size), 'linksMsk1Msk3': int(L13.size), 'restartHours': [HOURS[0], HOURS[-1], len(HOURS)],
       'boundaryFlux': flux, 'boundaryLinkMaxSpeed': speed, 'zsAtOutflowClusters': zsout,
       'roadStationsWithin600m': {'summary': stsum, 'stations': stations}, 'allRoadStations': allst,
       'zsChangeReach': {'byDistanceFromNearestOutflowCell': reach, **reachNote},
       'mapFrames': [FR[0], FR[-1], len(FR)], 'sections': sections, 'massBalance': massBalance,
       'negativeDepthAndStability': {'btf': negstab(ZB, WB, VOLB), 'base': negstab(ZA, WA, VOLA)},
       'solverTime': {'btf': solver_log(a.btf_log), 'base': solver_log(a.base_log)}, 'alert6443': alert}
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n'); print('ok', a.output)
