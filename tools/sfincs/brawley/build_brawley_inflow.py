"""Assemble the brawley-avra-west frozen inflow files, observed gauge files and the NWM-vs-USGS comparison.

Inputs (produced earlier by make_nwm_crosswalk.py, tools/sfincs/fetch_frozen_nwm.py and fetch_nwm_validation_aa.py):
  .sfincs-runs/brawley-avra-west-nwm-v1/{crosswalk.json, history/series.json, forecast/series.json, validation-aa/series.json}
  raw USGS IV responses passed with --usgs-raw (one or more json files per site)

  python tools/sfincs/brawley/build_brawley_inflow.py --usgs-raw <dir with iv_<site>_<date>.json>

No value is zero-filled or carried forward: a missing NWM frame or a gap in the 15-min USGS record stops the build.
"""
import argparse, hashlib, json
from datetime import datetime, timedelta, timezone
from pathlib import Path

CACHE = Path('.sfincs-runs/brawley-avra-west-nwm-v1')
OUT = Path('tools/sfincs/data/brawley-avra-west-v1')
INLET = '15876941'
CFS = 0.0283168  # m3/s per cfs
T0 = datetime(2026, 10, 30, 16, tzinfo=timezone.utc)
HIST_N, FORE_ISSUE = 47, datetime(2026, 11, 1, 13, tzinfo=timezone.utc)
iso = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')
parse = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
dump = lambda p, o: (p.parent.mkdir(parents=True, exist_ok=True), p.write_text(json.dumps(o, indent=2) + '\n', encoding='utf-8'))
HIST_TIMES = [T0 + timedelta(hours=i) for i in range(HIST_N)]
FORE_TIMES = [FORE_ISSUE + timedelta(hours=i) for i in range(1, 19)]
ALL_TIMES = HIST_TIMES + [t for t in FORE_TIMES if t > HIST_TIMES[-1]]  # 64 timestamps, 0..63 h


def nwm(kind):
    s = json.loads((CACHE / kind / 'series.json').read_text())
    if s['status'] != 'complete': raise SystemExit(kind + ' not complete')
    return s


def case_file(kind, series, reach_ids, provenance, issued=None, times=None):
    pts = {s['reachId']: s['points'] for s in series['series']}
    out = []
    for r in reach_ids:
        p = pts[r]
        if [x['time'] for x in p] != [iso(t) for t in times]: raise SystemExit(f'{kind} {r}: times differ from the frozen window')
        out.append({'reachId': r, 'units': 'm3/s', 'points': [{'time': x['time'], 'flowM3s': x['flowM3s']} for x in p]})
    return {'schemaVersion': 1, 'status': 'complete', 'kind': kind, 'issuedAt': issued, 'start': iso(times[0]), 'end': iso(times[-1]),
            'series': out, 'provenance': provenance, 'noModelExecuted': True, 'missingReachIds': []}


def usgs(raw_dir, site):
    files = sorted(Path(raw_dir).glob(f'iv_{site}_*.json'))
    vals, meta, requests = {}, None, []
    for f in files:
        d = json.loads(f.read_text())
        requests.append({'file': f.name, 'url': d['value']['queryInfo']['queryURL'], 'sha256': sha(f), 'timeSeries': len(d['value']['timeSeries'])})
        for ts in d['value']['timeSeries']:
            meta = ts
            nodata = ts['variable']['noDataValue']
            for x in ts['values'][0]['value']:
                v = float(x['value'])
                if v == nodata: continue  # a no-data flag is missing, never zero
                vals[datetime.fromisoformat(x['dateTime']).astimezone(timezone.utc)] = {'cfs': v, 'qualifiers': x['qualifiers'], 'local': x['dateTime']}
    return vals, meta, requests


def at(vals, t):
    """Instantaneous value at t; linear between the two neighbours when t is between 15-min readings. None if not bracketed within 15 min."""
    if t in vals: return vals[t]['cfs']
    before = [k for k in vals if k < t and t - k <= timedelta(minutes=15)]; after = [k for k in vals if k > t and k - t <= timedelta(minutes=15)]
    if not before or not after: return None
    a, b = max(before), min(after); w = (t - a) / (b - a)
    return vals[a]['cfs'] + w * (vals[b]['cfs'] - vals[a]['cfs'])


def trapz_m3(points):  # points: [(datetime, m3s)]
    return sum((b[0] - a[0]).total_seconds() * (a[1] + b[1]) / 2 for a, b in zip(points, points[1:]))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--usgs-raw', type=Path, required=True); a = ap.parse_args()
    cross = json.loads((CACHE / 'crosswalk.json').read_text())
    hist, fore, val = nwm('history'), nwm('forecast'), json.loads((CACHE / 'validation-aa' / 'series.json').read_text())
    if {f['issuedAt'] for f in fore['sourceFrames']} != {iso(FORE_ISSUE)}: raise SystemExit('forecast frames not all from the 13Z issue')
    dump(OUT / 'nwm-crosswalk.json', cross)
    frames = {'schemaVersion': 1, 'note': 'Per-frame source identity for the brawley-avra-west NWM files (ETag is the S3 object id, not a sha256 of the remote file).',
              'history': [{k: f[k] for k in ('url', 'etag', 'contentLength', 'issuedAt', 'time')} for f in hist['sourceFrames']],
              'forecast': [{k: f[k] for k in ('url', 'etag', 'contentLength', 'issuedAt', 'time')} for f in fore['sourceFrames']]}
    dump(OUT / 'nwm-source-frames.json', frames)
    prov = lambda kind: {'source': 'NOAA National Water Model v3.1 archived native channel_rt (s3 noaa-nwm-pds)', 'crosswalk': 'nwm-crosswalk.json', 'sourceFrames': 'nwm-source-frames.json#' + kind,
                         'tool': 'tools/sfincs/fetch_frozen_nwm.py --crosswalk .sfincs-runs/brawley-avra-west-nwm-v1/crosswalk.json' + (' --history' if kind == 'history' else ''),
                         'externalInlet': {'reachId': INLET, 'receivingReachId': '15876923', 'note': 'USGS 09487000 Brawley Wash near Three Points sits on 15876941 (NLDI measure 99.149); the ~27 km2 local catchment of 15876941 below the gauge is excluded from the domain and its runoff is not added.'}}
    dump(OUT / 'brawley-avra-west-history.json', case_file('archived_analysis', hist, [INLET], prov('history'), None, HIST_TIMES))
    dump(OUT / 'brawley-avra-west-forecast.json', case_file('frozen_forecast', fore, [INLET], prov('forecast'), iso(FORE_ISSUE), FORE_TIMES))
    others = [r for r in cross['indices'] if r != INLET]
    vh = case_file('archived_analysis', hist, list(cross['indices']), prov('history'), None, HIST_TIMES)
    vf = case_file('frozen_forecast', fore, list(cross['indices']), prov('forecast'), iso(FORE_ISSUE), FORE_TIMES)
    vaa = {s['reachId']: s['points'] for s in val['series']}
    if [p['time'] for p in vaa[INLET]] != [iso(t) for t in ALL_TIMES]: raise SystemExit('validation AA times differ')
    dump(OUT / 'nwm-validation-reaches.json', {
        'schemaVersion': 1, 'purpose': 'Validation only. Not case forcing. The case forcing is brawley-avra-west-{history,forecast}.json (15876941 only).',
        'reaches': {'15876941': 'Brawley Wash at USGS 09487000 (case inlet)', '15876923': 'Brawley Wash, receiving reach of the inlet', '15876919': 'Brawley Wash, Little Brawley 15876917 joins (old USGS 09487100 site)',
                    '15876811': 'Brawley Wash at the 15876815 confluence (ALERT 6443 Milewide is on this reach)', '15876815': 'San Joaquin/Black Wash outlet (604 km2 subtree, inside domain)',
                    '15876711': 'Brawley Wash, last reach to node 720060498 (domain outlet, Northern inlet)', '15876707': 'Reach ending at node 720060498 (Northern inlet)'},
        'history': {k: vh[k] for k in ('kind', 'start', 'end', 'series')}, 'forecast': {k: vf[k] for k in ('kind', 'issuedAt', 'start', 'end', 'series')},
        'analysisFullWindow': {'kind': 'validation_analysis', 'note': 'analysis_assim tm00 for every hour 2026-10-30T16Z..2026-11-02T07Z (NWM hindcast of the whole event; not available to a live 13Z run). nudgeM3s is the NWM data-assimilation nudge.',
                               'tool': 'tools/sfincs/brawley/fetch_nwm_validation_aa.py --start 2026-10-30T16 --hours 64', 'series': val['series'],
                               'sourceFrames': [{k: f[k] for k in ('url', 'etag', 'issuedAt', 'time')} for f in val['sourceFrames']]},
        'provenance': {'crosswalk': 'nwm-crosswalk.json'}})

    # ---- USGS observed
    raw_files = sorted(a.usgs_raw.glob('iv_*.json'))
    sites = sorted({f.name.split('_')[1] for f in raw_files})
    obs = {}
    for site in sites:
        vals, meta, reqs = usgs(a.usgs_raw, site)
        rec = {'schemaVersion': 1, 'site': site, 'parameterCd': '00060', 'units': 'ft3/s', 'retrievedAt': '2026-11-08', 'requests': reqs,
               'source': 'USGS NWIS Instantaneous Values service (waterservices.usgs.gov/nwis/iv), provisional data subject to revision',
               'requestedWindowLocal': '2026-10-30T00:00-07:00 .. 2026-11-03T23:59-07:00 (two requests)'}
        if meta is None:
            rec.update({'status': 'no_data', 'note': 'The IV service returned no time series for this site and window. NWIS site service lists it as a historical site only (no IV series); this is no data, not zero flow.', 'values': []})
        else:
            ks = sorted(vals); gaps = [(iso(x), iso(y)) for x, y in zip(ks, ks[1:]) if y - x != timedelta(minutes=15)]
            rec.update({'status': 'complete' if not gaps else 'gaps', 'siteName': meta['sourceInfo']['siteName'],
                        'location': {'lat': meta['sourceInfo']['geoLocation']['geogLocation']['latitude'], 'lon': meta['sourceInfo']['geoLocation']['geogLocation']['longitude']},
                        'nhdComid': '15876941' if site == '09487000' else None, 'gaps': gaps,
                        'values': [{'time': iso(k), 'local': vals[k]['local'], 'cfs': vals[k]['cfs'], 'qualifiers': vals[k]['qualifiers']} for k in ks]})
            obs[site] = vals
        dump(OUT / 'observed' / f'usgs-{site}-20261030-20261103.json', rec)

    v = obs['09487000']
    ks = sorted(v)
    if any(y - x != timedelta(minutes=15) for x, y in zip(ks, ks[1:])): raise SystemExit('09487000 record has gaps; not resampling')
    hourly = [(t, at(v, t)) for t in ALL_TIMES]
    if any(q is None for _, q in hourly): raise SystemExit('observed 09487000 does not cover every frozen timestamp')
    oprov = lambda part: {'source': 'USGS 09487000 Brawley Wash near Three Points, IV 00060, provisional (P)', 'file': 'observed/usgs-09487000-20261030-20261103.json',
                          'method': 'instantaneous 15-min value at each top-of-hour timestamp (all timestamps fall on a reading; no interpolation used), cfs x 0.0283168 = m3/s',
                          'purpose': 'Validation-run variant: replaces the NWM inflow at reach 15876941 with the observed gauge hydrograph. Not live forcing. ' + part,
                          'externalInlet': {'reachId': INLET, 'receivingReachId': '15876923'}}
    mk = lambda times, kind, issued, part: {'schemaVersion': 1, 'status': 'complete', 'kind': kind, 'issuedAt': issued, 'start': iso(times[0]), 'end': iso(times[-1]),
                                            'series': [{'reachId': INLET, 'units': 'm3/s', 'points': [{'time': iso(t), 'flowM3s': round(at(v, t) * CFS, 6)} for t in times]}],
                                            'provenance': oprov(part), 'noModelExecuted': True, 'missingReachIds': []}
    dump(OUT / 'brawley-avra-west-history-observed.json', mk(HIST_TIMES, 'observed_gauge', None, 'History part (same 47 timestamps as the NWM history file).'))
    dump(OUT / 'brawley-avra-west-forecast-observed.json', mk(FORE_TIMES, 'observed_gauge', None, 'Forecast part (same 18 timestamps as the NWM forecast file; issuedAt null because these are observations).'))

    # ---- comparison
    w0, w1 = ALL_TIMES[0], ALL_TIMES[-1]
    obs15 = [(k, v[k]['cfs'] * CFS) for k in ks]
    obs_win = [(k, q) for k, q in obs15 if w0 <= k <= w1]
    hpts = {s['reachId']: s['points'] for s in hist['series']}; fpts = {s['reachId']: s['points'] for s in fore['series']}
    frozen = [(parse(p['time']), p['flowM3s']) for p in hpts[INLET]] + [(parse(p['time']), p['flowM3s']) for p in fpts[INLET] if parse(p['time']) > HIST_TIMES[-1]]
    aa = [(parse(p['time']), p['flowM3s']) for p in vaa[INLET]]
    pk = lambda s: max(s, key=lambda x: x[1])
    first = lambda s, thr: next((iso(t) for t, q in s if q >= thr), None)
    summ = lambda s: {'peakM3s': round(pk(s)[1], 4), 'peakCfs': round(pk(s)[1] / CFS, 1), 'peakTime': iso(pk(s)[0]), 'volumeM3': round(trapz_m3(s)), 'firstAbove1m3s': first(s, 1.0), 'firstAbove10m3s': first(s, 10.0)}
    cmp = {'schemaVersion': 1, 'window': [iso(w0), iso(w1)], 'reach': INLET, 'gauge': '09487000',
           'observed15minInWindow': summ(obs_win), 'observedHourlyResampled': summ(hourly and [(t, q * CFS) for t, q in hourly]),
           'observedFullEvent': summ(obs15), 'nwmFrozenCaseInflow': summ(frozen), 'nwmAnalysisFullWindow': summ(aa),
           'nwmForecastIssue13zMax': summ([(parse(p['time']), p['flowM3s']) for p in fpts[INLET]]),
           'nudgeAt': {p['time']: p['nudgeM3s'] for p in vaa[INLET] if p['time'] in ('2026-11-01T21:00:00Z', '2026-11-01T22:00:00Z', '2026-11-02T00:00:00Z', '2026-11-02T03:00:00Z')}}
    dump(OUT / 'nwm-vs-usgs-09487000.json', cmp)
    print(json.dumps(cmp, indent=1))


if __name__ == '__main__':
    main()
