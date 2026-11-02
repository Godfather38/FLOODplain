"""Export existing SFINCS restart fluxes; never invokes or modifies the solver."""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
import xarray as xr
from pyproj import Transformer

ENGINE = 'f3647fc0289bb15cb2512d60686cef74cb853c78'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def restart(path):
    """Little-endian Fortran sequential records, pinned type-1 writer."""
    data = path.read_bytes()
    records, offset = [], 0
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError('Truncated restart record')
        size = struct.unpack_from('<i', data, offset)[0]
        if size < 0 or size % 4 or offset + size + 8 > len(data):
            raise ValueError('Invalid restart record length')
        if struct.unpack_from('<i', data, offset + size + 4)[0] != size:
            raise ValueError('Restart record marker mismatch')
        records.append(np.frombuffer(data, offset=offset + 4, count=size // 4,
                                     dtype='<i4' if not records else '<f4'))
        offset += size + 8
    if len(records) != 4 or records[0].tolist() != [1]:
        raise ValueError('Only pinned type-1 restart files supported')
    if not all(np.isfinite(a).all() for a in records):
        raise ValueError('Nonfinite restart state')
    return records[1:]


def physical_edges(grid):
    """sfincs_domain.f90: active cell order, right mu1/mu2 then above nu1/nu2.

    This exporter deliberately rejects inactive input cells rather than guessing
    their remapping. Both source refined runs have all input faces active.
    """
    if not np.all(grid['mask'].values > 0):
        raise ValueError('Inactive input faces require explicit solver remapping')
    a = {n: grid[n].values for n in ['mu', 'mu1', 'mu2', 'nu', 'nu1', 'nu2']}
    edges = []
    for face in range(len(grid['mask'])):
        for axis, flag, first, second in [(0, 'mu', 'mu1', 'mu2'), (1, 'nu', 'nu1', 'nu2')]:
            for neighbor in ([first] if a[flag][face] < 1 else [first, second]):
                if a[neighbor][face] > 0:
                    edges.append((face, int(a[neighbor][face]) - 1, axis))
    return np.asarray(edges, dtype=np.int64)


def face_bounds(dataset, name, xname, yname):
    conn = dataset[name]
    values = conn.values
    base = int(conn.attrs.get('start_index', 0))
    valid = np.isfinite(values) & (values >= base)
    indices = np.where(valid, values - base, 0).astype(int)
    x, y = dataset[xname].values[indices], dataset[yname].values[indices]
    return np.column_stack([np.where(valid, x, np.inf).min(1), np.where(valid, y, np.inf).min(1),
                            np.where(valid, x, -np.inf).max(1), np.where(valid, y, -np.inf).max(1)])


def signed_boundary(edges, selected):
    inside_a, inside_b = selected[edges[:, 0]], selected[edges[:, 1]]
    return np.where(inside_a ^ inside_b, np.where(inside_b, 1, -1), 0)


def budget(q_width, edges, selected):
    signs = signed_boundary(edges, selected)
    inward = q_width * signs
    divergence = np.zeros(len(selected))
    np.add.at(divergence, edges[:, 0], -q_width)
    np.add.at(divergence, edges[:, 1], q_width)
    net = float(inward.sum())
    residual = float(divergence[selected].sum() - net)
    if abs(residual) > 1e-10:
        raise ValueError('Incidence/boundary conservation mismatch')
    return {'inflowM3s': float(np.maximum(inward, 0).sum()),
            'outflowM3s': float(-np.minimum(inward, 0).sum()),
            'netInflowM3s': net, 'incidenceResidualM3s': residual}


def export(native, scene_path, destination):
    scene = json.loads(scene_path.read_text())
    if scene['runId'] != 'refined-full-41344983607':
        raise ValueError('Wrong source scene')
    grid = xr.open_dataset(native / 'sfincs.nc')
    water = xr.open_dataset(native / 'sfincs_map.nc')
    subgrid = xr.open_dataset(native / 'sfincs_subgrid.nc')
    if float(grid.attrs.get('rotation', 0)) != 0:
        raise ValueError('Rotated grid requires explicit normal transform')
    b = face_bounds(grid, 'mesh2d_face_nodes', 'mesh2d_node_x', 'mesh2d_node_y')
    wb = face_bounds(water, 'mesh2d_face_nodes', 'mesh2d_node_x', 'mesh2d_node_y')
    if not np.array_equal(b, wb) or not np.array_equal(grid.mesh2d_nFaces, np.arange(len(b))):
        raise ValueError('Expected independently checked identity source/map face correspondence')
    edges = physical_edges(grid)
    if len(edges) != subgrid.sizes['npuv']:
        raise ValueError('Physical edge count differs from native subgrid')
    combined_count = sum(int(((grid[direction].values == 1) &
                              ((grid[direction + '1'].values > 0) | (grid[direction + '2'].values > 0))).sum())
                         for direction in ['md', 'mu', 'nd', 'nu'])
    ids = np.array([int(c['nativeFaceId']) for c in scene['cells']])
    selected = np.zeros(len(b), dtype=bool)
    selected[ids] = True
    cx, cy = Transformer.from_crs(4326, 32612, always_xy=True).transform(*scene['center'])
    centers = (b[:, :2] + b[:, 2:]) / 2
    masks = {'scene': selected, 'junction160': selected & (abs(centers[:, 0] - cx) <= 80) & (abs(centers[:, 1] - cy) <= 80)}
    retained = selected[edges[:, 0]] | selected[edges[:, 1]]
    solver_indices = np.flatnonzero(retained)
    ee = edges[retained]
    edge_rows, widths = [], []
    for k, (a, c, axis) in zip(solver_indices, ee):
        if axis == 0:
            assert b[a, 2] == b[c, 0]
            ends = [[b[a, 2], max(b[a, 1], b[c, 1])], [b[a, 2], min(b[a, 3], b[c, 3])]]
        else:
            assert b[a, 3] == b[c, 1]
            ends = [[max(b[a, 0], b[c, 0]), b[a, 3]], [min(b[a, 2], b[c, 2]), b[a, 3]]]
        width = float(np.linalg.norm(np.subtract(ends[1], ends[0])))
        if width <= 0:
            raise ValueError('Disconnected physical edge')
        widths.append(width)
        edge_rows.append({'id': f'q:{k}', 'solverIndexZeroBased': int(k), 'fromFace': int(a), 'toFace': int(c),
                          'positiveNormalEN': [1, 0] if axis == 0 else [0, 1], 'endpointsUTM': ends, 'widthM': width})
    widths = np.array(widths)
    destination.mkdir(parents=True, exist_ok=True)
    def save(name, obj):
        raw = (json.dumps(obj, separators=(',', ':'), allow_nan=False) + '\n').encode()
        if name.endswith('.gz'):
            raw = gzip.compress(raw, mtime=0)
        (destination / name).write_bytes(raw)
        return {'path': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    geometry = {'schema': 'brawley-flow-geometry-v1', 'crs': 'EPSG:32612', 'edges': edge_rows,
                'masks': {name: {'nativeFaceIds': np.flatnonzero(mask).tolist(),
                                 'inwardSign': signed_boundary(ee, mask).tolist()} for name, mask in masks.items()}}
    descriptors = []
    for path in sorted(native.glob('*.rst')):
        day, hour = path.name.split('.')[1:3]
        stamp = f'{day[:4]}-{day[4:6]}-{day[6:]}T{hour[:2]}:{hour[2:4]}:{hour[4:]}Z'
        z, q, uvmean = restart(path)
        if len(z) != len(b) or len(q) != len(edges) + combined_count + 1:
            raise ValueError('Restart/grid shape mismatch')
        zi = water.zs.sel(time=np.datetime64(stamp[:-1])).values
        finite = np.isfinite(zi)
        if not np.array_equal(z[finite], zi[finite]):
            raise ValueError('Restart/map time or ordering mismatch')
        values = q[solver_indices].astype(float)
        frame = {'schema': 'brawley-flow-frame-v1', 'time': stamp, 'qM2s': values.tolist(),
                 'budgets': {name: budget(values * widths, ee, mask) for name, mask in masks.items()}}
        if stamp == '2026-11-01T22:00:00Z':
            expected = {'inflowM3s': .6156542878073878, 'outflowM3s': .6151355654090196}
            for key, value in expected.items():
                if abs(frame['budgets']['junction160'][key] - value) > 1e-12:
                    raise ValueError('Known 22:00 native snapshot mismatch')
        descriptors.append({**save(f'flow-{day}-{hour}.json.gz', frame), 'time': stamp,
                            'sourceRestart': {'path': path.name, 'sha256': digest(path)},
                            'nativeRecords': {'zsCount': len(z), 'qCount': len(q), 'boundaryUvmeanCount': len(uvmean)},
                            'finiteMapElevationsMatched': int(finite.sum())})
    if len(descriptors) != 14:
        raise ValueError('Expected all 14 saved hourly snapshots')
    manifest = {'schema': 'brawley-flow-v1', 'runId': scene['runId'], 'clockMode': 'frozen_replay',
                'sceneSha256': digest(scene_path), 'sceneGeometrySha256': scene['geometrySha256'],
                'sourceEngineCommit': ENGINE, 'sourceDirectory': 'road-result-41344983607/artifact/runs/current',
                'sourceHashes': {n: digest(native / n) for n in ['sfincs.nc', 'sfincs_map.nc', 'sfincs_subgrid.nc', 'sfincs.inp']},
                'geometry': save('geometry.json.gz', geometry), 'frames': descriptors,
                'quantity': 'Signed native edge unit-width discharge', 'units': 'm2/s',
                'positiveDirection': 'fromFace to toFace along positiveNormalEN',
                'totalDischarge': 'qM2s * widthM in m3/s', 'velocity': None,
                'velocityStatus': 'Not exported; q is not velocity', 'interpolation': 'none; exact hourly snapshots only',
                'waterFrames': {'cadenceSeconds': 900, 'count': 57, 'unchanged': True},
                'flowCadenceSeconds': 3600, 'physicalEdgeCount': len(edges), 'exportedEdgeCount': len(ee),
                'combinedEdgeCount': combined_count, 'dummyEntryCount': 1,
                'excludedEntries': 'All combined-edge and trailing dummy q entries beyond physicalEdgeCount',
                'spatialMasks': {'scene': 'Union of native faces listed in the checksummed Brawley scene; includes every incident edge',
                                'junction160': {'rule': 'Scene faces whose native UTM rectangle centres satisfy abs(x-centerX)<=80 and abs(y-centerY)<=80. Boundary is union of whole selected native faces, NOT a surveyed square.',
                                                'centerUTM': [cx, cy], 'halfWidthM': 80}},
                'budgetMeaning': 'Instantaneous signed perimeter transport; incidence sum checked. Not a timestep water balance: rain, infiltration and storage change are separate.',
                'checks': {'allRecordMarkersVerified': True, 'allPhysicalEdgesShareExactBoundary': True,
                           'allFiniteHourlyMapElevationsExact': True, 'known2200BudgetVerified': True}}
    descriptor = save('manifest.json', manifest)
    print(json.dumps({'manifest': descriptor, 'edges': len(ee), 'frames': len(descriptors),
                      'maskFaceCounts': {k: int(v.sum()) for k, v in masks.items()}}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', required=True, type=Path)
    parser.add_argument('--scene', required=True, type=Path)
    parser.add_argument('--destination', required=True, type=Path)
    args = parser.parse_args()
    export(args.native, args.scene, args.destination)
