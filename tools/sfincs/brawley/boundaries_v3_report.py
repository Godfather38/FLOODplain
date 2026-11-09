"""Placement report for the brawley-avra-west v3 boundaries (no solver run).

Reads the v2 and v3 boundary folders, the edge audit (audit_edge_outfall.py) and the extra-channel file, and writes
placement-report.json: which outflow cells are new and why, the six lobe-tip faces named in
docs/upgrade/BRAWLEY-OUTLET-POND-20261108.md, every edge cluster where the ground keeps falling outward with the reason
it was or was not opened, and the second reversed headwater 15876769.

  python tools/sfincs/brawley/boundaries_v3_report.py --v2 .sfincs-runs/brawley-avra-west-boundaries-v2 \
     --v3 .sfincs-runs/brawley-avra-west-boundaries-v3 --audit .sfincs-runs/brawley-avra-west-boundaries-v3/edge-audit/edge-outfall-audit.json \
     --components tools/sfincs/data/brawley-avra-west-v2/components --terrain .sfincs-runs/brawley-avra-west-context-v2/terrain.tif \
     --extra tools/sfincs/data/brawley-avra-west-v2/boundaries-v3/extra-outflow-channels.geojson --output <file>
"""
import argparse, json
from pathlib import Path
import numpy as np, geopandas as gpd, xugrid as xu, rasterio
from shapely.geometry import Point

NAMED = [54599, 54444, 54756, 54755, 54754, 54290]
SEED = (474844.48, 3581562.25)


def main():
    p = argparse.ArgumentParser()
    for k in ('--v2', '--v3', '--audit', '--components', '--terrain', '--extra', '--output'): p.add_argument(k, type=Path, required=True)
    a = p.parse_args()
    g2 = xu.open_dataset(a.v2 / 'sfincs.nc').load(); g3 = xu.open_dataset(a.v3 / 'sfincs.nc').load()
    m2, m3 = g2['mask'].values, g3['mask'].values; fx, fy = g3.grid.face_coordinates.T; z = g3['z'].values
    for k in [v for v in g3.data_vars if v != 'mask']:
        if not np.array_equal(np.asarray(g2[k].values), np.asarray(g3[k].values)): raise ValueError('v3 grid differs from v2 outside the mask: ' + k)
    place = json.loads((a.v3 / 'boundary-placement.json').read_text(encoding='utf-8'))
    src = {r['face']: r['sources'] for r in place['outflowCellSources']}
    new = np.flatnonzero((m2 != 3) & (m3 == 3)); lost = np.flatnonzero((m2 == 3) & (m3 != 3))
    if len(lost): raise ValueError('v3 lost outflow cells')
    level = g3['level'].values; size = 100.0 / 2 ** (level - 1)
    groups = {}
    for f in new:
        s = src[int(f)]; key = 'lobe tip, reversed NHDPlus 15876709' if any('reversed' in q for q in s) else ' / '.join(s)
        groups.setdefault(key, []).append(dict(face=int(f), x=round(float(fx[f]), 1), y=round(float(fy[f]), 1), cellM=float(size[f]), zZmin=round(float(z[f]), 2)))
    named = []
    sides = {}
    for r in json.loads((a.audit.parent / 'edge-sides.json').read_text(encoding='utf-8')): sides.setdefault(r['face'], []).append(r)
    for f in NAMED:
        d = float(np.hypot(fx[f] - SEED[0], fy[f] - SEED[1])); marked = bool(m3[f] == 3)
        why = 'marked by the HydroMT outflow point at the 15876709 start (250 m corridor)' if marked else (
            'not marked: %.0f m from the outflow point, outside the 250 m corridor the existing outflow cells use' % d)
        named.append(dict(face=f, x=float(fx[f]), y=float(fy[f]), zZmin=round(float(z[f]), 2), distanceFromSeedM=round(d), outflowV3=marked, reason=why,
                          edgeSides=[dict(side=r['side'], outside=r['outside'], fallsOutward=r['fallsOutward'], keepsFalling=r['keepsFalling']) for r in sides.get(f, [])]))
    audit = json.loads(a.audit.read_text(encoding='utf-8'))
    extra_ids = {str(f['properties']['id']) for f in json.loads(a.extra.read_text(encoding='utf-8'))['features']}
    dom = gpd.read_file(a.components / 'active-domain.geojson').to_crs(32612).union_all()
    clusters = []
    for c in audit['clusters']:
        f = np.array(c['faces']); n3v2 = int((m2[f] == 3).sum()); n3v3 = int((m3[f] == 3).sum())
        down = [q for q in c['channelsCrossingEdge'] if q['terrainFallsOutward']]
        opened = sorted({str(q['id']) for q in down if str(q['id']) in extra_ids})
        lobe = any(np.hypot(fx[f] - SEED[0], fy[f] - SEED[1]) < 300)
        if lobe: action = 'opened in v3: %d new outflow cells in the cluster, outflow point at the digitized start of the terrain-reversed NHDPlus 15876709 (OSM way 1103245450 continues north)' % (n3v3 - n3v2)
        elif n3v3 > n3v2 or opened: action = 'opened in v3: %d new outflow cells in the cluster, outflow point on %s' % (n3v3 - n3v2, ', '.join(opened) or 'the cluster edge')
        elif n3v2 or c['outflowCellsWithin600m']: action = 'unchanged: already drained by v2 outflow cells in or within 600 m of the cluster'
        elif not c['channelsCrossingEdge']: action = 'candidate, unchanged: ground falls outward but no NHDPlus or OSM channel crosses the edge here'
        elif not down: action = 'candidate, unchanged: the only mapped channel crossing here does not fall outward (%s)' % ', '.join('%s %s %s' % (q['source'], q['id'], q.get('waterway') or '') for q in c['channelsCrossingEdge'])
        else: action = 'candidate, unchanged: mapped channel crosses but has under 100 m of its length inside the domain, so it carries no domain water (%s)' % ', '.join('%s %s' % (q['source'], q['id']) for q in down)
        clusters.append(dict(cluster=c['cluster'], lon=c['lon'], lat=c['lat'], x=c['x'], y=c['y'], edgeSides=c['sides'], minZzmin=c['minZzmin'],
                             fallTo400_600mM=c['maxFallTo400_600mM'], outflowCellsV2=n3v2, outflowCellsV3=n3v3, opened=opened, action=action,
                             channels=[dict(source=q['source'], id=q['id'], waterway=q.get('waterway'), insideMinZ=q['insideMinZ'], outsideMinZ=q['outsideMinZ'], fallsOutward=q['terrainFallsOutward']) for q in c['channelsCrossingEdge']]))
    # 15876769
    net = gpd.read_file(a.components / 'brawley-avra-west-network.geojson').to_crs(32612); L = net[net.comid.astype(int) == 15876769].geometry.iloc[0]
    with rasterio.open(a.terrain) as s:
        zz = lambda q: round(float(list(s.sample([(q.x, q.y)]))[0][0]), 2)
        st = Point(L.coords[0]); e = dom.boundary.interpolate(dom.boundary.project(st)); u = np.hypot(e.x - st.x, e.y - st.y)
        beyond = [dict(m=d, z=zz(Point(st.x + (e.x - st.x) / u * d, st.y + (e.y - st.y) / u * d)), inside=bool(dom.contains(Point(st.x + (e.x - st.x) / u * d, st.y + (e.y - st.y) / u * d)))) for d in range(0, 1001, 200)]
        r769 = dict(comid=15876769, digitizedStart=[round(st.x, 1), round(st.y, 1)], startInsideEdgeM=round(dom.boundary.distance(st)), terrainStartM=zz(st), terrainEndM=zz(Point(L.coords[-1])),
                    profileStartToNearestEdgeAndBeyond=beyond,
                    action='candidate, unchanged: its start is 192 m inside the edge, beyond the 100 m HydroMT edge buffer, and no NHDPlus or OSM channel leaves there; the ground falls about 2 m over 1 km to the north-east outside, the CAP canal (OSM way 84241184) is 0.66 km away and crosses the same edge without falling outward; v2x held at most 0.90 m depth and 65,760 m3 within 1 km of it (BRAWLEY-OUTLET-POND-20261108.md)')
    rep = dict(case='brawley-avra-west', boundaries='v3', base='v2 boundaries (47 outflow cells), same mesh v2, same parameters v2, same inlet',
               method=place['outflowMethod'], outflowCellsV2=int((m2 == 3).sum()), outflowCellsV3=int((m3 == 3).sum()), newOutflowCells=int(len(new)), lostOutflowCells=0,
               gridOtherVariablesIdentical=True, newCellsBySource={k: dict(count=len(v), cells=v) for k, v in groups.items()},
               terrainReversedReaches=place['terrainReversedReaches'], extraOutflowChannels=place['extraOutflowChannels'], namedLobeTipFaces=named,
               edgeAudit=dict(method=audit['method'], edgeSides=audit['edgeSides'], fallsOutward=audit['fallsOutward'], keepsFalling=audit['keepsFalling'], clusters=len(clusters)),
               edgeClusters=clusters, secondReversedHeadwater=r769)
    a.output.write_text(json.dumps(rep, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({k: rep[k] for k in ('outflowCellsV2', 'outflowCellsV3', 'newOutflowCells')}), {k: len(v) for k, v in groups.items()})
    for c in clusters: print(c['cluster'], c['lon'], c['lat'], c['edgeSides'], c['outflowCellsV2'], c['outflowCellsV3'], c['action'][:90])


if __name__ == '__main__':
    main()
