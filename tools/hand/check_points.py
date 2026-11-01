#!/usr/bin/env python3
"""Outside checks on the crossing list. Writes public/inundation/data/checks.json.

fema: FEMA flood zone at each supported crossing, and how much of the estimated area
      at 3,000 cfs falls inside FEMA's mapped flood zones in the same square.
map:  nearest mapped waterway in OpenStreetMap to each point, and the distance to the
      Central Arizona Project canal, for reaches NOAA gives a canal name.
Reference only: nothing here feeds the app's numbers.
"""
import base64, json, time, urllib.parse, urllib.request
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'public/inundation/data'
NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query'
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
FLOW = 3000 * 0.028316846592
to_m = Transformer.from_crs(4326, 5070, always_xy=True)


def fema_polygons(lon_min, lat_min, lon_max, lat_max):
    q = {'geometry': f'{lon_min},{lat_min},{lon_max},{lat_max}', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'FLD_ZONE,ZONE_SUBTY', 'returnGeometry': 'true', 'outSR': 4326, 'f': 'geojson'}
    req = urllib.request.Request(NFHL + '?' + urllib.parse.urlencode(q), headers={'User-Agent': 'FLOODplain-check'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)['features']
        except Exception:
            if attempt == 3:
                raise
            time.sleep(20)


def stage(curve, q):
    return float(np.interp(q, curve['dischargeM3s'], curve['stageM'])) if q <= curve['dischargeM3s'][-1] else None


def fema_check(row):
    j = json.loads((DATA / row['file']).read_text(encoding='utf-8'))
    g = j['grid']
    hand = np.frombuffer(base64.b64decode(g['handCm']), '<u2').reshape(g['rows'], g['cols'])
    catch = np.frombuffer(base64.b64decode(g['catchment']), 'u1').reshape(g['rows'], g['cols'])
    wet = np.zeros(hand.shape, bool)
    for i, h in enumerate(j['hydroIds']):
        s = stage(j['rating'][str(h)], FLOW)
        if s is not None:
            wet |= (catch == i) & (hand != g['handNodata']) & (hand <= s * 100)
    lon_max, lat_min = g['lonMin'] + g['cols'] * g['dLon'], g['latMax'] - g['rows'] * g['dLat']
    feats = fema_polygons(g['lonMin'], lat_min, lon_max, g['latMax'])
    hazard = [shapely.geometry.shape(f['geometry']) for f in feats if str(f['properties']['FLD_ZONE']).startswith(('A', 'V'))]
    pt = shapely.Point(row['lon'], row['lat'])
    zone = next((f['properties']['FLD_ZONE'] for f in feats if shapely.geometry.shape(f['geometry']).contains(pt)), None)
    lons = g['lonMin'] + (np.arange(g['cols']) + .5) * g['dLon']
    lats = g['latMax'] - (np.arange(g['rows']) + .5) * g['dLat']
    lon2, lat2 = np.meshgrid(lons, lats)
    union = shapely.union_all(hazard) if hazard else None
    inside = shapely.contains_xy(union, lon2, lat2) if union is not None else np.zeros(hand.shape, bool)
    linked = catch != g['catchmentNone']
    both = int((wet & inside).sum())
    return {'femaZoneAtCrossing': zone, 'estimatedCellsAt3000cfs': int(wet.sum()), 'shareOfEstimateInsideFemaZone': round(both / wet.sum(), 2) if wet.sum() else None,
            'shareOfFemaZoneCoveredByEstimate': round(both / int((inside & linked).sum()), 2) if (inside & linked).any() else None, 'femaZoneCells': int(inside.sum())}


def overpass(query):
    error = None
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': query}).encode(), headers={'User-Agent': 'FLOODplain-check'})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)['elements']
        except Exception as e:
            error = e
            time.sleep(15)
    raise error


def lines(elements):
    out = []
    for e in elements:
        if 'geometry' in e:
            xs, ys = to_m.transform([p['lon'] for p in e['geometry']], [p['lat'] for p in e['geometry']])
            if len(xs) > 1:
                out.append((e.get('tags', {}), shapely.LineString(zip(xs, ys))))
    return out


def main():
    coverage = json.loads((DATA / 'coverage.json').read_text(encoding='utf-8'))
    pts = coverage['points']
    box = f"{min(p['lat'] for p in pts) - .02},{min(p['lon'] for p in pts) - .02},{max(p['lat'] for p in pts) + .02},{max(p['lon'] for p in pts) + .02}"
    ways = lines(overpass(f'[out:json][timeout:150];way["waterway"]({box});out tags geom;'))
    canal = [l for t, l in ways if 'central arizona' in str(t.get('name', '')).lower() or 'cap canal' in str(t.get('name', '')).lower()]
    canal_line = shapely.union_all(canal) if canal else None
    results = {}
    for p in pts:
        here = shapely.Point(*to_m.transform(p['lon'], p['lat']))
        near = min(ways, key=lambda w: w[1].distance(here)) if ways else None
        r = {'osmNearestWaterwayM': round(near[1].distance(here)) if near else None, 'osmNearestWaterwayName': near[0].get('name') if near else None, 'osmNearestWaterwayKind': near[0].get('waterway') if near else None,
             'capCanalM': round(canal_line.distance(here)) if canal_line is not None else None}
        if p['status'] == 'supported':
            try:
                r.update(fema_check(p))
            except Exception as e:
                r['femaError'] = str(e)[:120]
            time.sleep(.3)
        results[p['id']] = r
        print(p['id'], r, flush=True)
    (DATA / 'checks.json').write_text(json.dumps({'schemaVersion': 1, 'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'capCanalSegmentsFound': len(canal), 'flowCfs': 3000, 'points': results}, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
