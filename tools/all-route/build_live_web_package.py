"""Build the Map tab's display package for the LIVE all-route SFINCS runs.

The live runs (.github/workflows/live-all-route.yml on experiment/all-route-models) publish each
case's compact result to the live-model branch under all-route/<case>/compact/. They use the same
meshes as the saved run, so this builder reuses the saved package's cells (public/simulation/data/
all-route-13z/<case>/cells-*.bin.gz) and only writes new water frames, in the same format as
tools/all-route/build_web_package.py. Nothing is rerun or re-modelled.

How a native value becomes a display value is the saved builder's rule, read back from its files:
- full: every native cell.
- web:  the saved package's kept native cells, then its 50 m blocks; a block's depth is its member
        cells' total stored water over the block's area.
Route-point cells carry the exact native float32 depth and water surface in every frame.

A case is left out (with the reason) when its live result is missing, incomplete, on another mesh,
or older than --max-age-hours. The package then says so; the app shows what is there.

Usage: python tools/all-route/build_live_web_package.py --out DIR [--source URL_OR_DIR] [--now ISO]
"""
import argparse, gzip, hashlib, json, shutil, struct, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from build_web_package import read_columns, pack, UNIT, WET_M, BLOCK_M, WET_SUMMARY_M  # noqa: E402

SOURCE = 'https://raw.githubusercontent.com/Godfather38/FLOODplain/live-model/all-route/'
SAVED = Path(__file__).resolve().parents[2] / 'public/simulation/data/all-route-13z'
MAX_AGE_HOURS = 3  # the same freshness limit as the route ratings (road-forecast.js LIVE_MAX_AGE_MS)


def reader(source):
    if source.startswith('http'):
        def get(path):
            with urllib.request.urlopen(urllib.request.Request(source + path, headers={'Cache-Control': 'no-cache'}), timeout=120) as r:
                return r.read()
        return get
    return lambda path: (Path(source) / path).read_bytes()


def read_cells(path):
    """The saved package's cell file: ix, iy (6.25 m lattice), level, overlap flags, route cells."""
    raw = gzip.decompress(path.read_bytes())
    assert raw[:4] == b'FPQW', path
    n = struct.unpack('<I', raw[4:8])[0]; header = json.loads(raw[8:8+n]); body = raw[8+n:]; c = header['count']
    ix = np.frombuffer(body, '<u2', c, 0).astype(np.int64); iy = np.frombuffer(body, '<u2', c, 2*c).astype(np.int64)
    lvl = np.frombuffer(body, 'u1', c, 4*c).astype(np.int64); flags = np.frombuffer(body, 'u1', c, 5*c).copy()
    route = np.frombuffer(body, '<u4', header['routeCells'], 6*c + (-2*c) % 4).astype(np.int64)
    return header, ix, iy, lvl, flags, route


def web_mapping(full, web):
    """Which native cells the web variant keeps, and which 50 m block each other cell joins."""
    _, fix, fiy, flvl, _, _ = full; _, wix, wiy, wlvl, _, _ = web
    key = lambda ix, iy, lvl: (iy * 65536 + ix) * 16 + lvl
    native = key(fix, fiy, flvl); order = np.argsort(native); sorted_native = native[order]
    wkey = key(wix, wiy, wlvl); pos = np.searchsorted(sorted_native, wkey); pos[pos >= len(order)] = 0
    is_native = sorted_native[pos] == wkey
    n_keep = int(is_native.sum())
    assert is_native[:n_keep].all() and not is_native[n_keep:].any(), 'web cells must be kept native cells, then blocks'
    keep = order[pos[:n_keep]]
    assert (np.diff(keep) > 0).all(), 'kept cells must be in native order'
    join = np.ones(len(fix), bool); join[keep] = False
    per = int(BLOCK_M / UNIT); block_level = int(np.log2(per))
    assert (wlvl[n_keep:] == block_level).all() and (flvl[join] < block_level).all()
    bkey = lambda ix, iy: (iy // per) * 100000 + (ix // per)
    blocks = bkey(wix[n_keep:], wiy[n_keep:]); assert (np.diff(blocks) > 0).all(), 'blocks must be sorted'
    jinv = np.searchsorted(blocks, bkey(fix[join], fiy[join]))
    assert (blocks[jinv] == bkey(fix[join], fiy[join])).all(), 'every joined cell must have its block'
    return keep, join, jinv, len(blocks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True); ap.add_argument('--source', default=SOURCE); ap.add_argument('--saved', default=str(SAVED))
    ap.add_argument('--now', default=''); ap.add_argument('--max-age-hours', type=float, default=MAX_AGE_HOURS)
    ap.add_argument('--variants', default='web,full')
    args = ap.parse_args()
    get = reader(args.source); saved = Path(args.saved); out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    now = datetime.fromisoformat(args.now.replace('Z', '+00:00')) if args.now else datetime.now(timezone.utc)
    stamp = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
    base = json.loads((saved / 'package.json').read_text())
    wanted = [v for v in args.variants.split(',') if v]
    summary = dict(schema='floodplain-all-route-web/v1', live=True, builtAt=now.strftime('%Y-%m-%dT%H:%M:%SZ'), source=args.source,
                   maxAgeHours=args.max_age_hours, unitM=base['unitM'], wetListedFromM=WET_M, web=base['web'], caseOrder=base['caseOrder'],
                   mixedTerrain=base.get('mixedTerrain'), cases=[], unavailable=[])
    points_out = {}
    for info0 in base['cases']:
        key = info0['key']
        try:
            mbytes = get(f'{key}/compact/manifest.json'); man = json.loads(mbytes)
            assert man.get('status') == 'complete' and man.get('executionMode') == 'live_current_forcing' and man.get('case') == key, 'the live result is not a complete live run'
            age = (now - stamp(man['issuedAt'])).total_seconds() / 3600
            assert -0.1 <= age <= args.max_age_hours, f"the live result is {age:.1f} hours old"
            assert stamp(man['validTo']) >= now, 'the live result ends before now'
        except Exception as e:  # this case is left out; the others still publish
            summary['unavailable'].append(dict(key=key, label=info0['label'], reason=str(e))); print(key, 'left out:', e, file=sys.stderr); continue
        cells = {v: read_cells(saved / key / info0['variants'][v]['geometry']['file']) for v in ('full', 'web')}
        _, fix, fiy, flvl, fflags, froute = cells['full']
        n_native = len(fix); assert n_native == info0['nativeCells']
        area = (UNIT * 2.0 ** flvl) ** 2
        route_cells = froute; assert (np.diff(route_cells) > 0).all()
        cell_slot = {int(c): k for k, c in enumerate(route_cells)}
        assert all(cell_slot[p['nativeCell']] == p['slot'] for p in info0['routePoints'])
        mapping = dict(full=None, web=web_mapping(cells['full'], cells['web']))
        cdir = out / key; cdir.mkdir(exist_ok=True)
        info = dict(key=key, label=info0['label'], runId=man['runId'], status=man['status'], issuedAt=man['issuedAt'], validFrom=man['validFrom'], validTo=man['validTo'],
                    source=f'{key}/compact/manifest.json', sourceManifestSha256=hashlib.sha256(mbytes).hexdigest(),
                    e0=info0['e0'], n0=info0['n0'], nativeCells=n_native, frames=[], variants={}, routes=info0['routes'], routePoints=info0['routePoints'],
                    outline=info0['outline'], labelAt=info0['labelAt'], bounds=info0['bounds'])
        for v in wanted:  # the cells are the saved run's own files, byte for byte
            g = info0['variants'][v]['geometry']; shutil.copyfile(saved / key / g['file'], cdir / g['file'])
            info['variants'][v] = dict(cells=info0['variants'][v]['cells'], geometry=g, frameBytes=0)
        zs_series = {p['id']: [] for p in info0['routePoints']}; depth_series = {p['id']: [] for p in info0['routePoints']}
        for fi, fd in enumerate(man['frames']):
            fmeta, fc = read_columns(get(f"{key}/compact/{fd['path']}"))
            assert fmeta['time'] == fd['time'] and len(fc['nativeVolumeM3']) == n_native, 'the live frame is on another mesh'
            vol = fc['nativeVolumeM3'].astype(np.float64); zs = fc['waterSurfaceM']
            depth = np.maximum(0, vol) / area
            rdepth = depth[route_cells].astype(np.float32); rzs = zs[route_cells].astype(np.float32)
            wet = depth >= WET_SUMMARY_M
            by_flag = {}
            for fl in np.unique(fflags):
                m = (fflags == fl) & wet
                by_flag[int(fl)] = [round(float(area[m].sum()) / 1e6, 5), round(float(depth[m].max()) if m.any() else 0.0, 4)]
            frame = dict(time=fd['time'], wetKm2=round(float(area[wet].sum()) / 1e6, 4), deepM=round(float(depth.max()), 4), byFlags=by_flag)
            for v in wanted:
                if mapping[v] is None: d = depth
                else:
                    keep, join, jinv, nb = mapping[v]
                    d = np.concatenate([depth[keep], np.bincount(jinv, weights=np.maximum(0, vol[join]), minlength=nb) / (BLOCK_M * BLOCK_M)])
                listed = np.nonzero(d >= WET_M)[0].astype(np.int64)
                delta = np.diff(listed, prepend=0).astype('<u4'); mm = np.minimum(65535, np.rint(d[listed] * 1000)).astype('<u2')
                hdr = dict(format='floodplain-quad-frame-v1', case=key, time=fd['time'], listed=int(len(listed)), routeCells=int(len(route_cells)), depthUnit='mm', geometrySha256=info['variants'][v]['geometry']['sha256'])
                p = pack(cdir / f'{v}-{fi}.bin.gz', hdr, [delta, mm, np.zeros((-2*len(listed)) % 4, 'u1'), rdepth.astype('<f4'), rzs.astype('<f4')])
                frame[v] = dict(file=p['file'], bytes=p['bytes'], sha256=p['sha256'], listed=int(len(listed)))
                info['variants'][v]['frameBytes'] += p['bytes']
            info['frames'].append(frame)
            f32 = lambda x: None if not np.isfinite(x) else float(str(np.float32(x)))
            for pt in info0['routePoints']:
                zs_series[pt['id']].append(f32(rzs[pt['slot']])); depth_series[pt['id']].append(f32(rdepth[pt['slot']]))
        points_out[key] = dict(times=[fd['time'] for fd in man['frames']], points={pt['id']: dict(slot=pt['slot'], zs=zs_series[pt['id']], depth=depth_series[pt['id']]) for pt in info0['routePoints']})
        summary['cases'].append(info)
        print(key, man['runId'], len(info['frames']), 'frames', {v: info['variants'][v]['frameBytes'] for v in wanted})
    (out / 'package.json').write_text(json.dumps(summary, separators=(',', ':')) + '\n')
    (out / 'route-points.json').write_text(json.dumps(dict(meaning='Exact native values at each route point: zs = water surface NAVD88 m, depth = native volume / full cell area (m), per frame time; null = no value.', cases=points_out), separators=(',', ':')) + '\n')
    print('cases:', [c['key'] for c in summary['cases']], 'left out:', [u['key'] for u in summary['unavailable']])


if __name__ == '__main__':
    main()
