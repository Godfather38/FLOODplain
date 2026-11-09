"""Build the Ia/S = 0.05 curve-number infiltration field for a SFINCS inftype=cnb case, and predict its runoff timing
offline BEFORE any run (SENSITIVITY only; nothing here is fitted to a gauge).

Usage (cwd = repo root):
  python tools/sfincs/brawley/variants/build_ia005.py CASE_DIR OUT.nc --prediction PRED.json

Published source (chosen before the run):
  Hawkins, Jiang, Woodward, Hjelmfelt & Van Mullem (2002), "Runoff curve number method: examination of the initial
  abstraction ratio", Proc. 2nd Federal Interagency Hydrologic Modeling Conf.; Woodward, Hawkins, Jiang, Hjelmfelt,
  Van Mullem & Quan (2003), same title, World Water & Environmental Resources Congress 2003 (ASCE),
  doi:10.1061/40685(2003)308; restated in Lim, Engel et al. (2006) JAWRA 42(3):629-643 and Hawkins, Ward, Woodward &
  Van Mullem (2009) "Curve Number Hydrology: State of the Practice" (ASCE). Finding: Ia/S = 0.05 fits observed
  rainfall-runoff better than 0.20, and the CN/S tables built for 0.20 must be re-expressed for 0.05:
      S_0.05 = 1.33 * S_0.20 ** 1.15      (S in inches; fitted, Woodward et al. 2003)
  Hawkins et al. (2009) also give the linear approximation S_0.05 ~= 1.42 S_0.20 (natural data, least squares).
  The power form is used here (it is the equation of the cited 2003 paper); the linear form is reported for scale.

What changes (SFINCS f3647fc source/src/sfincs_infiltration.f90):
  compute_infiltration_cnb uses Ia = sfacinf * scs_S1 (lines 927-929); sfacinf is the sfincs.inp key 'sfacinf'
  (sfincs_input.f90:150, default 0.2). S comes from infiltration.nc: smax (maximum retention, m) and seff (initial
  effective retention, m; scs_S1 = scs_Se at each event start). The variant therefore needs:
    infiltration.nc: smax and seff converted with the equation above (inches in, metres out); ks unchanged, so the
                     recovery rate kr = sqrt(ks/25.4)/75 is unchanged;
    sfincs.inp:      sfacinf = 0.05.
  A face with S = 0 stays 0 (the power law maps 0 to 0). No NaN is filled; a NaN aborts.

Offline prediction: per face of the ALERT 6443 Black Wash 15876815 contributing area (same NHDPlus V2 delineation as
score_combo.py), the cnb event loop of compute_infiltration_cnb is replayed with dt = 60 s on the case's own
precip_2d.nc (sampled with the solver rule used in timing_diagnose.py; dtwnd 1800 s linear blend between block-held
hourly frames). It gives rainfall excess (rain minus infiltration) only, i.e. water put on the land surface, not
routed flow; it ignores infiltration of ponded run-on (cnb has none: qinfmap is computed from rain only).
"""
import argparse, json, math
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import xarray as xr
from scipy.interpolate import RegularGridInterpolator
from shapely import contains_xy
from shapely.ops import unary_union

IN = 0.0254


def s005(s020_m):
    s_in = s020_m / IN
    return (1.33 * np.power(s_in, 1.15)) * IN


def face_centres(mesh):
    with xr.open_dataset(mesh) as m:
        fn = m['mesh2d_face_nodes'].values; nx = m['mesh2d_node_x'].values; ny = m['mesh2d_node_y'].values
        level = m['level'].values.astype(int); dx = float(m.attrs['dx'])
    ok = np.isfinite(fn); idx = np.where(ok, fn, 0).astype(np.int64)
    xs = np.where(ok, nx[idx], np.nan); ys = np.where(ok, ny[idx], np.nan)
    cx = 0.5 * (np.nanmin(xs, 1) + np.nanmax(xs, 1)); cy = 0.5 * (np.nanmin(ys, 1) + np.nanmax(ys, 1))
    return cx, cy, (dx / 2.0 ** (level - 1)) ** 2


def replay(rate_fn, nsteps, dt, S0, Smax, ks, sfac):
    """compute_infiltration_cnb, vectorised over faces. rate_fn(k) -> rain rate m/s at step k. Returns excess m per step."""
    n = S0.size
    Se = S0.astype(np.float64).copy(); P1 = np.zeros(n); F1 = np.zeros(n); S1 = np.zeros(n); T1 = np.zeros(n)
    rain = np.zeros(n, bool); kr = np.sqrt(ks / 25.4) / 75.0
    exc = np.zeros(nsteps)
    for k in range(nsteps):
        p = rate_fn(k); wet = p > 0.0
        new = wet & ~rain
        P1[new] = 0.0; F1[new] = 0.0; S1[new] = Se[new]; rain[new] = True
        P1[wet] += p[wet] * dt
        q = np.zeros(n)
        run = wet & (P1 > sfac * S1)
        Q = np.zeros(n)
        Q[run] = (P1[run] - sfac * S1[run]) ** 2 / (P1[run] + (1.0 - sfac) * S1[run])
        I = P1 - Q
        q[run] = (I[run] - F1[run]) / dt; F1[run] = I[run]
        nr = wet & ~run
        F1[nr] = P1[nr]; q[nr] = p[nr]
        Se[wet] = np.maximum(Se[wet] - q[wet] * dt, 0.0)
        q = np.maximum(q, 0.0)
        exc_face = np.where(wet, (p - q) * dt, 0.0)
        exc[k] = exc_face @ W
        dry = ~wet
        stop = dry & rain
        rain[stop] = False; T1[stop] = 0.0
        T1[dry] += dt / 3600.0
        rec = dry & (T1 > 0.06 / kr)
        Se[rec] = np.minimum(Se[rec] + kr[rec] * Smax[rec] * dt / 3600.0, Smax[rec])
    return exc


def main():
    global W
    ap = argparse.ArgumentParser()
    ap.add_argument('case', type=Path); ap.add_argument('out', type=Path); ap.add_argument('--prediction', type=Path, required=True)
    ap.add_argument('--wt', type=Path, default=Path('.'))
    a = ap.parse_args()

    with xr.open_dataset(a.case / 'infiltration.nc') as ds:
        smax = ds['smax'].values.astype(np.float64); seff = ds['seff'].values.astype(np.float64); ks = ds['ks'].values.astype(np.float64)
        attrs = dict(ds.attrs); vattrs = {v: dict(ds[v].attrs) for v in ds.data_vars}
    for v, x in (('smax', smax), ('seff', seff), ('ks', ks)):
        assert not np.isnan(x).any(), f'{v} has NaN; refusing'
    assert (smax >= 0).all() and (seff >= 0).all()
    smax5, seff5 = s005(smax), s005(seff)
    assert not np.isnan(smax5).any() and not np.isnan(seff5).any()
    out = xr.Dataset({'smax': ('mesh2d_nFaces', smax5.astype(np.float32), vattrs['smax']),
                      'seff': ('mesh2d_nFaces', seff5.astype(np.float32), vattrs['seff']),
                      'ks': ('mesh2d_nFaces', ks.astype(np.float32), vattrs['ks'])}, attrs=attrs)
    out.attrs['ia005_conversion'] = ('smax, seff = 1.33 * (S_0.20 in inches) ** 1.15 inches -> m (Woodward et al. 2003, '
                                     'Ia/S 0.05); ks unchanged; base ' + str(a.case).replace('\\', '/') + '/infiltration.nc')
    a.out.parent.mkdir(parents=True, exist_ok=True)
    out.to_netcdf(a.out)

    # ---------- offline prediction over the Black Wash 15876815 contributing area ----------
    cx, cy, area = face_centres(a.case / 'sfincs.nc')
    COMP = a.wt / 'tools/sfincs/data/brawley-avra-west-v2/components'
    net = gpd.read_file(COMP / 'brawley-avra-west-network.geojson')
    cat = gpd.read_file(COMP / 'brawley-avra-west-catchments.geojson').to_crs(32612)
    by_to = {}
    for r in net.itertuples(): by_to.setdefault(int(r.tonode), []).append(int(r.comid))
    fromnode = {int(r.comid): int(r.fromnode) for r in net.itertuples()}
    up, todo = set(), [15876815]
    while todo:
        k = todo.pop()
        if k in up: continue
        up.add(k); todo += by_to.get(fromnode[k], [])
    sel = contains_xy(unary_union(cat[cat.featureid.isin(list(up))].geometry.values), cx, cy)
    A = area[sel]; W = A / A.sum()

    pr = xr.open_dataset(a.case / 'precip_2d.nc'); PR = pr.Precipitation.values.astype(np.float64)
    px, py = pr.x.values, pr.y.values; pt = pd.to_datetime(pr.time.values); pr.close()
    assert not np.isnan(PR).any(), 'NaN in precip_2d.nc'
    xs = px + 0.5 * (px[1] - px[0]); ys = py + 0.5 * (py[1] - py[0])
    pts = np.c_[cy[sel], cx[sel]]
    frames = np.stack([RegularGridInterpolator((ys[::-1], xs), PR[k][::-1], bounds_error=False, fill_value=np.nan)(pts)
                       for k in range(len(pt))])  # mm/h
    assert not np.isnan(frames).any(), 'face outside precip grid'
    t0 = pd.Timestamp('2026-10-30T16:00'); t1 = pd.Timestamp('2026-11-02T18:00'); dt = 60.0; dtw = 1800.0
    nsteps = int((t1 - t0).total_seconds() / dt)
    fsec = np.array([(t - t0).total_seconds() for t in pt])

    def held(tsec):
        i = np.searchsorted(fsec, tsec, side='right') - 1
        return frames[max(i, 0)] if i >= 0 else np.zeros(frames.shape[1])

    def rate(k):
        t = (k + 0.5) * dt; tu = math.floor(t / dtw) * dtw; f = (t - tu) / dtw
        return (held(tu) * (1 - f) + held(tu + dtw) * f) / 3.6e6  # mm/h -> m/s

    cases = {'cnb_Ia0.20_S0.20 (candidate)': (seff[sel], smax[sel], 0.2),
             'cnb_Ia0.05_S0.05 (this variant)': (seff5[sel], smax5[sel], 0.05),
             'cnb_Ia0.05_S0.20 (sfacinf only, not run; reference)': (seff[sel], smax[sel], 0.05)}
    rain_step = np.array([rate(k) @ W * dt for k in range(nsteps)])
    times = t0 + pd.to_timedelta(np.arange(nsteps) * dt, unit='s')
    hrs = pd.date_range('2026-11-01T12:00', '2026-11-02T00:00', freq='h')
    res = {'note': 'offline replay of compute_infiltration_cnb; rainfall excess over the Black Wash 15876815 area (not routed flow). Written before the run.',
           'areaKm2': round(float(A.sum()) / 1e6, 2), 'faces': int(sel.sum()),
           'Smean_mm': {'S0.20': round(float(smax[sel] @ W) * 1000, 2), 'S0.05': round(float(smax5[sel] @ W) * 1000, 2),
                        'S0.05_linear_1.42_for_scale': round(float(1.42 * smax[sel] @ W) * 1000, 2)},
           'IaMean_mm': {'0.2*S0.20': round(0.2 * float(smax[sel] @ W) * 1000, 2), '0.05*S0.05': round(0.05 * float(smax5[sel] @ W) * 1000, 2)},
           'rainMmWholeRun': round(float(rain_step.sum()) * 1000, 2), 'cases': {}}
    for name, (S0, Sm, sf) in cases.items():
        e = replay(rate, nsteps, dt, S0, Sm, ks[sel], sf)
        s = pd.Series(e * 1000, index=times)
        hourly = s.resample('h').sum()
        cum = s.cumsum()
        burst = s[(s.index >= '2026-11-01T12:00') & (s.index < '2026-11-02T00:00')]
        r = {'excessMmWholeRun': round(float(s.sum()), 2),
             'excessMm_Nov1_12Z_to_Nov2_00Z': round(float(burst.sum()), 2),
             'excessMmHourly_Nov1': {h.strftime('%dT%HZ'): round(float(hourly.get(h, 0.0)), 3) for h in hrs},
             'firstExcessRateOver1mmPerH': next((t.strftime('%Y-%m-%dT%H:%MZ') for t, v in (s * 60).items() if v > 1.0 and t >= pd.Timestamp('2026-11-01T00:00')), None),
             'burstExcessCentroid': (burst.index[0] + pd.Timedelta(seconds=float((np.arange(burst.size) * dt * burst.values).sum() / burst.sum()))).strftime('%Y-%m-%dT%H:%MZ') if burst.sum() > 0 else None,
             'cumExcessMmAt': {h: round(float(cum[cum.index <= pd.Timestamp(h)].iloc[-1]), 2) for h in
                               ('2026-11-01T14:00', '2026-11-01T16:00', '2026-11-01T17:00', '2026-11-01T18:00', '2026-11-02T00:00')}}
        res['cases'][name] = r
    a.prediction.parent.mkdir(parents=True, exist_ok=True)
    a.prediction.write_bytes((json.dumps(res, indent=1) + '\n').encode('utf-8'))
    print(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
