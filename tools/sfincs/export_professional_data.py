"""Export published FE-102-2019 GIS records via standard ArcGIS POST queries.

No GIS credentials or third-party Python packages required. Does not construct
hydraulic geometry or execute a solver. Raw responses and request bodies retained.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = 'https://services3.arcgis.com/9coHY2fvuFjG9HQX/arcgis/rest/services/'
ENVELOPE = '467000,3577000,493500,3596000'
SOURCES = (
    ('cross-sections', 'RFCDLocalFloodplainCrossSections_C', False),
    ('bfe-contours', 'RFCD_BFE_Contours_C', True),
)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def post(url, params, path, records):
    request = urllib.request.Request(
        url, data=urllib.parse.urlencode(params).encode('ascii'),
        headers={'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read()
    obj = json.loads(raw)
    if 'error' in obj:
        raise RuntimeError(f'{url}: {obj["error"]}')
    if obj.get('exceededTransferLimit'):
        raise RuntimeError(f'{url}: transfer limit exceeded; reduce --batch-size')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    records.append({'path': str(path.name), 'url': url, 'method': 'POST',
                    'parameters': params, 'bytes': len(raw), 'sha256': digest(raw),
                    'retrievedUtc': datetime.now(timezone.utc).isoformat()})
    return obj


def export_source(output, name, service, bounded, batch_size):
    base = ROOT + service + '/FeatureServer/0'
    rawdir = output / 'raw' / name
    records = []
    metadata = post(base, {'f': 'json'}, rawdir / 'metadata.json', records)
    fields = {f['name']: f for f in metadata['fields']}
    if 'STUDYID' not in fields or 'Query' not in metadata.get('capabilities', ''):
        raise RuntimeError(f'{name}: unexpected schema/query capability')
    selection = {'f': 'json', 'where': "STUDYID = 'FE-102-2019'"}
    if bounded:
        selection.update(geometry=ENVELOPE, geometryType='esriGeometryEnvelope',
                         inSR='32612', spatialRel='esriSpatialRelIntersects')
    ids_result = post(base + '/query', dict(selection, returnIdsOnly='true'),
                      rawdir / 'object-ids.json', records)
    oid = ids_result.get('objectIdFieldName') or metadata.get('objectIdField')
    ids = ids_result.get('objectIds')
    if not oid or ids is None or not ids:
        raise RuntimeError(f'{name}: no complete object ID selection returned')
    if len(ids) != len(set(ids)):
        raise RuntimeError(f'{name}: duplicate object IDs')
    ids = sorted(ids)
    max_batch = min(batch_size, metadata.get('maxRecordCount', batch_size))
    features, header = [], None
    for start in range(0, len(ids), max_batch):
        selected = ids[start:start + max_batch]
        params = {'f': 'json', 'objectIds': ','.join(map(str, selected)),
                  'outFields': '*', 'returnGeometry': 'true', 'outSR': '4326'}
        obj = post(base + '/query', params,
                   rawdir / f'batch-{start // max_batch + 1:03d}.json', records)
        batch = obj.get('features', [])
        returned = [f['attributes'][oid] for f in batch]
        if len(returned) != len(set(returned)) or set(returned) != set(selected):
            raise RuntimeError(f'{name}: incomplete/mismatched batch at {start}')
        if any(f['attributes'].get('STUDYID') != 'FE-102-2019' for f in batch):
            raise RuntimeError(f'{name}: study membership changed during export')
        current_header = {k: obj[k] for k in ('objectIdFieldName', 'globalIdFieldName',
                          'geometryType', 'spatialReference', 'fields') if k in obj}
        if header is None:
            header = current_header
        elif current_header != header:
            raise RuntimeError(f'{name}: response schema changed during export')
        features.extend(batch)
        print(f'{name}: {len(features)}/{len(ids)} features', flush=True)
    features.sort(key=lambda f: f['attributes'][oid])
    combined = dict(header, features=features)
    raw = (json.dumps(combined, separators=(',', ':'), ensure_ascii=False) + '\n').encode('utf-8')
    path = output / f'{name}.esri.json'
    path.write_bytes(raw)
    for record in records:
        record['path'] = f'raw/{name}/' + record['path']
    return {'name': name, 'service': base, 'scope': 'domain envelope' if bounded else 'entire study',
            'selection': selection, 'featureCount': len(features), 'objectIdField': oid,
            'path': path.name, 'sha256': digest(raw), 'bytes': len(raw),
            'rawResponses': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent /
                        'data/professional-sources/fe-102-2019-post')
    parser.add_argument('--batch-size', type=int, default=30)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 100:
        parser.error('--batch-size must be 1..100')
    # Refuse to replace an archive; failed partial exports remain inspectable.
    if args.output.exists():
        parser.error('Output already exists; choose a new --output directory')
    args.output.mkdir(parents=True)
    exports = [export_source(args.output, *source, args.batch_size) for source in SOURCES]
    manifest = {'schemaVersion': 1, 'studyId': 'FE-102-2019', 'exports': exports,
                'surveyAcquisitionDate': None, 'nativeHydraulicModel': False,
                'limitations': ['GIS study records, not full station-elevation profiles',
                                'Water surface elevations are not bed elevations',
                                'Hosted publication/edit dates are not survey dates',
                                'No null filling or geometric reconstruction performed']}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'manifest': str(args.output / 'manifest.json'),
                      'counts': {e['name']: e['featureCount'] for e in exports}}, indent=2))


if __name__ == '__main__':
    main()
