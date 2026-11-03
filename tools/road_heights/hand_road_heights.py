"""Road height above the HAND stream bed at each supported crossing, for the live wash check.

The bed comes from measured ground minus HAND at channel cells beside the
crossing, so the road's own height (bridge decks included) is what stage gets
compared with. Crossings where the bed cannot be pinned down are left unresolved.

Usage: python tools/road_heights/hand_road_heights.py TARGET_REPO_ROOT
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import dem as demlib
from encoding import FLAG, decode_lines

ROOT = Path(__file__).resolve().parents[2]
NEAR_M = 40.0
CHANNEL_M, CHANNEL_HAND_CM = 60.0, 30
NEAREST_CHANNEL_CELLS, MAX_NEAR_SPREAD_M, MAX_NEAR_DIFFERENCE_M = 9, 1.5, 1.0
MAX_BED_SPREAD_M = 2.5  # A wider spread means the stream bed slopes through the window, so no single bed height holds.
DEM_BOX = (-111.42, 32.16, -110.93, 32.60)


def main():
    target = Path(sys.argv[1]) / "public/inundation/data"
    output = Path(sys.argv[1]) / "public/inundation/road-heights.json"
    coverage = json.loads((target / "coverage.json").read_text())
    _, lines = decode_lines(ROOT / "public/simulation/data/road-heights/routes.bin.gz")
    out, skipped = {}, {}
    for row in coverage["points"]:
        if row["status"] != "supported":
            continue
        j = json.loads((target / row["file"]).read_text())
        g = j["grid"]
        hand = np.frombuffer(base64.b64decode(g["handCm"]), "<u2").reshape(g["rows"], g["cols"])
        lat0 = np.cos(np.radians(row["lat"]))
        near = []
        for l in lines:
            if l["kind"] != "route" or l["routeId"] not in row["routes"]:
                continue
            d = np.hypot((l["lon"] - row["lon"]) * 111320 * lat0, (l["lat"] - row["lat"]) * 110574)
            m = d <= NEAR_M
            if m.any():
                near.append((l["lon"][m], l["lat"][m], l["z"][m], l["flags"][m]))
        if not near:
            continue
        lon, lat, z, flags = (np.concatenate(x) for x in zip(*near))
        ok = np.isfinite(z)
        z, flags = z[ok], flags[ok]
        # The channel itself: grid cells barely above drainage, right beside the crossing.
        cols, rows = np.meshgrid(np.arange(g["cols"]), np.arange(g["rows"]))
        clon, clat = g["lonMin"] + (cols + 0.5) * g["dLon"], g["latMax"] - (rows + 0.5) * g["dLat"]
        dist = np.hypot((clon - row["lon"]) * 111320 * lat0, (clat - row["lat"]) * 110574)
        chan = (dist <= CHANNEL_M) & (hand <= CHANNEL_HAND_CM) & (hand != g["handNodata"])
        if not chan.any():
            skipped[row["id"]] = {"reason": "no channel cells beside the crossing"}
            continue
        ground, _, _ = demlib.sample(clon[chan], clat[chan], ROOT / "data/dem-cache", DEM_BOX, log=lambda *_: None)
        beds = ground - hand[chan] / 100
        bed = float(np.nanmedian(beds))
        spread = float(np.nanmax(beds) - np.nanmin(beds))
        # Channels slope. If the whole window varies too much, the cells nearest the crossing can
        # still pin the bed down, as long as they agree with each other and with the window.
        if spread > MAX_BED_SPREAD_M:
            nearest = beds[np.argsort(dist[chan])[:NEAREST_CHANNEL_CELLS]]
            near_bed = float(np.nanmedian(nearest))
            near_spread = float(np.nanmax(nearest) - np.nanmin(nearest))
            if near_spread <= MAX_NEAR_SPREAD_M and abs(near_bed - bed) <= MAX_NEAR_DIFFERENCE_M:
                bed, spread = near_bed, near_spread
        if not np.isfinite(bed) or spread > MAX_BED_SPREAD_M or z.min() - bed < 0:
            skipped[row["id"]] = {"reason": "bed height not consistent here", "bedSpreadM": round(spread, 2),
                                  "roadMinusBedM": round(float(z.min()) - bed, 2)}
            continue
        low = int(np.argmin(z))
        out[row["id"]] = {"roadM": round(float(z[low]), 2), "bedM": round(bed, 2), "roadAboveBedM": round(float(z[low]) - bed, 2),
                          "deck": bool(flags[low] & (FLAG["deck_lidar"] | FLAG["deck_approach"]))}
    doc = {"schemaVersion": 1, "datum": "NAVD88",
           "method": "Lowest road height within 40 m of the crossing, minus the HAND stream bed (measured ground minus HAND at channel cells within 60 m).",
           "sources": ["USGS 3DEP 1 m DEM", "USGS 3DEP lidar bridge deck points", "NOAA OWP HAND"], "points": out, "unresolved": skipped}
    output.write_text(json.dumps(doc, indent=1) + "\n")
    print(json.dumps({**out, "UNRESOLVED": skipped}, indent=0))


if __name__ == "__main__":
    main()
