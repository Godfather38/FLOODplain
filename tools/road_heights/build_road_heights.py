"""Build the road height package: routes and freeway every 5 m, other public roads every 10 m.

Sources are free and need no key: Overture road centrelines, USGS 3DEP 1 m DEM
tiles and USGS 3DEP lidar. Everything fetched is cached under data/ (git-ignored).

Usage: python tools/road_heights/build_road_heights.py [--stage roads|structures|package] [--no-area]
"""
import argparse
import hashlib
import json
import pickle
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import shapely
from pyproj import Transformer
from shapely.ops import substring

sys.path.insert(0, str(Path(__file__).parent))
import bridges as br
import dem as demlib
from encoding import FLAG, encode_lines
from ept import Ept

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "data/road-heights-work"
OUT = ROOT / "public/simulation/data/road-heights"
BOX = (-111.42, 32.16, -110.93, 32.52)
DEM_BOX = (BOX[0], BOX[1], BOX[2], BOX[3] + 0.08)  # Freeway segments run past the box's north edge.
OVERTURE_RELEASE = "2026-10-21.0"
LIDAR_PROJECT = "AZ_PimaCo_2_2021"
AREA_CLASSES = {"trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street"}
BRIDGE_CLASSES = AREA_CLASSES | {"motorway"}
LATERAL = np.array([-3.0, -1.5, 0.0, 1.5, 3.0])
GRID_DEG = 0.1
APPLY_NEAR_M, APPLY_ANGLE_DEG = 3.0, 35.0

to_utm = Transformer.from_crs(4326, 32612, always_xy=True).transform
to_ll = Transformer.from_crs(32612, 4326, always_xy=True).transform


def utm(coords):
    c = np.asarray(coords, "f8")[:, :2]
    return np.c_[to_utm(c[:, 0], c[:, 1])]


def stations(xy, step):
    pts, s = br.resample(xy, step)
    return pts, s


def bridge_ranges(flags):
    """(from, to) fractions of a segment flagged is_bridge."""
    return [tuple(f.get("between") or (0.0, 1.0)) for f in flags or [] if "is_bridge" in (f.get("values") or [])]


def load_segments():
    rows = pq.read_table(ROOT / "data/overture/segments.parquet").to_pylist()
    return [r for r in rows if r["subtype"] == "road"]


def label(r):
    for x in r.get("routes") or []:
        if x.get("ref"):
            return f"I-{x['ref']}" if "US:I" in (x.get("network") or "") else x["ref"]
    return (r["names"] or {}).get("primary")


def build_lines(segments, include_area):
    lines = []
    routes = json.loads((ROOT / "public/data/routes.geojson").read_text())
    for f in routes["features"]:
        g, seen = f["geometry"], set()
        for part in ([g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]):
            key = json.dumps(part)
            if key in seen:  # pr-ina repeats each part in routes.geojson.
                continue
            seen.add(key)
            pts, s = stations(utm(part), 5.0)
            lines.append({"name": f["properties"]["name"], "kind": "route", "routeId": f["properties"]["id"],
                          "xy": pts, "s": s, "tier": "routes"})
    for r in segments:
        cls = r["class"]
        if cls != "motorway" and not (include_area and cls in AREA_CLASSES):
            continue
        xy = utm(shapely.get_coordinates(shapely.from_wkb(r["geometry"])))
        step = 5.0 if cls == "motorway" else 10.0
        pts, s = stations(xy, step)
        lines.append({"name": label(r), "kind": "freeway" if cls == "motorway" else cls, "routeId": None,
                      "segmentId": r["id"], "xy": pts, "s": s, "tier": "routes" if cls == "motorway" else "area"})
    return lines


def sample_lines(lines):
    n = sum(len(l["xy"]) for l in lines)
    xy = np.vstack([l["xy"] for l in lines])
    tangent = np.vstack([np.gradient(l["xy"], axis=0) if len(l["xy"]) > 1 else np.array([[1.0, 0.0]]) for l in lines])
    tangent /= np.maximum(np.hypot(*tangent.T)[:, None], 1e-6)
    normal = np.c_[-tangent[:, 1], tangent[:, 0]]
    grid = xy[:, None, :] + LATERAL[None, :, None] * normal[:, None, :]
    lon, lat = to_ll(grid[..., 0].ravel(), grid[..., 1].ravel())
    z, src, projects = demlib.sample(lon, lat, ROOT / "data/dem-cache", DEM_BOX)
    z = z.reshape(n, len(LATERAL))
    src = src.reshape(n, len(LATERAL))
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore", RuntimeWarning)
        centre = np.nanmedian(z, axis=1)
        spread = np.nanmax(z, axis=1) - np.nanmin(z, axis=1)
    pos = 0
    for l in lines:
        k = len(l["xy"])
        l["z"], l["lateral"] = centre[pos:pos + k], spread[pos:pos + k]
        l["source"] = src[pos:pos + k, 2].astype("i1")
        l["flags"] = np.zeros(k, "u1")
        pos += k
    return projects


def dem_at(xy):
    lon, lat = to_ll(xy[:, 0], xy[:, 1])
    z, _, _ = demlib.sample(lon, lat, ROOT / "data/dem-cache", DEM_BOX, log=lambda *_: None)
    return z


def candidate_spans(segments, lines):
    spans = []
    for r in segments:
        if r["class"] not in BRIDGE_CLASSES:
            continue
        for a, b in bridge_ranges(r["road_flags"]):
            line = shapely.from_wkb(r["geometry"])
            part = substring(line, a, b, normalized=True)
            xy = utm(shapely.get_coordinates(part))
            if len(xy) >= 2 and np.hypot(*(xy[-1] - xy[0])) > 2:
                spans.append({"origin": "map_tag", "segmentId": r["id"], "name": label(r), "class": r["class"], "xy": xy})
    for l in lines:  # Only routes and freeway get the untagged search; it needs extra lidar reads.
        if l["tier"] != "routes":
            continue
        step = 5.0
        for i, j in br.notches(l["z"], step):
            a, b = max(i, 0), min(j, len(l["xy"]) - 1)
            if b - a >= 2:
                spans.append({"origin": "dem_notch", "segmentId": None, "name": l["name"], "class": l["kind"],
                              "routeId": l.get("routeId"), "xy": l["xy"][a:b + 1]})
    return spans


def measure_all(spans):
    ept = Ept(LIDAR_PROJECT, ROOT / "data/lidar-cache", max_depth=10)
    # DEM sampling opens tiles per call; memoising by rounded point keeps repeat approaches cheap.
    done = []
    def one(sp):
        try:
            m = br.measure(sp["xy"], ept, dem_at)
        except Exception as exc:
            m = {"kind": "failed", "error": str(exc)[:200], "xy": sp["xy"], "z": np.full(len(sp["xy"]), np.nan)}
        return {**sp, "profile": m}
    with ThreadPoolExecutor(6) as ex:
        for i, res in enumerate(ex.map(one, spans)):
            done.append(res)
            if i % 25 == 0:
                print(f"structures {i}/{len(spans)}", flush=True)
    return done


def apply_structures(lines, structures):
    usable = [s for s in structures if s["profile"]["kind"] == "lidar"
              or (s["origin"] == "map_tag" and s["profile"]["kind"] == "approach")]
    if not usable:
        return
    geoms = [shapely.LineString(s["profile"]["xy"]) for s in usable]
    tree = shapely.STRtree(geoms)
    for l in lines:
        xy, k = l["xy"], len(l["xy"])
        if k < 2:
            continue
        t = np.gradient(xy, axis=0)
        pts = shapely.points(xy)
        pi, gi = tree.query(pts, predicate="dwithin", distance=APPLY_NEAR_M)
        best_rank = np.full(k, -1)
        for p, g in zip(pi, gi):
            s = usable[g]
            prof, geom = s["profile"], geoms[g]
            along = geom.project(pts[p])
            eps = 1.0
            a, b = geom.interpolate(max(along - eps, 0)), geom.interpolate(min(along + eps, geom.length))
            dir_ = np.array([b.x - a.x, b.y - a.y])
            cos = abs(dir_ @ t[p]) / max(np.hypot(*dir_) * np.hypot(*t[p]), 1e-9)
            if cos < np.cos(np.radians(APPLY_ANGLE_DEG)):
                continue  # Crossing under or over this structure, not travelling along it.
            rank = 2 if prof["kind"] == "lidar" else 1
            if rank <= best_rank[p]:
                continue
            d = np.r_[0, np.cumsum(np.hypot(*np.diff(prof["xy"], axis=0).T))]
            value = float(np.interp(along, d, prof["z"]))
            if not np.isfinite(value):
                continue
            best_rank[p] = rank
            l["z"][p] = value
            l["flags"][p] = FLAG["deck_lidar"] if rank == 2 else FLAG["deck_approach"]
            if s["origin"] == "dem_notch":
                l["flags"][p] |= FLAG["structure_untagged"]


def structure_summary(structures):
    out = []
    for s in structures:
        p, c = s["profile"], np.asarray(s["profile"]["xy"]).mean(0)
        lon, lat = to_ll(c[0], c[1])
        if s["origin"] == "dem_notch" and p["kind"] != "lidar":
            continue  # A dip with no deck points is a real low spot, not a structure.
        out.append({"origin": s["origin"], "segmentId": s.get("segmentId"), "name": s.get("name"), "class": s.get("class"),
                    "routeId": s.get("routeId"), "lon": round(lon, 6), "lat": round(lat, 6), "kind": p["kind"],
                    "lengthM": p.get("lengthM"), "deckPoints": p.get("deckPoints"), "coverage": p.get("coverage"),
                    "deckMedianM": p.get("deckMedianM"), "approachM": p.get("approachM"),
                    "lidarMinusApproachM": p.get("lidarMinusApproachM"), "error": p.get("lidarError") or p.get("error")})
    return out


def finish(line):
    lon, lat = to_ll(line["xy"][:, 0], line["xy"][:, 1])
    line["lon"], line["lat"] = np.asarray(lon), np.asarray(lat)
    return line


METADATA = {
    "elevation": "metres NAVD88, 1 cm quantisation. Same vertical reference as model water surface.",
    "road": "Median of five bare-earth samples across the centreline (-3 to +3 m). A height, not a survey of the pavement.",
    "deck": "Bridge stations use median USGS lidar bridge-deck-class points within 4 m, or a line between approaches if lidar is absent; see flags.",
    "flags": FLAG,
    "lateralDm": "Highest minus lowest cross-road sample, decimetres. Large values mean a slope, ditch or centreline offset; 255 is null.",
    "unknown": "Missing heights stay unknown (no_terrain flag). Never read a missing value as zero or dry.",
    "attribution": ["USGS 3DEP (public domain)", "Overture Maps Foundation / OpenStreetMap contributors (ODbL)"],
}


def package(lines, projects, structures):
    OUT.mkdir(parents=True, exist_ok=True)
    for l in lines:
        finish(l)
    meta = {**METADATA, "sourceProjects": projects, "overtureRelease": OVERTURE_RELEASE, "lidarProject": LIDAR_PROJECT}
    tier1 = [l for l in lines if l["tier"] == "routes"]
    files = [{"tier": "routes", **encode_lines(OUT / "routes.bin.gz", tier1, meta)}]
    area = [l for l in lines if l["tier"] == "area"]
    cells = {}
    for l in area:
        key = (int(np.floor(l["lon"].mean() / GRID_DEG)), int(np.floor(l["lat"].mean() / GRID_DEG)))
        cells.setdefault(key, []).append(l)
    for (cx, cy), group in sorted(cells.items()):
        name = f"area_{cx}_{cy}.bin.gz".replace("-", "m")
        files.append({"tier": "area", "box": [cx * GRID_DEG, cy * GRID_DEG, (cx + 1) * GRID_DEG, (cy + 1) * GRID_DEG],
                      **encode_lines(OUT / name, group, meta)})
    summary = structure_summary(structures)
    (OUT / "structures.json").write_text(json.dumps({"schemaVersion": 1, "lidarProject": LIDAR_PROJECT, "structures": summary}, indent=0) + "\n")
    manifest = {"schemaVersion": 1, "kind": "road_height_package", "box": BOX, "files": files, "metadata": meta,
                "structures": {"path": "structures.json", "sha256": hashlib.sha256((OUT / "structures.json").read_bytes()).hexdigest()}}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


def checkpoint(name, obj=None):
    path = WORK / f"{name}.pkl"
    if obj is None:
        return pickle.loads(path.read_bytes())
    WORK.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pickle.dumps(obj))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["roads", "structures", "package"], default="roads")
    ap.add_argument("--no-area", action="store_true")
    args = ap.parse_args()
    if args.stage == "roads":
        segments = load_segments()
        lines = build_lines(segments, not args.no_area)
        print("lines", len(lines), "stations", sum(len(l["xy"]) for l in lines), flush=True)
        projects = sample_lines(lines)
        checkpoint("roads", (lines, projects))
    if args.stage in ("roads", "structures"):
        lines, projects = checkpoint("roads")
        spans = candidate_spans(load_segments(), lines)
        print("candidate spans", len(spans), flush=True)
        structures = measure_all(spans)
        checkpoint("structures", structures)
    lines, projects = checkpoint("roads")
    structures = checkpoint("structures")
    apply_structures(lines, structures)
    manifest = package(lines, projects, structures)
    print(json.dumps({"files": len(manifest["files"]), "bytes": sum(f["bytes"] for f in manifest["files"]),
                      "stations": sum(f["stationCount"] for f in manifest["files"])}))


if __name__ == "__main__":
    main()
