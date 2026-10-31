"""Render docs/routes.png from the Overture extract and built route GeoJSON."""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402
import shapely  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
data = Path(sys.argv[1])
W, S, E, N = -111.335, 32.375, -111.115, 32.475
COLORS = {"trico": "#d1495b", "avra": "#edae49", "silverbell-north": "#00798c", "silverbell-south": "#6a4c93"}

fig, ax = plt.subplots(figsize=(13, 7.5), dpi=130)
ax.set_facecolor("#f7f5f0")
box = shapely.box(W, S, E, N)
for r in pq.read_table(data / "water.parquet").to_pylist():
    g = shapely.from_wkb(r["geometry"])
    if not g.intersects(box) or r["subtype"] not in ("stream", "river", "canal"):
        continue
    if g.geom_type.endswith("Polygon"):
        g = g.boundary
    big = r["subtype"] == "river" or (r["names"] or {}).get("primary") in ("Santa Cruz River", "Brawley Wash", "Los Robles Wash")
    for part in getattr(g, "geoms", [g]):
        x, y = part.xy
        ax.plot(x, y, color="#4a90c2" if r["subtype"] != "canal" else "#8fb3c9",
                lw=1.6 if big else 0.5, alpha=0.9 if big else 0.6, zorder=1)
for r in pq.read_table(data / "segments.parquet", columns=["subtype", "class", "geometry"]).to_pylist():
    if r["subtype"] != "road" or r["class"] not in ("motorway", "trunk", "primary", "secondary", "tertiary"):
        continue
    g = shapely.from_wkb(r["geometry"])
    if g.intersects(box):
        x, y = g.xy
        ax.plot(x, y, color="#555" if r["class"] == "motorway" else "#bbb", lw=2.2 if r["class"] == "motorway" else 0.8, zorder=2)

routes = json.loads((ROOT / "public/data/routes.geojson").read_text())["features"]
for i, f in enumerate(routes):
    p = f["properties"]
    g = shapely.geometry.shape(f["geometry"])
    off = (i - 1.5) * 0.00045
    for part in getattr(g, "geoms", [g]):
        x, y = part.xy
        ax.plot([a + off for a in x], [b + off for b in y], color=COLORS[p["id"]], lw=3, alpha=0.85, zorder=3,
                label=f"{p['name']} ({p['km']} km, ~{p['minutes']:.0f} min)")
seen = set()
for f in json.loads((ROOT / "public/data/crossings.geojson").read_text())["features"]:
    p = f["properties"]
    x, y = f["geometry"]["coordinates"]
    key = (round(x, 3), round(y, 3))
    if key in seen:
        continue
    seen.add(key)
    dip = not p["bridge_tagged"]
    ax.scatter([x], [y], s=110 if dip else 60, marker="v" if dip else "s", zorder=5,
               color="#c0392b" if dip else "white", edgecolors="black", linewidths=1)
    if p["water"]:
        ax.annotate(p["water"] + ("\n(no bridge tag)" if dip else " bridge"), (x, y), xytext=(6, 8),
                    textcoords="offset points", fontsize=8, zorder=6,
                    bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=0.8))
for name, (x, y) in {"I-10": (-111.17, 32.445), "Avra Valley Rd": (-111.26, 32.392), "W Silverbell Rd": (-111.275, 32.437),
                     "Trico Rd": (-111.303, 32.415), "Sanders Rd": (-111.232, 32.418), "Marana Rd": (-111.245, 32.462)}.items():
    ax.text(x, y, name, fontsize=8, color="#333", style="italic", zorder=6)
ax.scatter([-111.3045], [32.4295], marker="*", s=220, color="black", zorder=7)
ax.annotate("Start: El Tiro & Trico", (-111.3045, 32.4295), xytext=(8, -12), textcoords="offset points", fontsize=8, weight="bold")
ax.set_xlim(W, E); ax.set_ylim(S, N); ax.set_aspect(1 / 0.844)
ax.set_xticks([]); ax.set_yticks([])
ax.legend(loc="lower right", fontsize=8, framealpha=0.95)
ax.set_title("Avra Valley to I-10: routes and wash/river crossings  (Overture Maps 2026-10-21 / OpenStreetMap)", fontsize=10)
fig.tight_layout()
fig.savefig(ROOT / "docs/routes.png")
