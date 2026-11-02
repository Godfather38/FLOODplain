"""Draw road height against the highest modeled water along Avra Valley Rd. For checking, not for the app."""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import flood_overlay as fo
from encoding import FLAG, decode_lines

M2FT = 1 / 0.3048
INK, MUTED, GRID, ROAD, WATER, DECK = "#1f2933", "#66707a", "#e4e7eb", "#3d4852", "#2a78c2", "#c2571a"
out = Path(sys.argv[1])
package = fo.DATA / "refined-full-compact-41344983607"
manifest = json.loads((package / "manifest.json").read_text())
_, lines = decode_lines(fo.HEIGHTS / "routes.bin.gz")
line = next(l for l in lines if l["routeId"] == "avra")
polys, area, _ = fo.load_faces(package)
face = fo.locate(line["lon"], line["lat"], polys)
peak = np.full(len(face), np.nan)
for fr in manifest["frames"]:
    _, c = fo.read_columns(package / fr["path"])
    depth = np.where(np.isnan(c["nativeVolumeM3"]), np.nan, np.maximum(c["nativeVolumeM3"], 0) / area)
    hit = face >= 0
    wse = c["waterSurfaceM"][face[hit]].astype("f8")
    wse[~(depth[face[hit]] >= fo.FACE_WET_M)] = np.nan
    cur = peak[hit]
    peak[hit] = np.fmax(cur, wse)

s, z = line["s"] / 1000, line["z"]
deck = (line["flags"] & FLAG["deck_lidar"]) > 0
panels = [("Brawley Wash dip: road is at grade, water reaches it", 4.6, 6.0), ("Santa Cruz River bridge: lidar deck stands clear", 19.0, 20.0)]
fig, axes = plt.subplots(2, 1, figsize=(10, 7), dpi=150)
for ax, (title, a, b) in zip(axes, panels):
    m = (s >= a) & (s <= b)
    ax.plot(s[m], z[m] * M2FT, color=ROAD, lw=2, label="Road height")
    ax.plot(s[m & deck], z[m & deck] * M2FT, color=DECK, lw=3.5, label="Measured bridge deck (lidar)")
    ax.plot(s[m], peak[m] * M2FT, color=WATER, lw=1.6, label="Highest modeled water, Nov 1-2 run")
    ax.fill_between(s[m], z[m] * M2FT, peak[m] * M2FT, where=peak[m] > z[m], color=WATER, alpha=.35, interpolate=True, label="Water above road")
    ax.set_title(title, loc="left", color=INK, fontsize=12)
    ax.set_ylabel("Feet above sea level (NAVD88)", color=MUTED)
    ax.grid(axis="y", color=GRID)
    ax.spines[["top", "right"]].set_visible(False)
    ax.tick_params(colors=MUTED)
    ax.legend(frameon=False, fontsize=9, loc="best")
axes[1].set_xlabel("Kilometres along Avra Valley Rd route", color=MUTED)
fig.tight_layout()
fig.savefig(out)
