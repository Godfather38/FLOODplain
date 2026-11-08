"""10 m context rasters (terrain NAVD88 m, ESA WorldCover 2021, GCN10 CN) for brawley-avra-west.

Adapted from the never-committed Codex workspace scripts
task-2/all-route-context/prepare_context.py + merge_adjacent.py and from
tools/sfincs/fetch_current_rasters.py. Same method: standard Rasterio/GDAL
WarpedVRT reprojection onto a 10 m EPSG:32612 grid aligned with
.sfincs-runs/all-route-context-v2; categorical layers nearest-neighbour;
1 m lidar standard bilinear to 10 m. No filling, burning or zero-fill:
cells no source covers stay nodata and are reported.

Terrain priority per 10 m cell (first valid wins; recorded in source-mask.tif):
  1 reuse all-route-context-v2/terrain.tif (2021 Pima B21 / 2023 NorthCentral B23 /
    documented 2019 BrawleyRillito peripheral, see its manifest)
  2 USGS 1 m AZ_PimaCounty_2021_B21
  6 USGS 1 m AZ_CochiseCounty_2020_B20 (newer than D19; only tile x48y354)
  3 USGS 1 m AZ_BrawleyRillito_2018_D19 (flown 2019)
  4 USGS 1 m AZ_Eastern_PimaCO_2015
  5 USGS 3DEP 1/3 arc-second seamless (only where no 1 m source has data)
"""
import argparse, hashlib, json, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window

WC = ['https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N30W114_Map.tif',
      'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N30W111_Map.tif']
CN = ['https://hydro.nmsu.edu/datasets/gcn10/cn_rasters_undrained/cn_f_ii_2281.tif',
      'https://hydro.nmsu.edu/datasets/gcn10/cn_rasters_undrained/cn_f_ii_2280.tif']
SEAMLESS = ['https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/n33w112/USGS_13_n33w112_20260601.tif',
            'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/n32w112/USGS_13_n32w112_20251219.tif']
MAP = 'https://raw.githubusercontent.com/Deltares/hydromt_sfincs/v1.2.2/hydromt_sfincs/data/lulc/esa_worldcover_mapping.csv'
PROJECTS = [  # (code, title key, acquisition window, label)
    (2, 'AZ_PimaCounty_2021_B21', '2021-09-27/2021-11-17', 'USGS 1 m AZ_PimaCounty_2021_B21'),
    (6, 'AZ_CochiseCounty_2020_B20', '2020 (project AZ_CochiseCounty_2020_B20; see USGS metadata)', 'USGS 1 m AZ_CochiseCounty_2020_B20'),
    (3, 'AZ_BrawleyRillito_2018_D19', '2019-03-05/2019-06-01', 'USGS 1 m AZ_BrawleyRillito_2018_D19'),
    (4, 'AZ Eastern PimaCO 2015', '2015 (USGS one meter AZ Eastern PimaCO 2015; see USGS project metadata)', 'USGS 1 m AZ_Eastern_PimaCO_2015'),
]
ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
           GDAL_HTTP_TIMEOUT='90', GDAL_HTTP_MAX_RETRY='4', GDAL_HTTP_RETRY_DELAY='5',
           GDAL_CACHEMAX=512)


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--bounds', nargs=4, type=float, default=[452000, 3532000, 500000, 3586000])
    ap.add_argument('--reuse', type=Path, default=Path('.sfincs-runs/all-route-context-v2'))
    ap.add_argument('--catalog', type=Path, help='TNM 1 m catalog json (default <output>/tnm-catalog.json)')
    ap.add_argument('--gcn-metadata', type=Path, help='local copy of https://hydro.nmsu.edu/datasets/gcn10/metadata.xml')
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()
    P = a.output
    P.mkdir(parents=True, exist_ok=True)
    parts = P / 'parts'
    parts.mkdir(exist_ok=True)
    t0 = time.time()
    xmin, ymin, xmax, ymax = a.bounds
    res = 10.0
    with rasterio.open(a.reuse / 'terrain.tif') as ref:
        rt = ref.transform
        assert ref.crs.to_epsg() == 32612 and rt.a == res and rt.e == -res
        assert ((xmin - rt.c) / res).is_integer() and ((ymax - rt.f) / res).is_integer(), 'grid not aligned with reuse context'
    w, h = int(round((xmax - xmin) / res)), int(round((ymax - ymin) / res))
    tr = from_origin(xmin, ymax, res, res)
    profile = dict(driver='GTiff', width=w, height=h, count=1, crs='EPSG:32612', transform=tr,
                   compress='deflate', tiled=True, blockxsize=256, blockysize=256)
    reuse_manifest = a.reuse / 'manifest.json'
    manifest = {
        'schemaVersion': 1, 'case': 'brawley-avra-west', 'createdUtc': datetime.now(timezone.utc).isoformat(),
        'script': 'tools/sfincs/brawley/prepare_context.py', 'bounds32612': [xmin, ymin, xmax, ymax], 'shape': [h, w],
        'resolutionM': res, 'horizontalCrs': 'EPSG:32612', 'gridAlignedWith': str(a.reuse / 'terrain.tif'),
        'terrainVerticalDatum': 'NAVD88', 'elevationUnits': 'm',
        'reuse': {'path': str(a.reuse), 'manifestSha256': sha(reuse_manifest),
                  'terrainSha256': sha(a.reuse / 'terrain.tif'), 'lulcSha256': sha(a.reuse / 'lulc.tif'), 'cnSha256': sha(a.reuse / 'cn.tif')},
        'layers': {}, 'errors': [],
        'limits': ['Terrain is a multi-vintage mosaic (2015/2019/2021/2023, 1/3 arc-second where coded); see source-mask.tif.',
                   'No filling, burning, conditioning or zero-fill; missing cells remain nodata.',
                   '10 m bare-earth context is not 1 m road survey detail and not a surveyed bridge deck.',
                   'GCN10 fair ARCII undrained is a published scenario, not measured antecedent moisture.',
                   'WorldCover-based roughness is a published class mapping, not measured friction.']}

    def save():
        (P / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    def reuse_array(name, nodata, dtype):
        out = np.full((h, w), nodata, dtype=dtype)
        with rasterio.open(a.reuse / (name + '.tif')) as ds:
            assert ds.nodata == nodata, (name, ds.nodata)
            c0 = int(round((xmin - ds.transform.c) / res)); r0 = int(round((ds.transform.f - ymax) / res))
            sc0, sr0 = max(c0, 0), max(r0, 0)
            sc1, sr1 = min(c0 + w, ds.width), min(r0 + h, ds.height)
            if sc1 > sc0 and sr1 > sr0:
                arr = ds.read(1, window=Window(sc0, sr0, sc1 - sc0, sr1 - sr0))
                out[sr0 - r0:sr1 - r0, sc0 - c0:sc1 - c0] = arr
        return out

    def warp(url, nodata, method, dtype, window=None):
        win = window or Window(0, 0, w, h)
        with rasterio.Env(**ENV):
            with rasterio.open(url) as src:
                with WarpedVRT(src, crs='EPSG:32612', transform=tr, width=w, height=h, resampling=method,
                               nodata=nodata, src_nodata=src.nodata) as vrt:
                    return vrt.read(1, window=win).astype(dtype), {'crs': str(src.crs), 'nodata': src.nodata, 'bounds': list(src.bounds)}

    def write(name, data, nodata, tags=None):
        path = P / (name + '.tif')
        with rasterio.open(path, 'w', **profile, dtype=data.dtype, nodata=nodata) as dst:
            dst.write(data, 1)
            if tags:
                dst.update_tags(**tags)
        return path

    print(f'grid {w}x{h} at {res} m bounds {a.bounds}', flush=True)
    save()

    # ---- categorical layers
    for name, urls, nodata, extra in [('lulc', WC, 0, {'scenario': 'ESA WorldCover 2021 v200', 'license': 'CC-BY-4.0 (ESA WorldCover project 2021)'}),
                                      ('cn', CN, 255, {'scenario': 'GCN10 fair cover ARCII undrained', 'license': 'ODbL 1.0 per current NMSU metadata; see gcn10-metadata.xml'})]:
        data = reuse_array(name, nodata, 'uint8')
        reused = int((data != nodata).sum())
        sources = [{'source': str(a.reuse / (name + '.tif')), 'addedCells': reused, 'method': 'direct aligned copy'}]
        for url in urls:
            miss = data == nodata
            if not miss.any():
                break
            arr, info = warp(url, nodata, Resampling.nearest, 'uint8')
            take = miss & (arr != nodata)
            data[take] = arr[take]
            sources.append({'url': url, 'addedCells': int(take.sum()), 'resampling': 'nearest', **info})
            print(f'{name} {url.rsplit("/",1)[-1]} added {int(take.sum())}', flush=True)
        write(name, data, nodata)
        good = data != nodata
        vals = np.unique(data[good]).tolist()
        manifest['layers'][name] = {'path': name + '.tif', 'sha256': sha(P / (name + '.tif')), 'nodata': nodata,
                                    'validCells': int(good.sum()), 'missingCells': int((~good).sum()),
                                    'range': [int(min(vals)), int(max(vals))] if vals else None,
                                    'values' if name == 'lulc' else 'distinctValueCount': vals if name == 'lulc' else len(vals),
                                    'sources': sources, **extra}
        save()
        print(f'{name} done valid {int(good.sum())} missing {int((~good).sum())}', flush=True)

    # ---- terrain
    out = reuse_array('terrain', -9999.0, 'float32')
    src_mask = np.where(out != -9999, 1, 0).astype('uint8')
    print(f'terrain reused {int((src_mask == 1).sum())} of {w*h}', flush=True)
    catalog_path = a.catalog or (P / 'tnm-catalog.json')
    catalog = json.loads(catalog_path.read_text())
    if catalog['total'] > len(catalog['items']):
        raise ValueError('incomplete TNM catalog')
    jobs = []
    missing0 = out == -9999
    for code, key, acq, label in PROJECTS:
        for item in catalog['items']:
            if key not in item['title']:
                continue
            url = item['downloadURL']
            if not url.startswith('https://prd-tnm.s3.amazonaws.com/'):
                raise ValueError('unexpected host ' + url)
            tok = [t for t in url.replace('.', '_').split('_') if t.startswith('x') and 'y' in t][0]
            tx, ty = int(tok[1:tok.index('y')]), int(tok[tok.index('y') + 1:])
            bx0, bx1, by0, by1 = tx * 10000 - 50, tx * 10000 + 10050, (ty - 1) * 10000 - 50, ty * 10000 + 50
            c0, c1 = max(0, int((bx0 - xmin) // res)), min(w, int(np.ceil((bx1 - xmin) / res)))
            r0, r1 = max(0, int((ymax - by1) // res)), min(h, int(np.ceil((ymax - by0) / res)))
            if c1 <= c0 or r1 <= r0:
                continue
            sub = missing0[r0:r1, c0:c1]
            if not sub.any():
                continue
            rr = np.flatnonzero(sub.any(axis=1)); cc = np.flatnonzero(sub.any(axis=0))
            win = Window(c0 + int(cc[0]), r0 + int(rr[0]), int(cc[-1] - cc[0] + 1), int(rr[-1] - rr[0] + 1))
            jobs.append(dict(code=code, label=label, acq=acq, item=item, url=url, tile=tok, win=win,
                             part=parts / f'terrain-{code}-{tok}-{hashlib.sha256(url.encode()).hexdigest()[:10]}.tif'))
    print(f'terrain 1 m jobs: {len(jobs)}', flush=True)

    def fetch(job):
        part, win = job['part'], job['win']
        t = time.time()
        if not part.exists():
            arr, info = warp(job['url'], -9999.0, Resampling.bilinear, 'float32', win)
            if info['crs'] != 'EPSG:26912':
                raise ValueError('unexpected terrain CRS ' + info['crs'])
            arr[~np.isfinite(arr)] = -9999.0
            pp = dict(profile, width=int(win.width), height=int(win.height),
                      transform=rasterio.windows.transform(win, tr))
            tmp = part.with_suffix('.tmp.tif')
            with rasterio.open(tmp, 'w', **pp, dtype='float32', nodata=-9999.0) as dst:
                dst.write(arr, 1)
                dst.update_tags(source_url=job['url'], source_crs=info['crs'], source_nodata=str(info['nodata']))
            tmp.replace(part)
        return job, round(time.time() - t, 1)

    results = {}
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(fetch, j) for j in jobs]
        for f in as_completed(futs):
            try:
                job, dt = f.result()
                results[job['part']] = dt
                print(f'terrain part {job["tile"]} code {job["code"]} {dt}s ({len(results)}/{len(jobs)})', flush=True)
            except Exception as e:
                manifest['errors'].append({'layer': 'terrain', 'error': repr(e)}); save()
                print('terrain part error ' + repr(e), flush=True)
    srcs = []
    for job in sorted(jobs, key=lambda j: (j['code'], j['tile'])):
        if not job['part'].exists():
            srcs.append({'url': job['url'], 'title': job['item']['title'], 'status': 'FAILED'})
            continue
        with rasterio.open(job['part']) as ds:
            arr = ds.read(1)
        win = job['win']
        r0, c0 = int(win.row_off), int(win.col_off)
        view = out[r0:r0 + arr.shape[0], c0:c0 + arr.shape[1]]
        mview = src_mask[r0:r0 + arr.shape[0], c0:c0 + arr.shape[1]]
        take = (view == -9999) & (arr != -9999) & np.isfinite(arr)
        view[take] = arr[take]; mview[take] = job['code']
        srcs.append({'code': job['code'], 'title': job['item']['title'], 'url': job['url'], 'catalogSourceId': job['item'].get('sourceId'),
                     'publicationDate': job['item'].get('publicationDate'), 'sizeInBytes': job['item'].get('sizeInBytes'),
                     'acquisitionWindow': job['acq'], 'window': [c0, r0, int(win.width), int(win.height)],
                     'partFile': 'parts/' + job['part'].name, 'partSha256': sha(job['part']),
                     'validCellsInPart': int((arr != -9999).sum()), 'addedCells': int(take.sum()), 'fetchSeconds': results.get(job['part'])})
        print(f'merge {job["tile"]} code {job["code"]} added {int(take.sum())}', flush=True)
    # 1/3 arc-second only where 1 m left gaps
    for url in SEAMLESS:
        miss = out == -9999
        if not miss.any():
            break
        rr = np.flatnonzero(miss.any(axis=1)); cc = np.flatnonzero(miss.any(axis=0))
        win = Window(int(cc[0]), int(rr[0]), int(cc[-1] - cc[0] + 1), int(rr[-1] - rr[0] + 1))
        arr, info = warp(url, -9999.0, Resampling.bilinear, 'float32', win)
        view = out[win.row_off:win.row_off + win.height, win.col_off:win.col_off + win.width]
        mview = src_mask[win.row_off:win.row_off + win.height, win.col_off:win.col_off + win.width]
        take = (view == -9999) & (arr != -9999) & np.isfinite(arr)
        view[take] = arr[take]; mview[take] = 5
        srcs.append({'code': 5, 'title': url.rsplit('/', 1)[-1], 'url': url, 'addedCells': int(take.sum()),
                     'resampling': 'bilinear', 'note': 'USGS 3DEP 1/3 arc-second seamless; used only where no 1 m tile had data', **info})
        print(f'seamless {url.rsplit("/",1)[-1]} added {int(take.sum())}', flush=True)
    write('terrain', out, -9999.0, {'vertical_datum': 'NAVD88', 'vertical_units': 'metres',
                                    'sources': 'see manifest.json and source-mask.tif'})
    good = out != -9999
    src_mask[~good] = 0
    write('source-mask', src_mask, 255, {'values': '0=missing terrain; 1=reused all-route-context-v2; 2=USGS 1m AZ_PimaCounty_2021_B21; 3=USGS 1m AZ_BrawleyRillito_2018_D19 (flown 2019); 4=USGS 1m AZ_Eastern_PimaCO_2015; 5=USGS 3DEP 1/3 arc-second seamless; 6=USGS 1m AZ_CochiseCounty_2020_B20'})
    write('missing-terrain-mask', (~good).astype('uint8'), 255, {'values': '0=terrain present; 1=missing; 255=nodata'})
    counts = {str(k): int((src_mask == k).sum()) for k in range(7)}
    manifest['layers']['terrain'] = {'path': 'terrain.tif', 'sha256': sha(P / 'terrain.tif'), 'nodata': -9999.0,
                                     'validCells': int(good.sum()), 'missingCells': int((~good).sum()),
                                     'range': [float(out[good].min()), float(out[good].max())] if good.any() else None,
                                     'resampling': 'reuse: direct aligned copy; new 1 m and 1/3 arc-second: GDAL WarpedVRT bilinear to 10 m (same as all-route-context-v2)',
                                     'sourceHorizontalCrs': 'EPSG:26912 (1 m), EPSG:4269 (1/3 arc-second)',
                                     'sourceCellCounts': counts, 'sources': srcs}
    manifest['sourceMask'] = {'path': 'source-mask.tif', 'sha256': sha(P / 'source-mask.tif'),
                              'values': {'0': 'missing', '1': 'reused all-route-context-v2 (2021 Pima B21 / 2023 NorthCentral B23 / documented 2019 BrawleyRillito peripheral)',
                                         '2': 'USGS 1 m AZ_PimaCounty_2021_B21', '3': 'USGS 1 m AZ_BrawleyRillito_2018_D19 (flown 2019)',
                                         '4': 'USGS 1 m AZ_Eastern_PimaCO_2015', '5': 'USGS 3DEP 1/3 arc-second seamless', '6': 'USGS 1 m AZ_CochiseCounty_2020_B20'}}
    manifest['missingTerrainMask'] = {'path': 'missing-terrain-mask.tif', 'sha256': sha(P / 'missing-terrain-mask.tif'),
                                      'values': {'0': 'present', '1': 'missing', '255': 'nodata'}}
    manifest['tnmCatalog'] = {'path': str(catalog_path), 'sha256': sha(catalog_path), 'total': catalog['total']}
    mp = P / 'esa_worldcover_mapping.csv'
    mp.write_bytes((a.reuse / 'esa_worldcover_mapping.csv').read_bytes())
    manifest['manningMapping'] = {'path': mp.name, 'url': MAP, 'sha256': sha(mp),
                                  'method': 'Official HydroMT-SFINCS v1.2.2 ESA WorldCover mapping (copied from all-route-context-v2; byte-identical to installed hydromt_sfincs 1.2.2 data/lulc/esa_worldcover_mapping.csv)'}
    if a.gcn_metadata and a.gcn_metadata.exists():
        (P / 'gcn10-metadata.xml').write_bytes(a.gcn_metadata.read_bytes())
        manifest['cnLicenseMetadata'] = {'url': 'https://hydro.nmsu.edu/datasets/gcn10/metadata.xml', 'path': 'gcn10-metadata.xml', 'sha256': sha(P / 'gcn10-metadata.xml')}
    manifest['cnAttribution'] = 'Azzam and Cho (2026), GCN10, SoftwareX 34, 102725, doi:10.1016/j.softx.2026.102725; NMSU distribution. ODbL 1.0 obligations apply to derivative databases.'
    manifest['runtimeSeconds'] = round(time.time() - t0, 1)
    save()
    print(json.dumps({'terrain': manifest['layers']['terrain']['range'], 'counts': counts,
                      'runtime': manifest['runtimeSeconds']}), flush=True)


if __name__ == '__main__':
    main()
