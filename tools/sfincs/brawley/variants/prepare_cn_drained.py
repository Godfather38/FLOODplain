"""GCN10 fair-cover ARC II *drained* CN on the brawley-avra-west 10 m context grid (SENSITIVITY input).

Same source and condition as the current cn.tif (GCN10 fair cover, ARC II, tiles 2281 then 2280,
https://hydro.nmsu.edu/datasets/gcn10/), only the drained/undrained interpretation of dual
hydrologic soil groups (A/D, B/D, C/D) changes. Same regridding as tools/sfincs/brawley/prepare_context.py:
rasterio WarpedVRT nearest onto the 10 m EPSG:32612 grid of the existing cn.tif, tile 2281 first,
2280 only where 2281 is nodata.

Because the existing cn.tif was assembled partly by an aligned copy of an older cache, the undrained
tiles are warped the same way first and compared with the existing cn.tif. The drained raster is
  existing cn.tif, replaced by the drained warp only on cells where drained warp != undrained warp,
so every cell the drained/undrained choice does not touch keeps its exact current value.
No filling: any nodata in the result is an error.
"""
import argparse, hashlib, json
from pathlib import Path
import numpy as np, rasterio
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT

BASE = 'https://hydro.nmsu.edu/datasets/gcn10/'
TILES = ['cn_f_ii_2281.tif', 'cn_f_ii_2280.tif']
ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
           GDAL_HTTP_TIMEOUT='90', GDAL_HTTP_MAX_RETRY='4', GDAL_HTTP_RETRY_DELAY='5', GDAL_CACHEMAX=512)


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def warp_set(regime, ref):
    data = np.full((ref.height, ref.width), 255, dtype='uint8')
    srcs = []
    for t in TILES:
        url = f'{BASE}cn_rasters_{regime}/{t}'
        with rasterio.Env(**ENV), rasterio.open(url) as src, WarpedVRT(src, crs=ref.crs, transform=ref.transform, width=ref.width,
                                                                          height=ref.height, resampling=Resampling.nearest,
                                                                          nodata=255, src_nodata=src.nodata) as vrt:
            arr = vrt.read(1).astype('uint8')
        take = (data == 255) & (arr != 255)
        data[take] = arr[take]
        srcs.append({'url': url, 'addedCells': int(take.sum())})
        print(regime, t, 'added', int(take.sum()), flush=True)
    return data, srcs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--existing', type=Path, default=Path('.sfincs-runs/brawley-avra-west-context-v2/cn.tif'))
    ap.add_argument('--output', type=Path, required=True)
    a = ap.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    with rasterio.open(a.existing) as ref:
        cur = ref.read(1); prof = ref.profile
        und, und_src = warp_set('undrained', ref)
        dra, dra_src = warp_set('drained', ref)
    for n, d in [('undrained', und), ('drained', dra), ('existing', cur)]:
        if (d == 255).any():
            raise ValueError(f'{n}: {int((d == 255).sum())} nodata cells; no filling')
    reproduce = cur == und
    changed = dra != und
    new = cur.copy(); new[changed] = dra[changed]
    pairs = {}
    for u, d in zip(und[changed].tolist(), dra[changed].tolist()):
        pairs[f'{u}->{d}'] = pairs.get(f'{u}->{d}', 0) + 1
    out = a.output / 'cn-drained.tif'
    with rasterio.open(out, 'w', **prof) as dst:
        dst.write(new, 1)
        dst.update_tags(scenario='GCN10 fair cover ARCII drained', license='ODbL 1.0 per NMSU GCN10 metadata; see gcn10-metadata.xml',
                        method='existing cn.tif with cells replaced where GCN10 drained != undrained (same WarpedVRT nearest)')
    rep = {'script': 'tools/sfincs/brawley/variants/prepare_cn_drained.py', 'existing': str(a.existing), 'existingSha256': sha(a.existing),
           'grid': {'crs': str(prof['crs']), 'transform': list(prof['transform'])[:6], 'shape': [prof['height'], prof['width']]},
           'sources': {'undrained': und_src, 'drained': dra_src}, 'cells': int(cur.size),
           'undrainedWarpReproducesExistingCells': int(reproduce.sum()), 'undrainedWarpMismatchCells': int((~reproduce).sum()),
           'drainedDiffersFromUndrainedCells': int(changed.sum()),
           'changedCellsWhereExistingMatchedUndrainedWarp': int((changed & reproduce).sum()),
           'cnTransitionsUndrainedToDrained': dict(sorted(pairs.items(), key=lambda kv: -kv[1])),
           'meanCn': {'existing': float(cur.mean()), 'drained': float(new.mean())},
           'output': {'path': str(out), 'sha256': sha(out)}}
    (a.output / 'cn-drained-report.json').write_text(json.dumps(rep, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps(rep, indent=1))


if __name__ == '__main__':
    main()
