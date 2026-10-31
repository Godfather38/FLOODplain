"""Route the commute options and find every waterway crossing on each.

Inputs (from tools/fetch_overture.py, Overture release 2026-10-21.0):
  segments.parquet  transportation/segment
  water.parquet     base/water
Outputs:
  public/data/routes.geojson     one LineString per route + summary
  public/data/crossings.geojson  one Point per road/waterway crossing

Usage: python3 tools/build_routes.py DATA_DIR
"""
import json
import sys
from pathlib import Path

import networkx as nx
import pyarrow.parquet as pq
import shapely
from shapely.geometry import mapping
from shapely.ops import linemerge

sys.path.insert(0, str(Path(__file__).parent))
from roadgraph import load_graph, nearest_node, path_edges, summarize  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WATER_KINDS = {"stream", "river"}  # canals/ditches are engineered, not flash-flood dips


def load_water(path):
    out = []
    for r in pq.read_table(path).to_pylist():
        if r["subtype"] not in WATER_KINDS and r["class"] not in WATER_KINDS:
            continue
        g = shapely.from_wkb(r["geometry"])
        if g.geom_type.endswith("Polygon"):
            g = g.boundary
        out.append((g, (r["names"] or {}).get("primary"), r["id"]))
    return out


def route(g, origin, waypoints, ramps):
    path = [origin]
    for name, lon, lat in waypoints:
        n = nearest_node(g, lon, lat, on_names={name})
        path += nx.dijkstra_path(g, path[-1], n, weight="time")[1:]
    dist, paths = nx.single_source_dijkstra(g, path[-1], weight="time")
    end = min(ramps, key=lambda n: dist.get(n, float("inf")))
    return path + paths[end][1:]


def crossings(g, path, water, tree):
    found, along = [], 0.0
    for _, _, d in path_edges(g, path):
        for i in tree.query(d["geom"], predicate="intersects"):
            wg, wname, wid = water[i]
            pt = d["geom"].intersection(wg).representative_point()
            found.append({
                "km": round((along + d["length"] / 2) / 1000, 2),
                "road": d["name"], "water": wname, "water_id": wid,
                "bridge_tagged": d["bridge"], "lon": round(pt.x, 5), "lat": round(pt.y, 5),
            })
        along += d["length"]
    # Collapse repeat hits on the same waterway within 150 m (braided channels).
    merged = []
    for c in found:
        if merged and (merged[-1]["water"] or "") == (c["water"] or "") and c["km"] - merged[-1]["km"] < 0.15:
            merged[-1]["bridge_tagged"] = merged[-1]["bridge_tagged"] or c["bridge_tagged"]
            continue
        merged.append(c)
    return merged


def main(data_dir):
    data_dir = Path(data_dir)
    cfg = json.loads((ROOT / "tools/routes.json").read_text())
    g = load_graph(data_dir / "segments.parquet")
    water = load_water(data_dir / "water.parquet")
    tree = shapely.STRtree([w[0] for w in water])
    ramps = [n for n in g if any(g[n][m]["cls"] == "motorway" for m in g[n])]
    route_feats, cross_feats = [], []
    for area in cfg["areas"]:
        o = area["origin"]
        origin = nearest_node(g, o["lon"], o["lat"])
        for r in area["routes"]:
            p = route(g, origin, r["waypoints"], ramps)
            legs = summarize(g, p)
            line = linemerge([d["geom"] for _, _, d in path_edges(g, p)])
            xs = crossings(g, p, water, tree)
            route_feats.append({"type": "Feature", "geometry": mapping(line), "properties": {
                "id": r["id"], "area": area["id"], "name": r["name"],
                "km": round(sum(l[1] for l in legs) / 1000, 1),
                "minutes": round(sum(l[2] for l in legs) / 60, 1),
                "legs": [{"road": n, "km": round(m / 1000, 1)} for n, m, _ in legs],
                "crossings": len(xs),
                "untagged_crossings": sum(not c["bridge_tagged"] for c in xs),
            }})
            for c in xs:
                cross_feats.append({"type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
                    "properties": {"route": r["id"], **{k: v for k, v in c.items() if k not in ("lon", "lat")}}})

    out = ROOT / "public/data"
    out.mkdir(parents=True, exist_ok=True)
    meta = {"source": "Overture Maps 2026-10-21.0 (OpenStreetMap contributors, ODbL)", "hubs": {a["id"]: a["origin"]["name"] for a in cfg["areas"]}}
    for name, feats in (("routes", route_feats), ("crossings", cross_feats)):
        (out / f"{name}.geojson").write_text(json.dumps(
            {"type": "FeatureCollection", "metadata": meta, "features": feats}, indent=1))
    for f in route_feats:
        p = f["properties"]
        print(f"{p['name']}: {p['km']} km, {p['minutes']} min, {p['crossings']} crossings "
              f"({p['untagged_crossings']} with no bridge tag)")


if __name__ == "__main__":
    main(sys.argv[1])
