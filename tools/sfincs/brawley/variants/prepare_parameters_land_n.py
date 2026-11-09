"""SENSITIVITY copy of tools/sfincs/prepare_route_case_parameters.py (subgrid table only): same Deltares quadtree
subgrid builder, same terrain sources and priority, same WorldCover 2021 raster and pinned mapping, except that
Manning n of the land classes named by --class-n (default: 20 shrubland, 30 grassland, 60 bare/sparse) is set to one
published value OUTSIDE a protected channel zone. Inside the channel zone every pixel keeps its pinned-mapping n.
No infiltration file is written (the case keeps its own infiltration.nc). No solver run. Not calibrated.

Value (default 0.011): USACE (1998) via HEC-HMS Technical Reference Manual CPD-74B (March 2000), Table 6-1
"Overland-flow roughness coefficients for sheet-flow modeling": smooth surfaces (concrete, asphalt, gravel, or bare
soil) N = 0.011. The same table gives Range 0.13, Short grass prairie 0.15, Fallow (no residue) 0.05. 0.011 is the
smallest overland value in that table; no vegetated or bare natural surface is smoother than bare soil, so it is used
as the physically defensible LOWER BOUND for land n (fastest possible hillslope flow), not as a best estimate. The
table's own best estimates for shrub/range and grass (0.13, 0.15) are slower than the pinned mapping (0.05, 0.034).

Channel zone: the v2n lidar-centred sand-bed channel mask (channel-mask.geojson from
tools/sfincs/brawley/sensitivity/prepare_parameters_channel_n.py, NHD order >= 3), buffered by --protect-buffer m
(default 10 m = one WorldCover pixel, so linear interpolation of the 10 m n raster onto subgrid pixels inside the mask
reads only unchanged pixels), rasterized all-touched.
"""
import argparse, importlib.util, json, hashlib
from pathlib import Path
import numpy as np, pandas as pd, xarray as xr, xugrid as xu, rioxarray, geopandas as gpd
from rasterio import features
from shapely.geometry import mapping
from cht_bathymetry.database import BathymetryDatabase

SOURCE = ('USACE 1998 via HEC-HMS Technical Reference Manual CPD-74B (Mar 2000) Table 6-1 overland-flow roughness '
          'for sheet flow: smooth surfaces (concrete, asphalt, gravel, or bare soil) N=0.011; same table Range 0.13, '
          'Short grass prairie 0.15, Fallow 0.05. 0.011 used as lower bound (bare soil) for shrub/grass/bare land.')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--mesh', type=Path, required=True)
    p.add_argument('--context', type=Path, required=True)
    p.add_argument('--extra-fine', type=Path, action='append', default=[])
    p.add_argument('--channel-mask', type=Path, required=True)
    p.add_argument('--protect-buffer', type=float, default=10.0)
    p.add_argument('--class-n', action='append', default=None, metavar='CODE=N',
                   help='WorldCover code=n outside the channel zone (default 20=0.011 30=0.011 60=0.011)')
    p.add_argument('--zone-only', action='store_true', help='write the n report and stop (no subgrid build)')
    a = p.parse_args(); a.output.mkdir(parents=True, exist_ok=True)
    cls = dict((int(k), float(v)) for k, v in (s.split('=') for s in (a.class_n or ['20=0.011', '30=0.011', '60=0.011'])))
    for c, n in cls.items():
        if not 0.010 <= n <= 0.8:
            raise ValueError(f'class {c} n {n} outside published overland range 0.010-0.80')
    grid = xu.open_dataset(a.mesh).load(); db = BathymetryDatabase(check_online=False); bathy = []
    fine_files = {q.name: q for q in Path('.sfincs-runs/road-terrain-1m-v1').glob('terrain-1m-*.tif')}
    fine_files.update({q.name: q for q in Path('.sfincs-runs/silverbell-terrain-v1').glob('terrain-1m-*.tif')})
    fine_files.update({q.name: q for q in Path('.sfincs-runs/all-routes-terrain-v1').glob('terrain-1m-*.tif')})
    for extra in a.extra_fine:
        fine_files.update({q.name: q for q in extra.glob('terrain-1m-*.tif')})
    lulc = rioxarray.open_rasterio(a.context / 'lulc.tif').squeeze('band', drop=True)
    mp = pd.read_csv(a.context / 'esa_worldcover_mapping.csv', index_col=0)
    base = np.full(lulc.shape, np.nan, dtype='float32')
    for code, row in mp.iterrows():
        base[lulc.values == int(code)] = row['N']
    if not np.isfinite(base).all() or (base <= 0).any():
        raise ValueError('Missing roughness mapping')
    cm = gpd.read_file(a.channel_mask).to_crs(lulc.rio.crs)
    zone = features.rasterize(((mapping(g), 1) for g in cm.geometry.buffer(a.protect_buffer)), out_shape=lulc.shape,
                              transform=lulc.rio.transform(), all_touched=True, dtype='uint8').astype(bool)
    values = base.copy()
    for c, n in cls.items():
        sel = (lulc.values == c) & ~zone
        values[sel] = n
    assert np.isfinite(values).all() and (values > 0).all()
    assert np.array_equal(values[zone], base[zone]), 'channel zone pixels changed'
    px = abs(lulc.rio.transform().a * lulc.rio.transform().e)
    rep = {'sensitivityVariant': True, 'change': f'land Manning n {cls} outside the protected channel zone', 'source': SOURCE,
           'channelMask': str(a.channel_mask).replace('\\', '/'), 'protectBufferM': a.protect_buffer,
           'zonePixels': int(zone.sum()), 'zoneAreaKm2': round(float(zone.sum() * px) / 1e6, 4),
           'pinnedMapping': {int(k): float(r['N']) for k, r in mp.iterrows()},
           'changedPixelsByClass': {int(c): int(((lulc.values == c) & ~zone).sum()) for c in cls},
           'changedAreaKm2': round(float((values != base).sum() * px) / 1e6, 3),
           'rasterMeanN': {'pinned': round(float(base.mean()), 5), 'variant': round(float(values.mean()), 5)}}
    (a.output / 'land-n-report.json').write_text(json.dumps(rep, indent=2) + '\n', encoding='utf-8'); print(json.dumps(rep))
    if a.zone_only:
        return
    for f in sorted(fine_files.values()):
        db.add_dataset_from_file(f.stem, str(f)); bathy.append({'name': f.stem})
    db.add_dataset_from_file('context', str(a.context / 'terrain.tif')); bathy.append({'name': 'context'})
    man = lulc.copy(data=values); man.rio.write_nodata(np.nan, inplace=True); db.add_dataarray_dataset(man, 'manning')
    target = a.output / 'sfincs_subgrid.nc'
    if target.exists():
        raise SystemExit(f'{target} exists; refusing to overwrite')
    spec = importlib.util.spec_from_file_location('official_subgrid', '.sfincs-runs/cht-refinement-source/subgrid_quadtree_builder.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    table = module.build_subgrid_table_quadtree(grid, bathymetry_sets=bathy, roughness_sets=[{'name': 'manning'}], nr_levels=10,
                                                nr_subgrid_pixels=6, depth_factor=1.0, zfill=None, bathymetry_database=db, quiet=False)
    for name in ['z_zmin', 'uv_zmin']:
        if not np.isfinite(table[name]).all() or float(table[name].min()) <= 0:
            raise ValueError('Uncovered local terrain reached native subgrid tables')
    table.to_netcdf(target)
    rep['files'] = [{'name': target.name, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}]
    rep['status'] = 'subgrid_prepared_not_runnable_case'; rep['solverExecuted'] = False
    (a.output / 'land-n-report.json').write_text(json.dumps(rep, indent=2) + '\n', encoding='utf-8'); print(json.dumps(rep))


if __name__ == '__main__':
    main()
