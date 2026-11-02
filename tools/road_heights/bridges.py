"""Measure bridge decks from lidar points classified as bridge deck (class 17).

Falls back to a straight line between the DEM approaches, the method the
existing bridge findings used, whenever lidar does not cover a span. Lidar is
accepted only if it lies near the approaches, so a road passing under another
structure can never inherit that structure's deck height.
"""
import numpy as np
from pyproj import Transformer

from ept import BRIDGE_DECK

to3857 = Transformer.from_crs(32612, 3857, always_xy=True).transform
from3857 = Transformer.from_crs(3857, 32612, always_xy=True).transform
STEP_M, RADIUS_M, MIN_POINTS = 5.0, 4.0, 5
EXTEND_M, APPROACH_NEAR_M, APPROACH_FAR_M = 60.0, 8.0, 25.0
MIN_COVERAGE, MAX_CREST_GRADE, CONTINUOUS_M = 0.4, 0.10, 1.0


def resample(xy, step=STEP_M):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
    s = np.arange(0, d[-1] + 1e-6, step)
    if d[-1] - s[-1] > step / 4:
        s = np.r_[s, d[-1]]
    return np.c_[np.interp(s, d, xy[:, 0]), np.interp(s, d, xy[:, 1])], s


def _unit(a, b):
    v = np.asarray(b) - np.asarray(a)
    return v / max(np.hypot(*v), 1e-6)


def measure(span_xy, ept, sample_dem):
    """span_xy is the tagged span in EPSG:32612. Returns a structure profile dict."""
    start, end = _unit(span_xy[1], span_xy[0]), _unit(span_xy[-2], span_xy[-1])
    pts, s = resample(span_xy)
    length = s[-1]
    # Approaches sit past any stretch the tag may have missed, so measure them outside the extension too.
    near = np.arange(APPROACH_NEAR_M, APPROACH_FAR_M + 1, 2.0)
    a_xy = span_xy[0] + np.outer(near + EXTEND_M, start)
    b_xy = span_xy[-1] + np.outer(near + EXTEND_M, end)
    a0_xy = span_xy[0] + np.outer(near, start)
    b0_xy = span_xy[-1] + np.outer(near, end)
    za0, zb0 = np.nanmedian(sample_dem(a0_xy)), np.nanmedian(sample_dem(b0_xy))
    profile = {"lengthM": float(length), "approachM": [_float(za0), _float(zb0)]}

    ext_a = span_xy[0] + np.outer(np.arange(EXTEND_M, 0, -STEP_M), start)
    ext_b = span_xy[-1] + np.outer(np.arange(STEP_M, EXTEND_M + 1, STEP_M), end)
    all_xy = np.vstack([ext_a, pts, ext_b])
    first, last = len(ext_a), len(ext_a) + len(pts) - 1

    pad = RADIUS_M + 2
    x0, y0 = all_xy.min(0) - pad
    x1, y1 = all_xy.max(0) + pad
    corners = [to3857(x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    box = (min(c[0] for c in corners), min(c[1] for c in corners), max(c[0] for c in corners), max(c[1] for c in corners))
    try:
        mx, my, mz, cls = ept.points(box)
    except Exception as exc:  # A failed fetch is recorded, never read as "no bridge".
        return {**profile, "kind": "approach", "xy": pts, "z": _approach(pts, s, za0, zb0), "lidarError": str(exc)[:200]}
    keep = cls == BRIDGE_DECK
    px, py = from3857(mx[keep], my[keep]) if keep.any() else (np.empty(0), np.empty(0))
    pz = mz[keep]

    z = np.full(len(all_xy), np.nan)
    n = np.zeros(len(all_xy), int)
    for i, (x, y) in enumerate(all_xy):
        hit = (px - x) ** 2 + (py - y) ** 2 <= RADIUS_M ** 2
        n[i] = hit.sum()
        if n[i] >= MIN_POINTS:
            z[i] = np.median(pz[hit])
    profile["deckPoints"] = int(n.sum())

    if not (np.isfinite(za0) and np.isfinite(zb0)):
        return {**profile, "kind": "approach_unavailable", "xy": pts, "z": np.full(len(pts), np.nan)}
    # Decks may crest above both approaches, but never sit below them or far above a normal road grade.
    low, high = min(za0, zb0) - 3.0, max(za0, zb0) + max(3.0, MAX_CREST_GRADE * length)
    z[(z < low) | (z > high)] = np.nan

    inside = np.isfinite(z[first:last + 1])
    profile["coverage"] = float(inside.mean())
    if profile["coverage"] < MIN_COVERAGE:
        line = _approach(pts, s, za0, zb0)
        # No deck points and terrain that follows the approaches: the road is in the DEM (a culvert or fill), so keep it.
        ground = sample_dem(pts)
        if np.isfinite(ground).all() and np.abs(ground - line).max() <= CONTINUOUS_M:
            return {**profile, "kind": "terrain_continuous", "xy": pts, "z": ground}
        return {**profile, "kind": "approach", "xy": pts, "z": line}

    # Grow outward only through contiguous measured deck the map tag missed.
    i, j = first, last
    while i > 0 and np.isfinite(z[i - 1]):
        i -= 1
    while j < len(z) - 1 and np.isfinite(z[j + 1]):
        j += 1
    xy, zz = all_xy[i:j + 1], z[i:j + 1]
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
    ok = np.isfinite(zz)
    zz = np.interp(d, d[ok], zz[ok])
    tagged = float(np.nanmedian(z[first:last + 1]))
    return {**profile, "kind": "lidar", "xy": xy, "z": zz, "deckMedianM": tagged,
            "approachLineM": _float((za0 + zb0) / 2), "lidarMinusApproachM": _float(tagged - (za0 + zb0) / 2)}


def _approach(pts, s, za, zb):
    if not (np.isfinite(za) and np.isfinite(zb)) or s[-1] == 0:
        return np.full(len(pts), np.nan)
    return za + (zb - za) * s / s[-1]


def _float(v):
    return None if v is None or not np.isfinite(v) else round(float(v), 3)


def notches(z, step, min_depth=0.75, max_span=300.0):
    """Runs where bare-earth DEM drops below a line joining its flanks: possible bridge removed from the DEM.

    At-grade wash dips also match, and are real, so these are only places to look for lidar deck points.
    """
    w = max(int(25 / step), 1)
    hits, i, n = [], 0, len(z)
    while i < n:
        if not np.isfinite(z[i]) or i < w:
            i += 1
            continue
        left = np.nanmedian(z[i - w:i])
        if z[i] < left - min_depth:
            lim = min(n - 1, i + int(max_span / step))
            right = next((j for j in range(i + 1, lim) if np.isfinite(z[j]) and z[j] >= left - min_depth / 2), None)
            if right is not None:
                hits.append((i - 1, right))
                i = right
        i += 1
    return hits
