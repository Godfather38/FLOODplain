"""Pre-run validation checks for brawley-avra-west (no solver result exists). Read-only.
Run with cwd = E:/FloodPLAIN/wt-model."""
import csv, gzip, io, json, math, subprocess, sys, time
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np
import xarray as xr
import shapely
from shapely.geometry import shape
from pyproj import Transformer

t0 = time.time()
sys.path.insert(0, 'tools/live')
import build_local_road_stations as bl

OUT = Path(sys.argv[1])
C = Path('tools/sfincs/data/brawley-avra-west-v1')
TOPO = Path('tools/sfincs/data/all-route-ready-v3/topology-version3')
R = {}
to_utm = Transformer.from_crs(4326, 32612, always_xy=True)

# ---------- mesh lookup ----------
ds = xr.open_dataset('.sfincs-runs/brawley-avra-west-mesh-v1/active-refinement-mesh.nc')
x0, y0 = float(ds.attrs['x0']), float(ds.attrs['y0'])
fn = ds['mesh2d_face_nodes'].values
nx, ny = ds['mesh2d_node_x'].values, ds['mesh2d_node_y'].values
lev = ds['level'].values.astype(int)
valid = ~np.isnan(fn)
idx = np.where(valid, fn, 0).astype(np.int64)
start = int(ds['mesh2d_face_nodes'].attrs.get('start_index', 0))
idx = idx - start
fx = np.where(valid, nx[idx], np.inf).min(1); fy = np.where(valid, ny[idx], np.inf).min(1)
fxM = np.where(valid, nx[idx], -np.inf).max(1)
size = 100.0 / 2 ** (lev - 1)
assert np.allclose(fxM - fx, size), 'face width != level size'
lut = {}
for f in range(len(lev)):
    lut[(lev[f], int(round((fx[f] - x0) / size[f])), int(round((fy[f] - y0) / size[f])))] = f
R['mesh'] = {'faces': int(len(lev)), 'levelCounts': {int(k): int(v) for k, v in zip(*np.unique(lev, return_counts=True))},
             'start_index': start}


def cell_of(lon, lat):
    x, y = to_utm.transform(lon, lat)
    for L in range(5, 0, -1):
        s = 100.0 / 2 ** (L - 1)
        f = lut.get((L, int(math.floor((x - x0) / s)), int(math.floor((y - y0) / s))))
        if f is not None:
            return f, s
    return None, None


# ---------- domains ----------
dom = bl.domain_geometry(TOPO / 'brawley-avra-west-domain.geojson')
live = {p: bl.domain_geometry(TOPO / f'{p}-domain.geojson') for p in ('northern', 'picture-rocks-ina-twinpeaks', 'gates')}
for g in [dom, *live.values()]:
    shapely.prepare(g)

# ---------- L4 points / CSV dips -> cell size ----------
l4 = json.loads((C / 'components/l4-window-points.geojson').read_text())['features']
rows = []
for f in l4:
    p = f['properties']; fid, s = cell_of(p['lon'], p['lat'])
    rows.append({**p, 'cellM': s, 'face': fid})
R['l4'] = {'n': len(rows), 'byKind': Counter(r['kind'] for r in rows),
           'cellSizes': Counter(str(r['cellM']) for r in rows),
           'notFinest': [r for r in rows if r['cellM'] != 6.25]}
dips_csv = subprocess.run(['git', 'show', 'origin/experimental/model-upgrade-diagnostics-20261107:docs/upgrade/candidate-road-dips-20261107.csv'],
                          check=True, capture_output=True, text=True).stdout
csvd = list(csv.DictReader(io.StringIO(dips_csv)))
inside = []
for d in csvd:
    lon, lat = float(d['lon']), float(d['lat']); pt = shapely.points(lon, lat)
    if shapely.covers(dom, pt):
        fid, s = cell_of(lon, lat)
        inside.append({'road': d['road_name'], 'depth': float(d['dip_depth_m']), 'lon': lon, 'lat': lat, 'cellM': s,
                       'liveDomains': [k for k, g in live.items() if shapely.covers(g, pt)],
                       'finestLive': d.get('finest_live_model_cell_m')})
R['csvDips'] = {'csvRows': len(csvd), 'insideNewDomain': len(inside),
                'insideNewOutsideLive': sum(not r['liveDomains'] for r in inside),
                'cellSizesOutsideLive': Counter(str(r['cellM']) for r in inside if not r['liveDomains']),
                'cellSizesInLiveOverlap': Counter(str(r['cellM']) for r in inside if r['liveDomains']),
                'overlapRows': [r for r in inside if r['liveDomains']]}

# ---------- local stations: cell size, no-height, no-cell ----------
st = json.load(gzip.open('tools/live/road-stations/brawley-avra-west-local.json.gz'))
cols = st['columns']
n = len(cols['id']); sizes = []; nocell = []
for i in range(n):
    fid, s = cell_of(cols['lon'][i], cols['lat'][i])
    sizes.append(s)
    if fid is None:
        nocell.append(cols['id'][i])
nh = [cols['id'][i] for i in range(n) if cols['roadZ'][i] is None]
R['stations'] = {'n': n, 'noHeight': len(nh), 'noHeightIds': nh, 'noCell': len(nocell), 'noCellSample': nocell[:20],
                 'cellSizes': Counter(str(s) for s in sizes),
                 'declaredCounts': st['selection']['counts']}
# priority-road station cell size
PRI = ['Sandario', 'Manville', 'Avra Valley', 'Anway', 'Mile Wide', 'Snyder Hill', 'Nelson Quihuis', 'Garcia Ranch',
       'Cocorague', 'Agua Dulce', 'Tucker']
def pri_of(name):
    for p in PRI:
        if name and p.lower() in name.lower():
            return p
    return None
pc = defaultdict(Counter)
for i in range(n):
    p = pri_of(cols['road'][i])
    if p:
        pc[p][str(sizes[i])] += 1
R['stationCellByPriorityRoad'] = pc

# ---------- coverage criterion over all tile stations ----------
commit = subprocess.run(['git', 'rev-parse', bl.DEFAULT_REF], check=True, capture_output=True, text=True).stdout.strip()
man = json.loads(bl.git_blob(commit, f'{bl.PACKAGE_DIR}/manifest.json'))
cov = defaultdict(lambda: Counter())
for t in [f for f in man['files'] if f.get('tier') == 'area']:
    raw = bl.git_blob(commit, f"{bl.PACKAGE_DIR}/{t['path']}")
    assert bl.sha(raw) == t['sha256']
    _, lines = bl.decode_tile(raw)
    for line in lines:
        p = pri_of(line['name'])
        if not p or not len(line['lon']):
            continue
        pts = shapely.points(line['lon'], line['lat'])
        inl = np.zeros(len(pts), bool)
        for g in live.values():
            inl |= shapely.covers(g, pts)
        inn = shapely.covers(dom, pts)
        # restrict "priority area" to west Avra Valley box (lon <= -111.15) to avoid same-named roads elsewhere
        box = (line['lon'] <= -111.15) & (line['lat'] >= 31.9) & (line['lat'] <= 32.45)
        c = cov[p]
        c['total'] += int(box.sum()); c['live'] += int((box & inl).sum()); c['new'] += int((box & inn & ~inl).sum())
        c['none'] += int((box & ~inl & ~inn).sum())
R['coverage'] = {'commit': commit, 'box': 'lon<=-111.15, lat 31.9..32.45', 'byRoad': cov,
                 'totals': dict(sum((Counter(v) for v in cov.values()), Counter()))}

# ---------- flows: frozen inflow, reference outflow, Northern injection ----------
vr = json.loads((C / 'nwm-validation-reaches.json').read_text())
def series(block, rid):
    for s in block['series']:
        if str(s['reachId']) == str(rid):
            return {p['time']: p['flowM3s'] for p in s['points']}
    return None
k0 = list(vr['analysisFullWindow']['series'][0]['points'][0].keys())
R['flowKeys'] = k0
def merged(rid):
    h = series(vr['history'], rid) or {}; f = series(vr['forecast'], rid) or {}
    return {**h, **f}
def stats(d):
    ts = sorted(d); v = np.array([d[t] for t in ts], float)
    if not len(v): return None
    i = int(np.nanargmax(v))
    return {'n': len(v), 'start': ts[0], 'end': ts[-1], 'peak': round(float(v[i]), 3), 'peakTime': ts[i],
            'volumeM3': round(float(np.nansum(v) * 3600)), 'nan': int(np.isnan(v).sum())}
flows = {}
for rid in ['15876941', '15876811', '15876815', '15876711', '15876707']:
    flows[rid] = {'frozen': stats(merged(rid)), 'analysis': stats(series(vr['analysisFullWindow'], rid))}
def summ(get):
    a, b = get('15876711'), get('15876707')
    return stats({t: a[t] + b[t] for t in a if t in b})
flows['711+707'] = {'frozen': summ(merged), 'analysis': summ(lambda r: series(vr['analysisFullWindow'], r))}
nh_ = json.loads((TOPO / 'northern-history.json').read_text()); nf_ = json.loads((TOPO / 'northern-forecast.json').read_text())
north = {}
for rid in ['15876711', '15876707']:
    h = series(nh_, rid); f = series(nf_, rid)
    north[rid] = stats({**(h or {}), **(f or {})}) if (h or f) else None
north['reachIds'] = [s['reachId'] for s in nh_['series']]
nreg = json.loads((TOPO / 'northern-boundary-registry.json').read_text()) if (TOPO / 'northern-boundary-registry.json').exists() else None
R['flows'] = flows; R['northernInjected'] = north
R['northernRegistryInlets'] = [
    {k: i.get(k) for k in ('reachId', 'receivingReachId', 'forcing', 'forcingStatus')} for i in (nreg or {}).get('externalInlets', [])]
# frozen-vs-analysis identity check at 711 for history hours
a = series(vr['analysisFullWindow'], '15876711'); h = series(vr['history'], '15876711')
R['historyEqualsAnalysis711'] = all(abs(a[t] - h[t]) < 1e-6 for t in h if t in a)
# case inflow files
for tag in ('', '-observed'):
    hh = json.loads((C / f'brawley-avra-west-history{tag}.json').read_text())
    ff = json.loads((C / f'brawley-avra-west-forecast{tag}.json').read_text())
    d = {**series(hh, '15876941'), **series(ff, '15876941')}
    vals = [v for v in d.values()]
    R[f'caseInflow{tag or "-nwm"}'] = {**stats(d), 'kind': [hh['kind'], ff['kind']], 'nulls': sum(v is None for v in vals),
                                      'missingReachIds': [hh.get('missingReachIds'), ff.get('missingReachIds')]}

# ---------- Brawley crossings and representative dips ----------
cx = [r for r in rows if r['kind'] == 'crossing' and r.get('wash') and 'brawley' in str(r['wash']).lower()]
sx, sy = to_utm.transform(np.array(cols['lon']), np.array(cols['lat']))
zs = np.array([np.nan if z is None else z for z in cols['roadZ']], float)
def near(r, rad=25.0):
    x, y = to_utm.transform(r['lon'], r['lat'])
    d = np.hypot(sx - x, sy - y); m = d <= rad
    if not m.any():
        return {'stations': 0, 'nearestM': round(float(d.min()), 1)}
    k = np.flatnonzero(m)
    return {'stations': int(m.sum()), 'roadZmin': None if np.all(np.isnan(zs[k])) else round(float(np.nanmin(zs[k])), 2),
            'roadZmax': None if np.all(np.isnan(zs[k])) else round(float(np.nanmax(zs[k])), 2),
            'roads': sorted(set(cols['road'][j] for j in k)), 'noHeight': int(np.isnan(zs[k]).sum())}
R['brawleyCrossings'] = [{**{k: r[k] for k in ('road', 'wash', 'comid', 'streamOrder', 'lon', 'lat', 'cellM')}, **near(r)} for r in cx]
dips = sorted([r for r in rows if r['kind'] == 'dip'], key=lambda r: -r['depthM'])
pick, seen = [], Counter()
for r in dips:  # 6 deepest, then deepest of each other road
    if len(pick) < 6:
        pick.append(r); seen[r['road']] += 1
for r in dips:
    if len(pick) >= 12: break
    if r not in pick and seen[r['road']] == 0:
        pick.append(r); seen[r['road']] += 1
for r in dips:
    if len(pick) >= 12: break
    if r not in pick:
        pick.append(r)
R['repDips'] = [{**{k: r[k] for k in ('road', 'depthM', 'lon', 'lat', 'cellM')}, **near(r)} for r in pick]
R['dipRoads'] = Counter(r['road'] for r in dips)
R['seconds'] = round(time.time() - t0, 1)
OUT.write_text(json.dumps(R, indent=1, default=lambda o: dict(o) if isinstance(o, Counter) else str(o)))
print('ok', R['seconds'])
