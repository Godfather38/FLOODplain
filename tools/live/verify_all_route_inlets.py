"""Pin the inlet reach order of each prepared all-route case for live forcing.

The reach of each sfincs.src point comes from the case's boundary-placement.json (written when
the inlets were placed). The point must sit within 0.1 m of that placement, and its sfincs.dis
column must equal that reach's frozen NWM series.

  python tools/live/verify_all_route_inlets.py   # writes tools/live/all-route-cases.json
"""
import hashlib, io, json, tarfile
from pathlib import Path
import numpy as np
from pyproj import Transformer

DATA = Path('tools/sfincs/data')
TOPO = DATA / 'all-route-ready-v3/topology-version3'
CASES = [
    # case manifest, registry/forcing prefix, frozen result holding the face mapping and compact geometry
    ('northern', 'all-route-ready-v3/northern-native-case-v3/manifest.json', 'northern', 'northern-result-41382880257'),
    ('picture-rocks', 'all-route-ready-v3/picture-rocks-native-case-v2/manifest.json', 'picture-rocks-ina-twinpeaks', 'picture-rocks-result-41382872468'),
    ('gates', 'all-route-ready-v3/gates-full-native-case-v3/manifest.json', 'gates', 'gates-full-result-41750298470'),
    # Result dir None = the single tools/sfincs/data/brawley-avra-west-result-<runid> made from its frozen run.
    ('brawley-avra-west', 'all-route-ready-v3/brawley-avra-west-native-case-v1/manifest.json', 'brawley-avra-west', None),
]
# Cases that also publish local-road-forecast.json: their frozen station list (build_local_road_stations.py).
LOCAL_ROADS = {'brawley-avra-west': 'tools/live/road-stations/brawley-avra-west-local.json.gz'}
sha = lambda b: hashlib.sha256(b).hexdigest()


def case_files(manifest_path):
    m = json.loads(manifest_path.read_text())
    data = b''.join((manifest_path.parent / p['path']).read_bytes() for p in m['parts'])
    if sha(data) != m['archiveSha256']: raise ValueError('Archive hash mismatch: ' + str(manifest_path))
    tf = tarfile.open(fileobj=io.BytesIO(data))
    read = lambda n: tf.extractfile(n).read()
    return m, read('sfincs.src').decode(), read('sfincs.dis').decode(), sha(read('sfincs.nc'))


def frozen_series(prefix):
    hist = {s['reachId']: s['points'] for s in json.loads((TOPO / f'{prefix}-history.json').read_text())['series']}
    fore = {s['reachId']: s['points'] for s in json.loads((TOPO / f'{prefix}-forecast.json').read_text())['series']}
    out = {}
    for r in hist:
        pts = hist[r] + [p for p in fore.get(r, []) if p['time'] > hist[r][-1]['time']]
        out[r] = np.array([p['flowM3s'] for p in pts])
    return out


def bounds32612(prefix):
    feats = json.loads((TOPO / f'{prefix}-domain.geojson').read_text())['features']
    flat = lambda c: [c] if isinstance(c[0], (int, float)) else [q for x in c for q in flat(x)]
    lonlat = np.array([q[:2] for f in feats for q in flat(f['geometry']['coordinates'])])
    x, y = Transformer.from_crs(4326, 32612, always_xy=True).transform(lonlat[:, 0], lonlat[:, 1])
    return [round(float(v), 1) for v in (x.min(), y.min(), x.max(), y.max())]


def main():
    rows = []
    for name, manifest, prefix, result in CASES:
        path = DATA / manifest
        if not path.exists():
            print(f'{name}: {manifest} not prepared yet, skipped'); continue
        m, src, dis, mesh_sha = case_files(path)
        pts = np.array(src.split(), dtype=float).reshape(-1, 2)
        cols = np.loadtxt(io.StringIO(dis))[:, 1:].T
        series = frozen_series(prefix)
        registry = json.loads((TOPO / f'{prefix}-boundary-registry.json').read_text())
        placed = json.loads((path.parent / 'boundary-placement.json').read_text())['inlets']
        if len(placed) != len(cols): raise ValueError(f'{name}: placement and sfincs.dis disagree on inlet count')
        reaches = []
        for k, (col, p) in enumerate(zip(cols, placed)):
            if np.hypot(pts[k, 0] - p['x'], pts[k, 1] - p['y']) > 0.1: raise ValueError(f'{name} inlet {k}: point differs from placement')
            if not np.allclose(series[p['reachId']], col, atol=5e-7): raise ValueError(f'{name} inlet {k}: flow differs from frozen {p["reachId"]}')
            reaches.append({'reachId': p['reachId'], 'x': float(pts[k, 0]), 'y': float(pts[k, 1])})
        if sorted(r['reachId'] for r in reaches) != sorted(i['reachId'] for i in registry['externalInlets']):
            raise ValueError(f'{name}: inlets differ from the registry')
        row = {'case': name, 'modelVersion': m['modelVersion'], 'caseManifest': str(path.as_posix()), 'archiveSha256': m['archiveSha256'],
               'meshSha256': mesh_sha, 'bounds32612': bounds32612(prefix), 'inlets': reaches, 'inletCheck': 'sfincs.src within 0.1 m of boundary-placement.json; each sfincs.dis column equals that reach\'s frozen series'}
        if result is None:
            found = sorted(DATA.glob(f'{name}-result-*/output-to-source-face-id.npy'))
            if len(found) != 1:
                raise ValueError(f'{name}: need exactly one frozen {name}-result-<runid> with a face mapping, found {len(found)}')
            result = found[0].parent.name
        if result:
            res = DATA / result
            row['faceMapping'] = {'path': (res / 'output-to-source-face-id.npy').as_posix(), 'sha256': sha((res / 'output-to-source-face-id.npy').read_bytes())}
            row['geometry'] = {'path': (res / 'compact/geometry.bin.gz').as_posix(), 'sha256': sha((res / 'compact/geometry.bin.gz').read_bytes())}
        if name == 'brawley-avra-west' and m['modelVersion'] != 'all-routes-brawley-avra-west-v1': raise ValueError(f'{name}: unexpected modelVersion {m["modelVersion"]}')
        if name in LOCAL_ROADS:
            local = Path(LOCAL_ROADS[name])
            if not local.exists(): raise ValueError(f'{name}: local road stations {local} not built yet (build_local_road_stations.py)')
            row['localRoads'] = {'path': local.as_posix(), 'sha256': sha(local.read_bytes()),
                                 'output': 'local-road-forecast.json', 'kind': 'floodplain-local-road-forecast'}
        rows.append(row); print(name, m['modelVersion'], [r['reachId'] for r in reaches])
    # Bytes, so a Windows run keeps LF line endings.
    Path('tools/live/all-route-cases.json').write_bytes((json.dumps({'schemaVersion': 1, 'cases': rows}, indent=1) + '\n').encode())


if __name__ == '__main__':
    main()
