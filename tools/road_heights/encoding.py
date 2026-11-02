"""Compact, gzip-friendly road height files: uint32 header size, JSON header, little-endian columns.

Decoder for browsers: public/simulation/road-heights.js.
"""
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

FORMAT = "floodplain-road-heights-v1"
FLAG = {"deck_lidar": 1, "deck_approach": 2, "no_terrain": 4, "structure_untagged": 8}
LATERAL_NULL = 255


def _delta(values, starts):
    out = np.diff(values, prepend=0).astype("i4")
    out[starts[:-1]] = values[starts[:-1]]
    return out


def encode_lines(path, lines, metadata):
    """lines: dicts with name, kind, routeId, lon, lat, z (NaN=null), s, lateral (m), flags, source."""
    counts = [len(l["lon"]) for l in lines]
    starts = np.r_[0, np.cumsum(counts)].astype("<u4")
    cat = lambda k: np.concatenate([l[k] for l in lines]) if lines else np.empty(0)
    lon, lat = np.rint(cat("lon") * 1e6).astype("i8"), np.rint(cat("lat") * 1e6).astype("i8")
    z = cat("z").astype("f8")
    known = np.isfinite(z)
    filled = np.where(known, z, 0.0)
    if known.any():  # Null heights repeat the previous value so deltas stay small; the flag marks them.
        idx = np.maximum.accumulate(np.where(known, np.arange(z.size), 0))
        filled = z[idx]
        filled[~np.isfinite(filled)] = 0.0
    zc = np.rint(filled * 100).astype("i8")
    station = np.rint(cat("s") * 10).astype("i8")
    lat_range = cat("lateral")
    lateral = np.where(np.isfinite(lat_range), np.minimum(np.rint(lat_range * 10), 254), LATERAL_NULL).astype("u1")
    flags = cat("flags").astype("u1") | np.where(known, 0, FLAG["no_terrain"]).astype("u1")
    columns = [("lineStart", "<u4", starts),
               ("dLonE6", "<i4", _delta(lon, starts)), ("dLatE6", "<i4", _delta(lat, starts)),
               ("dZCm", "<i4", _delta(zc, starts)), ("dStationDm", "<i4", _delta(station, starts)),
               ("lateralDm", "u1", lateral), ("flags", "u1", flags), ("source", "i1", cat("source").astype("i1"))]
    offset, table, blobs = 0, {}, []
    for name, dtype, values in columns:
        blob = np.asarray(values).astype(dtype).tobytes()
        table[name] = {"type": dtype.lstrip("<"), "count": int(np.asarray(values).size), "offset": offset}
        offset += len(blob)
        blobs.append(blob)
    header = {"format": FORMAT, "columns": table, "metadata": metadata,
              "lines": {"name": [l["name"] for l in lines], "kind": [l["kind"] for l in lines],
                        "routeId": [l.get("routeId") for l in lines]}}
    head = json.dumps(header, separators=(",", ":")).encode()
    raw = len(head).to_bytes(4, "little") + head + b"".join(blobs)
    data = gzip.compress(raw, 9, mtime=0)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)
    return {"path": Path(path).name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "decodedBytes": len(raw), "lineCount": len(lines), "stationCount": int(lon.size)}


def decode_lines(path):
    raw = gzip.decompress(Path(path).read_bytes())
    size = int.from_bytes(raw[:4], "little")
    header = json.loads(raw[4:4 + size])
    body = 4 + size
    col = {k: np.frombuffer(raw, dtype="<" + c["type"] if c["type"] not in ("u1", "i1") else c["type"],
                            count=c["count"], offset=body + c["offset"]) for k, c in header["columns"].items()}
    starts = col["lineStart"].astype(np.int64)
    lines = []
    for i in range(len(starts) - 1):
        a, b = starts[i], starts[i + 1]
        flags = col["flags"][a:b]
        z = np.cumsum(col["dZCm"][a:b].astype("i8")) / 100.0
        lines.append({"name": header["lines"]["name"][i], "kind": header["lines"]["kind"][i],
                      "routeId": header["lines"]["routeId"][i],
                      "lon": np.cumsum(col["dLonE6"][a:b].astype("i8")) / 1e6,
                      "lat": np.cumsum(col["dLatE6"][a:b].astype("i8")) / 1e6,
                      "s": np.cumsum(col["dStationDm"][a:b].astype("i8")) / 10.0,
                      "z": np.where(flags & FLAG["no_terrain"], np.nan, z),
                      "lateral": np.where(col["lateralDm"][a:b] == LATERAL_NULL, np.nan, col["lateralDm"][a:b] / 10.0),
                      "flags": flags, "source": col["source"][a:b]})
    return header, lines
