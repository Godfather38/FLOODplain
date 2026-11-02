"""Bind already-published route results; no solver, source rebuild or renderer edits."""
import csv
import gzip
import hashlib
import io
import json
import math
import posixpath
import subprocess
from pathlib import Path

COMMIT = '3dce053f1b22f80bbfb8cb9d3fbe46636fba6620'
ROOT = 'tools/sfincs/data/all-route-results-v1/'
URL = f'https://raw.githubusercontent.com/Godfather38/FLOODplain/{COMMIT}/'
GIT = r'C:\Program Files\Git\cmd\git.exe'
OUT = Path('public/simulation/data/all-route-data')


def source(path):
    raw = subprocess.check_output([GIT, 'show', f'{COMMIT}:{path}'])
    return raw, {'url': URL + path, 'sha256': hashlib.sha256(raw).hexdigest()}


def write(name, value):
    raw = (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode()
    if name.endswith('.gz'):
        raw = gzip.compress(raw, mtime=0)
    (OUT / name).write_bytes(raw)
    return {'path': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    delivery_raw, delivery_source = source(ROOT + 'delivery.json')
    ledger_raw, ledger_source = source(ROOT + 'coverage-ledger.json')
    overlap_raw, overlap_source = source(ROOT + 'overlap-readout.json')
    delivery, ledger, overlap = map(json.loads, [delivery_raw, ledger_raw, overlap_raw])
    cases = []
    for case in delivery['cases']:
        manifest_path = posixpath.normpath(ROOT + case['manifest'])
        raw, manifest_source = source(manifest_path)
        assert manifest_source['sha256'] == case['manifestSha256']
        manifest = json.loads(raw)
        assert (manifest['status'], manifest['validFrom'], manifest['validTo'], len(manifest['frames'])) == (case['status'], case['validFrom'], case['validTo'], case['frames'])
        csv_raw, csv_source = source(posixpath.normpath(ROOT + case['pointSeries']))
        summary_raw, summary_source = source(posixpath.normpath(ROOT + case['pointSummary']))
        summary = json.loads(summary_raw)
        assert summary_source['sha256'] == manifest['coverage']['coverageEvidenceSha256']
        times = [f['time'] for f in manifest['frames']]
        points = {}
        for row in csv.DictReader(io.StringIO(csv_raw.decode())):
            def number(key):
                value = float(row[key]) if row[key] else float('nan')
                return value if math.isfinite(value) else None
            identity = row['canonical_id']
            face = row['source_native_face_id']
            point = points.setdefault(identity, {'nativeFaceId': face, 'faceKey': f"{manifest['runId']}:{face}",
                                                 'areaM2': number('full_cell_area_m2'), 'samples': []})
            assert point['nativeFaceId'] == face and point['areaM2'] == number('full_cell_area_m2')
            assert row['time_utc'] == times[len(point['samples'])]
            volume, depth = number('subgrid_volume_m3'), number('volume_per_full_cell_area_m')
            assert (volume is None and depth is None) or abs(volume / point['areaM2'] - depth) < 1e-10
            point['samples'].append([volume, number('water_surface_navd88_m')])
        assert all(len(p['samples']) == len(times) for p in points.values())
        assert len(points) == case['counts']['located']
        series = write(f"points-{case['runId']}.json.gz", {'schema': 'all-route-points-v1', 'runId': manifest['runId'],
                       'sourceRunId': case['runId'], 'times': times, 'columns': ['nativeVolumeM3', 'waterSurfaceNAVD88M'],
                       'points': points, 'source': csv_source})
        cases.append({'sourceRunId': case['runId'], 'runId': manifest['runId'], 'modelVersion': case['modelVersion'],
                      'routeIds': summary['caseRouteIds'], 'status': case['status'], 'manifest': manifest_source,
                      'nativeArchiveManifest': {'url': URL + posixpath.normpath(ROOT + case['nativeArchiveManifest']),
                                                'sha256': case['nativeArchiveManifestSha256']},
                      'pointSummary': summary_source, 'pointSeriesSource': csv_source, 'points': series,
                      'validFrom': manifest['validFrom'], 'validTo': manifest['validTo'], 'times': times,
                      'geometrySha256': manifest['geometry']['sha256'], 'sourceIssues': manifest['sourceIssues'],
                      'clockMode': 'frozen_replay', 'nativeFaces': case['nativeFaces'],
                      'terrainDisplay': manifest['terrainDisplay']})
    by_source = {c['sourceRunId']: c for c in cases}
    entries = []
    for array in ['entries', 'officialRoadJunctions', 'terrainMinimumCandidates']:
        for entry in ledger[array]:
            coverage = entry['allRouteNativeCoverage']
            outputs = []
            for result in entry['allRouteNativeOutputs']:
                c = by_source[result['runId']]
                face = result['location'].get('sourceNativeFaceId')
                outputs.append({'runId': c['runId'], 'sourceRunId': c['sourceRunId'],
                                'faceKey': None if face is None else f"{c['runId']}:{face}",
                                'nativeFaceId': None if face is None else str(face),
                                'status': result['coverageStatus'], 'location': result['location'],
                                'native': result.get('native'), 'matchedCaseRouteIds': result['matchedCaseRouteIds'],
                                'validFrom': c['validFrom'], 'validTo': c['validTo'], 'sourceIssues': c['sourceIssues'],
                                'clockMode': 'frozen_replay', 'caseStatus': c['status']})
            status = 'full_window' if coverage['fullRequestedWindowOutputAvailable'] else 'partial_window' if coverage['partialWindowOutputOnly'] else 'uncovered'
            entries.append({'id': entry['canonicalId'], 'sourceArray': array, 'name': entry.get('name'),
                            'kind': entry.get('kind', array), 'coordinates': entry['coordinates'], 'routeIds': entry['routeIds'],
                            'aliases': entry.get('aliases', []), 'coverageStatus': status, 'modelOutputs': outputs,
                            'overlappingNativeOutputs': coverage['overlappingNativeOutputs'],
                            'gaugeAssociations': entry.get('gaugeAssociations', []), 'roadDepthValidated': False,
                            'risk': None, 'clearance': None})
    assert len({e['id'] for e in entries}) == 458
    counts = {s: sum(e['coverageStatus'] == s for e in entries) for s in ['full_window', 'partial_window', 'uncovered']}
    assert counts == {'full_window': 234, 'partial_window': 165, 'uncovered': 59}
    assert sum(e['overlappingNativeOutputs'] for e in entries) == 24
    catalog = {'schema': 'all-route-consumers-v1', 'sourceCommit': COMMIT, 'deliverySource': delivery_source,
               'ledgerSource': ledger_source, 'cases': cases, 'entries': entries, 'counts': counts,
               'evidenceMeaning': delivery['evidenceMeaning'], 'sourceIssues': delivery['sourceIssues'],
               'openItems': delivery['openItems'], 'overlap': {'status': 'unresolved', 'source': overlap_source,
               'policy': 'Keep both outputs; no averaging, source selection or risk change',
               'comparison': delivery['crossCaseComparison'], 'readout': overlap}}
    descriptor = write('catalog.json', catalog)
    pointer = {'path': 'data/all-route-data/catalog.json', 'sha256': descriptor['sha256']}
    Path('public/simulation/data/all-route-publication.json').write_text(json.dumps(pointer) + '\n')
    print(json.dumps({'catalog': descriptor, 'counts': counts, 'cases': [(c['runId'], len(c['times'])) for c in cases]}, indent=2))


if __name__ == '__main__':
    main()
