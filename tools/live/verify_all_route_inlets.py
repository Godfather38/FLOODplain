"""Pin the inlet reach order of each prepared all-route case for live forcing.

The reach of each sfincs.src point comes from the case's boundary-placement.json (written when
the inlets were placed). The point must sit within 0.1 m of that placement, and its sfincs.dis
column must equal that reach's frozen NWM series.

  python tools/live/verify_all_route_inlets.py   # writes tools/live/all-route-cases.json
"""
import hashlib, io, json, tarfile
from pathlib import Path
import numpy as np

DATA = Path('tools/sfincs/data')
TOPO = DATA / 'all-route-ready-v3/topology-version3'
CASES = [
    # case manifest, registry/forcing prefix, frozen result holding the face mapping and compact geometry
    ('northern', 'all-route-ready-v3/northern-native-case-v3/manifest.json', 'northern', 'northern-result-41382880257'),
    ('picture-rocks', 'all-route-ready-v3/picture-rocks-native-case-v2/manifest.json', 'picture-rocks-ina-twinpeaks', 'picture-rocks-result-41382872468'),
    ('gates', 'all-route-ready-v3/gates-full-native-case-v3/manifest.json', 'gates', None),
]
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
               'meshSha256': mesh_sha, 'inlets': reaches, 'inletCheck': 'sfincs.src within 0.1 m of boundary-placement.json; each sfincs.dis column equals that reach\'s frozen series'}
        if result:
            res = DATA / result
            row['faceMapping'] = {'path': (res / 'output-to-source-face-id.npy').as_posix(), 'sha256': sha((res / 'output-to-source-face-id.npy').read_bytes())}
            row['geometry'] = {'path': (res / 'compact/geometry.bin.gz').as_posix(), 'sha256': sha((res / 'compact/geometry.bin.gz').read_bytes())}
        rows.append(row); print(name, m['modelVersion'], [r['reachId'] for r in reaches])
    Path('tools/live/all-route-cases.json').write_text(json.dumps({'schemaVersion': 1, 'cases': rows}, indent=1) + '\n')


if __name__ == '__main__':
    main()
