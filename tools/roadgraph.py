"""Build a drivable road graph from Overture transportation segments.

Each Overture segment lists the connectors (junctions) along it with a
fractional position `at` (0..1). We split segment geometry at those
positions so every graph edge runs junction-to-junction, with travel time as
the weight. Pure Python: shapely + networkx.
"""
import math

import networkx as nx
import pyarrow.parquet as pq
import shapely
from shapely.ops import substring

# Rough free-flow speeds (km/h) by Overture road class.
SPEED = {
    "motorway": 105, "trunk": 90, "primary": 72, "secondary": 65, "tertiary": 56,
    "unclassified": 50, "residential": 40, "living_street": 20, "service": 20,
    "track": 25, "unknown": 35,
}
DRIVABLE = set(SPEED)


def geod_len_m(line):
    """Length in metres of a lon/lat LineString (equirectangular, fine at this scale)."""
    coords = list(line.coords)
    total = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        ky = 111_320.0
        kx = ky * math.cos(math.radians((y1 + y2) / 2))
        total += math.hypot((x2 - x1) * kx, (y2 - y1) * ky)
    return total


def surface_at(rules):
    for r in rules or []:
        if r.get("between") is None:
            return r.get("value")
    return (rules or [{}])[0].get("value") if rules else None


def is_bridge(flags):
    return any("is_bridge" in (f.get("values") or []) for f in flags or [])


def load_graph(segments_path):
    rows = pq.read_table(segments_path).to_pylist()
    g = nx.Graph()
    for r in rows:
        if r["subtype"] != "road" or r["class"] not in DRIVABLE:
            continue
        line = shapely.from_wkb(r["geometry"])
        conns = sorted(r["connectors"] or [], key=lambda c: c["at"])
        if len(conns) < 2:
            continue
        name = (r["names"] or {}).get("primary")
        surface = surface_at(r["road_surface"])
        bridge = is_bridge(r["road_flags"])
        speed = SPEED[r["class"]]
        if surface in ("gravel", "dirt", "unpaved"):
            speed = min(speed, 40)
        for a, b in zip(conns, conns[1:]):
            if b["at"] <= a["at"]:
                continue
            piece = substring(line, a["at"], b["at"], normalized=True)
            length = geod_len_m(piece)
            u, v = a["connector_id"], b["connector_id"]
            attrs = dict(
                seg=r["id"], name=name, cls=r["class"], surface=surface, bridge=bridge,
                length=length, time=length / (speed / 3.6), geom=piece,
            )
            # Keep the faster of parallel edges.
            if not g.has_edge(u, v) or g[u][v]["time"] > attrs["time"]:
                g.add_edge(u, v, **attrs)
    # Node coordinates from edge endpoints.
    for u, v, d in g.edges(data=True):
        c = list(d["geom"].coords)
        g.nodes[u].setdefault("xy", c[0])
        g.nodes[v].setdefault("xy", c[-1])
    # Drop disconnected fragments.
    biggest = max(nx.connected_components(g), key=len)
    return g.subgraph(biggest).copy()


def nearest_node(g, lon, lat, on_names=None):
    best, bd = None, float("inf")
    for n, d in g.nodes(data=True):
        if on_names is not None and not any(
            g[n][m]["name"] in on_names for m in g[n]
        ):
            continue
        x, y = d["xy"]
        dd = (x - lon) ** 2 + ((y - lat) / math.cos(math.radians(lat))) ** 2
        if dd < bd:
            best, bd = n, dd
    return best


def path_edges(g, path):
    return [(u, v, g[u][v]) for u, v in zip(path, path[1:])]


def summarize(g, path):
    """Collapse a node path into named legs: [(name, metres, seconds)]."""
    legs = []
    for _, _, d in path_edges(g, path):
        name = d["name"] or "(unnamed road)"
        if legs and legs[-1][0] == name:
            legs[-1][1] += d["length"]
            legs[-1][2] += d["time"]
        else:
            legs.append([name, d["length"], d["time"]])
    return legs
