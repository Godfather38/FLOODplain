"""Freeze the local-road stations one all-route case owns, for local-road-forecast.json.

Offline, run once per domain change (needs shapely and pyproj; the live runner does not).
Stations come from the area tiles of road-height package floodplain-road-heights-v1, read
straight from a pinned git commit and checked against that commit's manifest. A station is
kept when it lies inside (or on the edge of) the case domain and outside every live domain
listed with --exclude: existing cases keep every station inside their own domains.

  python tools/live/build_local_road_stations.py \
      --case brawley-avra-west \
      --domain tools/sfincs/data/all-route-ready-v3/topology-version3/brawley-avra-west-domain.geojson \
      --output tools/live/road-stations/brawley-avra-west-local.json.gz

Station id = "<tile stem>:<line index>:<stationDm>" (stationDm = station distance along the
tile line in decimetres), stable for a given package commit.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

FORMAT = 'floodplain-road-heights-v1'
KIND = 'floodplain-local-road-stations'
PACKAGE_DIR = 'public/simulation/data/road-heights'
DEFAULT_REF = 'origin/experiment/road-heights-integrity'
TOPO = Path('tools/sfincs/data/all-route-ready-v3/topology-version3')
LIVE_DOMAINS = [TOPO / f'{p}-domain.geojson' for p in ('northern', 'picture-rocks-ina-twinpeaks', 'gates')]
NO_TERRAIN = 4


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(commit, path):
    return subprocess.run(['git', 'show', f'{commit}:{path}'], check=True, capture_output=True).stdout


def decode_tile(raw_gz):
    """Same decoding as tools/road_heights/encoding.py::decode_lines (per-line delta columns)."""
    raw = gzip.decompress(raw_gz)
    size = int.from_bytes(raw[:4], 'little')
    header = json.loads(raw[4:4 + size])
    if header.get('format') != FORMAT:
        raise ValueError('Unexpected road height format')
    body = 4 + size
    col = {k: np.frombuffer(raw, dtype=('<' + c['type']) if c['type'] not in ('u1', 'i1') else c['type'],
                            count=c['count'], offset=body + c['offset']) for k, c in header['columns'].items()}
    starts = col['lineStart'].astype(np.int64)
    if len(starts) != len(header['lines']['name']) + 1 or starts[0] != 0 or starts[-1] != len(col['flags']):
        raise ValueError('Invalid road height line table')
    lines = []
    for i in range(len(starts) - 1):
        a, b = starts[i], starts[i + 1]
        flags = col['flags'][a:b].astype(np.int64)
        z = np.cumsum(col['dZCm'][a:b].astype('i8')) / 100.0
        lines.append({'name': header['lines']['name'][i], 'kind': header['lines']['kind'][i],
                      'lon': np.cumsum(col['dLonE6'][a:b].astype('i8')) / 1e6,
                      'lat': np.cumsum(col['dLatE6'][a:b].astype('i8')) / 1e6,
                      'stationDm': np.cumsum(col['dStationDm'][a:b].astype('i8')),
                      'z': np.where(flags & NO_TERRAIN, np.nan, z), 'flags': flags})
    return header, lines


def domain_geometry(path):
    """Union of a domain FeatureCollection, in lon/lat (CRS84 or EPSG:32612 input)."""
    from shapely.geometry import shape
    from shapely.ops import transform, unary_union
    data = json.loads(Path(path).read_text())
    geom = unary_union([shape(f['geometry']) for f in data['features']])
    crs = ((data.get('crs') or {}).get('properties') or {}).get('name', 'CRS84')
    if '32612' in crs:
        from pyproj import Transformer
        to_ll = Transformer.from_crs(32612, 4326, always_xy=True)
        geom = transform(to_ll.transform, geom)
    elif not ('CRS84' in crs or '4326' in crs):
        raise ValueError(f'Unsupported domain CRS {crs}: {path}')
    return geom


def build(case, domain, exclude, ref, output):
    import shapely
    commit = subprocess.run(['git', 'rev-parse', ref], check=True, capture_output=True, text=True).stdout.strip()
    manifest_raw = git_blob(commit, f'{PACKAGE_DIR}/manifest.json')
    manifest = json.loads(manifest_raw)
    tiles = [f for f in manifest['files'] if f.get('tier') == 'area']
    keep_geom = domain_geometry(domain)
    live = [domain_geometry(p) for p in exclude]
    shapely.prepare(keep_geom)
    for g in live:
        shapely.prepare(g)
    cols = {k: [] for k in ('id', 'road', 'kind', 'lon', 'lat', 'roadZ', 'flags')}
    tile_rows, counts = [], {'tileStations': 0, 'insideDomain': 0, 'insideLiveDomain': 0}
    for tile in sorted(tiles, key=lambda t: t['path']):
        raw = git_blob(commit, f"{PACKAGE_DIR}/{tile['path']}")
        if sha(raw) != tile['sha256'] or len(raw) != tile['bytes']:
            raise ValueError('Tile does not match its package manifest: ' + tile['path'])
        _, lines = decode_tile(raw)
        stem = tile['path'].split('.')[0]
        tile_rows.append({'path': tile['path'], 'sha256': tile['sha256'], 'box': tile.get('box')})
        for li, line in enumerate(lines):
            if not len(line['lon']):
                continue
            counts['tileStations'] += len(line['lon'])
            pts = shapely.points(line['lon'], line['lat'])
            inside = shapely.covers(keep_geom, pts)
            counts['insideDomain'] += int(inside.sum())
            owned = np.zeros(len(pts), dtype=bool)
            for g in live:
                owned |= shapely.covers(g, pts)
            counts['insideLiveDomain'] += int((inside & owned).sum())
            for k in np.flatnonzero(inside & ~owned):
                cols['id'].append(f"{stem}:{li}:{int(line['stationDm'][k])}")
                cols['road'].append(line['name'] or '(unnamed)')
                cols['kind'].append(line['kind'])
                cols['lon'].append(round(float(line['lon'][k]), 6))
                cols['lat'].append(round(float(line['lat'][k]), 6))
                z = line['z'][k]
                cols['roadZ'].append(None if not np.isfinite(z) else round(float(z), 2))
                cols['flags'].append(int(line['flags'][k]))
    if len(set(cols['id'])) != len(cols['id']):
        raise ValueError('Station ids are not unique')
    counts['selected'] = len(cols['id'])
    counts['selectedNoHeight'] = sum(z is None for z in cols['roadZ'])
    data = {
        'schemaVersion': 1, 'kind': KIND, 'case': case, 'roadHeights': FORMAT,
        'source': {'repository': 'Godfather38/FLOODplain', 'ref': ref, 'commit': commit,
                   'manifestPath': f'{PACKAGE_DIR}/manifest.json', 'manifestSha256': sha(manifest_raw),
                   'tiles': tile_rows, 'flags': {'deckLidar': 1, 'deckApproach': 2, 'noTerrain': 4, 'structureUntagged': 8},
                   'elevation': 'NAVD88 metres, lidar bare-earth road estimate (not a surveyed deck)'},
        'selection': {'rule': 'covered by the case domain and not covered by any live domain',
                      'domain': {'path': Path(domain).as_posix(), 'sha256': sha(Path(domain).read_bytes())},
                      'excludedLiveDomains': [{'path': Path(p).as_posix(), 'sha256': sha(Path(p).read_bytes())} for p in exclude],
                      'counts': counts},
        'columns': cols,
    }
    encoded = gzip.compress(json.dumps(data, separators=(',', ':'), allow_nan=False).encode(), 9, mtime=0)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_bytes(encoded)
    return {'path': Path(output).as_posix(), 'sha256': sha(encoded), 'bytes': len(encoded), **counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--case', required=True)
    parser.add_argument('--domain', required=True)
    parser.add_argument('--exclude', nargs='*', default=[str(p) for p in LIVE_DOMAINS])
    parser.add_argument('--ref', default=DEFAULT_REF)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.case, args.domain, args.exclude, args.ref, args.output), indent=1))


if __name__ == '__main__':
    main()
