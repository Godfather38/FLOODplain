#!/usr/bin/env python3
"""Reuse existing NOAA HAND/FIM data for FLOODplain crossings.

survey   Check every crossing against the real rasters, reaches and rating
         curves, and write data/hand/coverage.json.
build ID Check one junction from junctions.json and, only if it passes, clip
         its HAND, catchments and rating curves into data/hand/ID.json.

HAND means Height Above Nearest Drainage: how far a cell sits above the stream
it drains to. No terrain, catchment or rating value is made up here; a junction
that fails a check gets no file. Nothing here says anything about road use.
"""
import argparse, base64, csv, datetime, hashlib, json, math, os, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path

BUCKET = 'https://ciroh-owp-hand-fim.s3.amazonaws.com'
NWPS = 'https://api.water.noaa.gov/nwps/v1'
HUCS = ['15050301', '15050302', '15050303', '15050304']
# Same identities as public/simulation/forecast-stations.js (a test keeps them equal).
STATIONS = {'SCTA3': {'usgsId': '09486520', 'reachId': '15890430'},
            'CSCA3': {'usgsId': '09486500', 'reachId': '15903137'},
            'BWTA3': {'usgsId': '09487000', 'reachId': '15876941'}}
MAX_REACH_DISTANCE_M = 100
MIN_VALID_HAND_FRACTION = 0.95
HAND_NODATA_CM, CATCHMENT_NONE = 65535, 255
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'public/simulation/data/hand'
CACHE = Path(os.environ.get('HAND_CACHE', ROOT / '.hand-cache'))


# ---- Pure checks (tested without network or geo libraries) ----
def classify_point(reach, stations=STATIONS, water=None, max_distance=MAX_REACH_DISTANCE_M):
    """What can honestly be said about one crossing. reach: nearest HAND reach or None."""
    if not reach:
        return 'no_hand_catchment', 'No NOAA HAND catchment at this point.'
    if reach['distanceM'] > max_distance:
        return 'not_on_modeled_reach', f"Nearest HAND reach is {reach['distanceM']:.0f} m away, so its catchment does not describe this water."
    station = next((k for k, s in stations.items() if s['reachId'] == str(reach['featureId'])), None)
    if not station:
        return 'hand_reach_no_forecast', f"On NWM reach {reach['featureId']}, which has no forecast in the app's provider."
    if not water:
        return 'needs_review', f'On the {station} forecast reach, but the map data has no water name to confirm it.'
    if water.strip().lower() != str(reach.get('name', '')).strip().lower():
        return 'needs_review', f"Map data says {water}; NOAA calls this reach {reach.get('name')}."
    return 'forecast_linked', f'On the {station} forecast reach.'


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


# ---- Commands ----
def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def survey(_args):
    crossings = json.loads((ROOT / 'public/data/crossings.geojson').read_text())['features']
    grouped = {}
    for f in crossings:
        lon, lat = f['geometry']['coordinates']
        p = f['properties']
        row = grouped.setdefault(f'{lon:.5f},{lat:.5f}', {'lon': lon, 'lat': lat, 'road': p['road'], 'water': p['water'], 'routes': []})
        row['routes'].append(p['route'])
        row['water'] = row['water'] or p['water']
    hits = catchment_hits({k: (r['lon'], r['lat']) for k, r in grouped.items()})
    for k, row in grouped.items():
        reach = nearest_reach(row['lon'], row['lat'], hits[k])
        row['status'], row['evidence'] = classify_point(reach, water=row['water'])
        row['nearestReach'] = reach
    counts = {}
    for row in grouped.values():
        counts[row['status']] = counts.get(row['status'], 0) + 1
    out = {'schemaVersion': 1, 'checkedAt': now(), 'source': BUCKET, 'maxReachDistanceM': MAX_REACH_DISTANCE_M, 'counts': counts, 'points': sorted(grouped.values(), key=lambda r: (r['status'], r['road'], r['lon']))}
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'coverage.json').write_text(json.dumps(out, indent=1) + '\n')
    print(counts)


def gauge_relation(huc, branch, crossing_hydro, frame, station):
    """Where the forecast gauge sits relative to the crossing, along NOAA's own reach links."""
    path = fetch_cached(url_for(f'{huc}/branches/{branch}/usgs_elev_table.csv'), f'{huc}/{branch}/usgs_elev_table.csv')
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
            'alongChannelKm': down if down is not None else up,
            'gaugeSnapDistanceM': float(row['snap_distance']) if row.get('snap_distance') else None}


def inflows(feature_id):
    """NWM reaches that flow into the forecast reach, from the local basin files."""
    import geopandas as gpd
    found = []
    for h in HUCS:
        path = fetch_cached(url_for(f'{h}/nwm_subset_streams.gpkg'), f'{h}/nwm_subset_streams.gpkg')
        frame = gpd.read_file(path, ignore_geometry=True)
        for row in frame[frame['to'] == int(feature_id)].itertuples():
            found.append({'reachId': int(row.ID), 'name': reach_name(int(row.ID)), 'huc8': h})
    return found


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
    hand = hand_src.read(1, window=window)
    catchment = catch_src.read(1, window=window)
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


def build(args):
    import numpy as np
    from pyproj import Geod, Transformer
    junctions = json.loads((ROOT / 'tools/hand/junctions.json').read_text())
    if args.id not in junctions:
        raise SystemExit(f'Unknown junction: {args.id}')
    j = junctions[args.id]
    reach = nearest_reach(j['lon'], j['lat'], catchment_hits({args.id: (j['lon'], j['lat'])})[args.id])
    status, evidence = classify_point(reach, stations={j['station']: STATIONS[j['station']]}, water=j['water'])
    if status != 'forecast_linked':
        raise SystemExit(f'REFUSED {args.id}: {status}. {evidence}')
    huc, branch, feature = reach['huc'], reach['branch'], str(reach['featureId'])

    curves, calibrated = {}, set()
    for row in hydrotable(huc, branch):
        if row['feature_id'] != feature:
            continue
        if str(row.get('LakeID', '-999')).split('.')[0] != '-999':
            raise SystemExit(f"REFUSED {args.id}: HydroID {row['HydroID']} is flagged as a lake")
        c = curves.setdefault(int(row['HydroID']), {'stageM': [], 'dischargeM3s': []})
        c['stageM'].append(round(float(row['stage']), 4))
        c['dischargeM3s'].append(round(float(row['discharge_cms']), 3))
        calibrated.add(row.get('calb_applied', 'unknown'))
    for hydro, c in curves.items():
        problem = rating_problem(c['stageM'], c['dischargeM3s'])
        if problem:
            raise SystemExit(f'REFUSED {args.id}: rating curve for HydroID {hydro}: {problem}')

    # Output grid: about 10 m in lon/lat, so Leaflet can place it as an image.
    geod = Geod(ellps='WGS84')
    r = j['radiusM']
    lon_min, lon_max = geod.fwd(j['lon'], j['lat'], 270, r)[0], geod.fwd(j['lon'], j['lat'], 90, r)[0]
    lat_min, lat_max = geod.fwd(j['lon'], j['lat'], 180, r)[1], geod.fwd(j['lon'], j['lat'], 0, r)[1]
    cols = rows_n = 2 * r // 10
    d_lon, d_lat = (lon_max - lon_min) / cols, (lat_max - lat_min) / rows_n
    lons, lats = np.meshgrid(lon_min + (np.arange(cols) + .5) * d_lon, lat_max - (np.arange(rows_n) + .5) * d_lat)

    with open_raster(hand_key(huc, branch)) as hand_src, open_raster(catchment_key(huc, branch)) as catch_src:
        hand = clip(hand_src, lons, lats)
        catchment = clip(catch_src, lons, lats)
        hand_nodata = hand == hand_src.nodata
        ordered = sorted(h for h in curves if (catchment == h).any())
        if not ordered or len(ordered) > 250:
            raise SystemExit(f'REFUSED {args.id}: {len(ordered)} usable catchments in the window')
        index = np.full(hand.shape, CATCHMENT_NONE, 'u1')
        for i, h in enumerate(ordered):
            index[catchment == h] = i
        linked = index != CATCHMENT_NONE
        valid = float((linked & ~hand_nodata).sum() / linked.sum())
        if valid < MIN_VALID_HAND_FRACTION:
            raise SystemExit(f'REFUSED {args.id}: only {valid:.1%} of reach cells have HAND values')
        cm = np.where(hand_nodata, HAND_NODATA_CM, np.clip(np.round(np.where(hand_nodata, 0, hand) * 100), 0, HAND_NODATA_CM - 1)).astype('<u2')
        used = {h: curves[h] for h in ordered}
        reference = {str(q): wet_area_native(hand_src, catch_src, lons, lats, used, q) for q in args.check_flows}
        xy = Transformer.from_crs(4326, hand_src.crs, always_xy=True).transform(j['lon'], j['lat'])
        at_point = [float(v[0]) for v in hand_src.sample([xy])][0]

    objects = [object_record(k) for k in (hand_key(huc, branch), catchment_key(huc, branch), f'{huc}/branches/{branch}/hydroTable_{branch}.csv')]
    out = {
        'schemaVersion': 1, 'kind': 'hand_junction', 'id': args.id, 'name': j['name'],
        'crossing': {'lon': j['lon'], 'lat': j['lat'], 'water': j['water']}, 'station': j['station'],
        'reach': {'huc8': huc, 'branch': branch, 'featureId': feature, 'name': reach['name'], 'crossingHydroId': reach['hydroId'], 'crossingDistanceM': reach['distanceM']},
        'grid': {'cols': int(cols), 'rows': int(rows_n), 'lonMin': lon_min, 'latMax': lat_max, 'dLon': d_lon, 'dLat': d_lat, 'radiusM': r, 'handNodata': HAND_NODATA_CM, 'catchmentNone': CATCHMENT_NONE,
                 'handCm': base64.b64encode(cm.tobytes()).decode(), 'catchment': base64.b64encode(index.tobytes()).decode(), 'sha256': hashlib.sha256(cm.tobytes() + index.tobytes()).hexdigest()},
        'hydroIds': ordered, 'rating': {str(h): used[h] for h in ordered},
        'source': {'bucket': BUCKET, 'publisher': 'NOAA OWP HAND FIM, public copy hosted by CIROH', 'objects': objects, 'version': None,
                   'versionNote': 'The bucket states no FIM version. Age comes from the upload date of these files.',
                   'sourceDate': max(o['lastModified'] for o in objects), 'retrievedAt': now()},
        'calibration': {'calbApplied': sorted(calibrated), 'calibrated': calibrated == {'True'}},
        'gauge': gauge_relation(huc, branch, reach['hydroId'], reaches(huc, branch), j['station']),
        'inflows': inflows(feature),
        'verification': {'handAtCrossingM': round(at_point, 2), 'validHandFractionOfReachCells': round(valid, 4), 'reachCellFractionOfWindow': round(float(linked.mean()), 4), 'nativeGridWetAreaM2': reference},
    }
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / f'{args.id}.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    index_path = DATA / 'index.json'
    listing = json.loads(index_path.read_text()) if index_path.exists() else {'schemaVersion': 1, 'junctions': {}}
    listing['junctions'][args.id] = {'name': j['name'], 'station': j['station'], 'file': f'{args.id}.json', 'lon': j['lon'], 'lat': j['lat']}
    index_path.write_text(json.dumps(listing, indent=1) + '\n')
    print(json.dumps({k: out[k] for k in ('reach', 'calibration', 'gauge', 'inflows', 'verification')}, indent=1))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(required=True)
    sub.add_parser('survey').set_defaults(run=survey)
    b = sub.add_parser('build')
    b.add_argument('id')
    b.add_argument('--check-flows', nargs='+', type=float, default=[10, 85, 243.5, 424.8, 770.2], help='flows in m3/s compared against the native grid')
    b.set_defaults(run=build)
    args = parser.parse_args(argv)
    args.run(args)


if __name__ == '__main__':
    main()
