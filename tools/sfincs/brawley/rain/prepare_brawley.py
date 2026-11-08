"""Frozen 63-hour rainfall package for brawley-avra-west (adapted copy of task-2 all-route-rainfall/prepare.py).

Same retained raw bytes and the same decoder scripts as the all-route union package; only the crop changes.
Offline only: HRRR 2026-11-01T14Z f01-f18 APCP (full CONUS grid), Stage IV 01h (full HRAP grid) and the one
recorded MRMS Pass2 replacement hour are read from the retained road-rainfall-v2 cache (read-only) and copied.

usage (cwd = E:/FloodPLAIN/wt-model):
  python tools/sfincs/brawley/rain/prepare_brawley.py --output .sfincs-runs/brawley-avra-west-rainfall-v1
"""
import argparse, hashlib, json, shutil, subprocess, sys
from pathlib import Path
import numpy as np, xarray as xr

here = Path(__file__).resolve().parent
SRC = Path('H:/AI/Projects/FloodPLAIN-sfincs/.sfincs-runs/road-rainfall-v2')  # read-only source
GRID = [-111.52, 31.92, -110.98, 32.43]  # EPSG:4326 grid-centre bounds; requested south 31.98 moved to 31.92 because the local contributing area (NLDI 15876711 basin minus 15876941 basin) reaches 31.937 N (about 32 km2 south of 31.975 at lon -111.27..-111.13)
VERSION = 'brawley-avra-west-v1'

p = argparse.ArgumentParser(); p.add_argument('--output', type=Path, required=True); p.add_argument('--domain', type=Path, help='optional domain geojson to verify coverage')
p.add_argument('--grid', type=float, nargs=4, default=GRID, metavar=('W', 'S', 'E', 'N'), help='EPSG:4326 grid-centre bounds (default: the v1 crop)')
p.add_argument('--domain-version', default=VERSION); a = p.parse_args()
if list(a.grid) != GRID or a.domain_version != VERSION: GRID = [float(v) for v in a.grid]; VERSION = a.domain_version  # e.g. domain v2: north edge moved for the added west-valley subtrees
package = a.output.resolve()
if package.exists(): raise SystemExit(f'output exists: {package}')
package.mkdir(parents=True)
for f in SRC.iterdir():
    if f.is_file(): shutil.copy2(f, package / f.name)
shutil.copytree(SRC / 'raw', package / 'raw')
reg = json.loads((package / 'boundary-registry.json').read_text())
reg['crs'] = 'EPSG:4326'; reg['bounds'] = GRID; reg['domainVersion'] = VERSION
reg['scopeNote'] = f'Rainfall crop extent only (lon {GRID[0]}..{GRID[2]}, lat {GRID[1]}..{GRID[3]} grid centres); copied old inlet registry is NOT an assignment for brawley-avra-west'
(package / 'boundary-registry.json').write_text(json.dumps(reg, indent=2))
steps = [[sys.executable, str(here / 'recrop_current_inputs.py'), str(package), '--grid-bounds', *map(str, GRID), '--domain-version', VERSION],
         [sys.executable, str(here / 'finalize_current_inputs.py'), str(package)],
         [sys.executable, str(here / 'build_initialization_rainfall.py'), str(package)]]
for cmd in steps:
    print('RUN', ' '.join(cmd[1:]), flush=True); subprocess.run(cmd, check=True)
for f in (SRC / 'initialization-rainfall/raw').glob('*'):
    if 'MRMS' in f.name or f.suffix == '.csv': shutil.copy2(f, package / 'initialization-rainfall/raw' / f.name)
print('RUN resolve_initialization_rainfall.py', flush=True)
subprocess.run([sys.executable, str(here / 'resolve_initialization_rainfall.py'), str(package)], check=True)

paths = ['initialization-rainfall/resolved-analysis-precipitation.nc', 'initialization-rainfall/forecast-transition-precipitation.nc', 'precipitation.nc']; arrays = []
for rel in paths:
    with xr.open_dataset(package / rel, decode_coords='all') as ds: arrays.append(ds.precip.load())
rain = xr.concat(arrays, dim='time', join='exact', coords='minimal', compat='equals')
missing = int(np.isnan(rain.values).sum())
assert len(rain.time) == 63 and np.all(np.diff(rain.time.values) == np.timedelta64(1, 'h')) and missing == 0
assert str(rain.time.values[0])[:19] == '2026-10-30T16:00:00' and str(rain.time.values[-1])[:19] == '2026-11-02T06:00:00'
v = rain.values; tot = v.sum(axis=0)
stats = {'gridMaxHourlyMmH': float(v.max()), 'gridMaxHourlyAt': str(rain.time.values[int(np.unravel_index(v.argmax(), v.shape)[0])])[:19] + 'Z',
         'gridStormTotalMm': {'min': float(tot.min()), 'mean': float(tot.mean()), 'max': float(tot.max())},
         'segmentsMaxMmH': {rel: float(x.values.max()) for rel, x in zip(paths, arrays)}}
domain = None
if a.domain:
    import geopandas as gpd
    from shapely.geometry import box
    d = gpd.read_file(a.domain).to_crs(4326); dx = 0.01
    fp = box(float(rain.x.min()) - dx / 2, float(rain.y.min()) - dx / 2, float(rain.x.max()) + dx / 2, float(rain.y.max()) + dx / 2)
    domain = {'path': str(a.domain.resolve()), 'sha256': hashlib.sha256(a.domain.read_bytes()).hexdigest(), 'bounds4326': [float(b) for b in d.total_bounds], 'coveredByRasterFootprint': bool(fp.covers(d.union_all()))}
report = {'status': 'complete', 'role': 'frozen_replay_not_current', 'domainVersion': VERSION, 'gridCentreBounds4326': GRID,
          'rasterOuterBounds4326': [float(rain.x.min()) - .005, float(rain.y.min()) - .005, float(rain.x.max()) + .005, float(rain.y.max()) + .005],
          'shape': list(rain.shape), 'start': '2026-10-30T16:00:00Z', 'endExclusive': '2026-11-02T07:00:00Z', 'hrrrIssue': '2026-11-01T14:00:00Z', 'nwmIssueContext': '2026-11-01T13:00:00Z',
          'missingCellHours': missing, 'stats': stats, 'domain': domain,
          'files': {rel: {'sha256': hashlib.sha256((package / rel).read_bytes()).hexdigest(), 'bytes': (package / rel).stat().st_size} for rel in paths + ['precipitation-metadata.json']},
          'limits': ['Rainfall only; copied old inlet registry is not a brawley-avra-west boundary assignment.', 'Original Stage IV 2026-11-01 12-13Z bitmap gap retained in analysis-precipitation.nc; MRMS Pass2 substitution explicit in resolved-analysis-precipitation.nc.', 'No downloads, refresh or solver run; all raw bytes are the retained originals (sha256 verified for HRRR).']}
(package / 'delivery.json').write_text(json.dumps(report, indent=2)); print(json.dumps(report), flush=True)
