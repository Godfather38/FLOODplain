"""Windowed professional 1 m bare-earth terrain intake for the brawley-avra-west L>=3 refinement zones.

Adapted from tools/sfincs/import_all_routes_terrain.py. Differences:
- required area = refinement-zones.geojson features with refinement_level >= --min-level, buffered --buffer m
  (instead of all public routes buffered 525 m);
- a NEW TNM products catalog (tools/sfincs/data/brawley-avra-west-v1/terrain-catalog.json);
- source priority AZ_PimaCounty_2021_B21 > AZ_BrawleyRillito_2018_D19 > AZ_Eastern_PimaCO_2015 (2015 only where
  nothing newer is valid); per-window project, year, pixel counts and seam statistics are recorded;
- windows already present with identical bounds (same file name) in the junctioned caches road-terrain-1m-v1,
  silverbell-terrain-v1, all-routes-terrain-v1 are reused (prepare_route_case_parameters.py loads them
  automatically) when they have no missing required pixels; otherwise a replacement is written here and must be
  passed with --extra-fine;
- windows are processed in parallel worker processes, each reading byte ranges of the COG tiles over /vsicurl.
No filling, burning, smoothing or upscaled coarse source. Missing pixels stay nodata (-9999).

Top-up mode (--skip-present-in FOLDER ...): a window whose file name already exists in a cache or in one of these
folders is never written; its coverage is only evaluated from the file prepare_route_case_parameters.py would load
(caches first, then the --skip-present-in folders in the order given, later wins, matching repeated --extra-fine).
The 250-window envelope then applies to the windows actually written.
"""
import argparse, hashlib, json, os, re, sys, time, urllib.request
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from shapely.geometry import box, shape, mapping
from shapely.ops import transform as shp_transform
from pyproj import Transformer

TNM_BASE = ('https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Digital%20Elevation%20Model%20(DEM)%201%20meter'
            '&bbox={bbox}&max=500&outputFormat=JSON')
TNM_URL = TNM_BASE.format(bbox='-111.52,31.98,-110.98,32.43')
PRIORITY = [('AZ_PimaCounty_2021_B21', 2021), ('AZ_BrawleyRillito_2018_D19', 2018), ('AZ_Eastern_PimaCO_2015', 2015)]
CACHES = ['road-terrain-1m-v1', 'silverbell-terrain-v1', 'all-routes-terrain-v1']  # load order in prepare_route_case_parameters.py (later wins)
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='60',
                GDAL_HTTP_MAX_RETRY='4', GDAL_HTTP_RETRY_DELAY='2', GDAL_HTTP_MULTIRANGE='YES',
                GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES', VSI_CACHE='TRUE', VSI_CACHE_SIZE='100000000', GDAL_CACHEMAX='512')


def project_of(item):
    t = item['downloadURL']
    for proj, year in PRIORITY:
        if f'/Projects/{proj}/' in t:
            return proj, year
    return None, None


def fetch_catalog(path, url=TNM_URL):
    t0 = time.time()
    with urllib.request.urlopen(url, timeout=120) as r:
        raw = r.read()
    d = json.loads(raw)
    if d.get('errors'):
        raise RuntimeError(f"TNM errors: {d['errors']}")
    if d['total'] != len(d['items']):
        raise RuntimeError(f"TNM paging incomplete: total {d['total']} items {len(d['items'])}")
    keep = ['title', 'sourceId', 'downloadURL', 'boundingBox', 'publicationDate', 'lastUpdated', 'sizeInBytes', 'format', 'metaUrl', 'vendorMetaUrl']
    items = [{k: i.get(k) for k in keep} for i in d['items']]
    for i in items:
        i['project'], i['year'] = project_of(i)
    out = {'source': url, 'retrievedUtc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'responseSha256': hashlib.sha256(raw).hexdigest(), 'total': d['total'], 'messages': d.get('messages'),
           'priority': [p for p, _ in PRIORITY], 'items': items}
    path.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    print(f'catalog: {len(items)} items in {time.time()-t0:.1f}s -> {path}', flush=True)
    return out


# ---------------- worker ----------------
_W = {}


def _init(sources, req_wkb, l4_wkb):
    from shapely import wkb
    os.environ.update(GDAL_ENV)
    _W['sources'] = sources
    _W['req'] = wkb.loads(req_wkb)
    _W['l4'] = wkb.loads(l4_wkb)
    _W['open'] = {}


def _ds(url):
    d = _W['open'].get(url)
    if d is None:
        d = _W['open'][url] = rasterio.open(url)
    return d


def _masks(transform):
    win = box(transform.c, transform.f - 1000, transform.c + 1000, transform.f)
    req_g = _W['req'].intersection(win)
    l4_g = _W['l4'].intersection(win)
    req = geometry_mask([req_g], (1000, 1000), transform, invert=True, all_touched=True) if not req_g.is_empty else np.zeros((1000, 1000), bool)
    l4 = geometry_mask([l4_g], (1000, 1000), transform, invert=True, all_touched=True) if not l4_g.is_empty else np.zeros((1000, 1000), bool)
    return req, l4


def process(job):
    x, y, out_dir, cached = job[:4]
    evaluate_only = len(job) > 4 and job[4]
    out_dir = Path(out_dir)
    name = f'terrain-1m-{x}-{y}.tif'
    path, meta = out_dir / name, out_dir / f'terrain-1m-{x}-{y}.json'
    transform = from_origin(x, y + 1000, 1, 1)
    req, l4 = _masks(transform)
    base = {'name': name, 'boundsEPSG32612': [x, y, x + 1000, y + 1000], 'requiredPixels': int(req.sum()), 'l4RequiredPixels': int(l4.sum())}
    if cached:
        with rasterio.open(cached) as cr:
            ok = (cr.crs.to_epsg() == 32612 and tuple(cr.bounds) == (x, y, x + 1000, y + 1000) and cr.shape == (1000, 1000))
            v = cr.read(1)
            valid = np.isfinite(v) & (v != cr.nodata) if ok else None
        if ok:
            miss = int((req & ~valid).sum())
            if miss == 0:
                cm = Path(cached).with_suffix('.json')
                srcs = json.loads(cm.read_text()).get('sources') if cm.exists() else None
                return {**base, 'reusedCached': True, 'path': str(Path(cached)), 'cacheFolder': Path(cached).parent.name,
                        'validFraction': round(float(valid.mean()), 6), 'missingRequiredPixels': 0, 'l4MissingPixels': int((l4 & ~valid).sum()),
                        'sha256': hashlib.sha256(Path(cached).read_bytes()).hexdigest(), 'sources': srcs}
            if evaluate_only:
                return {**base, 'reusedCached': True, 'evaluatedOnly': True, 'path': str(Path(cached)), 'cacheFolder': Path(cached).parent.name,
                        'validFraction': round(float(valid.mean()), 6), 'missingRequiredPixels': miss, 'l4MissingPixels': int((l4 & ~valid).sum()),
                        'sha256': hashlib.sha256(Path(cached).read_bytes()).hexdigest()}
            base['cachedRejected'] = {'path': str(Path(cached)), 'missingRequiredPixels': miss}
        elif evaluate_only:
            raise ValueError(f'present window has unexpected grid: {cached}')
    if meta.exists() and path.exists():
        return json.loads(meta.read_text())
    t0 = time.time()
    wb = box(x, y, x + 1000, y + 1000)
    arr = np.full((1000, 1000), -9999, dtype='float32')
    owner = np.full((1000, 1000), -1, dtype='int8')
    used, seams = [], []
    for rank, (proj, year, items) in enumerate(_W['sources']):
        for it in items:
            if not shape(it['utm']).intersects(wb):
                continue
            src = _ds(it['downloadURL'])
            with WarpedVRT(src, crs='EPSG:32612', transform=transform, width=1000, height=1000, resampling=Resampling.bilinear, nodata=-9999) as v:
                data = v.read(1)
            good = np.isfinite(data) & (data != -9999) & (data > -1000)
            if not good.any():
                continue
            # seam statistics where a higher-priority product already holds the pixel
            over = good & (owner >= 0) & (owner < rank)
            take = good & (arr == -9999)
            if over.any():
                dlt = arr[over] - data[over]
                seams.append({'higher': _W['sources'][int(np.bincount(owner[over]).argmax())][0], 'lower': proj, 'overlapPixels': int(over.sum()),
                              'medianDiffM': round(float(np.median(dlt)), 3), 'p05DiffM': round(float(np.percentile(dlt, 5)), 3),
                              'p95DiffM': round(float(np.percentile(dlt, 95)), 3)})
            if take.any():
                arr[take] = data[take]
                owner[take] = rank
                used.append({'project': proj, 'year': year, 'title': it['title'], 'sourceId': it['sourceId'], 'url': it['downloadURL'],
                             'pixels': int(take.sum()), 'requiredPixels': int((take & req).sum())})
        if not (req & (arr == -9999)).any():
            break
    valid = arr != -9999
    missing = int((req & ~valid).sum())
    projs = sorted({u['project'] for u in used})
    req_projs = sorted({u['project'] for u in used if u['requiredPixels'] > 0})
    with rasterio.open(path, 'w', driver='GTiff', width=1000, height=1000, count=1, dtype='float32', crs='EPSG:32612', transform=transform,
                       nodata=-9999, compress='deflate', tiled=True) as dst:
        dst.write(arr, 1)
        dst.update_tags(vertical_datum='NAVD88', vertical_units='metres', source_resolution='1 metre professional USGS product',
                        source_projects=','.join(projs))
    rec = {**base, 'reusedCached': False, 'path': path.name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
           'validFraction': round(float(valid.mean()), 6), 'missingRequiredPixels': missing, 'l4MissingPixels': int((l4 & ~valid).sum()),
           'projects': projs, 'years': sorted({u['year'] for u in used}), 'requiredAreaProjects': req_projs,
           'uses2015InRequired': 'AZ_Eastern_PimaCO_2015' in req_projs, 'projectSeamInRequired': len(req_projs) > 1,
           'sources': used, 'seamOverlapStats': seams, 'seconds': round(time.time() - t0, 1)}
    meta.write_text(json.dumps(rec, indent=2) + '\n', encoding='utf-8')
    return rec


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--zones', type=Path, default=Path('tools/sfincs/data/brawley-avra-west-v1/components/refinement-zones.geojson'))
    p.add_argument('--catalog', type=Path, default=Path('tools/sfincs/data/brawley-avra-west-v1/terrain-catalog.json'))
    p.add_argument('--fetch-catalog', action='store_true')
    p.add_argument('--catalog-bbox', default='-111.52,31.98,-110.98,32.43', help='lon/lat bbox of the TNM query (with --fetch-catalog)')
    p.add_argument('--skip-present-in', type=Path, nargs='*', default=[],
                   help='top-up: never write a window whose name exists in a cache or in these folders; only evaluate its coverage')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--min-level', type=int, default=3)
    p.add_argument('--buffer', type=float, default=50.0)
    p.add_argument('--workers', type=int, default=12)
    p.add_argument('--limit', type=int, default=0, help='process only the first N windows (testing)')
    a = p.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    catalog = fetch_catalog(a.catalog, TNM_BASE.format(bbox=a.catalog_bbox)) if a.fetch_catalog or not a.catalog.exists() else json.loads(a.catalog.read_text())
    zones = gpd.read_file(a.zones).to_crs(32612)
    req_geom = zones[zones.refinement_level >= a.min_level].geometry.union_all().buffer(a.buffer)
    l4_geom = zones[zones.refinement_level >= 4].geometry.union_all()
    b = req_geom.bounds
    blocks = [(x, y) for x in range(int(np.floor(b[0] / 1000) * 1000), int(np.ceil(b[2] / 1000) * 1000), 1000)
              for y in range(int(np.floor(b[1] / 1000) * 1000), int(np.ceil(b[3] / 1000) * 1000), 1000) if req_geom.intersects(box(x, y, x + 1000, y + 1000))]
    if len(blocks) > 250 and not a.skip_present_in:
        raise ValueError('Exceeded audited 250-window intake envelope')
    tr = Transformer.from_crs(4326, 32612, always_xy=True).transform
    sources = []
    for proj, year in PRIORITY:
        items = []
        for it in catalog['items']:
            if it.get('project') == proj or (it.get('project') is None and f'/Projects/{proj}/' in it['downloadURL']):
                bb = it['boundingBox']
                g = shp_transform(tr, box(bb['minX'], bb['minY'], bb['maxX'], bb['maxY'])).buffer(100)
                items.append({**{k: it[k] for k in ['title', 'sourceId', 'downloadURL']}, 'utm': mapping(g)})
        sources.append((proj, year, items))
    runs = Path('.sfincs-runs')
    jobs = []
    for x, y in blocks:
        n = f'terrain-1m-{x}-{y}.tif'
        cached = None
        for f in CACHES:  # last match = file prepare_route_case_parameters.py would actually use
            if (runs / f / n).exists():
                cached = str(runs / f / n)
        if a.skip_present_in:
            for f in a.skip_present_in:
                if (f / n).exists():
                    cached = str(f / n)
            jobs.append((x, y, str(a.output), cached, cached is not None))
        else:
            jobs.append((x, y, str(a.output), cached))
    if a.skip_present_in and sum(1 for j in jobs if not j[4]) > 250:
        raise ValueError('Exceeded audited 250-window intake envelope (windows to write)')
    if a.limit:
        jobs = jobs[:a.limit]
    print(f'{len(jobs)} windows ({sum(1 for j in jobs if j[3])} with cache candidates); workers={a.workers}', flush=True)
    records = []
    with ProcessPoolExecutor(max_workers=a.workers, initializer=_init, initargs=(sources, req_geom.wkb, l4_geom.wkb)) as ex:
        futs = {ex.submit(process, j): j for j in jobs}
        for k, f in enumerate(as_completed(futs), 1):
            r = f.result()
            records.append(r)
            print(f"{k}/{len(jobs)} {r['name']} cached={r['reusedCached']} missingReq={r['missingRequiredPixels']} l4Missing={r['l4MissingPixels']} "
                  f"proj={r.get('requiredAreaProjects', r.get('cacheFolder'))} t={r.get('seconds')}", flush=True)
    records.sort(key=lambda r: r['name'])
    new = [r for r in records if not r['reusedCached']]
    summary = {'windows': len(records), 'reusedCached': len(records) - len(new), 'newWindows': len(new),
               'newBytes': sum(r.get('bytes', 0) for r in new),
               'requiredPixels': sum(r['requiredPixels'] for r in records), 'missingRequiredPixels': sum(r['missingRequiredPixels'] for r in records),
               'l4RequiredPixels': sum(r['l4RequiredPixels'] for r in records), 'l4MissingPixels': sum(r['l4MissingPixels'] for r in records),
               'windowsUsing2015InRequired': sum(1 for r in new if r.get('uses2015InRequired')),
               'windowsWithProjectSeamInRequired': sum(1 for r in new if r.get('projectSeamInRequired')),
               'windowsReplacingCache': [r['name'] for r in new if r.get('cachedRejected')],
               **({'skipPresentIn': [str(f) for f in a.skip_present_in],
                   'presentWindowsWithMissingRequired': [{'name': r['name'], 'path': r['path'], 'missingRequiredPixels': r['missingRequiredPixels'],
                                                          'l4MissingPixels': r['l4MissingPixels']} for r in records if r.get('evaluatedOnly') and r['missingRequiredPixels']]}
                  if a.skip_present_in else {}),
               'runtimeSeconds': round(time.time() - t0, 1)}
    result = {'kind': 'professional_1m_road_terrain', 'case': 'brawley-avra-west', 'resolutionM': 1, 'verticalDatum': 'NAVD88', 'crs': 'EPSG:32612',
              'method': 'Standard GDAL bilinear horizontal reprojection (NAD83 UTM12 -> EPSG:32612) of actual USGS 3DEP 1 m products; '
                        'priority fill PimaCounty 2021 > BrawleyRillito 2018 > Eastern PimaCO 2015; no filling, burning or upscaled 10 m source',
              'zones': str(a.zones), 'zoneSha256': hashlib.sha256(a.zones.read_bytes()).hexdigest(), 'minLevel': a.min_level, 'bufferM': a.buffer,
              'catalog': str(a.catalog), 'catalogRetrievedUtc': catalog.get('retrievedUtc'), 'priority': [p for p, _ in PRIORITY],
              'cacheFolders': CACHES, 'summary': summary, 'windows': records,
              'status': 'complete' if summary['missingRequiredPixels'] == 0 else ('coverage_gap_l3_only' if summary['l4MissingPixels'] == 0 else 'coverage_gap')}
    (a.output / 'manifest.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': result['status'], **summary}), flush=True)


if __name__ == '__main__':
    main()
