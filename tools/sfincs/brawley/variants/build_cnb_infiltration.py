"""Build a SFINCS inftype=cnb (Curve Number WITH recovery) infiltration.nc on a prepared quadtree case.

Usage (cwd = repo root):
  python tools/sfincs/brawley/variants/build_cnb_infiltration.py CASE_DIR POLARIS_DIR OUT.nc [--layer 0_5]

What SFINCS f3647fc reads for cnb (source/src/sfincs_infiltration.f90, initialize_infiltration_cnb and
compute_infiltration_cnb; netcdf inffile variables are read by name per mesh2d face):
  smax  maximum retention S, METRES (no unit conversion in cnb, unlike cna 'scs' which is inches)
  seff  initial effective retention S_e, METRES (scs_S1 = scs_Se at the start of each rain event)
  ks    saturated hydraulic conductivity, mm/hr; recovery kr = sqrt(ks/25.4)/75 per hour (SWMM eq. 4-36),
        recovery starts after a dry spell of 0.06/kr hours (SWMM eq. 4-37), then S_e += kr*smax per hour.

Choices (all physical, none tuned to a gauge):
  smax = the case's own cna 'scs' field (GCN10 cn_f_ii_2281, fair, ARC II, undrained; S in inches) * 0.0254.
         The CN source and its face averaging are therefore exactly those of the base case.
  seff = smax (dry start at tstart, Oct 30 16Z): with seff = smax the first rain event at every face sees the
         same S as cna, so the variant isolates the recovery/event-reset behaviour.
  ks   = POLARIS v1.0 ksat 'mean' (Chaney et al. 2019, Water Resour. Res. 55, doi:10.1029/2018WR022797;
         http://hydrology.cee.duke.edu/POLARIS/PROPERTIES/v1.0/), 1 arc-second, units log10(cm/hr),
         converted 10**v * 10 -> mm/hr, area-averaged (linear) over each face footprint as HydroMT-SFINCS 1.2.2
         scs_recovery_determination averages Ksat ('average' reprojection), and capped at 360 mm/hr
         (HydroMT's 100 um/s cap). No NaN is filled: a face with no POLARIS data aborts the build.
"""
import argparse, json, sys
from pathlib import Path

import numpy as np
import rasterio
import xarray as xr
from rasterio.merge import merge
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin

RES = 6.25  # finest quadtree level (100 m / 2**4)


def face_bounds(mesh):
    with xr.open_dataset(mesh) as m:
        fn = m['mesh2d_face_nodes'].values
        nx = m['mesh2d_node_x'].values; ny = m['mesh2d_node_y'].values
        level = m['level'].values
    valid = np.isfinite(fn)
    idx = np.where(valid, fn, 0).astype(np.int64)
    xs = np.where(valid, nx[idx], np.nan); ys = np.where(valid, ny[idx], np.nan)
    return np.nanmin(xs, 1), np.nanmax(xs, 1), np.nanmin(ys, 1), np.nanmax(ys, 1), level


def main():
    p = argparse.ArgumentParser()
    p.add_argument('case', type=Path); p.add_argument('polaris', type=Path); p.add_argument('out', type=Path)
    p.add_argument('--layer', default='0_5')
    a = p.parse_args()

    x0, x1, y0, y1, level = face_bounds(a.case / 'sfincs.nc')
    w = x1 - x0; h = y1 - y0
    assert np.all(np.isfinite(w)) and np.allclose(w, h, atol=1e-3), 'faces are not squares'
    print('faces', w.size, 'sizes (m):', {float(s): int((np.round(w, 3) == s).sum()) for s in np.unique(np.round(w, 3))})

    tiles = sorted(a.polaris.glob(f'ksat_mean_{a.layer}_*.tif'))
    assert tiles, f'no POLARIS tiles for layer {a.layer} in {a.polaris}'
    srcs = [rasterio.open(t) for t in tiles]
    mos, mtr = merge(srcs, nodata=-9999.0)
    crs_src = srcs[0].crs
    for s in srcs:
        s.close()
    mos = mos[0].astype(np.float64)
    mos[mos == -9999.0] = np.nan

    gx0 = np.floor(x0.min() / 100) * 100; gx1 = np.ceil(x1.max() / 100) * 100
    gy0 = np.floor(y0.min() / 100) * 100; gy1 = np.ceil(y1.max() / 100) * 100
    ncol = int(round((gx1 - gx0) / RES)); nrow = int(round((gy1 - gy0) / RES))
    dst = np.full((nrow, ncol), np.nan)
    # Convert to linear mm/hr before resampling so the face average is the arithmetic mean of Ks.
    lin = np.where(np.isfinite(mos), 10.0 ** mos * 10.0, np.nan)
    reproject(lin, dst, src_transform=mtr, src_crs=crs_src, src_nodata=np.nan,
              dst_transform=from_origin(gx0, gy1, RES, RES), dst_crs='EPSG:32612', dst_nodata=np.nan,
              resampling=Resampling.nearest)
    # integral images of value and of valid count
    ok = np.isfinite(dst)
    v = np.where(ok, dst, 0.0)
    S = np.zeros((nrow + 1, ncol + 1)); S[1:, 1:] = v.cumsum(0).cumsum(1)
    C = np.zeros((nrow + 1, ncol + 1)); C[1:, 1:] = ok.cumsum(0).cumsum(1)
    c0 = np.round((x0 - gx0) / RES).astype(int); c1 = np.round((x1 - gx0) / RES).astype(int)
    r0 = np.round((gy1 - y1) / RES).astype(int); r1 = np.round((gy1 - y0) / RES).astype(int)
    tot = S[r1, c1] - S[r0, c1] - S[r1, c0] + S[r0, c0]
    cnt = C[r1, c1] - C[r0, c1] - C[r1, c0] + C[r0, c0]
    npix = (r1 - r0) * (c1 - c0)
    nodata_faces = int((cnt == 0).sum())
    partial = int(((cnt > 0) & (cnt < npix)).sum())
    print('faces with no POLARIS data:', nodata_faces, ' faces partly without data (mean of valid part):', partial)
    if nodata_faces:
        raise SystemExit('faces without POLARIS Ks; refusing to fill')
    ks = tot / cnt
    ncap = int((ks > 360.0).sum())
    ks = np.minimum(ks, 360.0)

    with xr.open_dataset(a.case / 'infiltration.nc') as d:
        scs = d['scs'].values.astype(np.float64)
    assert scs.size == ks.size and np.all(np.isfinite(scs)) and np.all(scs >= 0), 'bad scs field'
    smax = scs * 0.0254
    seff = smax.copy()
    for name, arr in (('smax', smax), ('seff', seff), ('ks', ks)):
        assert np.all(np.isfinite(arr)), f'NaN/inf in {name}'

    kr = np.sqrt(ks / 25.4) / 75.0
    area = w * h
    wm = lambda q: float((q * area).sum() / area.sum())
    stats = {
        'faces': int(ks.size), 'polarisLayer_cm': a.layer.replace('_', '-'), 'polarisTiles': [t.name for t in tiles],
        'facesCappedAt360mmhr': ncap, 'facesPartlyWithoutPolaris': partial,
        'ks_mmhr_areaMean': wm(ks), 'ks_mmhr_p05_p50_p95': [float(q) for q in np.percentile(ks, [5, 50, 95])],
        'kr_perHour_areaMean': wm(kr), 'recoveryOnsetHours_0.06/kr_areaMean': wm(0.06 / kr),
        'recoveryOnsetHours_p05_p50_p95': [float(q) for q in np.percentile(0.06 / kr, [5, 50, 95])],
        'hoursSmaxFullRecovery_1/kr_p50': float(np.percentile(1 / kr, 50)),
        'smax_mm_areaMean': wm(smax * 1000), 'seff_equals_smax': True,
    }
    print(json.dumps(stats, indent=1))

    f = 'mesh2d_nFaces'
    ds = xr.Dataset({
        'smax': (f, smax.astype(np.float32), {'units': 'm', 'long_name': 'maximum soil retention S (cnb)',
                 'source': 'GCN10 cn_f_ii_2281 (fair, ARC II, undrained) via the base case scs field (inches) * 0.0254'}),
        'seff': (f, seff.astype(np.float32), {'units': 'm', 'long_name': 'initial effective soil retention (cnb)',
                 'source': 'seff = smax: dry start at tstart 2026-10-30 16Z'}),
        'ks': (f, ks.astype(np.float32), {'units': 'mm hr-1', 'long_name': 'saturated hydraulic conductivity (cnb recovery)',
               'source': f'POLARIS v1.0 ksat mean {a.layer} cm (Chaney et al. 2019, doi:10.1029/2018WR022797), '
                         'face-area arithmetic mean, capped 360 mm/hr (HydroMT-SFINCS 1.2.2 cap)'}),
    })
    a.out.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(a.out)
    (a.out.parent / (a.out.stem + '-stats.json')).write_text(json.dumps(stats, indent=1) + '\n', newline='\n')
    print('wrote', a.out)


if __name__ == '__main__':
    main()
