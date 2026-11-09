"""Stage IV rain over the model box before tstart (2026-10-30T16Z), for the cnb seff = smax (dry start) choice.

usage: python -I prior_rain.py <folder with ST4.*.grib> > stage4-prior-rain.json

The lon/lat box is the min/max over ALL FOUR corners of the UTM 12N model box (452400..496000 E, 3533400..3592800 N):
UTM grid north is not true north here, so two corners alone miss part of the box. 'priorTotalPerCell' adds, cell by cell,
the 24 h total ending 12Z Oct 30 and the four 01h totals ending 13Z..16Z Oct 30 (the rain from 12Z Oct 29 to tstart).
A missing cell value is unknown: it is counted in missingCells and never treated as zero.
"""
import sys, glob, json, numpy as np, eccodes as ec
from pathlib import Path
from pyproj import Transformer
t = Transformer.from_crs('EPSG:32612', 'EPSG:4326', always_xy=True)
X0, Y0, X1, Y1 = 452400, 3533400, 452400 + 436 * 100, 3533400 + 594 * 100
clon, clat = t.transform([X0, X1, X1, X0], [Y0, Y0, Y1, Y1])
lon0, lon1, lat0, lat1 = min(clon), max(clon), min(clat), max(clat)
out = {}; fields = {}; grid = None
for f in sorted(glob.glob(str(Path(sys.argv[1]) / '*.grib'))):
    with open(f, 'rb') as fh:
        g = ec.codes_grib_new_from_file(fh)
        v = ec.codes_get_values(g); la = ec.codes_get_array(g, 'latitudes'); lo = ec.codes_get_array(g, 'longitudes')
        miss = ec.codes_get(g, 'missingValue'); ec.codes_release(g)
    lo = np.where(lo > 180, lo - 360, lo)
    m = (la >= lat0) & (la <= lat1) & (lo >= lon0) & (lo <= lon1)
    if grid is None: grid = m
    assert (m == grid).all(), f'{f}: different grid'
    vv = v[m].astype(float); bad = (vv == miss) | ~np.isfinite(vv); vv[bad] = np.nan
    fields[Path(f).name] = vv
    out[Path(f).name] = {'cells': int(m.sum()), 'missingCells': int(bad.sum()),
                         'mean_mm': float(np.nanmean(vv)), 'max_mm': float(np.nanmax(vv))}
prior = ['ST4.2026103012.24h.grib'] + [f'ST4.20261030{h}.01h.grib' for h in (13, 14, 15, 16)]
tot = sum(fields[k] for k in prior)  # NaN in any part leaves that cell unknown
ok = np.isfinite(tot)
res = {'bbox_lonlat': [lon0, lat0, lon1, lat1], 'bboxMethod': 'min/max over the four corners of the UTM 12N model box',
       'files': out,
       'priorTotalPerCell': {'window': '2026-10-29T12Z..2026-10-30T16Z (24h ending 12Z Oct 30 + 01h ending 13Z..16Z)',
                             'files': prior, 'cells': int(tot.size), 'unknownCells': int((~ok).sum()),
                             'mean_mm': float(tot[ok].mean()), 'max_mm': float(tot[ok].max()),
                             'p95_mm': float(np.percentile(tot[ok], 95))}}
print(json.dumps(res, indent=1))
