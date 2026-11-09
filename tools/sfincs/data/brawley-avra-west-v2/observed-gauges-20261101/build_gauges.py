"""Build gauges.json: observed stream sensors in or next to the brawley-avra-west domain, Nov 1-2 2026.

Read-only against the model: it reads the committed v2x result (pinned commit, --model-commit) and the NWM analysis in the repo,
and the raw downloads in ./raw (gzipped, exact bytes as served). Nothing is zero-filled: an interval with no report
is listed as a gap with unknown value. ALERT readings are provisional county data; USGS IV readings are provisional.

Run (from the worktree root):
  H:/AI/Projects/FloodPLAIN-sfincs/.venv/Scripts/python.exe -I \
      tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/build_gauges.py
"""
import argparse
import gzip
import hashlib
import html
import json
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.ops import unary_union

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
RAW = HERE / 'raw'
COMP = ROOT / 'tools/sfincs/data/brawley-avra-west-v2/components'
RESULT = 'tools/sfincs/data/brawley-avra-west-v2/extended/result-42544624673'
NWM = ROOT / 'tools/sfincs/data/brawley-avra-west-v1/nwm-validation-reaches.json'
MST = timezone(timedelta(hours=-7))
CFS = 0.0283168466
WIN = ('2026-11-01T12:00Z', '2026-11-03T06:00Z')   # stored series window (UTC)
TASK = ('2026-11-01T12:00Z', '2026-11-02T18:00Z')  # analysis window (UTC)
UA = 'FLOODplain/0.1 (personal flood-route check; github.com/godfather38/floodplain)'
SHOW = 'https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/showdata.php/?id[{s}]=&nm={n}'
DSS = 'https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/dss/dss_stream.php?id={s}'
IV = ('https://waterservices.usgs.gov/nwis/iv/?format=json&sites={s}&parameterCd=00060,00065'
      '&startDT=2026-11-01T00:00Z&endDT=2026-11-03T12:00Z&siteStatus=all')
RETRIEVED = {'showdata': '2026-11-09T03:13:45Z..03:17:29Z', 'nwis': '2026-11-09T03:13:59Z..03:15:57Z',
             'dss': '2026-11-09T03:15:58Z..03:16:01Z', 'feeds': '2026-11-09T03:05Z..03:17:13Z'}


def raw(name):
    b = gzip.open(RAW / f'{name}.gz').read()
    return b, hashlib.sha256(b).hexdigest()


def z(t):
    return t.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def utc(s):
    return datetime.strptime(s.replace('Z', ''), '%Y-%m-%dT%H:%M' + (':%S' if s.count(':') == 2 else '')).replace(tzinfo=timezone.utc)


def head(name, n):
    return {'file': f'raw/{name}.gz', 'sha256OfUncompressed': raw(name)[1], 'url': n}


def parse_showdata(site):
    """The county page's table (Date, Time, feet[, cfs]); times are Arizona MST (UTC-7, no DST)."""
    b, h = raw(f'alert_showdata_{site}.html')
    t = b.decode('utf-8', errors='replace')
    meta_txt = html.unescape(re.sub(r'<[^>]*>', '\t', re.sub(r'<script.*?</script>', ' ', t, flags=re.S)))
    lines = [ln for ln in (re.sub(r'\s*\t\s*', '\t', x).strip('\t ') for x in meta_txt.splitlines()) if ln]
    rows, header = [], []
    for ln in lines:
        m = re.match(r'(\d\d)/(\d\d)/(\d{4})\t(\d\d:\d\d:\d\d)\t(.*)$', ln)
        if not m:
            if len(header) < 12:
                header.append(ln)
            continue
        mo, d, y, hms, rest = m.groups()
        parts = rest.split('\t')
        loc = datetime.strptime(f'{y}-{mo}-{d}T{hms}', '%Y-%m-%dT%H:%M:%S').replace(tzinfo=MST)
        rec = {'timeUtc': z(loc), 'timeLocal': loc.isoformat(), 'raw': parts}
        rec['flag'] = any('?' in p for p in parts)
        v0 = parts[0].replace('?', '')
        rec['value'] = float(v0) if re.fullmatch(r'-?\d+(\.\d+)?', v0) else None
        if len(parts) > 1:
            v1 = parts[1].replace('?', '')
            rec['flowCfs'] = float(v1) if re.fullmatch(r'-?\d+(\.\d+)?', v1) else None
            if rec['flowCfs'] is None:
                rec['flowText'] = parts[1]
        rows.append(rec)
    rows.sort(key=lambda r: r['timeUtc'])
    return rows, header, h


def in_win(rows, w=WIN):
    a, b = w[0].replace('Z', ':00Z'), w[1].replace('Z', ':00Z')
    return [r for r in rows if a <= r['timeUtc'] <= b]


def gaps(rows, minutes=65):
    out = []
    for p, q in zip(rows, rows[1:]):
        dt = (utc(q['timeUtc']) - utc(p['timeUtc'])).total_seconds() / 60
        if dt > minutes:
            out.append({'fromUtc': p['timeUtc'], 'toUtc': q['timeUtc'], 'minutes': round(dt), 'value': 'unknown (no report)'})
    return out


def peaks(series, key, prom):
    """Local maxima with prominence >= prom (in the series' own units); plateaus keep the first time."""
    v = [s[key] for s in series]
    out = []
    i = 0
    while i < len(v):
        j = i
        while j + 1 < len(v) and v[j + 1] == v[i]:
            j += 1
        left = v[i - 1] if i > 0 else None
        right = v[j + 1] if j + 1 < len(v) else None
        if v[i] is not None and (left is None or left < v[i]) and (right is None or right < v[i]):
            lmin = min([x for x in v[:i] if x is not None] or [v[i]])
            k = i - 1
            lo = v[i]
            while k >= 0 and v[k] is not None and v[k] <= v[i]:
                lo = min(lo, v[k]); k -= 1
            ro = v[i]
            k = j + 1
            while k < len(v) and v[k] is not None and v[k] <= v[i]:
                ro = min(ro, v[k]); k += 1
            p = v[i] - max(lo, ro)
            if p >= prom:
                out.append({'timeUtc': series[i]['timeUtc'], 'timeLocal': series[i]['timeLocal'], key: v[i], 'prominence': round(p, 3),
                            **({'plateauToUtc': series[j]['timeUtc']} if j > i else {})})
            del lmin
        i = j + 1
    return out


def nwis(site):
    b, h = raw(f'nwis_iv_{site}.json')
    d = json.loads(b)
    out = {}
    for ts in d['value']['timeSeries']:
        par = ts['variable']['variableCode'][0]['value']
        nod = ts['variable']['noDataValue']
        vals = []
        for x in ts['values'][0]['value']:
            t = datetime.fromisoformat(x['dateTime'])
            v = float(x['value'])
            vals.append({'timeUtc': z(t), 'timeLocal': t.isoformat(), 'value': None if v == nod else v, 'qualifiers': x['qualifiers']})
        out[par] = vals
    return out, h, d['value']['timeSeries'][0]['sourceInfo']['siteName'] if d['value']['timeSeries'] else None


# ---------------------------------------------------------------- geometry
T = Transformer.from_crs(4326, 32612, always_xy=True)
dom_fc = json.load(open(COMP / 'active-domain.geojson'))
assert dom_fc['crs']['properties']['name'].endswith('32612'), dom_fc['crs']
DOM = unary_union([shape(f['geometry']) for f in dom_fc['features']])
NET = [(f['properties'], shape(f['geometry'])) for f in json.load(open(COMP / 'brawley-avra-west-network.geojson'))['features']]
NETU = []
for p, g in NET:
    gs = list(g.geoms) if g.geom_type.startswith('Multi') else [g]
    from shapely.geometry import LineString, MultiLineString
    NETU.append((p, MultiLineString([LineString([T.transform(*c[:2]) for c in x.coords]) for x in gs])))


def where(lat, lon):
    pt = Point(*T.transform(lon, lat))
    near = sorted(NETU, key=lambda t: t[1].distance(pt))[:2]
    return {'lat': lat, 'lon': lon, 'inActiveDomain': bool(DOM.contains(pt)),
            'distanceToDomainBoundaryM': round(DOM.boundary.distance(pt)),
            'nearestNetworkReaches': [{'comid': n[0]['comid'], 'gnis': n[0]['gnis_name'].strip() or None, 'distanceM': round(n[1].distance(pt), 1),
                                       'totDaKm2': round(n[0]['totdasqkm'], 1)} for n in near]}


# ---------------------------------------------------------------- model + NWM
# The model side is read from a pinned commit, not from HEAD, so a re-run gives the same gauges.json on any later
# commit. 8b1d2f02cdc0 is the commit the committed gauges.json was first built from (its modelCommit).
ap = argparse.ArgumentParser()
ap.add_argument('--model-commit', default='8b1d2f02cdc0', help='commit to read the v2x result from (default: the one gauges.json records)')
ap.add_argument('--output', type=Path, default=HERE / 'gauges.json', help='where to write (default: gauges.json next to this script)')
ARGS = ap.parse_args()
HEADSHA = subprocess.check_output(['git', 'rev-parse', '--short=12', ARGS.model_commit], cwd=ROOT).decode().strip()
summ = json.loads(subprocess.check_output(['git', 'show', f'{HEADSHA}:{RESULT}/summary.json'], cwd=ROOT))
full = json.loads(subprocess.check_output(['git', 'show', f'{HEADSHA}:{RESULT}/validation-full.json'], cwd=ROOT))
secs = full['sectionsHourlyM3s']
nwm = {s['reachId']: {p['time'].replace(':00:00Z', 'Z'): p['flowM3s'] for p in s['points']} for s in json.load(open(NWM))['analysisFullWindow']['series']}


def hourly_keys(a='2026-11-01T18:00Z', b='2026-11-02T18:00Z'):
    t, e, out = utc(a), utc(b), []
    while t <= e:
        out.append(t.strftime('%Y-%m-%dT%H:%MZ')); t += timedelta(hours=1)
    return out


def obs_at(series, key, hk):
    """Report exactly at the hour, else the latest earlier report and its age (ALERT reports on change, so the value
    between reports is not measured; the age says how stale it is). Never interpolated, never zero-filled."""
    t = utc(hk)
    before = [s for s in series if utc(s['timeUtc']) <= t]
    if not before:
        return None
    s = before[-1]
    age = (t - utc(s['timeUtc'])).total_seconds() / 60
    return {'reportUtc': s['timeUtc'], 'ageMin': round(age), key: s[key]}


# ---------------------------------------------------------------- sensors
sensors = []
alert_meta = {
    '6443': ('Brawley Wash at Milewide Road (PT)', 32.248611, -111.244446, 'stream PT (pressure transducer) stage with county rating; rating effective 07/01/2015-01/01/2030'),
    '6423': ('Brawley Wash at Three Points (PT)', 32.075554, -111.338333, 'stream PT stage with county rating; rating effective 07/01/2015-01/01/2030; co-located with USGS 09487000'),
    '5033': ('AZGFD 3 - PT', 32.16695, -111.328484, 'PT stage only, no rating (no discharge column)'),
    '4103': ('AZGFD1 - PT', 32.33849, -111.411911, 'PT stage only, no rating'),
    '5023': ('AZGFD 2 - PT', 32.347321, -111.465012, 'PT stage only, no rating'),
    '1345': ('Santa Cruz River at Trico Road (Pinal County stage)', 32.471603, -111.301956, 'Pinal County stage only'),
    '782': ('Sasco Road (Pinal County stage)', 32.570831, -111.334717, 'Pinal County stage with rating'),
    '739': ('McClellan Wash at CAP Stage (Pinal County)', 32.669167, -111.349167, 'Pinal County stage with rating'),
}
role = {
    '6443': ('in-domain stream gauge; the only observed point downstream of the inlet on the Brawley system',
             'Mile Wide Black Wash 15876815 band (ALERT 6443)', ['Mile Wide both bands', 'Mile Wide Brawley 15877627 band'], True),
    '6423': ('inlet (just upstream of the domain boundary); same site as USGS 09487000', 'inlet face 276978 / reach 15876941 (forcing)', [], False),
    '5033': ('in domain but off-channel (271 m from a 3.4 km2 headwater reach); stage nearly constant 3.4-3.5 ft; not a wave-timing point', None, [], False),
    '4103': ('in domain but off-channel (832 m from the nearest NHD flowline); stage 3.49-3.59 ft; not a wave-timing point', None, [], False),
    '5023': ('in domain but off-channel (865 m from the nearest NHD flowline); slow stage rise over the event; not a wave-timing point', None, [], False),
    '1345': ('outside the domain on the Santa Cruz River, upstream of where Brawley/Los Robles joins it (confluence at -111.3987, 32.5372, about 10 km downstream); it cannot see Brawley water', None, [], False),
    '782': ('outside the domain (11 km), not on the Brawley/Los Robles path', None, [], False),
    '739': ('outside the domain (22 km), not on the Brawley/Los Robles path', None, [], False),
}
for site, (name, lat, lon, kind) in alert_meta.items():
    rows, header, h = parse_showdata(site)
    w = in_win(rows)
    has_q = any('flowCfs' in r for r in rows)
    ser = []
    for r in w:
        rec = {'timeUtc': r['timeUtc'], 'timeLocal': r['timeLocal'], 'stageFt': r['value']}
        if has_q:
            rec['flowCfs'] = r.get('flowCfs')
            rec['flowM3s'] = None if r.get('flowCfs') is None else round(r['flowCfs'] * CFS, 3)
            if 'flowText' in r:
                rec['flowText'] = r['flowText']
        if r['flag']:
            rec['provisionalFlag'] = '?'
        ser.append(rec)
    # a report more than 20 ft from the window median is a transmission spike (AZGFD 3 sends 201.8 ft twice, 1 s apart):
    # kept in the series with suspect set, left out of the summary; never replaced by a value
    vals = sorted(s['stageFt'] for s in ser if s['stageFt'] is not None)
    med = vals[len(vals) // 2] if vals else None
    for s in ser:
        if med is not None and s['stageFt'] is not None and abs(s['stageFt'] - med) > 20:
            s['suspect'] = f'more than 20 ft from the window median ({med} ft)'

    tw = in_win(rows, TASK)
    pre = [r['value'] for r in rows if r['timeUtc'] < '2026-11-01T16:00:00Z' and r['timeUtc'] >= '2026-11-01T06:00:00Z' and r['value'] is not None]
    base = max(set(pre), key=pre.count) if pre else None
    tser = [s for s in ser if s['timeUtc'] <= TASK[1].replace('Z', ':00Z') and 'suspect' not in s]
    rise = next((s for s in tser if base is not None and s['stageFt'] is not None and s['stageFt'] - base >= 0.05), None)
    key = 'flowCfs' if has_q and site in ('6443', '6423') else 'stageFt'
    good = [s for s in tser if s.get(key) is not None]
    mx = max(good, key=lambda s: s[key]) if good else None
    prom = 150 if key == 'flowCfs' else 0.3
    pk = peaks(good, key, prom) if good else []
    first_q = next((s for s in tser if (s.get('flowCfs') or 0) > 0), None) if has_q else None
    loc = where(lat, lon)
    rl = role[site]
    sensors.append({
        'id': f'ALERT {site}', 'operator': 'Pima County Regional Flood Control District ALERT' if site not in ('1345', '782', '739') else 'Pinal County (relayed on the Pima ALERT map)',
        'name': name, 'sensorType': kind, 'location': loc, 'role': rl[0], 'modelSection': rl[1], 'modelSectionsAlso': rl[2], 'usedForDownstreamTiming': rl[3],
        'units': {'stage': 'ft (gauge datum, not NAVD88; not a water-surface elevation)', **({'flow': 'cfs (county rating, provisional); m3/s = cfs x 0.0283168'} if has_q else {})},
        'timeBasis': 'page times are Arizona MST (UTC-7); timeUtc = local + 7 h',
        'dataQuality': 'provisional county data; ' + (f"{sum(1 for r in w if r['flag'])} readings flagged '?' in the stored window" if w else 'no readings in window')
                       + '; reports are event-driven (on change) plus hourly, so the value between reports is not measured',
        'source': {**head(f'alert_showdata_{site}.html', SHOW.format(s=site, n=1500 if site not in ('6450', '6460', '6480', '6500') else 1000)),
                   'retrievedUtc': RETRIEVED['showdata'], 'pageHeader': header[:6], 'rowsOnPage': len(rows), 'pageSpanUtc': [rows[0]['timeUtc'], rows[-1]['timeUtc']]},
        'summaryTaskWindow': {
            'windowUtc': list(TASK), 'reports': len(tw), 'baseStageFt': base,
            'firstRiseUtc': rise['timeUtc'] if rise else None, 'firstRiseStageFt': rise['stageFt'] if rise else None,
            **({'firstFlowAboveZeroUtc': first_q['timeUtc'], 'firstFlowAboveZeroCfs': first_q['flowCfs']} if first_q else {}),
            'maxBy': key, 'max': ({'timeUtc': mx['timeUtc'], 'timeLocal': mx['timeLocal'], key: mx[key], 'stageFt': mx['stageFt'],
                                   **({'flowM3s': mx.get('flowM3s')} if has_q else {})} if mx else None),
            'peaks': pk, 'peakProminenceThreshold': f'{prom} {"cfs" if key == "flowCfs" else "ft"}',
            'gapsOver65min': gaps(tw), 'suspectReportsExcluded': [s['timeUtc'] + ' ' + str(s['stageFt']) + ' ft' for s in ser if 'suspect' in s],
        },
        'series': ser,
    })

# rain gauges: context only (timing of rain at and above Mile Wide), cumulative inches as reported
rain = []
for site, name in [('6440', 'Brawley Wash at Milewide Road (rain)'), ('6420', 'Brawley Wash at Three Points (rain)'), ('6450', 'Hilltop Road - Brawley Basin (rain)'),
                   ('6460', 'Picture Rocks Community Center (rain)'), ('6480', 'Trico Rd north of Manville (rain)'), ('6500', 'Arizona-Sonora Desert Museum (rain)')]:
    rows, header, h = parse_showdata(site)
    w = in_win(rows)
    hrs = {}
    prev = None
    for r in w:
        if r['value'] is None:
            continue
        if prev is not None and r['value'] > prev:
            k = r['timeUtc'][:13] + 'Z'
            hrs[k] = round(hrs.get(k, 0) + r['value'] - prev, 2)
        prev = r['value']
    rain.append({'id': f'ALERT {site}', 'name': name, 'units': 'inches, accumulator increments by report (tips of 0.04 in)', 'source': head(f'alert_showdata_{site}.html', SHOW.format(s=site, n=1500 if site in ('6440', '6420') else 1000)),
                 'incrementsByUtcHour': hrs, 'totalInWindow': round(sum(hrs.values()), 2), 'note': 'an hour not listed had no tip reported; reports are event-driven'})

# USGS
usgs = []
umeta = {
    '09487000': ('inlet; case forcing; just upstream of the domain boundary (790 m)', 'inlet face 276978 / reach 15876941 (forcing)', 32.0756601, -111.3387473),
    '09486520': ('outside the domain (4.0 km), Santa Cruz River upstream of the Brawley/Los Robles confluence; does not see Brawley water', None, 32.47158889, -111.3019667),
    '09486500': ('outside the domain (10 km), Santa Cruz River at Cortaro, upstream of Trico; context only', None, 32.3507222, -111.095875),
}
for site, (rl, sec, lat, lon) in umeta.items():
    d, h, nm = nwis(site)
    q = [dict(x, flowCfs=x['value'], flowM3s=None if x['value'] is None else round(x['value'] * CFS, 3)) for x in d.get('00060', [])]
    st = {x['timeUtc']: x['value'] for x in d.get('00065', [])}
    ser = [{'timeUtc': x['timeUtc'], 'timeLocal': x['timeLocal'], 'flowCfs': x['flowCfs'], 'flowM3s': x['flowM3s'], 'gageHeightFt': st.get(x['timeUtc']),
            'qualifiers': x['qualifiers']} for x in q if WIN[0].replace('Z', ':00Z') <= x['timeUtc'] <= WIN[1].replace('Z', ':00Z')]
    tw = [s for s in ser if s['timeUtc'] <= TASK[1].replace('Z', ':00Z') and s['flowCfs'] is not None]
    mx = max(tw, key=lambda s: s['flowCfs'])
    base = tw[0]['flowCfs']
    fr = next((s for s in tw if s['flowCfs'] >= max(10 * base, base + 100)), None)
    exp = [s for s in ser]
    gp = []
    for p_, q_ in zip(exp, exp[1:]):
        dt = (utc(q_['timeUtc']) - utc(p_['timeUtc'])).total_seconds() / 60
        if dt > 15:
            gp.append({'fromUtc': p_['timeUtc'], 'toUtc': q_['timeUtc'], 'minutes': round(dt), 'value': 'unknown (no reading)'})
    missing = sum(1 for s in ser if s['flowCfs'] is None)
    usgs.append({'id': f'USGS {site}', 'operator': 'USGS NWIS instantaneous values', 'name': nm, 'sensorType': '15-min discharge (00060) and gage height (00065)',
                 'location': where(lat, lon), 'role': rl, 'modelSection': sec, 'usedForDownstreamTiming': False,
                 'units': {'flow': 'ft3/s; m3/s = cfs x 0.0283168', 'stage': 'ft gage height (gauge datum)'}, 'timeBasis': 'NWIS times carry -07:00; timeUtc converted',
                 'dataQuality': f"qualifiers {sorted({q for s in ser for q in s['qualifiers']})} (P = provisional); {missing} missing values; gaps over 15 min: {len(gp)}",
                 'source': {**head(f'nwis_iv_{site}.json', IV.format(s=site)), 'retrievedUtc': RETRIEVED['nwis']},
                 'summaryTaskWindow': {'windowUtc': list(TASK), 'baseFlowCfs': base, 'frontUtc': fr['timeUtc'] if fr else None, 'frontCfs': fr['flowCfs'] if fr else None,
                                       'max': {'timeUtc': mx['timeUtc'], 'timeLocal': mx['timeLocal'], 'flowCfs': mx['flowCfs'], 'flowM3s': mx['flowM3s']},
                                       'gapsOver15min': gp},
                 'series': ser})

i87 = usgs[0]['series']
crest = [s for s in i87 if s['flowCfs'] is not None and s['flowCfs'] >= 1300]
usgs[0]['summaryTaskWindow']['crestAtOrAbove1300cfs'] = {'fromUtc': crest[0]['timeUtc'], 'toUtc': crest[-1]['timeUtc'], 'readings': len(crest)}

no_iv = []
for site, nm, why in [('09487250', 'LOS ROBLES WASH NEAR MARANA, ARIZ. (32.4378, -111.3043; on Brawley 945050510 downstream of the domain outlet)', 'historical site; NWIS IV returned no series'),
                      ('321452111143601', 'MISC BRAWLEY WASH A MILE WIDE ROAD N TUCSON, AZ', 'miscellaneous measurement site; NWIS IV returned no series'),
                      ('09487100', 'LITTLE BRAWLEY WASH NEAR THREE POINTS, ARIZ.', 'historical site; no IV (see tools/sfincs/data/brawley-avra-west-v1/observed/usgs-09487100-20261030-20261103.json)'),
                      ('09486515', 'SANTA CRUZ RIVER AT SANDERS RD. NR. MARANA, AZ.', 'IV only 1991-1992; no series for the window'),
                      ('09486510', 'SANTA CRUZ RIVER NR. RILLITO, AZ.', 'IV only 1991-1992; no series for the window')]:
    f = 'nwis_iv_09487250.json' if site in ('09487250', '321452111143601') else (f'nwis_iv_{site}.json' if site.startswith('094865') else None)
    no_iv.append({'id': f'USGS {site}', 'name': nm, 'status': 'no data (not zero flow)', 'why': why,
                  **({'source': head(f, IV.format(s='09487250,321452111143601' if site in ('09487250', '321452111143601') else site))} if f else {})})

# ---------------------------------------------------------------- Mile Wide comparison
a6443 = sensors[0]
obs = [s for s in a6443['series'] if s['flowCfs'] is not None]
bw = secs['Mile Wide Black Wash 15876815 band (ALERT 6443)']
both = secs['Mile Wide both bands']
br = secs['Mile Wide Brawley 15877627 band']
table = []
for hk in hourly_keys():
    o = obs_at(obs, 'flowCfs', hk)
    k2 = hk.replace(':00Z', ':00Z')
    table.append({'hourUtc': hk, 'observed': None if o is None else {**o, 'flowM3s': round(o['flowCfs'] * CFS, 2)},
                  'modelBlackWashBandM3s': bw.get(k2), 'modelBothBandsM3s': both.get(k2), 'modelBrawleyBandM3s': br.get(k2),
                  'nwm15876811M3s': None if nwm['15876811'].get(hk.replace(':00Z', 'Z')) is None else round(nwm['15876811'][hk.replace(':00Z', 'Z')], 2),
                  'nwm15876815M3s': None if nwm['15876815'].get(hk.replace(':00Z', 'Z')) is None else round(nwm['15876815'][hk.replace(':00Z', 'Z')], 2)})


def trap(points):
    v = 0.0
    for (t0, q0), (t1, q1) in zip(points, points[1:]):
        v += (utc(t1) - utc(t0)).total_seconds() * (q0 + q1) / 2
    return v


def post_build_edits(o):
    """The 2026-11-09 corrections, first made by hand in gauges.json and now written here so a re-run reproduces the file.
    Every number in the text is computed from the raw pages and asserted, so the wording cannot drift from the data."""
    a = o['sensors'][0]
    assert a['id'] == 'ALERT 6443'
    ser = a['series']
    q = [s for s in ser if s['flowCfs'] is not None]
    # --- the ~817 cfs claim: the value appears twice; which report the owner saw is not known
    r817 = [s for s in q if s['flowCfs'] == 817.0 and '2026-11-01T12:00:00Z' <= s['timeUtc'] <= '2026-11-02T06:00:00Z']
    assert [s['timeUtc'] for s in r817] == ['2026-11-01T23:55:00Z', '2026-11-02T02:45:00Z'], [s['timeUtc'] for s in r817]
    other, at0245 = r817
    n03 = next(s for s in q if s['timeUtc'] == '2026-11-02T03:00:00Z')
    mx = a['summaryTaskWindow']['max']
    c = o['alert6443Claim']
    c['verdict'] = 'CONFIRMED value; the report the owner saw is UNCERTAIN'
    c['context'] = (f"817 cfs appears twice in the primary series: at 02:45Z Nov 2 (19:45 MST, {at0245['stageFt']:.2f} ft, falling limb of the third and smallest peak) "
                    f"and at 23:55Z Nov 1 (16:55 MST, {other['stageFt']:.2f} ft, first recession). The 03:00Z Nov 2 report is {n03['flowCfs']:.0f} cfs ({n03['flowM3s']} m3/s). "
                    f"Which report the owner saw at about 20:04 MST is not known, so no single corrected time is given; model runs are compared with the primary "
                    f"series at each hour (at 03Z: {n03['flowM3s']} m3/s). The event maximum at ALERT 6443 was {mx['flowCfs']:.0f} cfs ({mx['flowM3s']} m3/s) at {mx['timeUtc']}.")
    c['otherReport817'] = {k: other[k] for k in ('timeUtc', 'timeLocal', 'stageFt', 'flowCfs', 'flowM3s')}
    # --- gauge name vs NHD snap
    snap = a['location']['nearestNetworkReaches'][0]
    assert snap['comid'] == 15876815 and snap['distanceM'] == 4.8, snap
    nw = o['mileWideComparison']['nwmPeaks']
    v11, v15 = nw['15876811']['peak'], nw['15876815']['peak']
    snap_txt = (f"The county names the gauge 'Brawley Wash at Milewide Road' (page header '{a['source']['pageHeader'][1]}'), but its coordinates snap to NHD 15876815 "
                f"(Black Wash / San Joaquin outlet, 604 km2) at {snap['distanceM']} m; the Brawley 15877627 crossing is 0.8 km west. Both are stated because they point to "
                f"different comparisons: if the NHD geometry is right the gauge sees the Black Wash band (and NWM 15876815, peak {v15:.2f} m3/s); if the county name means "
                f"the combined Brawley flow at the road, it sees both bands (and NWM 15876811, peak {v11:.2f} m3/s). Which is right is not settled, so both are reported.")
    o['mileWideComparison']['gauge'] += ' ' + snap_txt
    a['nameAndNetworkSnap'] = snap_txt
    # --- low-stage rating step, from the stage/flow pairs of every report on the page
    rows, _, _ = parse_showdata('6443')
    pairs = {}
    for r in rows:
        if r['value'] is not None and r.get('flowCfs') is not None:
            pairs.setdefault(r['value'], set()).add(r['flowCfs'])
    zero_top = max(k for k, v in pairs.items() if v == {0.0})
    f = lambda st: sorted(pairs[st])
    assert len(rows) == 1000 and zero_top == 2.49 and 2.60 not in pairs, (len(rows), zero_top)
    assert f(2.50) == [16.0, 17.0] and f(2.59) == [330.0, 332.0] and f(2.61) == [383.0], (f(2.50), f(2.59), f(2.61))
    pl = [s for s in q if '2026-11-02T08:45:00Z' <= s['timeUtc'] <= '2026-11-02T16:20:00Z']
    st0, st1 = min(s['stageFt'] for s in pl), max(s['stageFt'] for s in pl)
    c0, c1 = min(s['flowCfs'] for s in pl), max(s['flowCfs'] for s in pl)
    m0, m1 = min(s['flowM3s'] for s in pl), max(s['flowM3s'] for s in pl)
    tail = next(s for s in ser if s['timeUtc'] == '2026-11-03T06:00:00Z')
    nov8 = next(r for r in reversed(rows) if r['timeUtc'].startswith('2026-11-08'))
    assert (nov8['value'], nov8.get('flowCfs')) == (2.30, 0.0), nov8
    step = (f"0 cfs up to {zero_top:.2f} ft, {f(2.50)[0]:.0f}-{f(2.50)[-1]:.0f} cfs at 2.50 ft, {f(2.59)[0]:.0f}-{f(2.59)[-1]:.0f} cfs at 2.59 ft, "
            f"{f(2.61)[0]:.0f} cfs at 2.61 ft")
    tw = a['summaryTaskWindow']
    tw['baseStageNote'] = (f"baseStageFt is the pre-event base reading (0 cfs), not the rating zero-flow stage; rated flow is 0 cfs at every report up to {zero_top:.2f} ft "
                           f"and {f(2.50)[0]:.0f}-{f(2.50)[-1]:.0f} cfs at 2.50 ft")
    tw['lowStageRatingCaveat'] = (f"County rating at low stage, from the stage/flow pairs of all {len(rows):,} reports on the page: {step} (no report at exactly 2.60 ft). "
                                  f"The flow jumps from 0 to about 380 cfs over 0.1 ft, so the 08:45-16:20Z Nov 2 plateau ({st0:.2f}-{st1:.2f} ft, {m0:.1f}-{m1:.1f} m3/s) "
                                  f"and the slow tail (still {tail['stageFt']:.2f} ft, {tail['flowCfs']:.0f} cfs at 06Z Nov 3; {nov8['value']:.2f} ft, {nov8['flowCfs']:.0f} cfs on Nov 8) "
                                  f"may be a rating or stage-shift artifact.")
    # --- volumes with and without the suspect plateau; the 16:20-18:00Z report gap is bridged linearly in all totals
    vm = o['mileWideComparison']['volumeM3']
    plv = round(trap([(s['timeUtc'], s['flowM3s']) for s in pl]))
    gp = [(s['timeUtc'], s['flowM3s']) for s in q if '2026-11-02T16:20:00Z' <= s['timeUtc'] <= '2026-11-02T18:00:00Z']
    assert [t for t, _ in gp] == ['2026-11-02T16:20:00Z', '2026-11-02T18:00:00Z'], gp
    vm['plateau0845to1620Z_Nov2'] = plv
    vm['observed18Zto18ZWithoutPlateau'] = vm['observed18Zto18Z'] - plv
    vm['observed16Zto18ZWithoutPlateau'] = vm['observed16Zto18Z'] - plv
    vm['plateauNote'] = (f"The 08:45-16:20Z Nov 2 reports sit at {st0:.2f}-{st1:.2f} ft, {c0:.0f}-{c1:.0f} cfs ({m0:.2f}-{m1:.2f} m3/s). On this rating that is on the steep "
                         f"low-stage step ({step} in the {len(rows):,} reports on the page), so a few hundredths of a foot of stage shift (sediment at the sensor, a moved "
                         f"control) would read as hundreds of cfs. The plateau may be a rating or stage-shift artifact. Leaving it out is a bracket, not a measurement: "
                         f"if it is an artifact the true flow then is unknown, not zero. The 16:20-18:00Z gap (100 min) is bridged linearly in all totals "
                         f"({round(trap(gp)):,} m3).")
    # --- stage rise: measured from the base reading, which is not the rating's zero-flow stage
    sr = o['mileWideComparison']['stageRise']
    # the rise arithmetic above uses 2.30 ft: the dry pre-event reading (Oct 31 21Z and Nov 8 on the page, both 0 cfs);
    # summaryTaskWindow.baseStageFt (2.31) is the Nov 1 06-16Z mode and is not what the rise is measured from
    base_ft = 2.30
    oct31 = next(r for r in rows if r['timeUtc'] == '2026-10-31T21:00:00Z')
    assert (oct31['value'], oct31.get('flowCfs'), nov8['value']) == (base_ft, 0.0, base_ft), oct31
    o['mileWideComparison']['stageRise'] = {
        'note': (f"Observed stage is on the gauge datum; the rise is measured from the pre-event base reading {base_ft:.2f} ft. {base_ft:.2f} ft is the "
                 f"base reading, not the rating's zero-flow stage (the rated flow stays 0 cfs up to {zero_top:.2f} ft). The model is zs on its cell. Only rises are "
                 f"comparable, and only roughly; this is not a water-level comparison."),
        'observedMaxAboveBaseReadingM': sr['observedMaxAboveZeroFlowStageM'], 'observedAt0915ZAboveBaseReadingM': sr['observedAt0915ZAboveZeroFlowStageM'],
        'modelGaugeCellZsMax': sr['modelGaugeCellZsMax'], 'modelGaugeCellZsMaxTime': sr['modelGaugeCellZsMaxTime']}
    # --- rain timing from the tip times of the six rain gauges (tips strictly after the 17:05 minute)
    tips = {}
    for site in ('6440', '6500', '6460', '6420', '6450', '6480'):
        w = [r for r in in_win(parse_showdata(site)[0]) if r['value'] is not None]
        tips[site] = [(w[i]['timeUtc'], w[i]['value'] - w[i - 1]['value']) for i in range(1, len(w)) if w[i]['value'] > w[i - 1]['value']]
    late = {s: [(t, d) for t, d in v if '2026-11-01T17:06:00Z' <= t < '2026-11-02T00:00:00Z'] for s, v in tips.items()}
    tot = {s: round(sum(d for _, d in v), 2) for s, v in late.items()}
    last = {s: v[-1][0][11:16] for s, v in late.items()}
    nxt = min((t for v in tips.values() for t, _ in v if t >= '2026-11-01T21:30:00Z'))
    nxt_site = next(s for s, v in tips.items() if any(t == nxt for t, _ in v))
    assert max(last.values()) == '21:27' and nxt[11:16] == '07:06' and nxt_site == '6460', (last, nxt, nxt_site)
    o['rainWindow'] = (f"From the tip times in raw/alert_showdata_64x0: the main burst was 14:45-17:05Z Nov 1 at all six gauges. Lighter rain followed after 17:05Z: "
                       f"6440 Mile Wide {tot['6440']:.2f} in to {last['6440']}Z, 6500 {tot['6500']:.2f} in to {last['6500']}Z, 6460 {tot['6460']:.2f} in to {last['6460']}Z, "
                       f"6420 {tot['6420']:.2f} in to {last['6420']}Z, 6450 {tot['6450']:.2f} in to {last['6450']}Z, 6480 {tot['6480']:.2f} in at {last['6480']}Z. "
                       f"The last tips were ALERT 6420 at {last['6420']}Z and 6450 at {last['6450']}Z, so 'no rain' starts about 21:30Z Nov 1 and lasts until "
                       f"{nxt[11:16]}Z Nov 2 (first tip, {nxt_site}).")
    o['postBuildEdits'] = ('2026-11-09 corrections (alert6443Claim verdict/context/otherReport817, mileWideComparison.gauge naming, volumeM3 plateau fields, '
                           'stageRise keys and note, sensors[ALERT 6443].nameAndNetworkSnap and summaryTaskWindow baseStageNote/lowStageRatingCaveat, rainWindow). '
                           'First made by hand; since 2026-11-09 written by build_gauges.py post_build_edits(), with every number computed from raw/ and asserted, '
                           'so a re-run reproduces this file.')


ov = [(s['timeUtc'], s['flowM3s']) for s in obs if '2026-11-01T18:00:00Z' <= s['timeUtc'] <= '2026-11-02T18:00:00Z']
ov16 = [(s['timeUtc'], s['flowM3s']) for s in obs if '2026-11-01T16:00:00Z' <= s['timeUtc'] <= '2026-11-02T18:00:00Z']
mvol = lambda sec: trap([(k, v) for k, v in sec.items() if '2026-11-01T18:00Z' <= k <= '2026-11-02T18:00Z'])
pk = {p['timeUtc']: p for p in a6443['summaryTaskWindow']['peaks']}
o09 = obs_at(obs, 'flowCfs', '2026-11-02T09:00Z')

claim = next(s for s in obs if s['timeUtc'] == '2026-11-02T02:45:00Z')
nxt = next(s for s in obs if s['timeUtc'] == '2026-11-02T03:00:00Z')
u0200 = next(s for s in i87 if s['timeUtc'] == '2026-11-02T02:00:00Z')
a6423_0245 = next(s for s in sensors[1]['series'] if s['timeUtc'] == '2026-11-02T02:45:00Z')

out = {
    'schemaVersion': 1,
    'purpose': 'Observed stream sensors in or next to the brawley-avra-west domain for the Nov 1-2 2026 event, mapped to model sections, '
               'to judge the v2x model against reality. Validation only, not forcing, no tuning.',
    'builtBy': 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/build_gauges.py', 'modelCommit': HEADSHA,
    'domain': {'file': 'tools/sfincs/data/brawley-avra-west-v2/components/active-domain.geojson', 'crs': dom_fc['crs']['properties']['name'],
               'crsCheck': 'EPSG:32612 (UTM 12N) declared in the file; sensor lon/lat transformed with pyproj 4326->32612; '
                           'the inlet USGS 09487000 lands 790 m outside the boundary, as expected for an upstream inlet'},
    'searchedSources': {
        'dataBranch': 'origin/data holds one force-pushed commit (14cb2a7, 2026-11-09T02:51Z): the snapshot workflow replaces it every ~10 min, '
                      'so it has no Nov 1-2 history. Nothing was read from it except to confirm that.',
        'pimaAlert': 'alertmap.rfcd.pima.gov currentstream.php (all stream sensors) and showdata.php (last 1000 reports per sensor, which reach back to '
                     'late Sep-mid Oct 2026, so Nov 1-2 is fully covered).',
        'usgs': 'waterservices.usgs.gov site service (bbox -111.55,31.90,-110.95,32.60, all stream sites) and IV service for every site with IV.',
        'feeds': [head('alert_currentstream_20261109.json', 'https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currentstream.php'),
                  head('alert_currain_20261109.json', 'https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currain.php'),
                  head('nwis_site_catalog_iv.rdb', 'https://waterservices.usgs.gov/nwis/site/?format=rdb&bBox=-111.55,31.95,-111.15,32.60&siteType=ST&siteStatus=all&seriesCatalogOutput=true&outputDataTypeCd=iv'),
                  head('nwis_site_all.rdb', 'https://waterservices.usgs.gov/nwis/site/?format=rdb&bBox=-111.55,31.95,-111.15,32.60&siteType=ST&siteStatus=all')]
                 + [head(f'alert_dss_{s}.html', DSS.format(s=s)) for s in ('6443', '6423', '5033', '4103', '5023')],
        'retrievedUtc': RETRIEVED, 'userAgent': UA,
    },
    'timeBasisCheck': 'ALERT pages are in Arizona MST: (1) the newest showdata row equals currentstream last_rpt, which tools/snapshot_alert.py '
                      'treats as UTC-7 and which matched the data-branch snapshot fetched at 02:51Z; (2) ALERT 6423 jumps 0.41->2.12 ft at 14:00 local while '
                      'the co-located USGS 09487000 (times stamped -07:00) jumps 66 -> 1570 cfs between 14:00 and 14:15 -07:00.',
    'alert6443Claim': {
        'claim': '~817 cfs at ~03:04Z Nov 2 (owner, 20:04 MST, second-hand)',
        'verdict': 'CONFIRMED value, CORRECTED time and context',
        'primary': {'timeUtc': claim['timeUtc'], 'timeLocal': claim['timeLocal'], 'stageFt': claim['stageFt'], 'flowCfs': claim['flowCfs'], 'flowM3s': claim['flowM3s']},
        'nextReport': {'timeUtc': nxt['timeUtc'], 'stageFt': nxt['stageFt'], 'flowCfs': nxt['flowCfs'], 'flowM3s': nxt['flowM3s']},
        'context': f"817 cfs is the 19:45 MST (02:45Z) report, on the falling limb of the third and smallest of three peaks. The event maximum at ALERT 6443 "
                   f"was {a6443['summaryTaskWindow']['max']['flowCfs']:.0f} cfs ({a6443['summaryTaskWindow']['max']['flowM3s']} m3/s) at "
                   f"{a6443['summaryTaskWindow']['max']['timeUtc']}. The same value (817) also appears at 16:55 MST (23:55Z) on the first recession.",
        'companionClaim': f"The owner's '1,160 cfs at Three Points' equals USGS 09487000 at {u0200['timeUtc']} (19:00 MST, {u0200['flowCfs']} cfs), the latest USGS "
                          f"value an ALERT-map viewer would see at about 20:04 MST; ALERT 6423 at 19:45 MST read {a6423_0245['flowCfs']} cfs.",
    },
    'mileWideComparison': {
        'gauge': 'ALERT 6443, 4.8 m from NHD 15876815 (San Joaquin/Black Wash outlet, 604 km2); the Brawley 15877627 crossing is 0.8 km west. '
                 'The model section that contains the gauge is the Black Wash 15876815 band; both-bands is the upper bound if the gauge saw the combined flow.',
        'hourly': table,
        'hourlyNote': "observed = the report at the hour, or the latest earlier report with its age in minutes (no interpolation); model = v2x hourly restart flux "
                      "across the section (m3/s); NWM = analysis_assim (ends 07Z Nov 2). Model hourly values exist from 18Z Nov 1.",
        'observedPeaks': a6443['summaryTaskWindow']['peaks'],
        'modelPeaks': {'blackWashBand': summ['timing']['Mile Wide Black Wash 15876815 band (ALERT 6443)'], 'bothBands': summ['timing']['Mile Wide both bands'],
                       'brawleyBand': summ['timing']['Mile Wide Brawley 15877627 band']},
        'nwmPeaks': {'15876811': summ['nwmAnalysis']['15876811'], '15876815': summ['nwmAnalysis']['15876815']},
        'atModelPeak09Z': {'observed': {**o09, 'flowM3s': round(o09['flowCfs'] * CFS, 2)}, 'modelBlackWashBandM3s': bw['2026-11-02T09:00Z'], 'modelBothBandsM3s': both['2026-11-02T09:00Z']},
        'volumeM3': {'observed18Zto18Z': round(trap(ov)), 'observed16Zto18Z': round(trap(ov16)),
                     'modelBlackWashBand18Zto18Z': round(mvol(bw)), 'modelBothBands18Zto18Z': round(mvol(both)),
                     'method': 'trapezoid between reports (observed; linear across report gaps, which is an assumption) and between hourly fluxes (model)'},
        'stageRise': {'observedMaxAboveZeroFlowStageM': round((a6443['summaryTaskWindow']['max']['stageFt'] - 2.30) * 0.3048, 2),
                      'observedAt0915ZAboveZeroFlowStageM': round((next(s for s in reversed(obs) if s['timeUtc'] <= '2026-11-02T09:15:00Z')['stageFt'] - 2.30) * 0.3048, 2),
                      'modelGaugeCellZsMax': summ['alert6443']['gaugeCellZsMax'], 'modelGaugeCellZsMaxTime': summ['alert6443']['gaugeCellZsMaxTime'],
                      'note': 'Observed stage is on the gauge datum (2.30 ft = zero flow), the model is zs on its cell. Only rises are comparable, and only roughly; '
                              'this is not a water-level comparison.'},
    },
    'downstreamPoints': {
        'Manville (15876771)': 'no stream sensor; rain gauge ALERT 6480 (Trico Rd north of Manville) only',
        'Tucker (15876711)': 'no stream sensor',
        'Outlet 720060498': 'no sensor; USGS 09487250 Los Robles Wash near Marana (12 km downstream on Brawley 945050510) is a historical site with no IV data',
        'Santa Cruz at Trico (USGS 09486520 / ALERT 1345)': 'upstream of the Brawley/Los Robles confluence; it measures Santa Cruz water only and cannot time the Brawley wave',
    },
    'sensors': sensors,
    'usgs': usgs,
    'usgsNoData': no_iv,
    'rainContext': rain,
}
post_build_edits(out)
with open(ARGS.output, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
    f.write('\n')
print('wrote', ARGS.output)
for s in sensors + usgs:
    print(s['id'], s['location']['inActiveDomain'], s['location']['distanceToDomainBoundaryM'], s['location']['nearestNetworkReaches'][0], json.dumps(s['summaryTaskWindow'])[:600])
print(json.dumps(out['alert6443Claim'], indent=1))
print(json.dumps({k: v for k, v in out['mileWideComparison'].items() if k != 'hourly'}, indent=1)[:4000])
for r in table:
    print(r['hourUtc'], r['observed'] and (r['observed']['reportUtc'][11:16], r['observed']['ageMin'], r['observed']['flowM3s']), r['modelBlackWashBandM3s'], r['modelBothBandsM3s'], r['nwm15876811M3s'], r['nwm15876815M3s'])
for r in rain:
    print(r['id'], r['totalInWindow'], r['incrementsByUtcHour'])
