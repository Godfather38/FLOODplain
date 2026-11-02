"""Lossless geographic doubles + native float32 quantities, with original package retained."""
import argparse, gzip, hashlib, json, struct, shutil
from array import array
from pathlib import Path
import sys

def pack(path, metadata, columns):
    if sys.byteorder != 'little':
        raise RuntimeError('Little-endian exporter required')
    offset = 0
    blocks = []
    descriptors = {}
    for name, (dtype, values) in columns.items():
        data = array(dtype, values).tobytes()
        descriptors[name] = dict(type=dtype, offset=offset, count=len(values))
        blocks.append(data); offset += len(data)
    header = json.dumps(dict(format='floodplain-columns-v1', metadata=metadata, columns=descriptors), separators=(',', ':')).encode()
    header += b' ' * (-(4 + len(header)) % 8)
    raw = struct.pack('<I', len(header)) + header + b''.join(blocks)
    compressed = gzip.compress(raw, compresslevel=6, mtime=0)
    path.write_bytes(compressed)
    return dict(path=path.name, sha256=hashlib.sha256(compressed).hexdigest(), bytes=len(compressed), decodedBytes=len(raw))

def convert(source, destination):
    source, destination = Path(source), Path(destination)
    destination.mkdir(exist_ok=False)
    read = lambda name: json.loads(gzip.decompress((source / name).read_bytes()))
    manifest = json.loads((source / 'manifest.json').read_text())
    geometry = read(manifest['geometry']['path'])
    cells, rings = geometry.pop('cells'), geometry.pop('rings')
    vertices, lookup, indices, offsets = [], {}, [], [0]
    for ring in rings:
        for point in ring:
            key = tuple(point)
            if key not in lookup:
                lookup[key] = len(vertices) // 2; vertices.extend(point)
            indices.append(lookup[key])
        offsets.append(len(indices))
    edges, edge_offsets = [], [0]
    for cell in cells:
        edges.extend(cell['edgeLengthsM']); edge_offsets.append(len(edges))
    geometry['nativeFaceIds'] = [c['nativeFaceId'] for c in cells]
    columns = {key: ('d', [c[key] for c in cells]) for key in ['lon', 'lat', 'areaM2', 'resolutionM']}
    columns.update(vertices=('d', vertices), ringOffsets=('I', offsets), ringIndices=('I', indices), edgeOffsets=('I', edge_offsets), edges=('d', edges))
    old_geometry = manifest['geometry']
    manifest['geometry'] = pack(destination / 'geometry.bin.gz', geometry, columns)
    new_frames = []
    for descriptor in manifest['frames']:
        frame = read(descriptor['path'])
        quantities = {}
        for key in ['nativeVolumeM3', 'waterSurfaceM']:
            values = frame.pop(key)
            finite = [float('nan') if v is None else v for v in values]
            encoded = array('f', finite)
            if any(v is not None and encoded[i] != v for i, v in enumerate(values)):
                raise ValueError('Quantity is not exactly native float32: ' + key)
            quantities[key] = ('f', encoded)
        frame.pop('depthM')
        frame['geometrySha256'] = manifest['geometry']['sha256']
        new_frames.append(dict(time=descriptor['time'], **pack(destination / descriptor['path'].replace('.json.', '.bin.'), frame, quantities)))
    manifest['frames'] = new_frames
    manifest['compactSource'] = dict(path=source.name, manifestSha256=hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest(), geometry=old_geometry, semantics='Float64 geometry unchanged; float32 native quantities exact; depth derived from volume/full native area; NaN encodes missing only.')
    for item in source.iterdir():
        if item.is_file() and item.name != 'manifest.json' and not item.name.endswith('.json.gz'):
            shutil.copyfile(item, destination/item.name)
    # Original package and raw source release remain immutable.
    manifest['supportingFilesSource'] = source.name
    (destination/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(dict(geometryBytes=manifest['geometry']['bytes'], firstFrameBytes=new_frames[0]['bytes'], totalBytes=sum(f['bytes'] for f in new_frames)+manifest['geometry']['bytes'])))

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('destination');a=p.parse_args();convert(a.source,a.destination)
