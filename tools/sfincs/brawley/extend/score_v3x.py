"""Score the brawley-avra-west v3x run (v3 boundaries) against the v2x run (v2 boundaries). No model input is changed.

Reads both runs' hourly restarts and map files plus their validate_extended.py outputs, and writes:
  - outflow by boundary source, each its own series: the 47 v2 cells (and inside them the Outlet 720060498 cells),
    the 15876709 lobe tip, OSM 1489567542 and OSM 1489567547 (hourly restart flux, trapezoid volume from the first restart);
  - the outlet pond (face 54135) water surface and depth, and the lobe storage (x > 473600, y > 3578000) every hour;
  - sections (Mile Wide, Manville, Tucker, outlet) and ALERT 6443 against the primary county series, v3x vs v2x;
  - mass balance, negative depth, stability and velocity proxies (domain and at outflow links), road over-topping changes.
Same restart reader and u/v order as validate_extended.py. Depth is zs - z_zmin of the cell (lowest sub-pixel), not a mean depth.

  python -I tools/sfincs/brawley/extend/score_v3x.py --wt . --v3 <v3x>/runs/current --v2x <v2x>/runs/current \
     --v3-validation <v3x validation-full.json> --v2x-validation <v2x validation-full.json> --output <summary.json>
"""
import argparse, json, math
from pathlib import Path
import numpy as np, pyproj, xarray as xr

p = argparse.ArgumentParser()
for k in ('--wt', '--v3', '--v2x', '--v3-validation', '--v2x-validation', '--output'): p.add_argument(k, type=Path, required=True)
a = p.parse_args(); WT = a.wt
TO_UTM = pyproj.Transformer.from_crs(4326, 32612, always_xy=True); TO_LL = pyproj.Transformer.from_crs(32612, 4326, always_xy=True)
POND = 54135

q = xr.open_dataset(a.v3 / 'sfincs.nc')
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

place = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/boundaries-v3/boundary-placement.json').read_text(encoding='utf-8'))
src = {r['face']: r['sources'] for r in place['outflowCellSources']}
rep = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/boundaries-v3/placement-report.json').read_text(encoding='utf-8'))
newcells = {k: [c['face'] for c in v['cells']] for k, v in rep['newCellsBySource'].items()}
ox, oy = TO_UTM.transform(-111.2930, 32.3647)


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
    ln = np.where((sel[uv_nm] & ~is3[uv_nmu]) | (sel[uv_nmu] & ~is3[uv_nm]))[0]
    return ln, np.where(sel[uv_nmu[ln]], 1.0, -1.0)


def score_run(run, mp, groups):
    rst = sorted(run.glob('sfincs.*.rst')); hours = []; series = {k: [] for k in groups}; vmax = {k: (0.0, None) for k in groups}
    vshallow = {k: (0.0, None, None) for k in groups}; qmax = {k: (0.0, None) for k in groups}
    zsl = {}
    for pth in rst:
        zz, qq = read_rst(pth); h = pth.name.split('.')[1]; h = f'{h[:4]}-{h[4:6]}-{h[6:8]}T{pth.name.split(".")[2][:2]}:00Z'; hours.append(h)
        for k, (ln, sg) in groups.items():
            series[k].append(float((qq[ln] * uv_w[ln] * sg).sum()))
            d = np.maximum(zz[uv_nm[ln]], zz[uv_nmu[ln]]) - np.maximum(mp['zb'][uv_nm[ln]], mp['zb'][uv_nmu[ln]])
            aq = np.abs(qq[ln]); j = int(np.argmax(aq)) if aq.size else 0
            if aq.size and aq[j] > qmax[k][0]: qmax[k] = (float(aq[j]), h)
            ok1 = d > 0.01
            if ok1.any():
                v = aq[ok1] / d[ok1]; j = int(np.argmax(v))
                if v[j] > vshallow[k][0]: vshallow[k] = (float(v[j]), h, float(d[ok1][j]))
            ok = d > 0.1
            if ok.any():
                v = np.abs(qq[ln][ok]) / d[ok]; j = int(np.argmax(v))
                if v[j] > vmax[k][0]: vmax[k] = (float(v[j]), h)
    vol = lambda s: float(sum((s[i] + s[i + 1]) / 2 * 3600 for i in range(len(s) - 1)))
    out = {}
    for k, s in series.items():
        out[k] = {'peakM3s': round(max(s), 3), 'peakTime': hours[int(np.argmax(s))], 'volumeFromFirstRestartM3': round(vol(s)),
                  'velocityProxyMaxMs': round(vmax[k][0], 3), 'velocityProxyAt': vmax[k][1],
                  'velocityProxyRule': '|q| / (max zs - max zb) of the two cells of each boundary link, only where that depth > 0.1 m (validate_extended.py rule)',
                  'shallowVelocityProxyMaxMs': round(vshallow[k][0], 3), 'shallowVelocityProxyAt': vshallow[k][1], 'shallowVelocityProxyDepthM': None if vshallow[k][2] is None else round(vshallow[k][2], 3),
                  'shallowRule': 'same proxy with a 0.01 m depth floor; zs - z_zmin of a subgrid cell is not the flow depth at the u/v point, so this overstates speed in thin sheets',
                  'maxUnitDischargeM2s': round(qmax[k][0], 3), 'maxUnitDischargeAt': qmax[k][1], 'hourlyM3s': dict(zip(hours, [round(v, 3) for v in s]))}
    return hours, out


def pond(mp):
    T = mp['T']; zs = mp['zs']; vol = mp['vol']; zb = mp['zb']
    lobe = (xc > 473600) & (yc > 3578000); near = np.hypot(xc - xc[POND], yc - yc[POND]) <= 1500.0
    z = np.where(np.isnan(zs[:, POND]), zb[POND], zs[:, POND])
    hourly = {T[i][5:16]: {'zs': round(float(z[i]), 3), 'depthAboveZmin': round(float(z[i] - zb[POND]), 3), 'lobeVolumeM3': round(float(np.nansum(vol[i][lobe])))} for i in range(0, len(T), 4)}
    return {'face': POND, 'zZmin': round(float(zb[POND]), 3), 'zsMax': round(float(z.max()), 3), 'zsMaxTime': T[int(np.argmax(z))], 'depthMaxAboveZmin': round(float(z.max() - zb[POND]), 3),
            'zsEnd': round(float(z[-1]), 3), 'stillRisingAtEnd': bool(z[-1] > z[-2] + 1e-4), 'lobeVolumeEndM3': round(float(np.nansum(vol[-1][lobe]))),
            'lobeVolumeMaxM3': round(float(max(np.nansum(vol[i][lobe]) for i in range(len(T))))), 'storedWithin1p5kmEndM3': round(float(np.nansum(vol[-1][near]))),
            'lobeDefinition': 'cells with centre x > 473600 and y > 3578000 (EPSG:32612), as in BRAWLEY-OUTLET-POND-20261108.md', 'hourly': hourly}


m3 = load(a.v3); m2 = load(a.v2x)
assert m3['T'] == m2['T'], 'frame times differ'
v2cells = np.where(m2['msk'] == 3)[0]; out720 = v2cells[np.hypot(xc[v2cells] - ox, yc[v2cells] - oy) <= 2000.0]
G3 = {'v2 outflow cells (47)': group_links(m3['msk'], v2cells), 'Outlet 720060498 (26 v2 cells within 2 km of the node)': group_links(m3['msk'], out720)}
for k, cells in newcells.items(): G3[f'v3 new: {k} ({len(cells)} cells)'] = group_links(m3['msk'], cells)
G3['All outflow cells'] = group_links(m3['msk'], np.where(m3['msk'] == 3)[0])
G2 = {'v2 outflow cells (47)': group_links(m2['msk'], v2cells), 'Outlet 720060498 (26 v2 cells within 2 km of the node)': group_links(m2['msk'], out720)}
h3, s3 = score_run(a.v3, m3, G3); h2, s2 = score_run(a.v2x, m2, G2)
V3 = json.loads(a.v3_validation.read_text(encoding='utf-8')); V2 = json.loads(a.v2x_validation.read_text(encoding='utf-8'))
SEC = ['Mile Wide Black Wash 15876815 band (ALERT 6443)', 'Mile Wide both bands', 'Manville (15876771)', 'Tucker (15876711)', 'Outlet 720060498 (outflow links)', 'All outflow cells']
sections = {}
for k in SEC:
    s_3, s_2 = V3['sectionsHourlyM3s'][k], V2['sectionsHourlyM3s'][k]
    sections[k] = {'v3x': V3['sectionPeaks'][k], 'v2x': V2['sectionPeaks'][k], 'q18Z_v3x': s_3['2026-11-02T18:00Z'], 'q18Z_v2x': s_2['2026-11-02T18:00Z'],
                   'maxAbsHourlyDiffM3s': round(max(abs(s_3[h] - s_2[h]) for h in s_3), 3), 'hourlyV3x': s_3}
al3, al2 = V3['alert6443'], V2['alert6443']
alert = {'observedSource': al3['observedSource'], 'observedPeaks': 'primary series: 64.7 m3/s at 18:20Z Nov 1, 42.0 at 21:45Z, 25.7 at 02:10Z Nov 2 (gauges.json summaryTaskWindow)',
         'observed03Z': al3['observed03Z'], 'model03Z': {'v3x': al3['model03Z'], 'v2x': al2['model03Z']}, 'ratio03Z': {'v3x': al3['ratio03Z'], 'v2x': al2['ratio03Z']},
         'modelPeak': {'v3x': al3['modelPeak'], 'v2x': al2['modelPeak']},
         'modelFirstAtObserved03Z': {'v3x': al3['modelFirstAtObserved03Z'], 'v2x': al2['modelFirstAtObserved03Z']},
         'hourly': [{'hourUtc': r['hourUtc'], 'observed': r['observed'], 'v3xBlackWash': r['modelBlackWashBandM3s'], 'v3xBoth': r['modelBothBandsM3s'],
                     'v2xBlackWash': r2['modelBlackWashBandM3s'], 'v2xBoth': r2['modelBothBandsM3s']} for r, r2 in zip(al3['hourly'], al2['hourly'])]}
gauges = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json').read_text(encoding='utf-8'))
obs = [(r['timeUtc'], r['flowM3s']) for s_ in gauges['sensors'] if s_['id'] == 'ALERT 6443' for r in s_['series'] if r.get('flowM3s') is not None]
o = [(np.datetime64(t[:19]), v) for t, v in obs if '2026-11-01T18:00' <= t[:16] <= '2026-11-02T18:00']
ovol = float(sum((o[i][1] + o[i + 1][1]) / 2 * (o[i + 1][0] - o[i][0]) / np.timedelta64(1, 's') for i in range(len(o) - 1)))
mvol = lambda s: float(sum((s[h] + s[h2]) / 2 * 3600 for h, h2 in zip(list(s)[:-1], list(s)[1:])))
alert['volume18Zto18Z'] = {'observedM3': round(ovol), 'observedNote': 'trapezoid between primary reports 18Z Nov 1..18Z Nov 2 (last report 16:20Z; 100-min gap to 18Z not filled); low-stage rating step makes the 08:45-16:20Z plateau suspect',
                           'v3xBlackWashM3': round(mvol(V3['sectionsHourlyM3s'][SEC[0]])), 'v3xBothM3': round(mvol(V3['sectionsHourlyM3s'][SEC[1]])),
                           'v2xBlackWashM3': round(mvol(V2['sectionsHourlyM3s'][SEC[0]])), 'v2xBothM3': round(mvol(V2['sectionsHourlyM3s'][SEC[1]]))}
roads = []
for kind in ('crossings', 'dips'):
    for r3, r2 in zip(V3[kind], V2[kind]):
        assert r3['label'] == r2['label']
        roads.append({'kind': kind[:-1], 'label': r3['label'], 'maxOverV3x': r3['maxOver'], 'maxOverV2x': r2['maxOver'],
                      'change': None if r3['maxOver'] is None or r2['maxOver'] is None else round(r3['maxOver'] - r2['maxOver'], 3),
                      'timeV3x': r3.get('maxWseTime'), 'lastOverV3x': r3.get('lastOver'), 'stationsOverV3x': r3.get('stationsOver'), 'stationsOverV2x': r2.get('stationsOver')})
# road stations whose cell is now an outflow cell (outflow cells hold zs at the bed, so these stations can no longer be scored)
import gzip
st = json.load(gzip.open(WT / 'tools/live/road-stations/brawley-avra-west-local-v2.json.gz'))['columns']
ssx, ssy = TO_UTM.transform(np.array(st['lon']), np.array(st['lat'])); sroad = np.array(st['road'])
lookup = {(level[i], nidx[i], midx[i]): i for i in range(NF)}; LEV = sorted(set(level.tolist()))


def face_at(x, y):
    for L in LEV:
        s_ = DX / 2.0 ** (L - 1); f = lookup.get((L, int(math.floor((y - Y0) / s_)) + 1, int(math.floor((x - X0) / s_)) + 1))
        if f is not None: return f
    return -1


sface = np.array([face_at(x, y) for x, y in zip(ssx, ssy)])
stations_new3 = {}
for k, cells in newcells.items():
    idx = np.flatnonzero(np.isin(sface, cells))
    stations_new3[k] = {'stations': int(idx.size), 'roads': sorted(set(sroad[idx].tolist())), 'faces': sorted(set(int(f) for f in sface[idx]))}
res = {'roadStationsInNewOutflowCells': stations_new3, 'runs': {'v3x': str(a.v3), 'v2x': str(a.v2x)}, 'frames': len(m3['T']),
       'outflowBySourceV3x': {k: v for k, v in s3.items()}, 'outflowV2x': {k: v for k, v in s2.items()},
       'pond': {'v3x': pond(m3), 'v2x': pond(m2)}, 'sections': sections, 'alert6443': alert,
       'massBalance': {'v3x': V3['balanceInputsWholeRunOutflowFromFirstRestart'], 'v2x': V2['balanceInputsWholeRunOutflowFromFirstRestart']},
       'negativeDepth': {'v3x': V3['negativeDepth'], 'v2x': V2['negativeDepth']}, 'stability': {'v3x': V3['stability'], 'v2x': V2['stability']},
       'outflowClustersV3x': V3['outflowClusters'],
       'roads': roads, 'stationsOverTotal': {'v3x': V3['stationsOverTotal'], 'v2x': V2['stationsOverTotal']},
       'stationsOverByCell': {'v3x': V3['stationsOverByCell'], 'v2x': V2['stationsOverByCell']},
       'notes': ['Tucker and Manville have no observed gauge in the primary data set; only ALERT 6443 (Mile Wide) is an observed flow point in the domain',
                 'Outflow before the first hourly restart (18Z Nov 1) is not in the outputs (no his file); volumes are from 18Z Nov 1',
                 'Depth at the pond is zs minus the lowest sub-pixel (z_zmin) of a 100 m cell, not a mean or surveyed depth']}
a.output.write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n')
print('ok', a.output)
