"""Verify brawley-avra-west context rasters against a domain polygon (+buffer).

Checks: domain+buffer inside raster bounds; no terrain/lulc/cn nodata inside it;
CN in 1..100; every lulc code present in the HydroMT mapping (excluding 0 nodata).
Writes the result into manifest.json under 'domainCheck' when --update-manifest.
"""
import argparse, csv, hashlib, json
from pathlib import Path
import numpy as np, rasterio, geopandas as gpd
from rasterio.features import geometry_mask


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--context', type=Path, required=True)
    ap.add_argument('--domain', type=Path, required=True)
    ap.add_argument('--buffer', type=float, default=300.0)
    ap.add_argument('--update-manifest', action='store_true')
    a = ap.parse_args()
    dom = gpd.read_file(a.domain).to_crs(32612)
    area = float(dom.geometry.union_all().area) if hasattr(dom.geometry, 'union_all') else float(dom.unary_union.area)
    geom = dom.geometry.buffer(a.buffer)
    res = {'domain': str(a.domain), 'domainSha256': hashlib.sha256(a.domain.read_bytes()).hexdigest(),
           'domainAreaKm2': round(area / 1e6, 3), 'bufferM': a.buffer,
           'bufferedBounds32612': [float(v) for v in geom.total_bounds]}
    mapping = {int(r['esa_worldcover']) for r in csv.DictReader(open(a.context / 'esa_worldcover_mapping.csv'))}
    ok = True
    for name in ['terrain', 'lulc', 'cn', 'source-mask']:
        with rasterio.open(a.context / (name + '.tif')) as ds:
            b = ds.bounds
            inside = (geom.total_bounds[0] >= b.left and geom.total_bounds[1] >= b.bottom and
                      geom.total_bounds[2] <= b.right and geom.total_bounds[3] <= b.top)
            mask = geometry_mask(geom, (ds.height, ds.width), ds.transform, invert=True, all_touched=True)
            data = ds.read(1)
            bad = mask & ((data == ds.nodata) | ~np.isfinite(data)) if name != 'source-mask' else mask & (data == 0)
            entry = {'withinRasterBounds': bool(inside), 'requiredCells': int(mask.sum()), 'missingCells': int(bad.sum())}
            v = data[mask & ~bad]
            if name == 'terrain':
                entry['rangeM'] = [float(v.min()), float(v.max())]
            elif name == 'cn':
                entry['range'] = [int(v.min()), int(v.max())]
                entry['inRange1to100'] = bool(v.min() >= 1 and v.max() <= 100)
                ok &= entry['inRange1to100']
            elif name == 'lulc':
                codes = sorted(set(np.unique(v).tolist()))
                entry['codes'] = codes
                entry['unmappedCodes'] = [c for c in codes if c not in mapping]
                ok &= not entry['unmappedCodes']
            else:
                u, c = np.unique(v, return_counts=True)
                entry['cellsBySourceCode'] = {str(int(k)): int(n) for k, n in zip(u, c)}
            ok &= inside and entry['missingCells'] == 0
            res[name] = entry
    res['pass'] = bool(ok)
    print(json.dumps(res, indent=1))
    if a.update_manifest:
        mp = a.context / 'manifest.json'
        m = json.loads(mp.read_text())
        m['domainCheck'] = res
        mp.write_text(json.dumps(m, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
