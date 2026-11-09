"""Inflow-wave arrival from the difference of the two variants (identical rain, mesh, parameters).
Usage: python -I tools/sfincs/brawley/validate_postrun_arrival.py <wt-model dir> <out.json>"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pyproj
import xarray as xr

WT = Path(sys.argv[1]); OUT = Path(sys.argv[2])
TO_UTM = pyproj.Transformer.from_crs(4326, 32612, always_xy=True)
TO_LL = pyproj.Transformer.from_crs(32612, 4326, always_xy=True)


def cur(run):
    return WT / ".sfincs-runs" / f"brawley-avra-west-result-{run}" / "artifact" / "runs" / "current"


mo = xr.open_dataset(cur("42535217219") / "sfincs_map.nc")
mn = xr.open_dataset(cur("42535214906") / "sfincs_map.nc")
zb = mo["zb"].values.astype(np.float64)
x = mo["mesh2d_face_x"].values; y = mo["mesh2d_face_y"].values
q = xr.open_dataset(cur("42535217219") / "sfincs.nc")
size = 100.0 / 2.0 ** (q["level"].values - 1)
area = size ** 2
t = [str(v)[:16] + "Z" for v in mo["time"].values]
zo = mo["zs"].values.astype(np.float64); zn = mn["zs"].values.astype(np.float64)
vo = mo["subgrid_volume"].values.astype(np.float64)
res = {}
# NaN meaning
nanmask = np.isnan(zo)
h = vo / area[None, :]
res["nanZs"] = {"count": int(nanmask.sum()), "withVolOverAreaGe0p0091": int((nanmask & (h >= 0.0091)).sum()),
                "maxVolOverAreaWhereNaN": float(np.nanmax(np.where(nanmask, h, -1))),
                "cellsEverNaN": int(nanmask.any(axis=0).sum())}
# NaN -> bed level (dry) for the difference only
zoF = np.where(np.isnan(zo), zb[None, :], zo); znF = np.where(np.isnan(zn), zb[None, :], zn)
diff = zoF - znF
inlet = 144751
ix, iy = x[inlet], y[inlet]
# front: northernmost cell centre with diff > 0.3 m (and > 0.05 m), per frame
front = {}
for i in range(0, len(t), 2):
    sel3 = diff[i] > 0.3; sel05 = diff[i] > 0.05
    f3 = float(y[sel3].max()) if sel3.any() else None
    f05 = float(y[sel05].max()) if sel05.any() else None
    front[t[i]] = {"north_y_0p3": f3, "lat_0p3": None if f3 is None else round(TO_LL.transform(ix, f3)[1], 4),
                   "dyKmFromInlet_0p3": None if f3 is None else round((f3 - iy) / 1000, 2),
                   "dyKmFromInlet_0p05": None if f05 is None else round((f05 - iy) / 1000, 2),
                   "cells_0p3": int(sel3.sum())}
res["front"] = front
SECT = {
    "Donaldson Ranch": (32.17568, -111.275, -111.245),
    "Mile Wide (both bands)": (32.24820, -111.262, -111.236),
    "Mile Wide Brawley 15877627 band": (32.24820, -111.262, -111.2475),
    "Mile Wide Black Wash 15876815 band": (32.24820, -111.2475, -111.236),
    "Manville": (32.29177, -111.285, -111.252),
    "Tucker": (32.33536, -111.300, -111.268),
    "Outlet (outflow cells)": (32.3647, -111.297, -111.289),
}
arr = {}
for k, (lat, lw, le) in SECT.items():
    xa, ys = TO_UTM.transform(lw, lat); xb, _ = TO_UTM.transform(le, lat)
    cells = np.where((x >= xa) & (x <= xb) & (np.abs(y - ys) <= 40.0))[0]
    d = diff[:, cells]
    mx = d.max(axis=1)
    first3 = next((t[i] for i in range(len(t)) if mx[i] > 0.3), None)
    first05 = next((t[i] for i in range(len(t)) if mx[i] > 0.05), None)
    j = int(np.argmax(d.max(axis=0)))
    c = int(cells[j])
    # literal rule at the cell of largest difference: zs_obs > zb + 0.3 m
    lit = next((t[i] for i in range(len(t)) if zoF[i, c] - zb[c] > 0.3), None)
    arr[k] = {"cells": int(cells.size), "firstDiffGt0p3": first3, "firstDiffGt0p05": first05,
              "maxDiffEnd07Z": round(float(mx[-1]), 3), "maxDiffAny": round(float(mx.max()), 3),
              "maxDiffTime": t[int(np.argmax(mx))],
              "cellOfMaxDiff": {"face": c, "cellM": float(size[c]), "lonlat": [round(v, 5) for v in TO_LL.transform(x[c], y[c])],
                                "zb": round(float(zb[c]), 3), "obsZsFirstAboveZb0p3": lit,
                                "obsZs17Z": round(float(zoF[0, c]), 3), "obsZs07Z": round(float(zoF[-1, c]), 3),
                                "nwmZs07Z": round(float(znF[-1, c]), 3)}}
res["arrival"] = arr
# ridge-road ranges for roads flagged in analyze.py
st = json.load(gzip.open(WT / "tools/live/road-stations/brawley-avra-west-local.json.gz"))["columns"]
road = np.array(st["road"]); rz = np.array([np.nan if v is None else v for v in st["roadZ"]])
rr = {}
for r in ["North Razorback Road", "South Crazy Cat Lane", "South Marstellar Road", "Welcome Way",
          "West Bar X Street", "West Dusty Flat Place", "West Iowa Street"]:
    ii = np.where(road == r)[0]
    rr[r] = {"n": int(ii.size), "roadZmin": float(np.nanmin(rz[ii])), "roadZmax": float(np.nanmax(rz[ii])),
             "lonlat": [float(np.mean(np.array(st["lon"])[ii])), float(np.mean(np.array(st["lat"])[ii]))]}
res["ridgeRoadRanges"] = rr
OUT.write_text(json.dumps(res, indent=1))
print(json.dumps(res, indent=1))
