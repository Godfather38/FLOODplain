"""Score the brawley-avra-west v3l-obsrain run (base case B, SENSITIVITY): v2r observed rain + the v3 lobe-tip outflow only.

No model input is changed. Reads this run's hourly restarts and map file, the v2r run's (same rain, v2 boundaries), and the
validate_extended.py outputs of v3l, v2r (42555458619) and v3x (42567934972, v3 boundaries, HRRR rain). Writes:
  - outflow by boundary source, each its own series: the 47 v2 cells, inside them the 26 Outlet 720060498 cells, the 5 lobe-tip
    cells (reversed NHDPlus 15876709), all outflow cells (hourly restart flux, trapezoid volume from the first restart 18Z Nov 1);
  - the outlet pond (face 54135) and the lobe storage, v3l vs v2r;
  - ALERT 6443 against the PRIMARY county series (gauges.json): Black Wash band and both bands, with and without the suspect
    08:45-16:20Z Nov 2 plateau, observed windows starting 16Z and 18Z Nov 1;
  - sections, mass balance, negative depth, stability, roads from the validate_extended.py outputs, v3l vs v2r vs v3x.
Same restart reader and u/v order as validate_extended.py / score_v3x.py. Pond depth is zs - z_zmin (lowest sub-pixel), not a mean depth.

  python -I score_v3l.py --wt . --run <v3l>/runs/current --v2r <v2r>/runs/current --validation validation-full.json \
     --v2r-validation <v2r validation-full.json> --v3x-validation <v3x validation-full.json> --output summary.json
"""
import argparse, json, math
from pathlib import Path
import numpy as np, xarray as xr

p = argparse.ArgumentParser()
for k in ('--wt', '--run', '--v2r', '--validation', '--v2r-validation', '--v3x-validation', '--output'): p.add_argument(k, type=Path, required=True)
a = p.parse_args(); WT = a.wt
POND = 54135
LOBE = [54443, 54444, 54598, 54599, 54756]
BW, BB = 'Mile Wide Black Wash 15876815 band (ALERT 6443)', 'Mile Wide both bands'

q = xr.open_dataset(a.run / 'sfincs.nc')
X0, Y0, DX = float(q.attrs['x0']), float(q.attrs['y0']), float(q.attrs['dx'])
level = q['level'].values.astype(int); nidx = q['n'].values.astype(int); midx = q['m'].values.astype(int)
nb = {k: q[k].values.astype(np.int64) for k in ['mu', 'mu1', 'mu2', 'nu', 'nu1', 'nu2']}; q.close()
NF = level.size; size = DX / 2.0 ** (level - 1); xc = X0 + (midx - 0.5) * size; yc = Y0 + (nidx - 0.5) * size
uv_nm, uv_nmu = [], []
for c in range(NF):
    for fl, a1, a2 in [('mu', 'mu1', 'mu2'), ('nu', 'nu1', 'nu2')]:
        if nb[a1][c] > 0: uv_nm.append(c); uv_nmu.append(nb[a1][c] - 1)
        if nb[fl][c] >= 1 and nb[a2][c] > 0: uv_nm.append(c); uv_nmu.append(nb[a2][c] - 1)
uv_nm = np.array(uv_nm); uv_nmu = np.array(uv_nmu); uv_w = np.minimum(size[uv_nm], size[uv_nmu])
import pyproj
ox, oy = pyproj.Transformer.from_crs(4326, 32612, always_xy=True).transform(-111.2930, 32.3647)


def read_rst(path):
    b = path.read_bytes(); recs, i = [], 0
    while i < len(b):
        n = int(np.frombuffer(b[i:i + 4], '<i4')[0]); recs.append(b[i + 4:i + 4 + n]); i += 8 + n
    return np.frombuffer(recs[1], '<f4'), np.frombuffer(recs[2], '<f4')


def load(run):
    m = xr.open_dataset(run / 'sfincs_map.nc')
    out = dict(msk=m['msk'].values.astype(int), zb=m['zb'].values.astype(float), T=[str(t)[:16] + 'Z' for t in m['time'].values],
               zs=m['zs'].values.astype(float), vol=m['subgrid_volume'].values.astype(float))
    m.close(); return out


def group_links(msk, cells):
    sel = np.zeros(NF, bool); sel[cells] = True; is3 = msk == 3
    assert is3[cells].all(), 'a grouped cell is not an outflow cell in this run'
    ln = np.where((sel[uv_nm] & ~is3[uv_nmu]) | (sel[uv_nmu] & ~is3[uv_nm]))[0]
    return ln, np.where(sel[uv_nmu[ln]], 1.0, -1.0)


def score_run(run, mp, groups):
    rst = sorted(run.glob('sfincs.*.rst')); hours = []; series = {k: [] for k in groups}; vmax = {k: (0.0, None) for k in groups}; qmax = {k: (0.0, None) for k in groups}
    for pth in rst:
        zz, qq = read_rst(pth); h = pth.name.split('.')[1]; h = f'{h[:4]}-{h[4:6]}-{h[6:8]}T{pth.name.split(".")[2][:2]}:00Z'; hours.append(h)
        assert not np.isnan(qq).any(), f'NaN flux in {pth.name}'
        for k, (ln, sg) in groups.items():
            series[k].append(float((qq[ln] * uv_w[ln] * sg).sum()))
            d = np.maximum(zz[uv_nm[ln]], zz[uv_nmu[ln]]) - np.maximum(mp['zb'][uv_nm[ln]], mp['zb'][uv_nmu[ln]])
            aq = np.abs(qq[ln])
            if aq.size and aq.max() > qmax[k][0]: qmax[k] = (float(aq.max()), h)
            ok = d > 0.1
            if ok.any():
                v = aq[ok] / d[ok]
                if v.max() > vmax[k][0]: vmax[k] = (float(v.max()), h)
    vol = lambda s: float(sum((s[i] + s[i + 1]) / 2 * 3600 for i in range(len(s) - 1)))
    out = {}
    for k, s in series.items():
        out[k] = {'peakM3s': round(max(s), 3), 'peakTime': hours[int(np.argmax(s))], 'volumeFromFirstRestartM3': round(vol(s)),
                  'velocityProxyMaxMs': round(vmax[k][0], 3), 'velocityProxyAt': vmax[k][1],
                  'velocityProxyRule': '|q| / (max zs - max zb) of the two cells of each boundary link, only where that depth > 0.1 m (validate_extended.py rule); None if no link is that deep',
                  'maxUnitDischargeM2s': round(qmax[k][0], 3), 'maxUnitDischargeAt': qmax[k][1], 'hourlyM3s': dict(zip(hours, [round(v, 3) for v in s]))}
    return hours, out


def pond(mp):
    T = mp['T']; zs = mp['zs']; vol = mp['vol']; zb = mp['zb']
    lobe = (xc > 473600) & (yc > 3578000); near = np.hypot(xc - xc[POND], yc - yc[POND]) <= 1500.0
    z = np.where(np.isnan(zs[:, POND]), zb[POND], zs[:, POND])  # NaN zs = dry cell in the map output; the water surface is then the bed
    lv = [float(np.nansum(vol[i][lobe])) for i in range(len(T))]
    return {'face': POND, 'zZmin': round(float(zb[POND]), 3), 'zsMax': round(float(z.max()), 3), 'zsMaxTime': T[int(np.argmax(z))],
            'heightAboveZminMax': round(float(z.max() - zb[POND]), 3), 'zsEnd': round(float(z[-1]), 3), 'stillRisingAtEnd': bool(z[-1] > z[-2] + 1e-4),
            'lobeVolumeMaxM3': round(max(lv)), 'lobeVolumeMaxTime': T[int(np.argmax(lv))], 'lobeVolumeEndM3': round(lv[-1]),
            'storedWithin1p5kmEndM3': round(float(np.nansum(vol[-1][near]))),
            'lobeDefinition': 'cells with centre x > 473600 and y > 3578000 (EPSG:32612), as in BRAWLEY-OUTLET-POND-20261108.md',
            'hourly': {T[i][5:16]: {'zs': round(float(z[i]), 3), 'lobeVolumeM3': round(lv[i])} for i in range(0, len(T), 4)}}


mL = load(a.run); mR = load(a.v2r)
assert mL['T'] == mR['T'], 'frame times differ'
diff = np.flatnonzero(mL['msk'] != mR['msk'])
assert sorted(diff.tolist()) == LOBE and (mL['msk'][LOBE] == 3).all() and (mR['msk'][LOBE] == 1).all(), f'mask differs from v2r on {diff.tolist()}, expected the 5 lobe-tip faces'
v2cells = np.where(mR['msk'] == 3)[0]; out720 = v2cells[np.hypot(xc[v2cells] - ox, yc[v2cells] - oy) <= 2000.0]
GL = {'v2 outflow cells (47)': group_links(mL['msk'], v2cells), 'Outlet 720060498 (26 v2 cells within 2 km of the node)': group_links(mL['msk'], out720),
      'Lobe tip, reversed NHDPlus 15876709 (5 cells)': group_links(mL['msk'], LOBE), 'All outflow cells (52)': group_links(mL['msk'], np.where(mL['msk'] == 3)[0])}
GR = {'v2 outflow cells (47)': group_links(mR['msk'], v2cells), 'Outlet 720060498 (26 v2 cells within 2 km of the node)': group_links(mR['msk'], out720)}
hL, sL = score_run(a.run, mL, GL); hR, sR = score_run(a.v2r, mR, GR); assert hL == hR
VL, VR, VX = (json.loads(f.read_text(encoding='utf-8')) for f in (a.validation, a.v2r_validation, a.v3x_validation))
hours = list(VL['sectionsHourlyM3s'][BW])
assert hours == hL and hours == list(VR['sectionsHourlyM3s'][BW]) and hours == list(VX['sectionsHourlyM3s'][BW])

# ---------------- ALERT 6443 against the primary county series ----------------
gauges = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json').read_text(encoding='utf-8'))
G = next(s for s in gauges['sensors'] if s['id'] == 'ALERT 6443')
obs = [(np.datetime64(r['timeUtc'][:19]), r['flowM3s']) for r in G['series'] if r.get('flowM3s') is not None]
assert all(not math.isnan(v) for _, v in obs)
PL0, PL1 = np.datetime64('2026-11-02T08:45:00'), np.datetime64('2026-11-02T16:20:00')
END = np.datetime64('2026-11-02T18:00:00')


def otrap(t0, t1):  # trapezoid between primary reports, linear across report gaps (the gauges.json method; an assumption across the 16:20-18:00Z gap)
    o = [(t, v) for t, v in obs if t0 <= t <= t1]; assert o[0][0] == t0 and o[-1][0] == t1, 'window must start and end on a report'
    return float(sum((o[i][1] + o[i + 1][1]) / 2 * ((o[i + 1][0] - o[i][0]) / np.timedelta64(1, 's')) for i in range(len(o) - 1)))


plateau = otrap(PL0, PL1)
ovol = {}
for st in ('16Z', '18Z'):
    t0 = np.datetime64(f'2026-11-01T{st[:2]}:00:00'); full = otrap(t0, END); ovol[st] = {'withPlateau': full, 'withoutPlateau': full - plateau}
gv = gauges['mileWideComparison']['volumeM3']
for st in ('16Z', '18Z'):  # same numbers as the committed gauges.json
    assert abs(ovol[st]['withPlateau'] - gv[f'observed{st}to18Z']) < 1.0 and abs(ovol[st]['withoutPlateau'] - gv[f'observed{st}to18ZWithoutPlateau']) < 1.0
assert abs(plateau - gv['plateau0845to1620Z_Nov2']) < 1.0
mvol = lambda s: float(sum((s[h] + s[h2]) / 2 * 3600 for h, h2 in zip(list(s)[:-1], list(s)[1:])))
obs_at_hour = {str(t)[:16] + 'Z': v for t, v in obs}
in_plateau = lambda h: bool(PL0 <= np.datetime64(h[:16]) <= PL1)


def metrics(sec, exclude_plateau):
    pairs = [(obs_at_hour[h], sec[h]) for h in hours if h in obs_at_hour and not (exclude_plateau and in_plateau(h))]
    o = np.array([x for x, _ in pairs]); m = np.array([y for _, y in pairs]); assert not np.isnan(o).any() and not np.isnan(m).any()
    return {'hours': len(pairs), 'nse': round(float(1 - ((m - o) ** 2).sum() / ((o - o.mean()) ** 2).sum()), 3), 'rmseM3s': round(float(np.sqrt(((m - o) ** 2).mean())), 3),
            'meanModelOverMeanObserved': round(float(m.mean() / o.mean()), 3), 'maxAbsErrorM3s': round(float(np.abs(m - o).max()), 3)}


def first_reach(sec, thr):
    s = [sec[h] for h in hours]
    for j in range(1, len(s)):
        if s[j - 1] < thr <= s[j]:
            return str(np.datetime64(hours[j - 1][:16]) + np.timedelta64(int(round((thr - s[j - 1]) / (s[j] - s[j - 1]) * 60)), 'm')) + 'Z'
    return None


OBSPEAK = G['summaryTaskWindow']['max']['flowM3s']; OBS03 = obs_at_hour['2026-11-02T03:00Z']
alert = {'observedSource': 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json, ALERT 6443 primary county series (provisional, UTC)',
         'gaugeNaming': 'NHD snap Black Wash 15876815 (4.8 m); county name Brawley Wash at Milewide Road. Which band the gauge sees is not settled, so both are scored',
         'observedPeak': {'m3s': OBSPEAK, 'timeUtc': G['summaryTaskWindow']['max']['timeUtc']}, 'observed03Z': OBS03,
         'plateau': {'fromUtc': '2026-11-02T08:45Z', 'toUtc': '2026-11-02T16:20Z', 'volumeM3': round(plateau),
                     'note': 'suspect low-stage rating step (gauges.json lowStageRatingCaveat). Without-plateau totals are a bracket, not a measurement: if it is an artifact the true flow then is unknown, not zero'},
         'modelWindowNote': 'model hourly restart flux exists from 18Z Nov 1 only (no his file; first restart 18Z). For the 16Z observed start the model volume is still 18Z-18Z, so that ratio is a LOWER bound on the model/observed ratio; model flow 16-18Z is not in the outputs and is not filled',
         'observedVolumeMethod': 'trapezoid between primary reports, linear across the 16:20-18:00Z Nov 2 gap (gauges.json method); equals gauges.json mileWideComparison.volumeM3',
         'runs': {}}
for tag, V in (('v3l', VL), ('v2r', VR), ('v3x', VX)):
    r = {}
    for band, key in (('blackWashBand', BW), ('bothBands', BB)):
        sec = V['sectionsHourlyM3s'][key]; mv = mvol(sec); pk = V['sectionPeaks'][key]
        vols = {f'{st}start{"" if pl == "withPlateau" else "NoPlateau"}': {'observedM3': round(ovol[st][pl]), 'modelM3': round(mv), 'ratio': round(mv / ovol[st][pl], 3),
                                                                          **({'ratioIsLowerBound': True} if st == '16Z' else {})}
                for st in ('16Z', '18Z') for pl in ('withPlateau', 'withoutPlateau')}
        r[band] = {'peak': pk, 'peakOverObservedPeak': round(pk['m3s'] / OBSPEAK, 3),
                   'peakLagHoursAfterObserved1820Z': round(float((np.datetime64(pk['time'][:16]) - np.datetime64('2026-11-01T18:20')) / np.timedelta64(1, 'm')) / 60, 2),
                   'q03Z': round(sec['2026-11-02T03:00Z'], 3), 'ratio03Z': round(sec['2026-11-02T03:00Z'] / OBS03, 3), 'q18Z_Nov1': round(sec['2026-11-01T18:00Z'], 3), 'q19Z_Nov1': round(sec['2026-11-01T19:00Z'], 3),
                   'firstReachObserved03Z': first_reach(sec, OBS03), 'firstReachObservedPeak': first_reach(sec, OBSPEAK), 'volumes': vols,
                   'hourlyFitAtReportHours18Zto18Z': {'withPlateau': metrics(sec, False), 'withoutPlateauHours': metrics(sec, True)}}
    alert['runs'][tag] = r
alert['hourlyFitNote'] = 'only hours with a primary report exactly on the hour (no interpolation, no carried-forward report); 16Z and 17Z Nov 1 have reports but no model value, so the hourly fit starts at 18Z for both window choices'
alert['hourly'] = [{'hourUtc': h, 'observedM3s': obs_at_hour.get(h), 'inPlateau': in_plateau(h),
                    **{f'{t}{b}': round(V['sectionsHourlyM3s'][k][h], 3) for t, V in (('v3l', VL), ('v2r', VR), ('v3x', VX)) for b, k in (('BlackWash', BW), ('Both', BB))}} for h in hours]

SEC = ['Donaldson Ranch (15877627)', BW, BB, 'Manville (15876771)', 'Tucker (15876711)', 'Outlet 720060498 (outflow links)', 'All outflow cells']
sections = {k: {'v3l': VL['sectionPeaks'][k], 'v2r': VR['sectionPeaks'][k], 'v3x': VX['sectionPeaks'][k],
                'maxAbsHourlyDiffVsV2rM3s': round(max(abs(VL['sectionsHourlyM3s'][k][h] - VR['sectionsHourlyM3s'][k][h]) for h in hours), 3),
                'q18Z': {t: V['sectionsHourlyM3s'][k]['2026-11-02T18:00Z'] for t, V in (('v3l', VL), ('v2r', VR), ('v3x', VX))}} for k in SEC}
roads = []
for kind in ('crossings', 'dips'):
    for rl, rr, rx in zip(VL[kind], VR[kind], VX[kind]):
        assert rl['label'] == rr['label'] == rx['label']
        roads.append({'kind': kind[:-1], 'label': rl['label'], 'maxOverV3l': rl['maxOver'], 'maxOverV2r': rr['maxOver'], 'maxOverV3x': rx['maxOver'],
                      'changeVsV2r': None if rl['maxOver'] is None or rr['maxOver'] is None else round(rl['maxOver'] - rr['maxOver'], 3),
                      'timeV3l': rl.get('maxWseTime'), 'firstOverV3l': rl.get('firstOver'), 'lastOverV3l': rl.get('lastOver')})
res = {'label': 'SENSITIVITY run, base case B v3l-obsrain; not tuned to observations, not for live registration',
       'runs': {'v3l': str(a.run), 'v2r': str(a.v2r), 'v3xValidation': str(a.v3x_validation)}, 'frames': len(mL['T']),
       'maskCheck': {'facesDifferingFromV2r': diff.tolist(), 'outflowCellsV3l': int((mL['msk'] == 3).sum()), 'outflowCellsV2r': int((mR['msk'] == 3).sum())},
       'outflowBySourceV3l': sL, 'outflowBySourceV2r': sR, 'pond': {'v3l': pond(mL), 'v2r': pond(mR)}, 'alert6443': alert, 'sections': sections,
       'massBalance': {t: V['balanceInputsWholeRunOutflowFromFirstRestart'] for t, V in (('v3l', VL), ('v2r', VR), ('v3x', VX))},
       'outflowBeforeFirstRestart': VL['outflowBeforeFirstRestart'],
       'negativeDepth': {t: V['negativeDepth'] for t, V in (('v3l', VL), ('v2r', VR), ('v3x', VX))},
       'stability': {t: V['stability'] for t, V in (('v3l', VL), ('v2r', VR), ('v3x', VX))},
       'roads': roads, 'stationsOverTotal': {t: V['stationsOverTotal'] for t, V in (('v3l', VL), ('v2r', VR), ('v3x', VX))},
       'notes': ['v3x has the HRRR rain (v2x forcing); v3l and v2r have all-observed Stage IV rain. v3l vs v2r isolates the lobe-tip boundary; v3l vs v3x mixes rain and the NW OSM outfalls',
                 'Outflow before the first hourly restart (18Z Nov 1) is not in the outputs (no his file); volumes are from 18Z Nov 1',
                 'Road comparisons are cell zs vs station roadZ in wet frames only (validate_extended.py); frames that are not wet are never dry evidence',
                 'Pond height is zs minus the lowest sub-pixel (z_zmin) of the cell, not a mean or surveyed depth']}
a.output.write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n')
print('ok', a.output)
