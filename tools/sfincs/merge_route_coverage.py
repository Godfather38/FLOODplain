"""Merge finished all-route native readings into one coverage ledger, without rewriting history.

Standard-library JSON merge only. It joins the all-route inventory ledger to the
route-point-summary.json products written by inspect_route_result.py and records,
per inventory record, exactly which completed native runs actually contain it.

Usage:

    python tools/sfincs/merge_route_coverage.py \
        --inventory tools/sfincs/data/all-routes-extension-v1/inventory/coverage-ledger.json \
        --result tools/sfincs/data/<case-a>-result-<run-id>/route-point-summary.json \
        --result tools/sfincs/data/<case-b>-result-<run-id>/route-point-summary.json \
        --result tools/sfincs/data/<case-c>-result-<run-id>/route-point-summary.json \
        --output tools/sfincs/data/all-routes-extension-v1/inventory/merged-coverage-ledger.json

Every --result path must already exist and be a real reader product; nothing is
stubbed, assumed pending or back-filled for a case that has not been read. The
inventory and the result files are opened read-only. Two products are written:
the merged ledger at --output and coverage-summary.json beside it.

What the merge does and does not establish:

  * Records and their fields are carried through verbatim. The pre-existing
    inventory model/status fields are NOT consulted for new coverage; only the
    supplied native readings are.
  * A record is marked native_output_available only when some supplied result
    locates it inside that run's own native domain AND that result carries
    actual native quantities for it. Otherwise it is outside_completed_cases,
    which means no completed case read covers the point. It does NOT mean dry,
    unflooded, safe or passable.
  * An outside-domain reading from one run never downgrades real coverage from
    another run; availability is the union over runs.
  * The counts are counts of distinct evidence identities (canonical IDs), not
    of unique confirmed physical dips. Route membership, point containment and
    native volume/area are not validated road depth, not passability and not
    proof of continuous full-road coverage.
  * Frozen recorded valid intervals from each native reading are preserved as
    read; no interval is widened, merged or re-derived.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path

INVENTORY_ARRAYS = ['entries', 'officialRoadJunctions', 'terrainMinimumCandidates']
REQUIRED_RESULTS = 3
LOCATED = 'located_in_current_native_domain'
AVAILABLE = 'native_output_available'
OUTSIDE = 'outside_completed_cases'
NATIVE_QUANTITIES = ['maxVolumeM3', 'minVolumeM3', 'maxVolumePerFullCellAreaM',
                     'maxWaterSurfaceNAVD88M']
COORDINATE_TOLERANCE_DEG = 1e-9
OUTSIDE_MEANING = ('No supplied completed-case native reading covers this point. Not dry, not '
                   'unflooded, not passable and not evidence of absence of flooding.')
EVIDENCE_MEANING = ('Counts of distinct evidence identities (canonical IDs) joined to native '
                    'output, not counts of unique confirmed physical dips. Route membership, '
                    'point containment and native volume/area do not validate road depth and do '
                    'not establish continuous full-road coverage.')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def coordinates_of(record, where):
    value = record.get('coordinates')
    if not (isinstance(value, list) and len(value) == 2):
        raise ValueError(f"{where} record {record.get('canonicalId')!r} has no [longitude,latitude]")
    return [float(value[0]), float(value[1])]


def native_present(point):
    """True only when the reader actually recorded native quantities for this point."""
    native = point.get('native')
    if not isinstance(native, dict): return False
    area = native.get('fullCellAreaM2')
    if not isinstance(area, (int, float)) or area <= 0: return False
    return any(isinstance(native.get(name), (int, float)) for name in NATIVE_QUANTITIES)


def index_inventory(inventory):
    """Map canonicalId to (array name, record) and fail on duplicate identities."""
    index = {}
    for array in INVENTORY_ARRAYS:
        records = inventory.get(array)
        if records is None: raise ValueError(f'Inventory is missing the {array} array')
        for record in records:
            canonical = record.get('canonicalId')
            if not canonical: raise ValueError(f'Inventory record without canonicalId in {array}')
            if canonical in index:
                raise ValueError(f'Duplicate inventory canonicalId {canonical!r}')
            coordinates_of(record, 'Inventory')
            if not isinstance(record.get('routeIds'), list):
                raise ValueError(f'Inventory record {canonical!r} has no routeIds list')
            index[canonical] = (array, record)
    return index


def read_result(path, index, seen_run_ids):
    """Read one route-point-summary.json and verify it joins the inventory exactly."""
    path = Path(path)
    if not path.is_file():
        raise ValueError(f'Supplied result file does not exist: {path}. Native readings are '
                         'required inputs; a pending result is never manufactured here.')
    data = load(path)
    run_id = data.get('runId')
    case_id = data.get('caseId')
    if not run_id: raise ValueError(f'{path} records no runId')
    if str(run_id) in seen_run_ids:
        raise ValueError(f'Duplicate result runId {run_id!r}: {path} and '
                         f'{seen_run_ids[str(run_id)]} are the same run')
    seen_run_ids[str(run_id)] = str(path)
    points = data.get('points')
    if not isinstance(points, list) or not points:
        raise ValueError(f'{path} records no points array')
    case_route_ids = data.get('caseRouteIds')
    if not isinstance(case_route_ids, list) or not case_route_ids:
        raise ValueError(f'{path} records no caseRouteIds')
    coverage = data.get('timeCoverage')
    if not isinstance(coverage, dict):
        raise ValueError(f'{path} records no timeCoverage; frozen valid interval unavailable')

    joined, local = {}, set()
    for point in points:
        canonical = point.get('canonicalId')
        if canonical in local:
            raise ValueError(f'Duplicate canonicalId {canonical!r} within {path}')
        local.add(canonical)
        if canonical not in index:
            raise ValueError(f'Result {path} reports unknown canonicalId {canonical!r}; '
                             'it is absent from the supplied inventory')
        array, record = index[canonical]
        if point.get('inventoryArray') != array:
            raise ValueError(f'{canonical!r} is in inventory array {array!r} but {path} '
                             f"records {point.get('inventoryArray')!r}")
        inventory_xy = coordinates_of(record, 'Inventory')
        result_xy = coordinates_of(point, f'Result {path}')
        if max(abs(a - b) for a, b in zip(inventory_xy, result_xy)) > COORDINATE_TOLERANCE_DEG:
            raise ValueError(f'{canonical!r} coordinates differ: inventory {inventory_xy} '
                             f'versus {path} {result_xy}')
        if list(point.get('routeIds') or []) != list(record['routeIds']):
            raise ValueError(f'{canonical!r} route memberships differ: inventory '
                             f"{record['routeIds']} versus {path} {point.get('routeIds')}")
        matched = list(point.get('matchedCaseRouteIds') or [])
        if not matched:
            raise ValueError(f'{canonical!r} in {path} records no matchedCaseRouteIds')
        unknown = [r for r in matched if r not in record['routeIds']]
        if unknown:
            raise ValueError(f'{canonical!r} in {path} claims route memberships {unknown} '
                             'absent from the inventory record')
        off_case = [r for r in matched if r not in case_route_ids]
        if off_case:
            raise ValueError(f'{canonical!r} in {path} claims route memberships {off_case} '
                             'outside the case routeIds of that run')

        location = copy.deepcopy(point.get('location')) or {}
        present = native_present(point)
        status = location.get('status')
        joined[canonical] = {
            'caseId': case_id,
            'runId': run_id,
            'resultPath': str(path),
            'resultSha256': sha(path),
            'matchedCaseRouteIds': matched,
            'caseRouteIds': list(case_route_ids),
            'location': location,
            'projected': copy.deepcopy(point.get('projected')),
            'native': copy.deepcopy(point.get('native')),
            'nativeQuantitiesPresent': present,
            'timeCoverage': copy.deepcopy(coverage),
            'frozenRecordedValidInterval': {
                'recordedValidFrom': coverage.get('recordedValidFrom'),
                'recordedValidTo': coverage.get('recordedValidTo'),
                'framesRecorded': coverage.get('framesRecorded'),
                'distinctIntervalSeconds': coverage.get('distinctIntervalSeconds'),
                'preservedAsRead': True},
            'coverageStatus': AVAILABLE if (status == LOCATED and present) else OUTSIDE,
            'coverageBasis': f'location.status == {status!r} and native quantities '
                             f'present == {present}',
        }
    return data, joined


def route_counter():
    return {'distinctEvidenceIdentities': 0, 'nativeOutputAvailable': 0,
            'outsideCompletedCases': 0, 'withOverlappingAvailableOutputs': 0,
            'withFullRequestedWindowOutput': 0, 'withPartialWindowOutputOnly': 0,
            'byInventoryArray': {a: 0 for a in INVENTORY_ARRAYS}}


def merge(inventory_path, result_paths, output_path):
    inventory_path, output_path = Path(inventory_path), Path(output_path)
    if len(result_paths) < REQUIRED_RESULTS:
        raise ValueError(f'{REQUIRED_RESULTS} finished native readings are required; '
                         f'{len(result_paths)} supplied')
    inventory = load(inventory_path)
    index = index_inventory(inventory)

    seen_run_ids, results, joins = {}, [], {}
    for path in result_paths:
        data, joined = read_result(path, index, seen_run_ids)
        results.append({'path': str(Path(path)), 'sha256': sha(path), 'runId': data.get('runId'),
                        'caseId': data.get('caseId'), 'caseRouteIds': data.get('caseRouteIds'),
                        'reportedCounts': data.get('counts'),
                        'timeCoverage': copy.deepcopy(data['timeCoverage']),
                        'frozenRecordedValidInterval': {
                            'recordedValidFrom': (data['timeCoverage'] or {}).get('recordedValidFrom'),
                            'recordedValidTo': (data['timeCoverage'] or {}).get('recordedValidTo'),
                            'framesRecorded': (data['timeCoverage'] or {}).get('framesRecorded'),
                            'distinctIntervalSeconds': (data['timeCoverage'] or {}).get(
                                'distinctIntervalSeconds'),
                            'preservedAsRead': True},
                        'joinedInventoryRecords': len(joined),
                        'joinedWithNativeOutput': sum(1 for e in joined.values()
                                                      if e['coverageStatus'] == AVAILABLE)})
        joins[str(path)] = joined

    merged = copy.deepcopy(inventory)
    per_route, arrays = {}, {}
    overlap_pairs, multi_joined, multi_available = {}, 0, 0
    overall = route_counter()
    available_ids, outside_ids = [], []

    for array in INVENTORY_ARRAYS:
        counts = route_counter()
        for position, record in enumerate(merged[array]):
            canonical = record['canonicalId']
            outputs = [joins[str(Path(p))][canonical] for p in result_paths
                       if canonical in joins[str(Path(p))]]
            # Union over runs: an outside-domain reading never cancels real coverage elsewhere.
            available = [o for o in outputs if o['coverageStatus'] == AVAILABLE]
            full_window = any(o['timeCoverage'].get('reachesRequestedEnd') is True for o in available)
            partial_only = bool(available) and not full_window
            status = AVAILABLE if available else OUTSIDE
            record['allRouteNativeOutputs'] = outputs
            record['allRouteNativeCoverage'] = {
                'status': status,
                'statusMeaning': None if available else OUTSIDE_MEANING,
                'suppliedResultsJoined': len(outputs),
                'resultsWithNativeOutput': len(available),
                'runIdsWithNativeOutput': [o['runId'] for o in available],
                'runIdsJoinedWithoutNativeOutput': [o['runId'] for o in outputs
                                                    if o['coverageStatus'] != AVAILABLE],
                'overlappingNativeOutputs': len(available) > 1,
                'fullRequestedWindowOutputAvailable': full_window,
                'partialWindowOutputOnly': partial_only,
                'derivedFrom': 'Supplied native readings only; pre-existing inventory model '
                               'fields were not consulted for this coverage status.',
                'notValidated': ['road depth', 'passability', 'continuous full-road coverage',
                                 'unique physical dip identity'],
            }

            if len(outputs) > 1: multi_joined += 1
            if len(available) > 1:
                multi_available += 1
                run_ids = sorted({str(o['runId']) for o in available})
                for i, left in enumerate(run_ids):
                    for right in run_ids[i + 1:]:
                        key = f'{left}|{right}'
                        overlap_pairs[key] = overlap_pairs.get(key, 0) + 1
            (available_ids if available else outside_ids).append(canonical)

            for bucket in (counts, overall):
                bucket['distinctEvidenceIdentities'] += 1
                bucket['byInventoryArray'][array] += 1
                bucket['nativeOutputAvailable' if available else 'outsideCompletedCases'] += 1
                bucket['withFullRequestedWindowOutput'] += int(full_window)
                bucket['withPartialWindowOutputOnly'] += int(partial_only)
                if len(available) > 1: bucket['withOverlappingAvailableOutputs'] += 1
            for route in record['routeIds']:
                bucket = per_route.setdefault(route, route_counter())
                bucket['distinctEvidenceIdentities'] += 1
                bucket['byInventoryArray'][array] += 1
                bucket['nativeOutputAvailable' if available else 'outsideCompletedCases'] += 1
                bucket['withFullRequestedWindowOutput'] += int(full_window)
                bucket['withPartialWindowOutputOnly'] += int(partial_only)
                if len(available) > 1: bucket['withOverlappingAvailableOutputs'] += 1
            del position
        arrays[array] = {'records': len(merged[array]),
                         'distinctCanonicalIds': len({r['canonicalId'] for r in merged[array]}),
                         'nativeOutputAvailable': counts['nativeOutputAvailable'],
                         'outsideCompletedCases': counts['outsideCompletedCases'],
                         'withOverlappingAvailableOutputs':
                             counts['withOverlappingAvailableOutputs']}

    provenance = {
        'schemaVersion': 1,
        'product': 'merged all-route native coverage ledger',
        'inventory': {'path': str(inventory_path), 'sha256': sha(inventory_path),
                      'schema': inventory.get('schema'), 'arrays': INVENTORY_ARRAYS,
                      'originalsEdited': False},
        'results': results,
        'joinRule': 'Exact canonicalId equality, with inventory coordinates and route '
                    'memberships verified against every joined native reading.',
        'coverageRule': f'{AVAILABLE} requires location.status == {LOCATED} in a supplied '
                        f'reading AND native quantities actually present; otherwise '
                        f'{OUTSIDE}. Availability is the union over runs, so an '
                        'outside-domain reading cannot overwrite real coverage from another run.',
        'outsideCompletedCasesMeaning': OUTSIDE_MEANING,
        'evidenceCountMeaning': EVIDENCE_MEANING,
        'frozenValidIntervals': 'Recorded valid intervals are copied from each native reading '
                                'unchanged; not merged, widened or re-derived.',
        'allOutsideRecordsRetained': True,
        'counts': {
            'suppliedResults': len(results),
            'overall': overall,
            'byInventoryArray': arrays,
            'byRouteId': per_route,
            'overlappingOutputs': {
                'recordsJoinedToMultipleResults': multi_joined,
                'recordsWithNativeOutputInMultipleResults': multi_available,
                'byRunIdPair': overlap_pairs,
                'meaning': 'One evidence identity read in more than one completed case; the '
                           'same identity, not additional dips.'},
            'nativeOutputAvailableCanonicalIds': sorted(available_ids),
            'outsideCompletedCasesCanonicalIds': sorted(outside_ids),
        },
    }
    merged['allRouteNativeCoverage'] = provenance

    if output_path.exists(): raise ValueError(f'Output already exists: {output_path}')
    summary_path = output_path.parent / 'coverage-summary.json'
    if summary_path.exists(): raise ValueError(f'Output already exists: {summary_path}')
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(merged, indent=2) + '\n', encoding='utf-8')

    summary = {k: provenance[k] for k in ['schemaVersion', 'product', 'inventory', 'results',
                                          'joinRule', 'coverageRule',
                                          'outsideCompletedCasesMeaning', 'evidenceCountMeaning',
                                          'frozenValidIntervals', 'allOutsideRecordsRetained']}
    summary['mergedLedger'] = str(output_path)
    summary['counts'] = {k: provenance['counts'][k] for k in
                         ['suppliedResults', 'overall', 'byInventoryArray', 'byRouteId',
                          'overlappingOutputs']}
    summary_path.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    return merged, summary, summary_path


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--inventory', type=Path, required=True, help='all-route coverage-ledger.json')
    p.add_argument('--result', type=Path, action='append', required=True, metavar='PATH',
                   help='route-point-summary.json from inspect_route_result.py; repeatable')
    p.add_argument('--output', type=Path, required=True, help='new merged ledger JSON path')
    a = p.parse_args()
    _, summary, summary_path = merge(a.inventory, a.result, a.output)
    print(json.dumps({'mergedLedger': str(a.output), 'coverageSummary': str(summary_path),
                      'suppliedResults': summary['counts']['suppliedResults'],
                      'overall': summary['counts']['overall'],
                      'overlappingOutputs': summary['counts']['overlappingOutputs'],
                      'evidenceCountMeaning': EVIDENCE_MEANING}, indent=2))
