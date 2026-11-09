"""Validation only: observed USGS 09487000 inflow for the brawley-avra-west extended window (v2x), plus an hourly-mean variant.

Case forcing = the same method as tools/sfincs/brawley/build_brawley_inflow.py (`at`): the instantaneous 15-min reading at each
top-of-hour timestamp (linear between the two neighbours within 15 min if needed), cfs x 0.0283168. Every hour of the window,
no NWM, no zero-fill, no carry-forward. The committed record tools/sfincs/data/brawley-avra-west-v1/observed/usgs-09487000-20261030-20261103.json
is the source; an optional --refetch NWIS IV response is compared value by value (provisional data can be revised).

Variants reported (NOT forcing): centred hourly mean (trapezoid of the 15-min readings over t-30..t+30 min) and the interval
mean of the four readings in [t, t+1h). Differences against top-of-hour sampling are written to the comparison file.

  python -I tools/sfincs/brawley/extend/build_extended_inflow.py --hours 74 --output tools/sfincs/data/brawley-avra-west-v2/extended \
      --refetch .sfincs-runs/brawley-avra-west-usgs-v2x/iv_09487000_refetch.json
"""
import argparse, hashlib, json
from datetime import datetime, timedelta, timezone
from pathlib import Path

OBS = Path('tools/sfincs/data/brawley-avra-west-v1/observed/usgs-09487000-20261030-20261103.json')
INLET, CFS = '15876941', 0.0283168
T0 = datetime(2026, 10, 30, 16, tzinfo=timezone.utc)
iso = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')
parse = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)
M15 = timedelta(minutes=15)


def at(vals, t):  # identical rule to build_brawley_inflow.at
    if t in vals: return vals[t]
    before = [k for k in vals if k < t and t - k <= M15]; after = [k for k in vals if k > t and k - t <= M15]
    if not before or not after: return None
    a, b = max(before), min(after); w = (t - a) / (b - a)
    return vals[a] + w * (vals[b] - vals[a])


def centred(vals, t):
    pts = [vals.get(t + i * M15) for i in range(-2, 3)]
    if any(p is None for p in pts): return None
    return (pts[0] / 2 + pts[1] + pts[2] + pts[3] + pts[4] / 2) / 4


def interval(vals, t):
    pts = [vals.get(t + i * M15) for i in range(4)]
    return None if any(p is None for p in pts) else sum(pts) / 4


def trapz(series):
    return sum((b[0] - a[0]).total_seconds() * (a[1] + b[1]) / 2 for a, b in zip(series, series[1:]))


def main():
    p = argparse.ArgumentParser(); p.add_argument('--hours', type=int, required=True); p.add_argument('--output', type=Path, required=True); p.add_argument('--refetch', type=Path)
    a = p.parse_args()
    rec = json.loads(OBS.read_text()); vals = {parse(x['time']): x['cfs'] for x in rec['values']}
    ks = sorted(vals)
    if rec['status'] != 'complete' or any(y - x != M15 for x, y in zip(ks, ks[1:])): raise SystemExit('gauge record has gaps; not resampling')
    times = [T0 + timedelta(hours=i) for i in range(a.hours + 1)]
    q = [at(vals, t) for t in times]
    if any(v is None for v in q): raise SystemExit('observed 09487000 does not cover every hour of the window')
    refetch = None
    if a.refetch:
        d = json.loads(a.refetch.read_text()); ts = d['value']['timeSeries'][0]; nod = ts['variable']['noDataValue']
        new = {datetime.fromisoformat(x['dateTime']).astimezone(timezone.utc): float(x['value']) for x in ts['values'][0]['value'] if float(x['value']) != nod}
        common = sorted(set(new) & set(vals)); diff = [(iso(k), vals[k], new[k]) for k in common if abs(vals[k] - new[k]) > 1e-9]
        quals = sorted({q for x in ts['values'][0]['value'] for q in x['qualifiers']})
        refetch = {'file': str(a.refetch).replace('\\', '/'), 'sha256': hashlib.sha256(a.refetch.read_bytes()).hexdigest(), 'url': d['value']['queryInfo']['queryURL'],
                   'readings': len(new), 'common': len(common), 'onlyInCommitted': len(set(vals) - set(new)), 'onlyInRefetch': len(set(new) - set(vals)), 'changedValues': diff[:50], 'changedCount': len(diff), 'qualifiers': quals}
        print('refetch', {k: v for k, v in refetch.items() if k != 'changedValues'}, flush=True)
    a.output.mkdir(parents=True, exist_ok=True)
    out = {'schemaVersion': 1, 'status': 'complete', 'kind': 'observed_gauge', 'issuedAt': None, 'start': iso(times[0]), 'end': iso(times[-1]),
           'series': [{'reachId': INLET, 'units': 'm3/s', 'points': [{'time': iso(t), 'flowM3s': round(v * CFS, 6)} for t, v in zip(times, q)]}],
           'provenance': {'source': 'USGS 09487000 Brawley Wash near Three Points, IV 00060, provisional (P)', 'file': '../../brawley-avra-west-v1/observed/usgs-09487000-20261030-20261103.json',
                          'method': 'instantaneous 15-min value at each top-of-hour timestamp (all timestamps fall on a reading), cfs x 0.0283168 = m3/s; same rule as build_brawley_inflow.py',
                          'purpose': f'Validation-only extended window ({a.hours} h, {iso(times[0])}..{iso(times[-1])}); every hour observed; not live forcing.',
                          'tool': 'tools/sfincs/brawley/extend/build_extended_inflow.py', 'externalInlet': {'reachId': INLET, 'receivingReachId': '15876923'}},
           'noModelExecuted': True, 'missingReachIds': []}
    (a.output / 'brawley-avra-west-inflow-observed-v2x.json').write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    obs15 = [(k, vals[k] * CFS) for k in ks if times[0] <= k <= times[-1]]
    variants = {'topOfHour': q, 'centredHourlyMean': [centred(vals, t) for t in times], 'intervalMeanStartLabel': [interval(vals, t) for t in times]}
    summ = {}
    for name, s in variants.items():
        ser = [(t, v * CFS) for t, v in zip(times, s) if v is not None]
        pk = max(ser, key=lambda x: x[1]); first = next((iso(t) for t, v in ser if v >= 10), None)
        summ[name] = {'peakM3s': round(pk[1], 3), 'peakTime': iso(pk[0]), 'volumeM3': round(trapz(ser)), 'firstAbove10m3s': first, 'missingHours': sum(v is None for v in s)}
    pk15 = max(obs15, key=lambda x: x[1])
    summ['readings15min'] = {'peakM3s': round(pk15[1], 3), 'peakTime': iso(pk15[0]), 'volumeM3': round(trapz(obs15)), 'firstAbove10m3s': next((iso(t) for t, v in obs15 if v >= 10), None)}
    rows = [{'time': iso(t), 'topOfHourCfs': variants['topOfHour'][i], 'centredMeanCfs': variants['centredHourlyMean'][i], 'intervalMeanCfs': variants['intervalMeanStartLabel'][i]} for i, t in enumerate(times)]
    big = sorted([r for r in rows if r['centredMeanCfs'] is not None], key=lambda r: -abs(r['centredMeanCfs'] - r['topOfHourCfs']))[:6]
    cmp = {'schemaVersion': 1, 'purpose': 'Hourly MEAN variants vs top-of-hour sampling (the case forcing). Report only; not forcing.', 'window': [iso(times[0]), iso(times[-1])],
           'summary': summ, 'largestHourDifferencesCfs': big, 'hourly': rows, 'refetchCheck': refetch}
    (a.output / 'inflow-hourly-mean-vs-top-of-hour.json').write_text(json.dumps(cmp, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'summary': summ, 'largest': big}, indent=1))


if __name__ == '__main__': main()
