"""Read small windows of USGS 3DEP lidar from its public Entwine (EPT) archive.

Each project on s3://usgs-lidar-public is an octree of LAZ files, so a road
corridor needs only a handful of nodes. No account, key or per-request charge.
Coordinates are Web Mercator (EPSG:3857); heights are in the project's own
vertical reference; AZ_PimaCo_2_2021 agrees with the NAVD88 DEM to the centimetre at checked sites.
"""
import io
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import laspy
import numpy as np
import requests

BUCKET = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public"
GROUND, BRIDGE_DECK = 2, 17


def _get(url, cache=None, retries=4):
    if cache is not None and cache.exists():
        return cache.read_bytes()
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=120)
            r.raise_for_status()
            break
        except requests.RequestException:
            if attempt == retries - 1:
                raise
    if cache is not None:
        cache.parent.mkdir(parents=True, exist_ok=True)
        part = cache.with_name(f"{cache.name}.{threading.get_ident()}.part")
        part.write_bytes(r.content)
        try:
            part.replace(cache)
        except PermissionError:  # Another thread published the same node first (Windows locks open files).
            part.unlink(missing_ok=True)
    return r.content


class Ept:
    def __init__(self, project, cache_dir, max_depth=None):
        self.project, self.base = project, f"{BUCKET}/{project}"
        self.max_depth = max_depth
        self.cache = Path(cache_dir) / project
        self.meta = json.loads(_get(f"{self.base}/ept.json", self.cache / "ept.json"))
        self.bounds = self.meta["bounds"]
        self.hierarchy = {}
        self.pages = set()
        self.lock = threading.Lock()

    def _page(self, key):
        with self.lock:
            if key in self.pages:
                return
            self.pages.add(key)
            self.hierarchy.update(json.loads(_get(f"{self.base}/ept-hierarchy/{key}.json",
                                                  self.cache / "h" / f"{key}.json")))

    def _nodes(self, box):
        """Every non-empty node whose cube overlaps box = (xmin, ymin, xmax, ymax)."""
        x0, y0, _, x1, y1, _ = self.bounds
        size = x1 - x0
        hits, stack = [], [(0, 0, 0, 0)]
        self._page("0-0-0-0")
        while stack:
            d, x, y, z = stack.pop()
            key = f"{d}-{x}-{y}-{z}"
            count = self.hierarchy.get(key, 0)
            if count == -1:
                self._page(key)
                count = self.hierarchy.get(key, 0)
            if not count:
                continue
            s = size / 2 ** d
            nx0, ny0 = x0 + x * s, y0 + y * s
            if nx0 > box[2] or nx0 + s < box[0] or ny0 > box[3] or ny0 + s < box[1]:
                continue
            hits.append(key)
            if self.max_depth is not None and d >= self.max_depth:
                continue
            for dx in (0, 1):
                for dy in (0, 1):
                    for dz in (0, 1):
                        stack.append((d + 1, 2 * x + dx, 2 * y + dy, 2 * z + dz))
        return hits

    def _node_points(self, key, box):
        raw = _get(f"{self.base}/ept-data/{key}.laz", self.cache / "d" / f"{key}.laz")
        las = laspy.read(io.BytesIO(raw))
        x, y = np.asarray(las.x), np.asarray(las.y)
        keep = (x >= box[0]) & (x <= box[2]) & (y >= box[1]) & (y <= box[3])
        return x[keep], y[keep], np.asarray(las.z)[keep], np.asarray(las.classification)[keep]

    def points(self, box):
        """Arrays x, y, z, classification inside the Web Mercator box."""
        nodes = self._nodes(box)
        with ThreadPoolExecutor(8) as ex:
            parts = list(ex.map(lambda k: self._node_points(k, box), nodes))
        if not parts:
            return tuple(np.empty(0) for _ in range(4))
        return tuple(np.concatenate([p[i] for p in parts]) for i in range(4))
