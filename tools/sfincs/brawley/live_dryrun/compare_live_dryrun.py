"""Compare two unpublished live all-route outputs of the same HRRR cycle (cna registered case vs cnb+btfilter dry run).

Usage (cwd = repo root):
  python tools/sfincs/brawley/live_dryrun/compare_live_dryrun.py CNA_OUT_DIR CNB_OUT_DIR OUT.json

Each OUT_DIR is the 'live-brawley-avra-west-unpublished-output' artifact (out/ with manifest.json, frame-*.bin.gz,
road-forecast.json, and local/local-road-forecast.json). Missing or negative native values stay UNKNOWN: they are
counted, never summed as zero (the finite sums below assert the two runs have the same unknown cells or report both).
Water is compared as native volume and water-surface elevation zs; no exact water level is inferred from depth.
"""
import json, sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'live'))
from export_road_forecast import read_columns  # noqa: E402


def frames(out):
    m = json.loads((out / 'manifest.json').read_text())
    for f in m['frames']:
        _, cols = read_columns(out / f['path'], 'floodplain-columns-v1', f['sha256'])
        yield f['time'], cols['nativeVolumeM3'].astype('float64'), cols['waterSurfaceM'].astype('float64')


def summary(out):
    m = json.loads((out / 'manifest.json').read_text())
    local = None
    for p in (out / 'local' / 'local-road-forecast.json', out.parent / 'local' / 'local-road-forecast.json',
              out / 'local-road-forecast.json'):
        if p.exists():
            local = json.loads(p.read_text()); break
    return m, local


def main():
    a, b, dest = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    ma, la = summary(a); mb, lb = summary(b)
    assert ma['sourceIssues']['HRRR'] == mb['sourceIssues']['HRRR'], 'different HRRR cycles'
    rows = []
    for (ta, va, za), (tb, vb, zb) in zip(frames(a), frames(b)):
        assert ta == tb, (ta, tb)
        known = np.isfinite(va) & np.isfinite(vb) & (va >= 0) & (vb >= 0)
        unknown_a = int((~np.isfinite(va) | (va < 0)).sum()); unknown_b = int((~np.isfinite(vb) | (vb < 0)).sum())
        # Sums over cells known in BOTH runs only; unknown counts are reported, not filled.
        zknown = np.isfinite(za) & np.isfinite(zb)
        dz = zb[zknown] - za[zknown]
        if not len(dz): dz = np.array([np.nan])
        rows.append({'time': ta, 'cellsKnownBoth': int(known.sum()), 'unknownCna': unknown_a, 'unknownCnb': unknown_b,
                     'zsKnownBoth': int(zknown.sum()), 'zsUnknownCna': int((~np.isfinite(za)).sum()),
                     'zsUnknownCnb': int((~np.isfinite(zb)).sum()),
                     'volumeKnownBothM3': {'cna': float(va[known].sum()), 'cnb': float(vb[known].sum())},
                     'cellsWithVolume': {'cna': int((va[known] > 0).sum()), 'cnb': int((vb[known] > 0).sum())},
                     'zsDiffM_cnbMinusCna': {'min': float(dz.min()), 'max': float(dz.max()),
                                              'cellsAbsOver1cm': int((np.abs(dz) > 0.01).sum())}})
    keys = ('runId', 'status', 'validFrom', 'validTo', 'timing', 'solverCompletion', 'inflowSource', 'flowNotes')
    result = {'hrrrCycle': ma['sourceIssues']['HRRR'], 'cna': {k: ma.get(k) for k in keys}, 'cnbBtf': {k: mb.get(k) for k in keys},
              'localRoadSummary': {'cna': (la or {}).get('summary'), 'cnbBtf': (lb or {}).get('summary')},
              'routeForecast': {'cna': ma.get('roadForecast'), 'cnbBtf': mb.get('roadForecast')}, 'frames': rows}
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(result, indent=1) + '\n')
    last = rows[-1]
    print(json.dumps({'frames': len(rows), 'last': last, 'local': result['localRoadSummary']}, indent=1))


if __name__ == '__main__':
    main()
