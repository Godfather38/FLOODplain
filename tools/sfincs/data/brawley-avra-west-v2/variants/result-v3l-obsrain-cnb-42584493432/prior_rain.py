import sys, glob, json, numpy as np, eccodes as ec
from pathlib import Path
from pyproj import Transformer
t = Transformer.from_crs('EPSG:32612', 'EPSG:4326', always_xy=True)
lon0, lat0 = t.transform(452400, 3533400); lon1, lat1 = t.transform(452400+436*100, 3533400+594*100)
out = {}
for f in sorted(glob.glob(str(Path(sys.argv[1]) / '*.grib'))):
    with open(f, 'rb') as fh:
        g = ec.codes_grib_new_from_file(fh)
        v = ec.codes_get_values(g); la = ec.codes_get_array(g, 'latitudes'); lo = ec.codes_get_array(g, 'longitudes')
        miss = ec.codes_get(g, 'missingValue'); ec.codes_release(g)
    lo = np.where(lo > 180, lo - 360, lo)
    m = (la >= lat0) & (la <= lat1) & (lo >= lon0) & (lo <= lon1)
    vv = v[m]; bad = (vv == miss) | ~np.isfinite(vv)
    out[Path(f).name] = {'cells': int(m.sum()), 'missingCells': int(bad.sum()),
                         'mean_mm': float(vv[~bad].mean()), 'max_mm': float(vv[~bad].max())}
print(json.dumps({'bbox_lonlat': [lon0, lat0, lon1, lat1], 'files': out}, indent=1))
