"""Compare road heights with one model run's water surface, frame by frame.

Reads a compact quadtree package. Each road station takes the water surface of
the native face containing it. A station counts only when the face holds water
and that surface is above the road. Stations outside the model stay unknown.

Usage: python tools/road_heights/flood_overlay.py [PACKAGE_DIR_NAME]
"""
import gzip
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import shapely

sys.path.insert(0, str(Path(__file__).parent))
from encoding import FLAG, decode_lines

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public/simulation/data"
HEIGHTS = DATA / "road-heights"
FACE_WET_M = 0.01      # Existing display threshold for a face holding water.
ABOVE_ROAD_M = 0.03    # About an inch; smaller differences are below the terrain's precision.
MERGE_GAP_M = 15.0
FINE_FACE_M = 12.5
NULL_CM = -32768


def read_columns(path):
    raw = gzip.decompress(Path(path).read_bytes())
    size = int.from_bytes(raw[:4], "little")
    head = json.loads(raw[4:4 + size])
    types = {"d": "<f8", "f": "<f4", "I": "<u4"}
    cols = {k: np.frombuffer(raw, dtype=types[c["type"]], count=c["count"], offset=4 + size + c["offset"])
            for k, c in head["columns"].items()}
    return head["metadata"], cols


def load_faces(package):
    meta, c = read_columns(package / "geometry.bin.gz")
    vertices = c["vertices"].reshape(-1, 2)  # Native rings are latitude, longitude.
    indices, offsets = c["ringIndices"], c["ringOffsets"].astype(np.int64)
    rings = vertices[indices][:, ::-1]
    polys = shapely.polygons(shapely.linearrings(rings, indices=np.repeat(np.arange(len(offsets) - 1), np.diff(offsets))))
    return polys, c["areaM2"], c["resolutionM"]


def locate(lon, lat, polys):
    tree = shapely.STRtree(polys)
    points = shapely.points(lon, lat)
    pi, fi = tree.query(points, predicate="intersects")
    face = np.full(len(lon), -1, dtype="i4")
    face[pi[::-1]] = fi[::-1]  # A point on a shared edge takes its first face.
    return face


def stretches_of(line, above_peak, peak_frame, first_frame, last_frame, face_res, times):
    """Merge above-road stations along one line into stretches."""
    s, on = line["s"], above_peak >= ABOVE_ROAD_M
    idx = np.flatnonzero(on)
    if not idx.size:
        return []
    groups, a = [], idx[0]
    for prev, cur in zip(idx, idx[1:]):
        if s[cur] - s[prev] > MERGE_GAP_M:
            groups.append((a, prev))
            a = cur
    groups.append((a, idx[-1]))
    out = []
    for i, j in groups:
        run = np.arange(i, j + 1)
        mask = run[on[run]]
        k = mask[np.argmax(above_peak[mask])]
        flags = line["flags"][run]
        deck = bool((flags & (FLAG["deck_lidar"] | FLAG["deck_approach"])).any())
        out.append({"type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[round(float(x), 6), round(float(y), 6)]
                                 for x, y in zip(line["lon"][run], line["lat"][run])] if len(run) > 1 else
                                 [[round(float(line["lon"][i]), 6), round(float(line["lat"][i]), 6)]] * 2},
                    "properties": {"road": line["name"], "kind": line["kind"], "routeId": line["routeId"],
                                   "startStationM": round(float(s[i]), 1), "lengthM": round(float(s[j] - s[i]), 1),
                                   "peakAboveRoadM": round(float(above_peak[k]), 2),
                                   "peakTime": times[int(peak_frame[k])],
                                   "firstTime": times[int(first_frame[mask].min())], "lastTime": times[int(last_frame[mask].max())],
                                   "roadHeightM": round(float(line["z"][k]), 2), "onStructure": deck,
                                   "coarsestFaceM": round(float(face_res[run].max()), 1),
                                   # Fine faces can resolve a road; a coarse face only says water is near this height nearby.
                                   "faceSupport": "fine" if face_res[run].max() <= FINE_FACE_M else "coarse",
                                   "lowestRoadCheckM": round(float(np.nanmin(line["z"][run])), 2)}})
    return out


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "refined-full-compact-41344983607"
    package = DATA / name
    manifest = json.loads((package / "manifest.json").read_text())
    road_manifest = json.loads((HEIGHTS / "manifest.json").read_text())
    polys, area, res = load_faces(package)
    times = [f["time"] for f in manifest["frames"]]
    outdir = HEIGHTS / "flood" / manifest["runId"]
    outdir.mkdir(parents=True, exist_ok=True)

    all_files = road_manifest["files"]
    loaded = [(f, decode_lines(HEIGHTS / f["path"])[1]) for f in all_files]
    lines = [l for _, ls in loaded for l in ls]
    lon, lat = np.concatenate([l["lon"] for l in lines]), np.concatenate([l["lat"] for l in lines])
    face = locate(lon, lat, polys)
    z =np.concatenate([l["z"] for l in lines])

    above = np.full((len(times), len(z)), np.nan, dtype="f4")
    for fi, fr in enumerate(manifest["frames"]):
        _, c = read_columns(package / fr["path"])
        wse, vol = c["waterSurfaceM"], c["nativeVolumeM3"]
        depth = np.where(np.isnan(vol), np.nan, np.maximum(vol, 0) / area)
        hit = face >= 0
        wet = depth[face[hit]] >= FACE_WET_M
        vals = wse[face[hit]].astype("f8") - z[hit]
        vals[~wet] = np.nan
        above[fi, hit] = vals.astype("f4")
        print(f"frame {fi + 1}/{len(times)}", flush=True) if fi % 14 == 0 else None

    with np.errstate(invalid="ignore"):
        counted = above >= ABOVE_ROAD_M
    any_counted = counted.any(0)
    peak = np.nan_to_num(np.where(counted, above, np.nan), nan=-1e9)
    peak_val, peak_frame = peak.max(0), peak.argmax(0)
    first = counted.argmax(0)
    last = len(times) - 1 - counted[::-1].argmax(0)

    features, pos = [], 0
    for l in lines:
        k = len(l["z"])
        lr = res[np.maximum(face[pos:pos + k], 0)]
        features += stretches_of(l, peak_val[pos:pos + k], peak_frame[pos:pos + k], first[pos:pos + k], last[pos:pos + k], lr, times)
        l["_pos"] = pos
        pos += k
    geo = {"type": "FeatureCollection", "metadata": {
        "runId": manifest["runId"], "executionMode": manifest["executionMode"],
        "meaning": "Modeled water level above estimated road height somewhere in the time window. Not an observation, closure or measured road depth.",
        "aboveRoadThresholdM": ABOVE_ROAD_M, "faceWetThresholdM": FACE_WET_M,
        "limits": ["Water levels are per model face (6.25 to 100 m); a level above a road in the same face does not prove water reaches it.",
                   "The model's terrain is coarser than these road heights, so narrow embankments may not block water in the model as they do on the ground.",
                   "Stations outside the model have no result and are not dry."]},
        "features": features}
    (outdir / "stretches.geojson").write_text(json.dumps(geo, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")

    # Sparse frames so a map can animate without opening 57 full model frames: only stations ever above the road.
    ever = np.flatnonzero(any_counted)
    cm = np.where(np.isfinite(above[:, ever]), np.clip(np.rint(above[:, ever] * 100), -32000, 32000), NULL_CM).astype("<i2")
    blob = [ever.astype("<u4").tobytes(), cm.tobytes(), face.astype("<i4").tobytes()]
    head = json.dumps({"format": "floodplain-road-flood-v1", "runId": manifest["runId"], "times": times,
                       "stationCount": int(len(face)), "everAboveCount": int(ever.size), "nullCm": NULL_CM,
                       "stationOrder": [f["path"] for f in all_files],
                       "columns": ["everAboveStation:u4[everAboveCount]", "aboveRoadCm:i2[frames*everAboveCount, frame first]", "stationFace:i4[stationCount], -1 outside model"]},
                      separators=(",", ":")).encode()
    data = gzip.compress(len(head).to_bytes(4, "little") + head + b"".join(blob), 9, mtime=0)
    (outdir / "frames.bin.gz").write_bytes(data)

    inside_len = lambda mask: int(mask.sum())
    route_mask = np.concatenate([np.full(len(l["z"]), l["kind"] == "route") for l in lines])
    free_mask = np.concatenate([np.full(len(l["z"]), l["kind"] == "freeway") for l in lines])
    summary = {"schemaVersion": 1, "runId": manifest["runId"], "stations": int(len(face)),
               "stationsInsideModel": inside_len(face >= 0), "stationsOutsideModel": inside_len(face < 0),
               "routeStationsInsideModel": inside_len(route_mask & (face >= 0)), "routeStations": inside_len(route_mask),
               "freewayStationsInsideModel": inside_len(free_mask & (face >= 0)), "freewayStations": inside_len(free_mask),
               "stretches": len(features), "routeStretches": sum(f["properties"]["kind"] == "route" for f in features),
               "freewayStretches": sum(f["properties"]["kind"] == "freeway" for f in features),
               "frames": {"path": "frames.bin.gz", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)},
               "stretchesFile": {"path": "stretches.geojson", "sha256": hashlib.sha256((outdir / "stretches.geojson").read_bytes()).hexdigest()},
               "packageManifestSha256": hashlib.sha256((package / "manifest.json").read_bytes()).hexdigest(),
               "roadManifestSha256": hashlib.sha256((HEIGHTS / "manifest.json").read_bytes()).hexdigest()}
    (outdir / "summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("frames", "stretchesFile")}))


if __name__ == "__main__":
    main()
