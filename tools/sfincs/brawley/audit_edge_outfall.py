"""Audit the domain edge for closed low points where the ground keeps falling outward (no solver run).

For every active quadtree cell with a missing neighbour (a domain-edge side) the lowest sub-pixel of the cell
(subgrid z_zmin) is compared with the 10 m context terrain just outside that side. A side "falls outward" when the
outside terrain is lower than z_zmin, and "keeps falling" when two further bands outward are lower again. Sides that
pass are grouped into edge clusters, and each cluster is checked for a mapped channel that leaves the domain there:
an NHDPlus flowline from the wide fetch or an OSM waterway that crosses the domain boundary within the cluster, with
the terrain along the channel lower outside than inside. Nothing is changed here; the report lists every cluster.

Usage (repo root):
  python tools/sfincs/brawley/audit_edge_outfall.py --boundaries .sfincs-runs/brawley-avra-west-boundaries-v2 \
    --parameters .sfincs-runs/brawley-avra-west-parameters-v2 --terrain .sfincs-runs/brawley-avra-west-context-v2/terrain.tif \
    --components tools/sfincs/data/brawley-avra-west-v2/components --osm <overpass waterway json> --output <dir>
"""
import argparse, gzip, json
from pathlib import Path
import numpy as np, geopandas as gpd, xarray as xr, xugrid as xu, rasterio
from rasterio.features import rasterize
from shapely.geometry import LineString, Point, box
from shapely.ops import unary_union

BANDS = ((0, 100), (200, 400), (400, 600))  # metres outward from the cell edge
MARGIN = 0.2  # metres; a band must be this much lower than the previous one to count as falling


def edge_sides(g):
    """Yield (face, direction) for every side with no neighbour. Directions: W (md), E (mu), S (nd), N (nu)."""
    out = []
    for d, k in (('W', 'md'), ('E', 'mu'), ('S', 'nd'), ('N', 'nu')):
        lev = g[k].values; n1 = g[k + '1'].values - 1; n2 = g[k + '2'].values - 1
        missing = (n1 < 0) | ((lev == 1) & (n2 < 0))
        out += [(int(i), d) for i in np.flatnonzero(missing)]
    return out


def main():
    p = argparse.ArgumentParser()
    for a in ('--boundaries', '--parameters', '--terrain', '--components', '--osm', '--output'):
        p.add_argument(a, type=Path, required=True)
    a = p.parse_args(); a.output.mkdir(parents=True, exist_ok=True)
    g = xu.open_dataset(a.boundaries / 'sfincs.nc').load()
    zmin = xr.open_dataset(a.parameters / 'sfincs_subgrid.nc').z_zmin.values.astype(float)
    mask = g['mask'].values; level = g['level'].values; size = 100.0 / 2 ** (level - 1)
    fx, fy = g.grid.face_coordinates[:, 0], g.grid.face_coordinates[:, 1]
    domain = gpd.read_file(a.components / 'active-domain.geojson').to_crs(32612).union_all()
    with rasterio.open(a.terrain) as s:
        z = s.read(1).astype(float); z[z == s.nodata] = np.nan; T = s.transform
        inside = rasterize([(domain, 1)], out_shape=z.shape, transform=T, fill=0, dtype='uint8').astype(bool)
    zo = z.copy(); zo[inside] = np.nan  # terrain outside the domain only
    x0, y0, res = T.c, T.f, T.a

    def boxmin(arr, xa, xb, ya, yb):
        c0, c1 = int(np.floor((min(xa, xb) - x0) / res)), int(np.ceil((max(xa, xb) - x0) / res))
        r0, r1 = int(np.floor((y0 - max(ya, yb)) / res)), int(np.ceil((y0 - min(ya, yb)) / res))
        w = arr[max(r0, 0):max(r1, 0), max(c0, 0):max(c1, 0)]
        return float(np.nanmin(w)) if w.size and np.isfinite(w).any() else np.nan

    rows = []
    for f, d in edge_sides(g):
        h = size[f] / 2; lat = max(h, 15.0); cx, cy = fx[f], fy[f]; b = []
        for o0, o1 in BANDS:
            if d == 'E': v = boxmin(zo, cx + h + o0, cx + h + o1, cy - lat, cy + lat)
            elif d == 'W': v = boxmin(zo, cx - h - o1, cx - h - o0, cy - lat, cy + lat)
            elif d == 'N': v = boxmin(zo, cx - lat, cx + lat, cy + h + o0, cy + h + o1)
            else: v = boxmin(zo, cx - lat, cx + lat, cy - h - o1, cy - h - o0)
            b.append(v)
        falls = np.isfinite(b[0]) and b[0] < zmin[f]
        keeps = falls and np.isfinite(b[1]) and np.isfinite(b[2]) and b[1] < b[0] - MARGIN and b[2] < b[1] - MARGIN
        rows.append(dict(face=f, side=d, x=round(float(cx), 1), y=round(float(cy), 1), cellSizeM=float(size[f]), mask=int(mask[f]),
                         zZmin=round(float(zmin[f]), 2), outside=[None if not np.isfinite(v) else round(v, 2) for v in b],
                         fallsOutward=bool(falls), keepsFalling=bool(keeps)))
    flagged = [r for r in rows if r['keepsFalling']]
    # cluster flagged sides: union of 250 m buffers around their cell centres
    blobs = unary_union([Point(r['x'], r['y']).buffer(250) for r in flagged])
    blobs = list(getattr(blobs, 'geoms', [blobs])) if flagged else []
    # mapped channels: NHD wide fetch and OSM waterways
    with gzip.open(a.components / 'raw' / 'nhdflowline_network.geojson.gz', 'rt', encoding='utf-8') as fh:
        nhd = gpd.read_file(fh).to_crs(32612)
    osm = json.loads(a.osm.read_text(encoding='utf-8'))
    ways = [(e['id'], e.get('tags', {}).get('waterway'), e.get('tags', {}).get('name'), LineString([(q['lon'], q['lat']) for q in e['geometry']]))
            for e in osm['elements'] if e['type'] == 'way' and len(e.get('geometry', [])) > 1]
    osmg = gpd.GeoDataFrame({'osmId': [w[0] for w in ways], 'waterway': [w[1] for w in ways], 'name': [w[2] for w in ways]},
                            geometry=[w[3] for w in ways], crs=4326).to_crs(32612)
    edge = domain.boundary

    def zat(x, y):
        c, r = int((x - x0) / res), int((y0 - y) / res)
        return float(z[r, c]) if 0 <= r < z.shape[0] and 0 <= c < z.shape[1] and np.isfinite(z[r, c]) else np.nan

    def leaving(line, blob):
        """Crossings of the domain edge inside the blob, with terrain 150-300 m inside vs outside along the line."""
        res_ = []
        cr = line.intersection(edge.intersection(blob.buffer(1)).buffer(1))
        if cr.is_empty: return res_
        for part in getattr(cr, 'geoms', [cr]):
            s = line.project(part.centroid); prof = {}
            for side, sign in (('a', -1), ('b', 1)):
                pts = [line.interpolate(min(max(s + sign * dd, 0), line.length)) for dd in (150, 225, 300)]
                prof[side] = [(q, domain.contains(q), zat(q.x, q.y)) for q in pts]
            ins = [v for k in 'ab' for q, inn, v in prof[k] if inn and np.isfinite(v)]
            out = [v for k in 'ab' for q, inn, v in prof[k] if not inn and np.isfinite(v)]
            if ins and out:
                res_.append(dict(x=round(part.centroid.x, 1), y=round(part.centroid.y, 1), insideMinZ=round(min(ins), 2),
                                 outsideMinZ=round(min(out), 2), terrainFallsOutward=bool(min(out) < min(ins))))
        return res_

    clusters = []
    for k, blob in enumerate(sorted(blobs, key=lambda q: (-q.centroid.y, q.centroid.x))):
        mem = [r for r in flagged if blob.contains(Point(r['x'], r['y']))]
        ch = []
        for _, l in nhd[nhd.intersects(blob)].iterrows():
            for c in leaving(l.geometry if l.geometry.geom_type == 'LineString' else unary_union(l.geometry), blob):
                ch.append(dict(source='NHDPlus', id=int(l.comid), digitizedFrom='inside' if domain.contains(Point(l.geometry.coords[0] if l.geometry.geom_type == 'LineString' else l.geometry.geoms[0].coords[0])) else 'outside', **c))
        for _, l in osmg[osmg.intersects(blob)].iterrows():
            for c in leaving(l.geometry, blob):
                ch.append(dict(source='OSM', id=int(l.osmId), waterway=l.waterway, name=l['name'], **c))
        out3 = int(sum(1 for r in mem if r['mask'] == 3))
        near3 = int(((mask == 3) & (np.hypot(fx - blob.centroid.x, fy - blob.centroid.y) < 600)).sum())
        cand = any(c['terrainFallsOutward'] for c in ch)
        drop = max(r['zZmin'] - r['outside'][2] for r in mem)
        lon, lat_ = gpd.GeoSeries([blob.centroid], crs=32612).to_crs(4326).iloc[0].coords[0]
        clusters.append(dict(cluster=k, x=round(blob.centroid.x), y=round(blob.centroid.y), lon=round(lon, 5), lat=round(lat_, 5),
                             sides=len(mem), faces=sorted({r['face'] for r in mem}), minZzmin=min(r['zZmin'] for r in mem),
                             maxFallTo400_600mM=round(drop, 2), outflowCellsInCluster=out3, outflowCellsWithin600m=near3,
                             channelsCrossingEdge=ch, mappedChannelLeavesDownhill=bool(cand)))
    rep = dict(method=dict(edgeSides='active cell side with no quadtree neighbour', cellZ='subgrid z_zmin (lowest sub-pixel)',
                           outside='minimum of the 10 m context terrain outside the domain polygon in bands %s m outward from the cell edge, lateral width max(cell, 30 m)' % (BANDS,),
                           fallsOutward='band 0-100 m below z_zmin', keepsFalling='fallsOutward and each further band at least %.1f m lower than the previous' % MARGIN,
                           clusters='union of 250 m buffers around flagged cell centres',
                           channel='NHDPlus wide-fetch flowline or OSM waterway crossing the domain edge in the cluster; terrainFallsOutward when the line terrain 150-300 m outside is below that inside'),
               edgeSides=len(rows), fallsOutward=sum(r['fallsOutward'] for r in rows), keepsFalling=len(flagged), clusters=clusters)
    (a.output / 'edge-outfall-audit.json').write_text(json.dumps(rep, indent=1) + '\n', encoding='utf-8', newline='\n')
    (a.output / 'edge-sides.json').write_text(json.dumps(rows) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({k: v for k, v in rep.items() if k != 'clusters'}))
    for c in clusters:
        print(c['cluster'], c['x'], c['y'], c['sides'], c['minZzmin'], c['maxFallTo400_600mM'], 'out3', c['outflowCellsInCluster'], c['outflowCellsWithin600m'],
              'leaves', c['mappedChannelLeavesDownhill'], [(q['source'], q['id'], q['terrainFallsOutward']) for q in c['channelsCrossingEdge']])


if __name__ == '__main__':
    main()
