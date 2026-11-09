"""Depth to groundwater (USGS parameter 72019, ft below land surface) in the brawley-avra-west context box.

Public USGS Water Data OGC API (no login): https://api.waterdata.usgs.gov/ogcapi/v0/collections/field-measurements
The legacy waterservices.usgs.gov/nwis/gwlevels service was decommissioned (fall 2025).
Purpose: decide whether GCN10 "drained" curve numbers apply, i.e. whether the seasonal
high water table is deeper than 60 cm (NRCS NEH 630 ch. 7, dual hydrologic soil groups).
Every reading is kept; nothing is filled. Summary uses the shallowest reading per well.
"""
import argparse, json, statistics, urllib.request, urllib.parse
from pathlib import Path

API = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/field-measurements/items'


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/geo+json'}), timeout=120) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--bbox', default='-111.51,31.92,-111.0,32.48', help='lon/lat of the 10 m context box 452000-500000 E, 3532000-3594000 N (EPSG:32612)')
    ap.add_argument('--time', default='2015-01-01T00:00:00Z/2026-11-09T00:00:00Z')
    ap.add_argument('--output', type=Path, required=True)
    a = ap.parse_args()
    q = urllib.parse.urlencode({'f': 'json', 'bbox': a.bbox, 'parameter_code': '72019', 'time': a.time, 'limit': 10000})
    url, feats = API + '?' + q, []
    while url:
        page = get(url)
        feats += page['features']
        url = next((l['href'] for l in page.get('links', []) if l.get('rel') == 'next'), None)
    rows = []
    for f in feats:
        p = f['properties']
        if p['unit_of_measure'] != 'ft':
            raise ValueError('unexpected unit ' + p['unit_of_measure'])
        if p['value'] in (None, ''):
            continue  # no reading; not treated as anything
        rows.append({'site': p['monitoring_location_id'], 'time': p['time'], 'depthFt': float(p['value']),
                     'qualifier': p.get('qualifier'), 'approval': p['approval_status'], 'lonlat': f['geometry']['coordinates']})
    sites = {}
    for r in rows:
        sites.setdefault(r['site'], []).append(r)
    per_site = []
    for s, rs in sorted(sites.items()):
        shallow = min(rs, key=lambda r: r['depthFt'])
        per_site.append({'site': s, 'lonlat': rs[0]['lonlat'], 'readings': len(rs), 'shallowestFt': shallow['depthFt'],
                         'shallowestTime': shallow['time'], 'shallowestQualifier': shallow['qualifier'],
                         'latestFt': max(rs, key=lambda r: r['time'])['depthFt'], 'latestTime': max(r['time'] for r in rs)})
    sh = sorted(x['shallowestFt'] for x in per_site)
    summary = {'source': API, 'query': {'bbox': a.bbox, 'parameter_code': '72019 depth to water level, ft below land surface', 'time': a.time},
               'readings': len(rows), 'wells': len(per_site),
               'shallowestReadingAnyWellFt': sh[0] if sh else None, 'shallowestReadingAnyWellM': round(sh[0] * 0.3048, 2) if sh else None,
               'medianOfPerWellShallowestFt': statistics.median(sh) if sh else None,
               'wellsWithAnyReadingShallowerThan2ft(0.6m)': sum(1 for v in sh if v < 0.6 / 0.3048),
               'wellsShallowerThan50ft': [x for x in per_site if x['shallowestFt'] < 50],
               'threshold': 'NRCS NEH 630 ch. 7: dual groups A/D, B/D, C/D take the drained (first) group where the seasonal high water table is kept or naturally deeper than 60 cm (2 ft)',
               'perWell': per_site}
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(summary, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({k: v for k, v in summary.items() if k != 'perWell'}, indent=1))


if __name__ == '__main__':
    main()
