#!/usr/bin/env python3
"""Reuse existing NOAA HAND/FIM data for FLOODplain crossings.

Checks every crossing in public/data/crossings.geojson against the real rasters,
reaches, rating curves and forecasts. Clips data for each one that passes and
records the reason for each one that doesn't, all in
public/inundation/data/coverage.json.

HAND means Height Above Nearest Drainage: how far a cell sits above the stream
it drains to. No terrain, catchment or rating value is made up here; a crossing
that fails a check gets no file and is shown as missing coverage. Nothing here
says anything about road use.
"""
import argparse, base64, csv, datetime, hashlib, json, math, os, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path

BUCKET = 'https://ciroh-owp-hand-fim.s3.amazonaws.com'
NWPS = 'https://api.water.noaa.gov/nwps/v1'
HUCS = ['15050301', '15050302', '15050303', '15050304']
# Same identities as public/inundation/forecast-stations.js (a test keeps them equal).
STATIONS = {'SCTA3': {'usgsId': '09486520', 'reachId': '15890430'},
            'CSCA3': {'usgsId': '09486500', 'reachId': '15903137'},
            'BWTA3': {'usgsId': '09487000', 'reachId': '15876941'}}
MAX_REACH_DISTANCE_M = 100
MAX_GAUGE_KM = 10
MIN_VALID_HAND_FRACTION = 0.95
HAND_NODATA_CM, CATCHMENT_NONE = 65535, 255
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'public/inundation/data'
CACHE = Path(os.environ.get('HAND_CACHE', ROOT / '.hand-cache'))


# ---- Pure checks (tested without network or geo libraries) ----
def classify_point(reach, water=None, max_distance=MAX_REACH_DISTANCE_M):
    """Whether the HAND data can describe one crossing. reach: nearest HAND reach or None."""
    if not reach:
        return 'no_hand_catchment', 'No NOAA HAND catchment at this point.'
    if reach['distanceM'] > max_distance:
        return 'not_on_modeled_reach', f"The nearest HAND stream is {reach['distanceM']:.0f} m away, so its rating curve does not describe the water here."
    name = str(reach.get('name') or '').strip()
    if 'aqueduct' in name.lower():
        return 'needs_review', f"NOAA calls the nearest reach {name}, a canal name, so it may not be this water."
    if water and name and water.strip().lower() != name.lower():
        return 'needs_review', f"Our map data says {water}; NOAA calls the nearest reach {name}."
    return 'eligible', f"Within {reach['distanceM']:.0f} m of HAND reach {reach['featureId']}."


def forecast_for(reach, gauge, stations=STATIONS, max_km=MAX_GAUGE_KM):
    """Use a gauge only when it is linked along this channel and close. Otherwise the reach's model flow."""
    station = next((k for k, s in stations.items() if s['reachId'] == str(reach['featureId'])), None)
    if station and gauge and gauge['gaugeIs'] != 'unlinked' and gauge['alongChannelKm'] is not None and gauge['alongChannelKm'] <= max_km:
        return {'kind': 'gauge', 'station': station}
    return {'kind': 'nwm_reach', 'reachId': str(reach['featureId'])}


def reach_forecast_problem(raw, reach_id):
    """Reason a recorded NWM reach forecast can't be relied on, or None."""
    if str((raw.get('reach') or {}).get('reachId')) != str(reach_id):
        return 'reach identity mismatch'
    series = (raw.get('shortRange') or {}).get('series') or {}
    if series.get('units') != 'ft³/s':
        return f"unknown units {series.get('units')}"
    data = series.get('data') or []
    if not data:
        return 'no forecast values'
    if any(not isinstance(p.get('flow'), (int, float)) or p['flow'] < 0 for p in data):
        return 'invalid forecast value'
    return None


def rating_problem(stages, discharges):
    """Reason a rating curve can't be used, or None."""
    if len(stages) < 2 or len(stages) != len(discharges):
        return 'too few points'
    if any(not math.isfinite(v) or v < 0 for v in [*stages, *discharges]):
        return 'non-finite or negative value'
    if any(b <= a for a, b in zip(stages, stages[1:])):
        return 'stage does not rise'
    if any(b < a for a, b in zip(discharges, discharges[1:])):
        return 'discharge falls as stage rises'
    if discharges[-1] <= 0:
        return 'no flow above zero'
    return None


def stage_for_flow(flow, stages, discharges):
    """Linear lookup; None past the top of the curve, never extrapolated."""
    if flow > discharges[-1]:
        return None
    for i in range(1, len(discharges)):
        if flow <= discharges[i]:
            span = discharges[i] - discharges[i - 1]
            if span <= 0:
                return stages[i - 1]
            return stages[i - 1] + (flow - discharges[i - 1]) / span * (stages[i] - stages[i - 1])
    return stages[-1]


def slug(road, lon, lat):
    words = ''.join(c if c.isalnum() else '-' for c in road.lower()).strip('-')
    return f'{words}-{lat:.5f}-{abs(lon):.5f}'.replace('.', '-')


# ---- Source access ----
def url_for(key):
    return f'{BUCKET}/{key}'


def fetch_cached(url, name):
    path = CACHE / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=120) as r:
            body = r.read()
        path.write_bytes(body)
    return path


def object_record(key):
    """Size, date and ETag the bucket reports: the only version evidence it has."""
    ns = '{http://s3.amazonaws.com/doc/2006-03-01/}'
    with urllib.request.urlopen(f'{BUCKET}/?list-type=2&prefix={key}', timeout=60) as r:
        root = ET.fromstring(r.read())
    for item in root.findall(ns + 'Contents'):
        if item.find(ns + 'Key').text == key:
            return {'key': key, 'lastModified': item.find(ns + 'LastModified').text, 'size': int(item.find(ns + 'Size').text), 'etag': item.find(ns + 'ETag').text.strip('"')}
    raise SystemExit(f'Not in bucket: {key}')


def branches(huc):
    text = fetch_cached(url_for(f'{huc}/branch_ids.csv'), f'{huc}/branch_ids.csv').read_text()
    return [line.split(',')[1].strip() for line in text.splitlines() if line.strip()]


def reaches(huc, branch):
    import geopandas as gpd
    name = f'demDerived_reaches_split_filtered_addedAttributes_crosswalked_{branch}.gpkg'
    path = fetch_cached(url_for(f'{huc}/branches/{branch}/{name}'), f'{huc}/{branch}/{name}')
    return gpd.read_file(path)


def hydrotable(huc, branch):
    path = fetch_cached(url_for(f'{huc}/branches/{branch}/hydroTable_{branch}.csv'), f'{huc}/{branch}/hydroTable.csv')
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


def reach_name(feature_id):
    path = CACHE / 'reach-names.json'
    names = json.loads(path.read_text()) if path.exists() else {}
    key = str(feature_id)
    if key not in names:
        try:
            with urllib.request.urlopen(f'{NWPS}/reaches/{key}', timeout=30) as r:
                names[key] = json.load(r).get('name') or ''
        except Exception:
            names[key] = ''
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(names))
    return names[key]


def open_raster(key):
    import rasterio
    os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    return rasterio.open('/vsicurl/' + url_for(key))


def catchment_key(huc, branch):
    return f'{huc}/branches/{branch}/gw_catchments_reaches_filtered_addedAttributes_{branch}.tif'


def hand_key(huc, branch):
    return f'{huc}/branches/{branch}/rem_zeroed_masked_{branch}.tif'


def nearest_reach(lon, lat, hits):
    """Nearest HAND reach among the branches whose catchment contains the point."""
    import shapely
    from pyproj import Transformer
    best = None
    for hit in hits:
        frame = reaches(hit['huc'], hit['branch'])
        x, y = Transformer.from_crs(4326, frame.crs, always_xy=True).transform(lon, lat)
        distance = frame.distance(shapely.Point(x, y))
        i = distance.idxmin()
        if best is None or distance[i] < best['distanceM']:
            best = {'huc': hit['huc'], 'branch': hit['branch'], 'hydroId': int(frame.loc[i, 'HydroID']), 'featureId': int(frame.loc[i, 'feature_id']), 'distanceM': round(float(distance[i]), 1)}
    if best:
        best['name'] = reach_name(best['featureId'])
    return best


def catchment_hits(points):
    """Every branch whose catchment raster has a value at each point."""
    from pyproj import Transformer
    found = {k: [] for k in points}
    for huc in HUCS:
        for branch in branches(huc):
            with open_raster(catchment_key(huc, branch)) as src:
                t = Transformer.from_crs(4326, src.crs, always_xy=True)
                xy = [t.transform(*points[k]) for k in points]
                for k, v in zip(points, src.sample(xy)):
                    value = int(v[0])
                    if value > 0 and value != src.nodata:
                        found[k].append({'huc': huc, 'branch': branch, 'hydroId': value})
    return found


# ---- Build ----
def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def gauge_relation(huc, branch, crossing_hydro, frame, station):
    """Where a forecast gauge sits relative to the crossing, along NOAA's own reach links."""
    try:
        path = fetch_cached(url_for(f'{huc}/branches/{branch}/usgs_elev_table.csv'), f'{huc}/{branch}/usgs_elev_table.csv')
    except OSError:
        return None
    with open(path, newline='', encoding='utf-8') as f:
        row = next((r for r in csv.DictReader(f) if r['nws_lid'] == station), None)
    if not row:
        return None
    gauge = int(float(row['HydroID']))
    links = {int(r.HydroID): (int(r.NextDownID), float(r.LengthKm)) for r in frame.itertuples()}

    def walk(start, end):
        km, at = 0.0, start
        while at in links and at != end:
            km += links[at][1]
            at = links[at][0]
        return round(km, 2) if at == end else None
    down, up = walk(crossing_hydro, gauge), walk(gauge, crossing_hydro)
    return {'station': station, 'gaugeHydroId': gauge, 'crossingHydroId': crossing_hydro,
            'gaugeIs': 'downstream' if down is not None else 'upstream' if up is not None else 'unlinked',
            'alongChannelKm': down if down is not None else up}


def nwm_stream(feature_id):
    """Length and stream order of an NWM reach, from the local basin files."""
    import geopandas as gpd
    for h in HUCS:
        frame = gpd.read_file(fetch_cached(url_for(f'{h}/nwm_subset_streams.gpkg'), f'{h}/nwm_subset_streams.gpkg'), ignore_geometry=True)
        match = frame[frame['ID'] == int(feature_id)]
        if len(match):
            return {'lengthKm': round(float(match.iloc[0]['Length']) / 1000, 2), 'order': int(match.iloc[0]['order_'])}
    return {'lengthKm': None, 'order': None}


def record_reach_forecast(reach_id):
    """Save NOAA's answer, so a replay and the tests need no network."""
    path = DATA / 'nwm' / f'{reach_id}.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    with urllib.request.urlopen(f'{NWPS}/reaches/{reach_id}/streamflow?series=short_range', timeout=60) as r:
        saved = {'recordedAt': now(), 'response': json.load(r)}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(saved, separators=(',', ':')) + '\n', encoding='utf-8')
    return saved


def clip(src, lons, lats):
    """Nearest-cell sample of a raster onto the output lon/lat grid. Values are not blended."""
    import numpy as np
    from pyproj import Transformer
    from rasterio.windows import from_bounds
    x, y = Transformer.from_crs(4326, src.crs, always_xy=True).transform(lons, lats)
    pad = 2 * src.res[0]
    window = from_bounds(x.min() - pad, y.min() - pad, x.max() + pad, y.max() + pad, src.transform).round_offsets().round_lengths()
    data = src.read(1, window=window, boundless=True, fill_value=src.nodata)
    wt = src.window_transform(window)
    cols = np.floor((x - wt.c) / wt.a).astype(int)
    rows = np.floor((y - wt.f) / wt.e).astype(int)
    return data[np.clip(rows, 0, data.shape[0] - 1), np.clip(cols, 0, data.shape[1] - 1)]


def wet_area_native(hand_src, catch_src, lons, lats, curves, flow):
    """Reference extent on NOAA's own 10 m grid, for checking the clip.

    NOAA's grid is rotated against lon/lat here, so only its cells whose centres
    fall inside the output box count. The box half a cell wider covers cell edges.
    """
    import numpy as np
    from pyproj import Transformer
    from rasterio.windows import from_bounds
    x, y = Transformer.from_crs(4326, hand_src.crs, always_xy=True).transform(lons, lats)
    window = from_bounds(x.min(), y.min(), x.max(), y.max(), hand_src.transform).round_offsets().round_lengths()
    hand = hand_src.read(1, window=window, boundless=True, fill_value=hand_src.nodata)
    catchment = catch_src.read(1, window=window, boundless=True, fill_value=catch_src.nodata)
    wt = hand_src.window_transform(window)
    cx, cy = np.meshgrid(wt.c + (np.arange(hand.shape[1]) + .5) * wt.a, wt.f + (np.arange(hand.shape[0]) + .5) * wt.e)
    clon, clat = Transformer.from_crs(hand_src.crs, 4326, always_xy=True).transform(cx, cy)
    half_lon, half_lat = abs(lons[0, 1] - lons[0, 0]) / 2, abs(lats[1, 0] - lats[0, 0]) / 2
    inside = (clon >= lons.min() - half_lon) & (clon <= lons.max() + half_lon) & (clat >= lats.min() - half_lat) & (clat <= lats.max() + half_lat)
    wet = np.zeros(hand.shape, bool)
    for hydro, curve in curves.items():
        stage = stage_for_flow(flow, curve['stageM'], curve['dischargeM3s'])
        if stage is not None:
            wet |= (catchment == hydro) & (hand != hand_src.nodata) & (hand <= stage)
    return int((wet & inside).sum()) * hand_src.res[0] * hand_src.res[1]


class Refused(Exception):
    pass


def build_junction(row, check_flows):
    import numpy as np
    from pyproj import Geod
    reach = row['nearestReach']
    huc, branch, feature = reach['huc'], reach['branch'], str(reach['featureId'])
    curves, calibrated = {}, set()
    for line in hydrotable(huc, branch):
        if line['feature_id'] != feature:
            continue
        if str(line.get('LakeID', '-999')).split('.')[0] != '-999':
            raise Refused(f"HydroID {line['HydroID']} is flagged as a lake.")
        c = curves.setdefault(int(line['HydroID']), {'stageM': [], 'dischargeM3s': []})
        c['stageM'].append(round(float(line['stage']), 4))
        c['dischargeM3s'].append(round(float(line['discharge_cms']), 3))
        calibrated.add(line.get('calb_applied', 'unknown'))
    if not curves:
        raise Refused(f'No rating curve for reach {feature}.')

    frame = reaches(huc, branch)
    station = next((k for k, s in STATIONS.items() if s['reachId'] == feature), None)
    gauge = gauge_relation(huc, branch, reach['hydroId'], frame, station) if station else None
    forecast = forecast_for(reach, gauge)
    if forecast['kind'] == 'nwm_reach':
        problem = reach_forecast_problem(record_reach_forecast(feature)['response'], feature)
        if problem:
            raise Refused(f'NWM forecast for reach {feature}: {problem}.')
    stream = nwm_stream(feature)

    # Output grid: about 10 m in lon/lat, so Leaflet can place it as an image.
    geod = Geod(ellps='WGS84')
    r = 1500 if (stream['order'] or 0) >= 5 else 1000
    lon, lat = row['lon'], row['lat']
    lon_min, lon_max = geod.fwd(lon, lat, 270, r)[0], geod.fwd(lon, lat, 90, r)[0]
    lat_min, lat_max = geod.fwd(lon, lat, 180, r)[1], geod.fwd(lon, lat, 0, r)[1]
    cols = rows_n = 2 * r // 10
    d_lon, d_lat = (lon_max - lon_min) / cols, (lat_max - lat_min) / rows_n
    lons, lats = np.meshgrid(lon_min + (np.arange(cols) + .5) * d_lon, lat_max - (np.arange(rows_n) + .5) * d_lat)

    with open_raster(hand_key(huc, branch)) as hand_src, open_raster(catchment_key(huc, branch)) as catch_src:
        hand = clip(hand_src, lons, lats)
        catchment = clip(catch_src, lons, lats)
        hand_nodata = hand == hand_src.nodata
        ordered = sorted(h for h in curves if (catchment == h).any())
        if not ordered or len(ordered) > 250:
            raise Refused(f'{len(ordered)} usable catchments in the map square.')
        for hydro in ordered:
            problem = rating_problem(curves[hydro]['stageM'], curves[hydro]['dischargeM3s'])
            if problem:
                raise Refused(f'Rating curve for HydroID {hydro}, in this map square: {problem}.')
        index = np.full(hand.shape, CATCHMENT_NONE, 'u1')
        for i, h in enumerate(ordered):
            index[catchment == h] = i
        linked = index != CATCHMENT_NONE
        valid = float((linked & ~hand_nodata).sum() / linked.sum())
        if valid < MIN_VALID_HAND_FRACTION:
            raise Refused(f'Only {valid:.1%} of the reach cells have HAND values.')
        cm = np.where(hand_nodata, HAND_NODATA_CM, np.clip(np.round(np.where(hand_nodata, 0, hand) * 100), 0, HAND_NODATA_CM - 1)).astype('<u2')
        used = {h: curves[h] for h in ordered}
        reference = {str(q): wet_area_native(hand_src, catch_src, lons, lats, used, q) for q in check_flows}

    objects = [object_record(k) for k in (hand_key(huc, branch), catchment_key(huc, branch), f'{huc}/branches/{branch}/hydroTable_{branch}.csv')]
    water = row['water']
    out = {
        'schemaVersion': 1, 'kind': 'hand_junction', 'id': row['id'], 'name': row['name'],
        'crossing': {'lon': lon, 'lat': lat, 'water': water}, 'forecast': forecast,
        'reach': {'huc8': huc, 'branch': branch, 'featureId': feature, 'name': reach['name'], 'nameConfirmed': bool(water and reach['name']), 'crossingHydroId': reach['hydroId'], 'crossingDistanceM': reach['distanceM'], **stream},
        'grid': {'cols': int(cols), 'rows': int(rows_n), 'lonMin': lon_min, 'latMax': lat_max, 'dLon': d_lon, 'dLat': d_lat, 'radiusM': r, 'handNodata': HAND_NODATA_CM, 'catchmentNone': CATCHMENT_NONE,
                 'handCm': base64.b64encode(cm.tobytes()).decode(), 'catchment': base64.b64encode(index.tobytes()).decode(), 'sha256': hashlib.sha256(cm.tobytes() + index.tobytes()).hexdigest()},
        'hydroIds': ordered, 'rating': {str(h): used[h] for h in ordered},
        'source': {'bucket': BUCKET, 'publisher': 'NOAA OWP HAND FIM, public copy hosted by CIROH', 'objects': objects, 'version': None,
                   'versionNote': 'The bucket states no FIM version. Age comes from the upload date of these files.',
                   'sourceDate': max(o['lastModified'] for o in objects), 'retrievedAt': now()},
        'calibration': {'calbApplied': sorted(calibrated), 'calibrated': calibrated == {'True'}},
        'gauge': gauge if forecast['kind'] == 'gauge' else None,
        'verification': {'validHandFractionOfReachCells': round(valid, 4), 'reachCellFractionOfWindow': round(float(linked.mean()), 4), 'nativeGridWetAreaM2': reference},
    }
    (DATA / f"{row['id']}.json").write_text(json.dumps(out, separators=(',', ':')) + '\n', encoding='utf-8')
    return forecast


def run_all(args):
    crossings = json.loads((ROOT / 'public/data/crossings.geojson').read_text(encoding='utf-8'))['features']
    grouped = {}
    for f in crossings:
        lon, lat = f['geometry']['coordinates']
        p = f['properties']
        row = grouped.setdefault(f'{lon:.5f},{lat:.5f}', {'id': slug(p['road'], lon, lat), 'lon': lon, 'lat': lat, 'road': p['road'], 'water': p['water'], 'routes': []})
        row['routes'] = sorted({*row['routes'], p['route']})
        row['water'] = row['water'] or p['water']
        row['name'] = f"{row['road']} at {row['water']}" if row['water'] else f"{row['road']} ({lat:.4f}, {lon:.4f})"
    hits = catchment_hits({k: (r['lon'], r['lat']) for k, r in grouped.items()})
    DATA.mkdir(parents=True, exist_ok=True)
    counts = {}
    for k, row in grouped.items():
        reach = nearest_reach(row['lon'], row['lat'], hits[k])
        row['nearestReach'] = reach
        row['status'], row['evidence'] = classify_point(reach, water=row['water'])
        if row['status'] == 'eligible':
            try:
                forecast = build_junction(row, args.check_flows)
                row['status'], row['file'], row['forecast'] = 'supported', row['id'] + '.json', forecast
            except Refused as e:
                row['status'], row['evidence'] = 'build_refused', str(e)
        counts[row['status']] = counts.get(row['status'], 0) + 1
        print(row['status'], row['id'], row['evidence'], flush=True)
    out = {'schemaVersion': 1, 'checkedAt': now(), 'source': BUCKET, 'maxReachDistanceM': MAX_REACH_DISTANCE_M, 'counts': counts, 'points': sorted(grouped.values(), key=lambda r: (r['status'] != 'supported', r['road'], r['lon']))}
    (DATA / 'coverage.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')
    print(counts)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-flows', nargs='+', type=float, default=[5, 50, 500], help='flows in m3/s compared against the native grid')
    args = parser.parse_args(argv)
    run_all(args)


if __name__ == '__main__':
    main()
