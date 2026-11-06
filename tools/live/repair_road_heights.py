"""Reproduce the two measured-source Gates repairs; never fill nodata or known heights.

Offline: python tools/live/repair_road_heights.py BASE_ROUTES OUTPUT_ROUTES
Evidence and unresampled USGS pixels are pinned beside the road station package.
Only the two missing heights, their flags/source/spread and necessary height
delta neighbours change. Coordinates, all existing heights and header stay exact.
"""
import gzip
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

from export_road_forecast import DTYPES

ROOT = Path(__file__).resolve().parent / 'road-stations'
EVIDENCE = ROOT / 'repairs/gates-2021-repair.json'
FORMAT = 'floodplain-road-heights-v1'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def columns(raw):
    size = int.from_bytes(raw[:4], 'little')
    header = json.loads(raw[4:4 + size])
    if header.get('format') != FORMAT:
        raise ValueError('Unexpected road package format')
    cols = {name: np.frombuffer(raw, dtype=DTYPES[d['type']], count=d['count'],
                               offset=4 + size + d['offset'])
            for name, d in header['columns'].items()}
    return header, cols


def load_evidence(path=EVIDENCE):
    path = Path(path)
    evidence = json.loads(path.read_text())
    window = evidence['window']
    encoded = (path.parent / window['path']).read_bytes()
    raw = gzip.decompress(encoded)
    if sha(encoded) != window['sha256'] or sha(raw) != window['decodedSha256']:
        raise ValueError('USGS source pixel checksum mismatch')
    pixels = np.frombuffer(raw, dtype=window['dtype']).reshape(window['height'], window['width'])
    return evidence, pixels


def measure(station, evidence, pixels):
    """Same bilinear finite-pixel sampling and five-sample median as original builder."""
    samples = station['samples']
    if [s['offsetM'] for s in samples] != [-3., -1.5, 0., 1.5, 3.]:
        raise ValueError('Expected original five cross-road offsets')
    window = evidence['window']
    values = []
    for sample in samples:
        col, row = sample['pixelCentreCoordinates']
        c, r = int(np.floor(col)), int(np.floor(row))
        x, y = c - window['col'], r - window['row']
        if x < 0 or y < 0 or x + 1 >= window['width'] or y + 1 >= window['height']:
            raise ValueError('Source sample outside captured window')
        footprint = pixels[y:y + 2, x:x + 2].astype('float64')
        if not np.isfinite(footprint).all() or np.any(footprint == evidence['source']['nodata']):
            raise ValueError('Missing source terrain; never interpolate across nodata')
        fx, fy = col - c, row - r
        a, b, c_, d = footprint.ravel()
        values.append(float((a * (1 - fx) + b * fx) * (1 - fy) +
                            (c_ * (1 - fx) + d * fx) * fy))
    return {'samplesM': values, 'heightCm': int(np.rint(np.median(values) * 100)),
            'lateralDm': int(min(np.rint((max(values) - min(values)) * 10), 254))}


def repair(encoded, evidence, pixels):
    if sha(encoded) != evidence['inputSha256']:
        raise ValueError('Repair requires exact original package; no overwriting newer sources')
    raw = bytearray(gzip.decompress(encoded))
    if sha(raw) != evidence['inputDecodedSha256']:
        raise ValueError('Original decoded package checksum mismatch')
    header, cols = columns(raw)
    project = evidence['source']['project']
    source_index = header['metadata']['sourceProjects'].index(project)
    results = []
    for station in evidence['stations']:
        line, k = station['lineIndex'], station['stationIndex']
        a, b = map(int, cols['lineStart'][line:line + 2])
        i = a + k
        if (i != station['globalIndex'] or not a <= i < b or
                header['lines']['routeId'][line] != station['routeId'] or
                header['lines']['kind'][line] != 'route'):
            raise ValueError('Repair station identity differs')
        lon = int(cols['dLonE6'][a:i + 1].astype('int64').sum()) / 1e6
        lat = int(cols['dLatE6'][a:i + 1].astype('int64').sum()) / 1e6
        old_cm = int(cols['dZCm'][a:i + 1].astype('int64').sum())
        original = station['original']
        if (lon != station['lon'] or lat != station['lat'] or
                old_cm != original['encodedHeightCm'] or cols['flags'][i] != 4 or
                any(int(cols[key][i]) != original[key] for key in ('flags', 'source', 'lateralDm'))):
            raise ValueError('Only the exact two missing terrain stations may change')
        result = measure(station, evidence, pixels)
        delta = result['heightCm'] - old_cm
        cols['dZCm'][i] += delta
        if i + 1 < b:
            cols['dZCm'][i + 1] -= delta  # Keep every later decoded height unchanged.
        cols['flags'][i] = 0
        cols['source'][i] = source_index
        cols['lateralDm'][i] = result['lateralDm']
        results.append({'routeId': station['routeId'], 'stationIndex': k, **result})
    return gzip.compress(raw, compresslevel=9, mtime=0), results


def descriptor(encoded, source, evidence_path=EVIDENCE):
    evidence, _ = load_evidence(evidence_path)
    return {k: source[k] for k in ('tier', 'path', 'lineCount', 'stationCount', 'repository')} | {
        'sha256': sha(encoded), 'bytes': len(encoded),
        'decodedBytes': len(gzip.decompress(encoded)), 'baseSource': source,
        'repairs': [{'path': 'repairs/' + Path(evidence_path).name,
                     'sha256': sha(Path(evidence_path).read_bytes()),
                     'id': evidence['id'], 'source': evidence['source'],
                     'pixelWindow': evidence['window'],
                     'stations': [{'routeId': s['routeId'], 'stationIndex': s['stationIndex'],
                                   'lat': s['lat'], 'lon': s['lon']} for s in evidence['stations']]}],
        'meaning': 'Original route/freeway tile with only two missing pr-gates heights recovered from verified USGS 2021 pixels using the existing five-sample method. Every existing height and coordinate is unchanged.'}


if __name__ == '__main__':
    evidence, pixels = load_evidence()
    encoded, results = repair(Path(sys.argv[1]).read_bytes(), evidence, pixels)
    Path(sys.argv[2]).write_bytes(encoded)
    print(json.dumps({'sha256': sha(encoded), 'bytes': len(encoded), 'stations': results}, indent=2))
