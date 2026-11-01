"""Export completed native UGRID output as an opt-in, frame-streamed package.

Never writes current-sfincs-manifest.json or fabricates native face correspondence.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
import xarray as xr
from pyproj import CRS, Transformer


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def face_ids(values):
    values = np.asarray(values)
    if values.ndim != 1 or not np.issubdtype(values.dtype, np.integer):
        raise ValueError('Explicit one-dimensional integer native face IDs required')
    ids = [str(int(v)) for v in values]
    if len(set(ids)) != len(ids): raise ValueError('Duplicate native face IDs')
    return ids


def geometry(ds, topology_name, id_name, crs_name):
    crs = CRS.from_user_input(crs_name)
    if not crs.is_projected or any(abs(a.unit_conversion_factor - 1) > 1e-10 for a in crs.axis_info[:2]):
        raise ValueError('Projected metre coordinates required for native polygon areas')
    topology = ds[topology_name].attrs
    if topology.get('cf_role') != 'mesh_topology' or topology.get('topology_dimension') != 2:
        raise ValueError('UGRID two-dimensional mesh topology required')
    conn = ds[topology['face_node_connectivity']]
    xy_names = topology['node_coordinates'].split()
    if len(xy_names) != 2: raise ValueError('Two node coordinate variables required')
    ids = face_ids(ds[id_name].values)
    if ds[id_name].dims != (conn.dims[0],): raise ValueError('Face IDs do not index mesh faces')
    nodes = np.column_stack([ds[n].values for n in xy_names])
    if nodes.ndim != 2 or nodes.shape[1] != 2 or not np.isfinite(nodes).all(): raise ValueError('Invalid native nodes')
    start = int(conn.attrs.get('start_index', 0))
    fill = conn.attrs.get('_FillValue', conn.encoding.get('_FillValue'))
    to_geo = Transformer.from_crs(crs, 4326, always_xy=True)
    cells, rings, areas = [], [], []
    for native_id, row in zip(ids, conn.values):
        valid = np.isfinite(row)
        if fill is not None: valid &= row != fill
        raw = row[valid]
        if (raw != np.floor(raw)).any(): raise ValueError('Noninteger connectivity')
        indices = raw.astype(int) - start
        if len(indices) > 1 and indices[-1] == indices[0]: indices = indices[:-1]
        if not 4 <= len(indices) <= 16 or len(set(indices)) != len(indices) or (indices < 0).any() or (indices >= len(nodes)).any():
            raise ValueError('Quadtree requires distinct valid native polygon vertices')
        corners = nodes[indices]
        # Translate before shoelace to avoid large UTM-coordinate cancellation.
        local = corners - corners[0]
        signed = np.sum(local[:, 0] * np.roll(local[:, 1], -1) - np.roll(local[:, 0], -1) * local[:, 1]) / 2
        edges = np.roll(corners, -1, axis=0) - corners
        following = np.roll(edges, -1, axis=0)
        turns = edges[:, 0] * following[:, 1] - edges[:, 1] * following[:, 0]
        if signed == 0 or not (((turns >= 0).all() and (turns > 0).any()) or ((turns <= 0).all() and (turns < 0).any())): raise ValueError('Invalid nonconvex/degenerate face')
        area = abs(float(signed)); lon, lat = to_geo.transform(corners[:, 0], corners[:, 1])
        cross = local[:, 0] * np.roll(local[:, 1], -1) - np.roll(local[:, 0], -1) * local[:, 1]
        center = corners[0] + np.sum((local + np.roll(local, -1, axis=0)) * cross[:, None], axis=0) / (6 * signed)
        cx, cy = to_geo.transform(*center)
        ring = [[float(y), float(x)] for x, y in zip(lon, lat)]
        if any(abs(x) > 180 or abs(y) > 90 for y, x in ring): raise ValueError('Invalid geographic footprint')
        cells.append({'nativeFaceId': native_id, 'lon': cx, 'lat': cy, 'areaM2': area,
                      'resolutionM': float(np.sqrt(area)), 'edgeLengthsM': np.linalg.norm(edges, axis=1).tolist()})
        rings.append(ring); areas.append(area)
    return cells, rings, np.asarray(areas)


def frame_values(volume, surface, areas, tolerance):
    volume, surface = np.asarray(volume, dtype=float), np.asarray(surface, dtype=float)
    if volume.shape != areas.shape or surface.shape != areas.shape: raise ValueError('Native face shape mismatch')
    if not np.isfinite(tolerance) or tolerance < 0: raise ValueError('Invalid negative-volume tolerance')
    if (volume[np.isfinite(volume)] < -tolerance).any(): raise ValueError('Negative volume exceeds declared display tolerance')
    clean = lambda a: [float(v) if np.isfinite(v) else None for v in a]
    return {'depthM': clean(np.maximum(volume, 0) / areas), 'nativeVolumeM3': clean(volume), 'waterSurfaceM': clean(surface)}


def export(config_path, destination):
    config_path = Path(config_path).resolve(); c = json.loads(config_path.read_text(encoding='utf-8-sig'))
    base = config_path.parent
    source = lambda name: (base / c[name]).resolve()
    if c.get('executionMode') != 'simulated_live_frozen_inputs': raise ValueError('Explicit frozen-input mode required')
    if not c.get('runId') or not c.get('assumptions') or not c.get('verticalDatum'): raise ValueError('Run identity, assumptions and datum required')
    if not c.get('inputArtifacts'): raise ValueError('Input artifact hashes required')
    for item in c['inputArtifacts']:
        if sha(base / item['path']) != item['sha256']: raise ValueError('Input hash mismatch')
    partial = None
    if c.get('partialProof'):
        proof_path = base / c['partialProof']['path']
        if sha(proof_path) != c['partialProof']['sha256']: raise ValueError('Partial proof checksum mismatch')
        partial = json.loads(proof_path.read_text())
        if partial.get('status') != 'partial_budget_timeout' or partial['validFrom'] != c['validFrom'] or partial['validTo'] != c['validTo']: raise ValueError('Partial coverage proof mismatch')
        for key, field in [('sfincs.nc','meshFile'),('sfincs_map.nc','mapFile'),('solver.log','logFile')]:
            if sha(source(field)) != partial['nativeInputHashes'][key]: raise ValueError('Partial native hash mismatch')
    elif 'Simulation finished' not in source('logFile').read_text(errors='replace'): raise ValueError('Completed solver log required')
    destination = Path(destination)
    if destination.exists(): raise ValueError('New immutable package directory required')
    with xr.open_dataset(source('meshFile')) as mesh, xr.open_dataset(source('mapFile'), decode_times=False) as native:
        cells, rings, areas = geometry(mesh, c['meshTopology'], c['meshFaceIdVariable'], c['projectedCrs'])
        mesh_ids = [x['nativeFaceId'] for x in cells]
        if c.get('faceMapping'):
            mapping = c['faceMapping']; path = base / mapping['path']
            if sha(path) != mapping['sha256']: raise ValueError('Face proof hash mismatch')
            output_ids = face_ids(np.load(path, allow_pickle=False))
            # Independently verify supplied IDs against exact bounds from both native connectivities.
            def bounds(ds, topology):
                t = ds[topology].attrs; v = ds[t['face_node_connectivity']]; a = v.values
                good = np.isfinite(a); fill = v.encoding.get('_FillValue',v.attrs.get('_FillValue'))
                if fill is not None: good &= a != fill
                indices = np.where(good,a, v.attrs.get('start_index',0)).astype(int)-int(v.attrs.get('start_index',0))
                names=t['node_coordinates'].split(); xx=np.where(good,ds[names[0]].values[indices],np.nan); yy=np.where(good,ds[names[1]].values[indices],np.nan)
                return np.column_stack([np.nanmin(xx,axis=1),np.nanmin(yy,axis=1),np.nanmax(xx,axis=1),np.nanmax(yy,axis=1)])
            ib=bounds(mesh,c['meshTopology']); ob=bounds(native,c['outputMeshTopology']); byid={v:i for i,v in enumerate(mesh_ids)}
            if len(output_ids)!=len(ob) or any(v not in byid for v in output_ids):raise ValueError('Face proof does not cover output')
            if not np.array_equal(ib[[byid[v] for v in output_ids]],ob):raise ValueError('Supplied face proof disagrees with native geometry')
            if len(np.unique(ib,axis=0))!=len(ib):raise ValueError('Ambiguous native rectangle proof')
            face_dim=native[native[c['outputMeshTopology']].attrs['face_node_connectivity']].dims[0]
        else:
            output_ids = face_ids(native[c['outputFaceIdVariable']].values)
            face_dim = native[c['outputFaceIdVariable']].dims[0]
        if set(output_ids) != set(mesh_ids): raise ValueError('Output/mesh face IDs differ; count equality is insufficient')
        order = {v: i for i, v in enumerate(output_ids)}; reorder = [order[v] for v in mesh_ids]
        volume, surface = native[c['volumeVariable']], native[c['surfaceVariable']]
        if volume.attrs.get('units') not in ('m3', 'm^3') or surface.attrs.get('units') != 'm': raise ValueError('Native volume m3 and surface m required; no h/zs-derived depth fallback')
        if set(volume.dims) != {'time', face_dim} or set(surface.dims) != {'time', face_dim}: raise ValueError('Explicit time/native-face variables required')
        times = np.asarray(xr.decode_cf(native[['time']]).time.values, dtype='datetime64[ns]')
        if np.isnat(times).any() or not np.all(np.diff(times) > np.timedelta64(0, 'ns')): raise ValueError('Invalid native time axis')
        if c.get('nativeTimeZone') != 'UTC': raise ValueError('Native UTC convention must be explicit')
        start, end = (np.datetime64(c[k].removesuffix('Z'), 'ns') for k in ('validFrom', 'validTo'))
        if not all(c[k].endswith('Z') for k in ('validFrom', 'validTo')) or start >= end: raise ValueError('Explicit UTC valid window required')
        selected = np.flatnonzero((times >= start) & (times <= end))
        if not len(selected) or times[selected[0]] != start or times[selected[-1]] != end: raise ValueError('Native output must cover exact valid endpoints')
        destination.mkdir(parents=True)
        def write(name, value):
            path = destination / name
            path.write_bytes(gzip.compress(json.dumps(value, allow_nan=False, separators=(',', ':')).encode(), mtime=0))
            return {'path': name, 'sha256': sha(path), 'bytes': path.stat().st_size}
        geo = write('geometry.json.gz', {'schemaVersion': 1, 'runId': c['runId'], 'cells': cells, 'rings': rings,
                    'coordinates': 'latitude,longitude', 'geometryKind': 'native_quadtree_faces', 'projectedCrs': c['projectedCrs']})
        frames = []
        for i in selected:
            stamp = str(times[i])[:19] + 'Z'
            values = frame_values(volume.isel(time=int(i)).values[reorder], surface.isel(time=int(i)).values[reorder], areas, c.get('negativeVolumeToleranceM3', 0))
            frames.append({'time': stamp, **write(f'frame-{i}.json.gz', {'schemaVersion': 1, 'runId': c['runId'], 'geometrySha256': geo['sha256'], 'time': stamp, **values})})
        manifest = {'schemaVersion': 1, 'kind': 'quadtree_output_package', 'status': 'partial' if partial else 'complete', 'runId': c['runId'],
                    'executionMode': c['executionMode'], 'validFrom': c['validFrom'], 'validTo': c['validTo'], 'geometry': geo, 'frames': frames,
                    'resolution': {'minimumM': float(np.sqrt(areas.min())), 'maximumM': float(np.sqrt(areas.max())), 'cellCount': len(cells), 'uniform': bool(np.allclose(areas, areas[0]))},
                    'quantity': {'name': 'cell_average_depth', 'units': 'm', 'definition': 'Native volume divided by each full native polygon area'},
                    'coverage': {'status': 'native_geometry_only', 'crossingRegistry': None, 'roadDepthValidated': False},
                    'terrainDisplay': {'status': 'unavailable', 'reason': 'Requires separately source-bound terrain; no regular-grid DEM blocks substituted'},
                    'provenance': {'configurationSha256': sha(config_path), 'meshSha256': sha(source('meshFile')), 'nativeMapSha256': sha(source('mapFile')), 'logSha256': sha(source('logFile')), 'inputArtifacts': c['inputArtifacts'], 'verticalDatum': c['verticalDatum'], 'assumptions': c['assumptions'], 'nativeFaceOrdering': 'mesh face ID order; output reordered by exact ID', 'negativeVolumeDisplayToleranceM3': c.get('negativeVolumeToleranceM3', 0)},
                    'uncertainty': {'status': 'not_quantified', 'plusMinus': None}, 'solverCompletion': partial or {'status':'complete'}, 'endSummary': None if partial else 'not_exported'}
        (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        return manifest


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--config', required=True); p.add_argument('--destination', required=True)
    a = p.parse_args(); result = export(a.config, a.destination); print(json.dumps({'cells': result['resolution']['cellCount'], 'frames': len(result['frames'])}))
