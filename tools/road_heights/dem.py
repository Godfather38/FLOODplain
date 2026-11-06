"""Sample USGS 3DEP 1 m bare-earth DEM tiles (NAVD88) from the public TNM bucket.

Newest project wins per sample; older projects only fill its gaps. Bare-earth
means bridges are removed: under a span these values are the channel, not the
road, which is why bridges.py replaces them.
"""
import re
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.windows import Window
from known_dem_tiles import supplement_tiles

TNM ="https://tnmaccess.nationalmap.gov/api/v1/products"
DATASET = "Digital Elevation Model (DEM) 1 meter"
TILE_DEG = 0.12  # Tiles are 10 km; generous padding for the coverage test below.


@lru_cache(maxsize=4)
def tile_index(box):
    w, s, e, n = box
    items, offset = [], 0
    while True:
        r = requests.get(TNM, params={"bbox": f"{w},{s},{e},{n}", "datasets": DATASET, "max": 100,
                                      "offset": offset, "outputFormat": "JSON"}, timeout=120)
        r.raise_for_status()
        d = r.json()
        items += d["items"]
        offset += len(d["items"])
        if not d["items"] or offset >= d["total"]:
            break
    tiles = []
    for i in items:
        project = re.search(r"Projects/([^/]+)/", i["downloadURL"]).group(1)
        year = re.search(r"(20\d\d)", project)
        b = i["boundingBox"]
        tiles.append({"project": project, "year": int(year.group(1)) if year else 0, "url": i["downloadURL"],
                      "bytes": i.get("sizeInBytes"), "box": (b["minX"], b["minY"], b["maxX"], b["maxY"]),
                      "published": i.get("publicationDate")})
    return sorted(supplement_tiles(tiles, box), key=lambda t: (-t["year"], t["url"]))


def download(tile, cache_dir):
    path = Path(cache_dir) / tile["project"] / tile["url"].rsplit("/", 1)[1]
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    for attempt in range(4):
        try:
            with requests.get(tile["url"], stream=True, timeout=300) as r:
                r.raise_for_status()
                with part.open("wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            part.replace(path)
            return path
        except requests.RequestException:
            if attempt == 3:
                raise
    return path


def _bilinear(band, nodata, col, row):
    c0, r0 = np.floor(col).astype(int), np.floor(row).astype(int)
    fc, fr = col - c0, row - r0
    h, w = band.shape
    out = np.full(col.shape, np.nan, dtype="f8")
    ok = (c0 >= 0) & (r0 >= 0) & (c0 < w - 1) & (r0 < h - 1)
    a, b = band[r0[ok], c0[ok]], band[r0[ok], c0[ok] + 1]
    c, d = band[r0[ok] + 1, c0[ok]], band[r0[ok] + 1, c0[ok] + 1]
    fx, fy = fc[ok], fr[ok]
    v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    bad = ~np.isfinite(v)
    if nodata is not None:
        bad |= (a == nodata) | (b == nodata) | (c == nodata) | (d == nodata)
    v = v.astype("f8")
    v[bad] = np.nan
    out[ok] = v
    return out


def sample(lon, lat, cache_dir, box, log=print):
    """Return (metres NAVD88, tile project index, project names) for lon/lat arrays. NaN and -1 where absent."""
    lon, lat = np.asarray(lon, "f8"), np.asarray(lat, "f8")
    z = np.full(lon.shape, np.nan)
    src = np.full(lon.shape, -1, dtype="i2")
    tiles = tile_index(box)
    projects = sorted({t["project"] for t in tiles}, key=lambda p: min(-t["year"] for t in tiles if t["project"] == p))
    # Tile boxes are padded, so "needed" over-selects by a tile at worst; sampling is exact.
    def touched(t):
        w, s, e, n = t["box"]
        return bool(((lon >= w) & (lon <= e) & (lat >= s) & (lat <= n) & np.isnan(z)).any())

    for project in projects:
        wanted = [t for t in tiles if t["project"] == project and touched(t)]
        log(f"{project}: {len(wanted)} tiles")
        with ThreadPoolExecutor(4) as ex:
            paths = list(ex.map(lambda t: download(t, cache_dir), wanted))
        for t, path in zip(wanted, paths):
            w, s, e, n = t["box"]
            idx = np.flatnonzero((lon >= w) & (lon <= e) & (lat >= s) & (lat <= n) & np.isnan(z))
            if not idx.size:
                continue
            with rasterio.open(path) as ds:
                fwd = Transformer.from_crs(4326, ds.crs, always_xy=True).transform
                x, y = fwd(lon[idx], lat[idx])
                inv = ~ds.transform
                col, row = inv * (np.asarray(x), np.asarray(y))
                col, row = np.asarray(col) - 0.5, np.asarray(row) - 0.5
                # Small requests read only their window; large ones read the tile once.
                c0 = max(int(col.min()) - 1, 0)
                r0 = max(int(row.min()) - 1, 0)
                c1 = min(int(col.max()) + 3, ds.width)
                r1 = min(int(row.max()) + 3, ds.height)
                if c1 <= c0 or r1 <= r0:
                    continue
                band = ds.read(1, masked=False, window=Window(c0, r0, c1 - c0, r1 - r0))
                v = _bilinear(band, ds.nodata, col - c0, row - r0)
                del band
            hit = np.isfinite(v)
            z[idx[hit]] = v[hit]
            src[idx[hit]] = projects.index(project)
    return z, src, projects

