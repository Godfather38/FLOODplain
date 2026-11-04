"""Build the Map tab's display package for the three saved all-route SFINCS results.

Reads the published compact packages straight from the pinned Git commit of the version 2
delivery (tools/sfincs/data/all-route-results-v2/delivery.json: <case>/compact/ and
route-point-series.csv) and writes
public/simulation/data/all-route-13z/. Nothing is rerun or re-modelled.

Two variants per case:
- web:  native cells within MERGE_FROM_M of a route stay as they are; farther away, blocks of
        cells smaller than BLOCK_M are joined into one BLOCK_M square whose depth is the blocks'
        total stored water over their total area (the same volume / area rule as the native depth).
- full: every native cell (6.25 m and up), for the 3D view on High and Ultra.
Cells that hold a route point are never joined, and their depth and water surface are stored as
the exact native float32 values in every frame. The builder checks those against the case's own
route-point-series.csv and stops if any differ.

Usage: python tools/all-route/build_web_package.py [--commit SHA] [--out DIR]
"""
import argparse, csv, gzip, hashlib, io, json, struct, subprocess, sys
from pathlib import Path
import numpy as np

COMMIT = '2b8c5284eb3e26d00a6d53a70b00a0f417ab10af'  # claude/all-route-expansion-78d5d4
SRC = 'tools/sfincs/data/'
CASES = [
    # key, folder, label, source run id
    ('northern', 'northern-result-41382880257', 'Northern: Trico, Avra, both Silverbells', '41382880257'),
    ('picture-rocks', 'picture-rocks-result-41745843031', 'Picture Rocks: Ina, Twin Peaks, Picture Rocks/Avra', '41745843031'),
    ('gates', 'gates-full-result-41750298470', 'Gates: Sandario south, Kinney, Gates Pass', '41750298470'),
]
UNIT = 6.25           # the finest native cell, metres
WET_M = 0.005         # sparse frames list cells at least this deep (the map's first band is 0.03 ft = 9 mm)
MERGE_FROM_M = 150    # web variant: native cells closer than this to a route stay native
BLOCK_M = 50
WET_SUMMARY_M = 0.0091  # the app's "wet" for wet area (0.03 ft)

# --- UTM 12N, the same series as public/preview/geo3d/src/utm.js ---
a = 6378137; f = 1 / 298.257223563; k0 = .9996; e2 = f * (2 - f); ep2 = e2 / (1 - e2)
def _mer(p): return a * ((1 - e2/4 - 3*e2*e2/64 - 5*e2**3/256)*p - (3*e2/8 + 3*e2*e2/32 + 45*e2**3/1024)*np.sin(2*p) + (15*e2*e2/256 + 45*e2**3/1024)*np.sin(4*p) - (35*e2**3/3072)*np.sin(6*p))
def to_utm(lon, lat):
    p = np.radians(lat); l = np.radians(np.asarray(lon, float) + 111); s, c, t = np.sin(p), np.cos(p), np.tan(p)
    N = a / np.sqrt(1 - e2*s*s); T = t*t; C = ep2*c*c; A = c*l
    e = 500000 + k0*N*(A + (1-T+C)*A**3/6 + (5-18*T+T*T+72*C-58*ep2)*A**5/120)
    n = k0*(_mer(p) + N*t*(A*A/2 + (5-T+9*C+4*C*C)*A**4/24 + (61-58*T+T*T+600*C-330*ep2)*A**6/720))
    return e, n
def from_utm(e, n):
    M = n / k0; mu = M / (a*(1 - e2/4 - 3*e2*e2/64 - 5*e2**3/256)); e1 = (1 - np.sqrt(1-e2)) / (1 + np.sqrt(1-e2))
    p1 = mu + (3*e1/2 - 27*e1**3/32)*np.sin(2*mu) + (21*e1*e1/16 - 55*e1**4/32)*np.sin(4*mu) + (151*e1**3/96)*np.sin(6*mu) + (1097*e1**4/512)*np.sin(8*mu)
    s, c, t = np.sin(p1), np.cos(p1), np.tan(p1); N = a/np.sqrt(1-e2*s*s); R = a*(1-e2)/(1-e2*s*s)**1.5; T = t*t; C = ep2*c*c; D = (e-500000)/(N*k0)
    lat = (p1 - N*t/R*(D*D/2 - (5+3*T+10*C-4*C*C-9*ep2)*D**4/24 + (61+90*T+298*C+45*T*T-252*ep2-3*C*C)*D**6/720))*180/np.pi
    lon = -111 + (D - (1+2*T+C)*D**3/6 + (5-2*C+28*T-3*C*C+8*ep2+24*T*T)*D**5/120)/c*180/np.pi
    return lon, lat

def git_bytes(commit, path):
    return subprocess.run(['git', 'show', f'{commit}:{path}'], check=True, capture_output=True).stdout

def read_columns(blob):
    raw = gzip.decompress(blob); n = struct.unpack('<I', raw[:4])[0]; h = json.loads(raw[4:4+n]); base = 4 + n
    cols = {k: np.frombuffer(raw, dtype={'d': '<f8', 'f': '<f4', 'I': '<u4'}[c['type']], count=c['count'], offset=base+c['offset']) for k, c in h['columns'].items()}
    return h['metadata'], cols

def pack(path, header, arrays):
    head = json.dumps(header, separators=(',', ':')).encode()
    head += b' ' * (-(8 + len(head)) % 8)
    body = b''.join(np.ascontiguousarray(x).tobytes() for x in arrays)
    raw = b'FPQW' + struct.pack('<I', len(head)) + head + body
    data = gzip.compress(raw, compresslevel=9, mtime=0)
    path.write_bytes(data)
    return dict(file=path.name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())

def route_samples(routes_path, only=None):
    pts = []
    for feat in json.loads(Path(routes_path).read_text())['features']:
        if only is not None and feat['properties']['id'] not in only: continue
        g = feat['geometry']; lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for line in lines:
            ll = np.array(line, float); e, n = to_utm(ll[:, 0], ll[:, 1])
            for i in range(len(e) - 1):
                k = max(1, int(np.hypot(e[i+1]-e[i], n[i+1]-n[i]) / 10))
                for s in range(k): pts.append((e[i] + (e[i+1]-e[i])*s/k, n[i] + (n[i+1]-n[i])*s/k))
            pts.append((e[-1], n[-1]))
    return np.array(pts)

def near_routes(xs, ys, samples, reach):
    """True where (xs, ys) is within reach metres of any route sample."""
    cell = reach; out = np.zeros(len(xs), bool)
    grid = {}
    for k, (x, y) in enumerate(samples): grid.setdefault((int(x // cell), int(y // cell)), []).append(k)
    gx = (xs // cell).astype(int); gy = (ys // cell).astype(int)
    keys = {}
    for i, key in enumerate(zip(gx, gy)): keys.setdefault(key, []).append(i)
    for (cx, cy), idx in keys.items():
        near = [k for dx in (-1, 0, 1) for dy in (-1, 0, 1) for k in grid.get((cx+dx, cy+dy), [])]
        if not near: continue
        s = samples[near]; idx = np.array(idx)
        d2 = (xs[idx, None] - s[None, :, 0])**2 + (ys[idx, None] - s[None, :, 1])**2
        out[idx] = d2.min(1) <= reach*reach
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--commit', default=COMMIT); ap.add_argument('--out', default='public/simulation/data/all-route-13z')
    ap.add_argument('--routes', default='public/data/routes.geojson'); args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    samples = route_samples(args.routes)
    cases = []; points_out = {}
    # Pass 1: native geometry of every case, so each can say where the others also have cells.
    for key, folder, label, rid in CASES:
        base = SRC + folder + '/'
        man = json.loads(git_bytes(args.commit, base + 'compact/manifest.json'))
        meta, g = read_columns(git_bytes(args.commit, base + 'compact/' + man['geometry']['path']))
        ids = meta['nativeFaceIds']
        assert all(ids[i] == str(i) for i in range(len(ids))), 'native face ids must be their index'
        res = g['resolutionM'].copy(); e, n = to_utm(g['lon'], g['lat'])
        x0 = e - res/2; y0 = n - res/2
        e0 = float(np.floor(x0.min() / 100) * 100); n0 = float(np.floor(y0.min() / 100) * 100)
        ix = np.rint((x0 - e0) / UNIT).astype(np.int64); iy = np.rint((y0 - n0) / UNIT).astype(np.int64)
        assert np.abs(ix*UNIT + e0 - x0).max() < .01 and np.abs(iy*UNIT + n0 - y0).max() < .01, 'cells must sit on the 6.25 m lattice'
        lvl = np.rint(np.log2(res / UNIT)).astype(np.int64); assert np.allclose(UNIT * 2.0**lvl, res)
        assert np.allclose(g['areaM2'], res*res), 'cells must be full squares'
        cases.append(dict(key=key, folder=folder, label=label, rid=rid, man=man, area=g['areaM2'].copy(), res=res, e0=e0, n0=n0, ix=ix, iy=iy, lvl=lvl, cx=e, cy=n))
    # Occupancy at 12.5 m, in shared UTM, for the overlap flags.
    OCC = 12.5; E0 = min(c['e0'] for c in cases); N0 = min(c['n0'] for c in cases)
    E1 = max((c['ix']*UNIT + c['res']).max() + c['e0'] for c in cases); N1 = max((c['iy']*UNIT + c['res']).max() + c['n0'] for c in cases)
    W = int(np.ceil((E1 - E0) / OCC)) + 1; H = int(np.ceil((N1 - N0) / OCC)) + 1
    for c in cases:
        occ = np.zeros((H, W), bool)
        gx0 = np.floor((c['ix']*UNIT + c['e0'] - E0) / OCC).astype(int); gy0 = np.floor((c['iy']*UNIT + c['n0'] - N0) / OCC).astype(int)
        span = np.maximum(1, (c['res'] / OCC).astype(int))
        for s in np.unique(span):
            m = span == s
            for dy in range(s):
                for dx in range(s): occ[gy0[m]+dy, gx0[m]+dx] = True
        c['occ'] = occ
    for ci, c in enumerate(cases):
        gx = np.floor((c['cx'] - E0) / OCC).astype(int); gy = np.floor((c['cy'] - N0) / OCC).astype(int)
        flags = np.zeros(len(c['res']), np.uint8)
        for oi, o in enumerate(cases):
            if oi != ci: flags |= (o['occ'][gy, gx].astype(np.uint8) << oi)
        c['flags'] = flags
    # Where areas overlap, the area whose own routes are nearest draws the place by default
    # (flag bit 7 = this case's cell is drawn in that mode). Distances on a 50 m raster.
    D = 50; dw = int(np.ceil((E1 - E0) / D)) + 1; dh = int(np.ceil((N1 - N0) / D)) + 1
    gxs = E0 + (np.arange(dw) + .5) * D; gys = N0 + (np.arange(dh) + .5) * D
    for c in cases:
        c['routes'] = json.loads(git_bytes(args.commit, SRC + c['folder'] + '/route-point-summary.json'))['caseRouteIds']
        own = route_samples(args.routes, set(c['routes']))[::5].astype(np.float32)
        dist = np.empty((dh, dw), np.float32)
        for j in range(dh):
            dx = gxs[:, None].astype(np.float32) - own[None, :, 0]; dy = np.float32(gys[j]) - own[None, :, 1]
            dist[j] = np.sqrt((dx*dx + dy*dy).min(1))
        c['dist'] = dist
    for ci, c in enumerate(cases):
        gx = np.clip(((c['cx'] - E0) // D).astype(int), 0, dw-1); gy = np.clip(((c['cy'] - N0) // D).astype(int), 0, dh-1)
        mine = c['dist'][gy, gx]; owned = np.ones(len(mine), bool)
        for oi, o in enumerate(cases):
            if oi == ci: continue
            there = (c['flags'] >> oi) & 1 == 1; theirs = o['dist'][gy, gx]
            owned &= ~there | (mine < theirs) | ((mine == theirs) & (ci < oi))
        c['flags'] = c['flags'] | (owned & (c['flags'] != 0)).astype(np.uint8) << 7
    summary = dict(schema='floodplain-all-route-web/v1', sourceCommit=args.commit, unitM=UNIT, wetListedFromM=WET_M,
                   web=dict(nativeWithinM=MERGE_FROM_M, blockM=BLOCK_M), caseOrder=[c['key'] for c in cases], cases=[])
    for ci, c in enumerate(cases):
        base = SRC + c['folder'] + '/'
        # Route points: the exact cell for each tracked identity, from this case's own series.
        rows = list(csv.DictReader(io.StringIO(git_bytes(args.commit, base + 'route-point-series.csv').decode())))
        series = {}
        for r in rows:
            if r['output_face_index'] == '': continue
            series.setdefault(r['canonical_id'], dict(cell=int(r['output_face_index']), lon=float(r['longitude']), lat=float(r['latitude']), routes=r['route_ids'].split('|') if r['route_ids'] else [], t={}))['t'][r['time_utc']] = (r['subgrid_volume_m3'], r['water_surface_navd88_m'], r['volume_per_full_cell_area_m'])
        route_cells = sorted({s['cell'] for s in series.values()})
        n_native = len(c['res'])
        # Web variant: which native cells are joined into blocks.
        far = ~near_routes(c['cx'], c['cy'], samples, MERGE_FROM_M + BLOCK_M * .71)
        small = c['res'] < BLOCK_M
        bx = (c['ix'] * UNIT // BLOCK_M).astype(np.int64); by = (c['iy'] * UNIT // BLOCK_M).astype(np.int64)
        bkey = by * 100000 + bx
        cand = far & small
        # A block joins only when its small cells fill it completely and none holds a route point.
        uk, inv = np.unique(bkey[cand], return_inverse=True)
        fill = np.bincount(inv, weights=c['area'][cand]); hasroute = np.zeros(len(uk), bool)
        rc = np.zeros(n_native, bool); rc[route_cells] = True; hasroute[np.unique(inv[rc[cand]])] = True
        okb = (np.abs(fill - BLOCK_M*BLOCK_M) < 1e-6) & ~hasroute
        join = np.zeros(n_native, bool); idx = np.nonzero(cand)[0]; join[idx[okb[inv]]] = True
        jk, jinv = np.unique(bkey[join], return_inverse=True)
        keep = np.nonzero(~join)[0]
        # web cell list: kept native cells, then blocks
        blk_ix = ((jk % 100000) * BLOCK_M / UNIT).astype(np.int64); blk_iy = ((jk // 100000) * BLOCK_M / UNIT).astype(np.int64)
        blk_lvl = np.full(len(jk), int(np.log2(BLOCK_M / UNIT)))
        # block flags: OR of member flags
        blk_flags = np.zeros(len(jk), np.uint8); np.bitwise_or.at(blk_flags, jinv, c['flags'][join])
        variants = {
            'full': dict(ix=c['ix'], iy=c['iy'], lvl=c['lvl'], flags=c['flags'], map=None),
            'web': dict(ix=np.concatenate([c['ix'][keep], blk_ix]), iy=np.concatenate([c['iy'][keep], blk_iy]), lvl=np.concatenate([c['lvl'][keep], blk_lvl]), flags=np.concatenate([c['flags'][keep], blk_flags]), map=(keep, join, jinv, len(jk))),
        }
        cdir = out / c['key']; cdir.mkdir(exist_ok=True)
        info = dict(key=c['key'], label=c['label'], sourceRunId=c['rid'], runId=c['man']['runId'], status=c['man']['status'],
                    source=f"{SRC}{c['folder']}/compact/manifest.json", sourceManifestSha256=hashlib.sha256(git_bytes(args.commit, base + 'compact/manifest.json')).hexdigest(),
                    e0=c['e0'], n0=c['n0'], nativeCells=n_native, frames=[], variants={},
                    routes=json.loads(git_bytes(args.commit, base + 'route-point-summary.json'))['caseRouteIds'])
        # Route points: id, the cell in each variant, and where in the per-frame exact block it sits.
        cell_slot = {cell: k for k, cell in enumerate(route_cells)}
        for vname, v in variants.items():
            if v['map'] is None: vi = np.array(route_cells)
            else:
                keep_pos = -np.ones(n_native, np.int64); keep_pos[keep] = np.arange(len(keep)); vi = keep_pos[route_cells]; assert (vi >= 0).all()
            v['routeIndex'] = vi
            lo, la = from_utm(v['ix']*UNIT + c['e0'] + UNIT*2.0**v['lvl']/2, v['iy']*UNIT + c['n0'] + UNIT*2.0**v['lvl']/2)
            hdr = dict(format='floodplain-quad-cells-v1', case=c['key'], runId=c['man']['runId'], e0=c['e0'], n0=c['n0'], unitM=UNIT, count=int(len(v['ix'])),
                       flagsMeaning='bit k (0-2) set: case caseOrder[k] also has a cell at this cell centre; bit 7: in an overlap, this case has the nearest own route, so it draws the place by default', routeCells=int(len(vi)))
            g = pack(cdir / f'cells-{vname}.bin.gz', hdr, [v['ix'].astype('<u2'), v['iy'].astype('<u2'), v['lvl'].astype('u1'), v['flags'].astype('u1'), np.zeros((-2*len(v['ix'])) % 4, 'u1'), vi.astype('<u4')])
            info['variants'][vname] = dict(cells=int(len(v['ix'])), geometry=g, frameBytes=0)
        info['routePoints'] = [dict(id=k, slot=cell_slot[s['cell']], nativeCell=s['cell'], lon=s['lon'], lat=s['lat'], routes=s['routes']) for k, s in sorted(series.items())]
        # Frames
        checked = 0
        for fi, fd in enumerate(c['man']['frames']):
            fmeta, fc = read_columns(git_bytes(args.commit, base + 'compact/' + fd['path']))
            assert fmeta['time'] == fd['time']
            vol = fc['nativeVolumeM3'].astype(np.float64); zs = fc['waterSurfaceM']
            depth32 = (np.maximum(0, fc['nativeVolumeM3']) / c['area'].astype(np.float32))  # display depth per native cell
            depth = np.maximum(0, vol) / c['area']
            # exact route block: native float32 volume / area, and native float32 surface
            rdepth = depth[route_cells].astype(np.float32); rzs = zs[route_cells].astype(np.float32)
            for k, s in series.items():
                row = s['t'].get(fd['time'])
                if row is None: continue
                slot = cell_slot[s['cell']]
                if row[0] != '': assert np.float32(float(row[0])) == fc['nativeVolumeM3'][s['cell']], (k, fd['time'])
                if row[1] != '': assert np.float32(float(row[1])) == rzs[slot], (k, fd['time'])
                checked += 1
            wet = depth >= WET_SUMMARY_M
            # wet area and deepest cell by overlap-flag combination, so the app can count each place once
            by_flag = {}
            for fl in np.unique(c['flags']):
                m = (c['flags'] == fl) & wet
                by_flag[int(fl)] = [round(float(c['area'][m].sum()) / 1e6, 5), round(float(depth[m].max()) if m.any() else 0.0, 4)]
            frame = dict(time=fd['time'], wetKm2=round(float(c['area'][wet].sum()) / 1e6, 4), deepM=round(float(depth.max()), 4), byFlags=by_flag)
            for vname, v in variants.items():
                if v['map'] is None: d = depth
                else:
                    keep, join, jinv, nb = v['map']
                    bvol = np.bincount(jinv, weights=np.maximum(0, vol[join]), minlength=nb)
                    d = np.concatenate([depth[keep], bvol / (BLOCK_M * BLOCK_M)])
                listed = np.nonzero(d >= WET_M)[0].astype(np.int64)
                delta = np.diff(listed, prepend=0).astype('<u4')
                mm = np.minimum(65535, np.rint(d[listed] * 1000)).astype('<u2')
                hdr = dict(format='floodplain-quad-frame-v1', case=c['key'], time=fd['time'], listed=int(len(listed)), routeCells=int(len(route_cells)), depthUnit='mm', geometrySha256=info['variants'][vname]['geometry']['sha256'])
                pad = np.zeros((-2*len(listed)) % 4, 'u1')
                p = pack(cdir / f'{vname}-{fi}.bin.gz', hdr, [delta, mm, pad, rdepth.astype('<f4'), rzs.astype('<f4')])
                frame[vname] = dict(file=p['file'], bytes=p['bytes'], sha256=p['sha256'], listed=int(len(listed)))
                info['variants'][vname]['frameBytes'] += p['bytes']
            info['frames'].append(frame)
            print(c['key'], fd['time'], {k: frame[k]['bytes'] for k in variants}, file=sys.stderr)
        info['routeValuesChecked'] = checked
        # The exact native values at every route point for every frame, as float32 written in
        # their shortest exact form; null where the case has no value (no frame, or no cell).
        f32 = lambda v: None if v == '' else float(str(np.float32(float(v))))
        times = [fd['time'] for fd in c['man']['frames']]
        points_out[c['key']] = dict(times=times, points={k: dict(slot=cell_slot[s['cell']], zs=[f32(s['t'][t][1]) if t in s['t'] else None for t in times], depth=[f32(s['t'][t][2]) if t in s['t'] else None for t in times]) for k, s in sorted(series.items())})
        summary['cases'].append(info)
    # Each case's model area: its outline on a 100 m grid, and a point inside it for a label.
    for ci, c in enumerate(cases):
        k = int(100 / OCC); hh, ww = c['occ'].shape[0] // k, c['occ'].shape[1] // k
        blk = c['occ'][:hh*k, :ww*k].reshape(hh, k, ww, k).any(axis=(1, 3))
        pad = np.pad(blk, 1)
        segs = []
        for horizontal in (True, False):
            diff = (pad[1:, 1:-1] != pad[:-1, 1:-1]) if horizontal else (pad[1:-1, 1:] != pad[1:-1, :-1])
            for line in range(diff.shape[0] if horizontal else diff.shape[1]):
                row = diff[line, :] if horizontal else diff[:, line]
                run = None
                for p in range(len(row) + 1):
                    on = p < len(row) and row[p]
                    if on and run is None: run = p
                    if not on and run is not None:
                        if horizontal: segs.append(((run, line), (p, line)))
                        else: segs.append(((line, run), (line, p)))
                        run = None
        lines = []
        for (x1, y1), (x2, y2) in segs:
            lo, la = from_utm(np.array([E0 + x1*100, E0 + x2*100]), np.array([N0 + y1*100, N0 + y2*100]))
            lines.append([[round(float(la[0]), 6), round(float(lo[0]), 6)], [round(float(la[1]), 6), round(float(lo[1]), 6)]])
        ys, xs = np.nonzero(blk); my, mx = ys.mean(), xs.mean(); j = np.argmin((ys-my)**2 + (xs-mx)**2)
        lo, la = from_utm(E0 + (xs[j]+.5)*100, N0 + (ys[j]+.5)*100)
        summary['cases'][ci]['outline'] = lines
        summary['cases'][ci]['labelAt'] = [round(float(la), 6), round(float(lo), 6)]
        lo, la = from_utm(np.array([c['e0'], c['e0'] + (c['ix']*UNIT + c['res']).max()]), np.array([c['n0'], c['n0'] + (c['iy']*UNIT + c['res']).max()]))
        summary['cases'][ci]['bounds'] = [[float(la.min()), float(lo.min())], [float(la.max()), float(lo.max())]]
    # The open items, read from the delivery (the Gates mixed-vintage terrain), and the Northern /
    # Picture Rocks overlap readout, which still applies: Picture Rocks frames 0-55 are unchanged.
    delivery = json.loads(git_bytes(args.commit, SRC + 'all-route-results-v2/delivery.json'))
    assert [c['runId'] for c in delivery['cases']] == [c['rid'] for c in cases], 'cases must match the delivery'
    for d, c in zip(delivery['cases'], summary['cases']):
        assert hashlib.sha256(git_bytes(args.commit, SRC + d['manifest'][3:])).hexdigest() == d['manifestSha256'] == c['sourceManifestSha256']
        assert len(c['frames']) == d['frames'] and d['counts']['located'] == d['counts']['retained'] == len(c['routePoints'])
    v1 = json.loads(git_bytes(args.commit, SRC + 'all-route-results-v1/delivery.json'))
    overlap = json.loads(git_bytes(args.commit, SRC + 'all-route-results-v1/overlap-readout.json'))
    summary['delivery'] = SRC + 'all-route-results-v2/delivery.json'
    summary['openItems'] = delivery['openItems']
    summary['mixedTerrain'] = next(dict(case='gates', source=o['source'], cells10m=o['cells10m'], reason=o['reason']) for o in delivery['openItems'] if o['kind'] == 'mixed_vintage_terrain')
    summary['sourceIssues'] = delivery['sourceIssues']
    worst = overlap['maximumAbsoluteDifferenceByIdentity'][0] if 'maximumAbsoluteDifferenceByIdentity' in overlap else None
    summary['overlap'] = dict(casePair=['northern', 'picture-rocks'], maximumDifferenceM=delivery['crossCaseComparison']['maximumAbsoluteMatchedPointSurfaceDifferenceM'],
                              identitiesCompared=overlap.get('identitiesCompared'), worst=worst, source=SRC + 'all-route-results-v1/overlap-readout.json',
                              meaning=v1['crossCaseComparison']['interpretation'])
    (out / 'package.json').write_text(json.dumps(summary, separators=(',', ':')) + '\n')
    (out / 'route-points.json').write_text(json.dumps(dict(meaning='Exact native values at each route point: zs = water surface NAVD88 m, depth = native volume / full cell area (m), per frame time; null = no value.', cases=points_out), separators=(',', ':')) + '\n')
    for ci in summary['cases']:
        print(ci['key'], {k: (v['cells'], v['geometry']['bytes'], v['frameBytes']) for k, v in ci['variants'].items()}, 'route values checked', ci['routeValuesChecked'])

if __name__ == '__main__':
    main()
