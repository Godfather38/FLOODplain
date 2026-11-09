"""Post-run validation of the brawley-avra-west v1b frozen results (both variants).

Reads native SFINCS output only (sfincs_map.nc, hourly .rst restart files, sfincs.nc quadtree,
sfincs.dis). No model input or parameter is changed. Writes one JSON with every number.
Usage: python -I tools/sfincs/brawley/validate_postrun.py <wt-model dir> <out.json>
"""
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
import pyproj
import xarray as xr

WT = Path(sys.argv[1])
OUT = Path(sys.argv[2])
RUNS = {
    "nwm": "42535214906",
    "observed": "42535217219",
}
X0, Y0, DX = 460200.0, 3533400.0, 100.0
TO_UTM = pyproj.Transformer.from_crs(4326, 32612, always_xy=True)
TO_LL = pyproj.Transformer.from_crs(32612, 4326, always_xy=True)
DRY = 0.0091  # exporter wet threshold (volume/area), used only as a wet flag
res = {"runs": RUNS}


def cur(run):
    return WT / ".sfincs-runs" / f"brawley-avra-west-result-{run}" / "artifact" / "runs" / "current"


# ---------------- geometry (identical in both runs) ----------------
q = xr.open_dataset(cur(RUNS["observed"]) / "sfincs.nc")
level = q["level"].values.astype(int)
nidx = q["n"].values.astype(int)
midx = q["m"].values.astype(int)
nb = {k: q[k].values.astype(np.int64) for k in ["mu", "mu1", "mu2", "nu", "nu1", "nu2"]}
NF = level.size
size = DX / 2.0 ** (level - 1)
area = size * size
xc = X0 + (midx - 0.5) * size
yc = Y0 + (nidx - 0.5) * size
lookup = {}
for i in range(NF):
    lookup[(level[i], nidx[i], midx[i])] = i
LEVELS = sorted(set(level.tolist()))


def face_at(x, y):
    for L in LEVELS:
        s = DX / 2.0 ** (L - 1)
        m = int(math.floor((x - X0) / s)) + 1
        n = int(math.floor((y - Y0) / s)) + 1
        f = lookup.get((L, n, m))
        if f is not None:
            return f
    return None


# uv points in SFINCS order: for each cell, right link(s) then above link(s)
uv_nm, uv_nmu, uv_dir = [], [], []
for c in range(NF):
    for d, (fl, a, b) in enumerate([("mu", "mu1", "mu2"), ("nu", "nu1", "nu2")]):
        if nb[fl][c] < 1:
            if nb[a][c] > 0:
                uv_nm.append(c); uv_nmu.append(nb[a][c] - 1); uv_dir.append(d)
        else:
            if nb[a][c] > 0:
                uv_nm.append(c); uv_nmu.append(nb[a][c] - 1); uv_dir.append(d)
            if nb[b][c] > 0:
                uv_nm.append(c); uv_nmu.append(nb[b][c] - 1); uv_dir.append(d)
uv_nm = np.array(uv_nm); uv_nmu = np.array(uv_nmu); uv_dir = np.array(uv_dir)
NPUV = uv_nm.size
uv_w = np.minimum(size[uv_nm], size[uv_nmu])
res["geometry"] = {"faces": int(NF), "npuv": int(NPUV), "areaKm2": float(area.sum() / 1e6)}

m0 = xr.open_dataset(cur(RUNS["observed"]) / "sfincs_map.nc")
msk = m0["msk"].values.astype(int)
zb = m0["zb"].values.astype(np.float64)
times = m0["time"].values
tlabels = [str(t)[:16] + "Z" for t in times]
fx, fy = m0["mesh2d_face_x"].values, m0["mesh2d_face_y"].values
res["geometry"]["faceCentreMaxDiffM"] = float(max(np.abs(fx - xc).max(), np.abs(fy - yc).max()))
out_cells = np.where(msk == 3)[0]
res["geometry"]["outflowCells"] = {
    "n": int(out_cells.size),
    "xRange": [float(xc[out_cells].min()), float(xc[out_cells].max())],
    "yRange": [float(yc[out_cells].min()), float(yc[out_cells].max())],
    "lonlatMean": list(TO_LL.transform(float(xc[out_cells].mean()), float(yc[out_cells].mean()))),
    "sizesM": sorted(set(size[out_cells].tolist())),
}
m0.close()

is3 = msk == 3
bnd_links = np.where(is3[uv_nm] ^ is3[uv_nmu])[0]
# sign: +1 if the flux q (nm->nmu) goes into the outflow cell
bnd_sign = np.where(is3[uv_nmu[bnd_links]], 1.0, -1.0)
res["geometry"]["outflowLinks"] = int(bnd_links.size)


def read_rst(path):
    b = path.read_bytes()
    recs, i = [], 0
    while i < len(b):
        n = int(np.frombuffer(b[i:i + 4], "<i4")[0])
        recs.append(b[i + 4:i + 4 + n])
        i += 8 + n
    zs = np.frombuffer(recs[1], "<f4")
    qq = np.frombuffer(recs[2], "<f4")
    return zs, qq


def section_links(lat, lon1, lon2):
    """Stair-step section along a parallel between two longitudes: A = cells south, B = north."""
    xa, ys = TO_UTM.transform(lon1, lat)
    xb, _ = TO_UTM.transform(lon2, lat)
    inband = (xc >= min(xa, xb)) & (xc <= max(xa, xb))
    south = yc < ys
    A = inband & south
    B = inband & ~south
    l1 = np.where(A[uv_nm] & B[uv_nmu])[0]
    l2 = np.where(B[uv_nm] & A[uv_nmu])[0]
    links = np.concatenate([l1, l2])
    sign = np.concatenate([np.ones(l1.size), -np.ones(l2.size)])  # + = northward (downstream)
    return links, sign


meta = json.loads((WT / "docs/upgrade/validation-brawley-prerun-20261108.json").read_text())
crossings = meta["brawleyCrossings"]
repdips = meta["repDips"]
nwmref = json.loads((WT / "tools/sfincs/data/brawley-avra-west-v1/nwm-validation-reaches.json").read_text())
aa = {s["reachId"]: s["points"] for s in nwmref["analysisFullWindow"]["series"]}

SECTIONS = {
    # name: (lat, lon west, lon east)
    "Donaldson Ranch (15877627)": (32.17568, -111.275, -111.245),
    "Mile Wide Brawley 15877627 only": (32.24820, -111.262, -111.2475),
    "Mile Wide Black Wash 15876815 only": (32.24820, -111.2475, -111.236),
    "Mile Wide both": (32.24820, -111.262, -111.236),
    "Manville (15876771)": (32.29177, -111.285, -111.252),
    "Tucker (15876711)": (32.33536, -111.300, -111.268),
    "Little Williams (15876711)": (32.33710, -111.300, -111.268),
}
sec = {k: section_links(*v) for k, v in SECTIONS.items()}
res["sections"] = {k: {"lat": v[0], "lonW": v[1], "lonE": v[2], "links": int(sec[k][0].size)} for k, v in SECTIONS.items()}

stations = json.load(gzip.open(WT / "tools/live/road-stations/brawley-avra-west-local.json.gz"))["columns"]
slon = np.array(stations["lon"]); slat = np.array(stations["lat"])
sz = np.array([np.nan if v is None else v for v in stations["roadZ"]], dtype=float)
sroad = np.array(stations["road"]); sflag = np.array(stations["flags"])
sx, sy = TO_UTM.transform(slon, slat)
sface = np.array([(-1 if (f := face_at(x, y)) is None else f) for x, y in zip(sx, sy)])


def near_stations(lon, lat, r=25.0):
    x, y = TO_UTM.transform(lon, lat)
    return np.where(np.hypot(sx - x, sy - y) <= r)[0]


def channel_face(lon, lat, r=30.0):
    x, y = TO_UTM.transform(lon, lat)
    cand = np.where(np.hypot(xc - x, yc - y) <= r)[0]
    if cand.size == 0:
        return face_at(x, y)
    return int(cand[np.argmin(zb[cand])])


inlet_face = 144751
POINTS = {"Inlet face 144751 (15876923)": inlet_face}
for c in crossings:
    POINTS[f"{c['road']} channel"] = channel_face(c["lon"], c["lat"])
POINTS["ALERT 6443 site (on 15876815) containing face"] = face_at(*TO_UTM.transform(-111.244446, 32.248611))
POINTS["ALERT 6443 site lowest face within 30 m"] = channel_face(-111.244446, 32.248611)
POINTS["Brawley 15877627 at Mile Wide (lowest within 30 m)"] = channel_face(-111.25265, 32.24820)
POINTS["Confluence 15876811 start"] = channel_face(-111.2439, 32.2501)
POINTS["Outlet node 720060498 (lowest within 100 m)"] = channel_face(-111.2930, 32.3647, 100.0)

res["variants"] = {}
cache = {}
for var, run in RUNS.items():
    d = cur(run)
    m = xr.open_dataset(d / "sfincs_map.nc")
    zs = m["zs"].values.astype(np.float64)  # (57, NF)
    vol = m["subgrid_volume"].values.astype(np.float64)
    zsmax = m["zsmax"].values[0].astype(np.float64)
    cumprcp = m["cumprcp"].values[0].astype(np.float64)
    cuminf = m["cuminf"].values[0].astype(np.float64)
    prate = m["precipitation_rate"].values.astype(np.float64)  # mm/h at frame times
    m.close()
    cache[var] = (zs, vol, zsmax)
    V = {}
    # ---- inflow ----
    dis = np.loadtxt(d / "sfincs.dis")
    t, qin = dis[:, 0], dis[:, 1]
    tstop = 63 * 3600.0
    inflow_total = float(np.trapz(qin, t))
    V["inflow"] = {"peakM3s": float(qin.max()), "peakTimeS": float(t[np.argmax(qin)]),
                   "volumeM3_trapz_wholeRun": inflow_total}
    # ---- whole-run volume balance ----
    rain = float((cumprcp * area).sum())
    inf = float((cuminf * area).sum())
    s_end = float(np.nansum(vol[-1]))
    s_start_window = float(np.nansum(vol[0]))
    # outflow from hourly restart q at the boundary links
    rst = sorted(d.glob("sfincs.*.rst"))
    hours, qout, secq, rstzs = [], [], {k: [] for k in sec}, []
    for p in rst:
        zsr, qq = read_rst(p)
        assert qq.size >= NPUV
        hours.append(p.name.split(".")[1] + "T" + p.name.split(".")[2][:2] + "Z")
        qout.append(float((qq[bnd_links] * uv_w[bnd_links] * bnd_sign).sum()))
        for k, (ln, sg) in sec.items():
            secq[k].append(float((qq[ln] * uv_w[ln] * sg).sum()))
        rstzs.append(zsr)
    qout = np.array(qout)
    out_window = float(np.trapz(qout, dx=3600.0))
    V["outflowHourly"] = dict(zip(hours, [round(v, 3) for v in qout]))
    V["outflowPeak"] = {"m3s": float(qout.max()), "time": hours[int(np.argmax(qout))]}
    V["outflowVolume18Zto07Z_m3"] = out_window
    # infiltration of the whole run vs rain; residual
    resid = inflow_total + rain - inf - s_end - out_window
    V["balanceWholeRun"] = {
        "inflowM3": inflow_total, "rainM3": rain, "infiltrationM3": inf,
        "storageEndM3": s_end, "storageStartWindow17ZM3": s_start_window,
        "outflowMeasured18Zto07ZM3": out_window,
        "residualM3": resid,
        "residualPctOfInputs": 100.0 * resid / (inflow_total + rain),
        "rainMeanMm": 1000.0 * rain / area.sum(),
        "infMeanMm": 1000.0 * inf / area.sum(),
        "negativeVolumeEndM3": float(vol[-1][vol[-1] < 0].sum()),
        "negativeVolumeMinCellM3": float(np.nanmin(vol)),
    }
    # hourly continuity check 18Z..07Z using the map storage at the same hours:
    # dS/dt = Qin + R - I - Qout  ->  implied infiltration I = Qin + R - Qout - dS/dt
    idx_h = [tlabels.index(h[:4] + "-" + h[4:6] + "-" + h[6:8] + "T" + h[9:11] + ":00Z") for h in hours]
    S_h = np.array([np.nansum(vol[i]) for i in idx_h])
    R_frames = (prate / 1000.0 / 3600.0 * area[None, :]).sum(axis=1)  # m3/s at frames
    rows = []
    for j in range(len(hours) - 1):
        i0, i1 = idx_h[j], idx_h[j + 1]
        rain_v = float(np.trapz(R_frames[i0:i1 + 1], dx=900.0))
        # inflow volume in this hour (linear interpolation of dis)
        ts0 = (np.datetime64(times[i0]) - np.datetime64("2026-10-30T16:00")) / np.timedelta64(1, "s")
        tg = np.linspace(ts0, ts0 + 3600.0, 61)
        qin_v = float(np.trapz(np.interp(tg, t, qin), tg))
        qout_v = 0.5 * (qout[j] + qout[j + 1]) * 3600.0
        dS = float(S_h[j + 1] - S_h[j])
        rows.append({"hour": hours[j], "inflowM3": round(qin_v), "rainM3": round(rain_v),
                     "outflowM3": round(qout_v), "dStorageM3": round(dS),
                     "impliedInfiltrationM3": round(qin_v + rain_v - qout_v - dS)})
    V["hourlyWindow"] = rows
    V["rainBefore17ZM3"] = rain - float(np.trapz(R_frames, dx=900.0))
    V["rainWindow17Zto07ZM3"] = float(np.trapz(R_frames, dx=900.0))
    V["rainDomainMeanMmPerFrame"] = [round(float(r / area.sum() * 3600 * 1000), 3) for r in R_frames]
    # ---- sections ----
    V["sectionsHourlyM3s"] = {k: dict(zip(hours, [round(x, 3) for x in v])) for k, v in secq.items()}
    V["sectionPeaks"] = {k: {"m3s": float(max(v)), "time": hours[int(np.argmax(v))]} for k, v in secq.items()}
    # ---- points: arrival, max ----
    pts = {}
    for name, f in POINTS.items():
        z = zs[:, f]
        dep = z - zb[f]
        hv = vol[:, f] / area[f]
        first03 = next((tlabels[i] for i in range(len(z)) if dep[i] > 0.3), None)
        rise03 = next((tlabels[i] for i in range(len(z)) if z[i] - z[0] > 0.3), None)
        i3 = tlabels.index("2026-11-02T03:00Z")
        pts[name] = {
            "face": int(f), "cellM": float(size[f]), "lonlat": [round(v, 5) for v in TO_LL.transform(xc[f], yc[f])],
            "zbM": round(float(zb[f]), 3), "zs17Z": round(float(z[0]), 3),
            "depth17Z": round(float(dep[0]), 3),
            "firstZsAboveZb0p3": first03, "firstRise0p3Above17Z": rise03,
            "maxZs": round(float(np.nanmax(z)), 3), "maxZsTime": tlabels[int(np.nanargmax(z))],
            "maxZsMinusZb": round(float(np.nanmax(dep)), 3),
            "zsmaxWholeRun": round(float(zsmax[f]), 3),
            "zs0300Z": round(float(z[i3]), 3), "zs0315Z": round(float(z[i3 + 1]), 3),
            "zs0304Z_interp": round(float(z[i3] + (z[i3 + 1] - z[i3]) * 4 / 15), 3),
            "depth0304Z_zsMinusZb": round(float(z[i3] + (z[i3 + 1] - z[i3]) * 4 / 15 - zb[f]), 3),
            "volOverArea0300Z": round(float(hv[i3]), 3),
            "series_zs_hourly": {tlabels[i]: round(float(z[i]), 3) for i in range(0, len(z), 4)},
        }
    V["points"] = pts
    # ---- road crossings and dips (zs vs roadZ in wet frames) ----
    wet = (vol / area[None, :]) >= DRY

    def road_eval(lon, lat, label):
        ids = near_stations(lon, lat)
        best = None
        rows = []
        for s in ids:
            f = sface[s]
            if f < 0 or np.isnan(sz[s]):
                rows.append({"station": stations["id"][s], "state": "no-cell" if f < 0 else "no-road-height"})
                continue
            z = np.where(wet[:, f], zs[:, f], np.nan)
            if np.all(np.isnan(z)):
                mo, mw, fo = None, None, None
            else:
                mw = float(np.nanmax(z)); mo = mw - sz[s]
                ov = np.where(z > sz[s])[0]
                fo = tlabels[ov[0]] if ov.size else None
            rows.append({"station": stations["id"][s], "roadZ": float(sz[s]), "cellM": float(size[f]),
                         "maxWse": mw, "maxOver": mo, "firstOver": fo, "flags": int(sflag[s])})
        good = [r for r in rows if "roadZ" in r]
        wetr = [r for r in good if r["maxWse"] is not None]
        out = {"label": label, "lon": lon, "lat": lat, "stations": len(ids),
               "roadZmin": min(r["roadZ"] for r in good) if good else None,
               "roadZmax": max(r["roadZ"] for r in good) if good else None,
               "cellM": sorted(set(r["cellM"] for r in good)),
               "wetStations": len(wetr)}
        if wetr:
            b = max(wetr, key=lambda r: r["maxOver"])
            fos = sorted(r["firstOver"] for r in wetr if r["firstOver"])
            out.update({"maxWse": round(b["maxWse"], 3), "maxOver": round(b["maxOver"], 3),
                        "maxOverStationRoadZ": b["roadZ"],
                        "firstOver": fos[0] if fos else None,
                        "stationsOver": len(fos)})
        else:
            out.update({"maxWse": None, "maxOver": None, "firstOver": None, "stationsOver": 0})
        return out

    V["crossings"] = [road_eval(c["lon"], c["lat"], c["road"]) for c in crossings]
    V["dips"] = [road_eval(c["lon"], c["lat"], f"{c['road']} {c['depthM']} m") for c in repdips]
    # deck-lidar stations
    deck = np.where(sflag == 1)[0]
    V["deckLidar"] = []
    for s in deck:
        f = sface[s]
        z = np.where(wet[:, f], zs[:, f], np.nan)
        V["deckLidar"].append({"station": stations["id"][s], "road": str(sroad[s]), "roadZ": float(sz[s]),
                               "cellM": float(size[f]), "zb": float(zb[f]),
                               "maxWse": None if np.all(np.isnan(z)) else float(np.nanmax(z)),
                               "zsmax": float(zsmax[f])})
    # ---- ridge stations: highest roadZ per road (roads with >= 50 stations) ----
    ridge = []
    for r in sorted(set(sroad.tolist())):
        ii = np.where((sroad == r) & ~np.isnan(sz) & (sface >= 0))[0]
        if ii.size < 50:
            continue
        top = ii[np.argsort(sz[ii])[-5:]]
        st = []
        for s in top:
            f = sface[s]
            z = np.where(wet[:, f], zs[:, f], np.nan)
            mo = None if np.all(np.isnan(z)) else float(np.nanmax(z) - sz[s])
            st.append(mo)
        ridge.append({"road": r, "n": int(ii.size), "top5RoadZ": [float(sz[s]) for s in top],
                      "top5MaxOver": st, "anyOver": any(v is not None and v > 0 for v in st)})
    V["ridge"] = ridge
    # ---- all-station over/below stats by cell size (zs vs roadZ) ----
    valid = (sface >= 0) & ~np.isnan(sz)
    sf = np.where(valid, sface, 0)
    zst = np.where(wet[:, sf], zs[:, sf], np.nan)
    with np.errstate(all="ignore"):
        mws = np.nanmax(zst, axis=0)
    mo = mws - sz
    over = valid & (mo > 0)
    stat = {}
    for c in sorted(set(size.tolist())):
        sel = valid & (size[sf] == c)
        stat[str(c)] = {"stations": int(sel.sum()), "over": int((over & sel).sum()),
                        "overGt0p1": int((sel & (mo > 0.1)).sum()), "overGt0p3": int((sel & (mo > 0.3)).sum()),
                        "medianOverWhenOver": float(np.median(mo[over & sel])) if (over & sel).any() else None}
    V["stationsOverByCell"] = stat
    # first-over time distribution of 6.25/12.5 m stations vs 100 m
    fo_idx = np.full(sz.size, -1)
    for i in range(zst.shape[0]):
        hit = valid & (fo_idx < 0) & (zst[i] > sz)
        fo_idx[hit] = i
    V["firstOverMedianFrameByCell"] = {str(c): (float(np.median(fo_idx[(fo_idx >= 0) & (size[sf] == c)]))
                                       if ((fo_idx >= 0) & (size[sf] == c)).any() else None)
                                       for c in sorted(set(size.tolist()))}
    # ---- instability ----
    dz = np.abs(np.diff(zs, axis=0))
    wetany = wet.any(axis=0)
    V["stability"] = {
        "nanZs": int(np.isnan(zs).sum()), "nanVol": int(np.isnan(vol).sum()),
        "maxAbsDzs15minWetCell": float(np.nanmax(dz[:, wetany])),
        "cellsDzsGt1mPer15min": int((dz[:, wetany] > 1.0).any(axis=0).sum()),
        "cellsDzsGt0p5mPer15min": int((dz[:, wetany] > 0.5).any(axis=0).sum()),
        "zsBelowZbMinM": float(np.nanmin(zs - zb[None, :])),
        "maxDepthZsmaxMinusZb": float(np.nanmax(zsmax - zb)),
        "maxDepthFace": int(np.nanargmax(zsmax - zb)),
    }
    f = V["stability"]["maxDepthFace"]
    V["stability"]["maxDepthFaceInfo"] = {"cellM": float(size[f]), "lonlat": list(TO_LL.transform(xc[f], yc[f])),
                                          "zb": float(zb[f]), "zsmax": float(zsmax[f])}
    # spike: zs rising > 0.5 m and falling > 0.5 m in consecutive frames
    d1 = np.diff(zs, axis=0)
    spike = (d1[:-1] > 0.5) & (d1[1:] < -0.5)
    V["stability"]["spikeCells"] = int(spike.any(axis=0).sum())
    # velocity proxy from last restart q: |q| / h at uv point, h = max(zs) - max(zb) of the two cells
    vmax = 0.0; qmax = 0.0
    for p in rst:
        zsr, qq = read_rst(p)
        qa = np.abs(qq[:NPUV]).astype(np.float64)
        h = np.maximum(zsr[uv_nm], zsr[uv_nmu]) - np.maximum(zb[uv_nm], zb[uv_nmu])
        ok = h > 0.1
        vv = np.where(ok, qa / np.where(ok, h, 1.0), 0.0)
        if vv.max() > vmax:
            vmax = float(vv.max()); vmax_at = (p.name, int(np.argmax(vv)))
        qmax = max(qmax, float(qa.max()))
    ip = vmax_at[1]
    V["stability"]["velocityProxyMaxMs"] = vmax
    V["stability"]["velocityProxyAt"] = {"file": vmax_at[0], "lonlat": list(TO_LL.transform(xc[uv_nm[ip]], yc[uv_nm[ip]])),
                                         "cellM": float(uv_w[ip])}
    V["stability"]["maxAbsQm2s"] = qmax
    res["variants"][var] = V

# ---- upstream-of-inlet check and inflow footprint (obs - nwm zsmax, identical rain) ----
zo, vo, zmo = cache["observed"]; zn, vn, zmn = cache["nwm"]
diff = zmo - zmn
ix, iy = xc[inlet_face], yc[inlet_face]
dist = np.hypot(xc - ix, yc - iy)
up = yc < iy - 50.0  # south of the inlet (Brawley flows north)
res["inflowFootprint"] = {
    "cellsDiffGt0p05": int((diff > 0.05).sum()),
    "cellsDiffGt0p05_southOfInlet": int(((diff > 0.05) & up).sum()),
    "maxDiffSouthOfInlet": float(np.nanmax(np.where(up, diff, -9))),
    "southOfInletMaxDistM": float(dist[(diff > 0.05) & up].max()) if ((diff > 0.05) & up).any() else 0.0,
    "southOfInletMaxDyM": float((iy - yc[(diff > 0.05) & up]).max()) if ((diff > 0.05) & up).any() else 0.0,
    "cellsDiffLtMinus0p05": int((diff < -0.05).sum()),
    "minDiff": float(np.nanmin(diff)),
    "domainCellsSouthOfInlet": int(up.sum()),
    "inletFace": {"zb": float(zb[inlet_face]), "cellM": float(size[inlet_face])},
}
# NWM analysis reference timing
ref = {}
for r in ["15876941", "15876811", "15876815", "15876711", "15876707"]:
    pts = aa.get(r)
    if pts:
        v = [p["flowM3s"] for p in pts]
        i = int(np.argmax(v))
        ref[r] = {"peak": v[i], "time": pts[i]["time"],
                  "hourly_17Z_to_07Z": {p["time"][5:13]: round(p["flowM3s"], 2) for p in pts if p["time"] >= "2026-11-01T17"}}
res["nwmAnalysisRef"] = ref
OUT.write_text(json.dumps(res, indent=1, default=float))
print("ok")
