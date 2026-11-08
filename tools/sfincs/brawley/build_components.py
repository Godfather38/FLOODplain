"""Build hydrologic/domain components for the brawley-avra-west SFINCS quadtree case.

Inputs: raw NHDPlus V2 flowlines/catchments fetched by fetch_nhd.py, live v3 domains
(tools/sfincs/data/all-route-ready-v3/topology-version3), candidate dips csv (git ref), and the
floodplain-road-heights-v1 area tiles (priority-road geometry). No solver, no terrain.
Run with cwd = repo root.
"""
import argparse, collections, csv, gzip, io, json, math, subprocess
from pathlib import Path
import numpy as np, geopandas as gpd
from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union, linemerge
from shapely import make_valid

CASE = 'brawley-avra-west'; MODEL_VERSION = 'all-routes-brawley-avra-west-v1'
OUTLET_REACHES = (15876711, 15876707); GAUGE_REACH = 15876941; RECEIVING = 15876923
LIVE = ('northern', 'picture-rocks-ina-twinpeaks', 'gates')
TOPO = Path('tools/sfincs/data/all-route-ready-v3/topology-version3')
PRIORITY = {'Sandario': ['sandario'], 'Manville': ['manville'], 'Avra Valley Rd west': ['avra valley road'], 'Anway': ['anway'],
            'Mile Wide': ['mile wide', 'milewide'], 'Snyder Hill': ['snyder hill'], 'Nelson Quihuis': ['nelson quihuis'],
            'Garcia Ranch': ['garcia ranch'], 'Cocorague Ranch': ['cocorague'], 'Agua Dulce Ranch': ['agua dulce'], 'Tucker': ['tucker']}
TO84 = Transformer.from_crs(32612, 4326, always_xy=True); TO32 = Transformer.from_crs(4326, 32612, always_xy=True)


def read_fc(path):
    return gpd.GeoDataFrame.from_features(json.load(gzip.open(path)), crs=4326)


def decode(path):
    """floodplain-road-heights-v1 line decoder (re-implementation of tools/road_heights/encoding.py::decode_lines)."""
    raw = gzip.decompress(Path(path).read_bytes()); size = int.from_bytes(raw[:4], 'little')
    header = json.loads(raw[4:4 + size]); body = 4 + size
    col = {k: np.frombuffer(raw, dtype=('<' + c['type']) if c['type'] not in ('u1', 'i1') else c['type'], count=c['count'], offset=body + c['offset'])
           for k, c in header['columns'].items()}
    st = col['lineStart'].astype(np.int64); out = []
    for i in range(len(st) - 1):
        a, b = st[i], st[i + 1]
        out.append((header['lines']['name'][i], np.cumsum(col['dLonE6'][a:b].astype('i8')) / 1e6, np.cumsum(col['dLatE6'][a:b].astype('i8')) / 1e6))
    return out


def upstream(seed, G):
    out = set(); st = [seed]
    while st:
        x = st.pop()
        if x in out: continue
        out.add(x); st.extend(G.get(x, ()))
    return out


def fc_write(gdf, path, name):
    path = Path(path)
    if path.exists(): path.unlink()
    gdf.to_file(path, driver='GeoJSON')
    d = json.loads(path.read_text(encoding='utf-8')); d['name'] = name
    if d.get('crs', {}).get('properties', {}).get('name') == 'urn:ogc:def:crs:OGC::CRS84': d['crs']['properties']['name'] = 'urn:ogc:def:crs:OGC:1.3:CRS84'  # match topology-version3 files
    path.write_text(json.dumps(d) + '\n', encoding='utf-8')


def as_multi(g):
    if g.geom_type == 'Polygon': return MultiPolygon([g])
    if g.geom_type == 'MultiPolygon': return g
    return MultiPolygon([q for q in getattr(g, 'geoms', []) if q.geom_type == 'Polygon'] +
                        [p for q in getattr(g, 'geoms', []) if q.geom_type == 'MultiPolygon' for p in q.geoms])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--raw', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--tiles', type=Path, required=True, help='folder with road-heights manifest.json and area_*.bin.gz')
    p.add_argument('--dips-ref', default='origin/experimental/model-upgrade-diagnostics-20261107:docs/upgrade/candidate-road-dips-20261107.csv')
    p.add_argument('--min-dip-m', type=float, default=0.0, help='only dips at least this deep get L4 windows')
    p.add_argument('--l3-road-buffer', type=float, default=100.); p.add_argument('--l3-wash-buffer', type=float, default=100.)
    p.add_argument('--l2-buffer', type=float, default=400.); p.add_argument('--l1-buffer', type=float, default=1500.)
    p.add_argument('--window', type=float, default=200.); p.add_argument('--network-buffer', type=float, default=2000.)
    p.add_argument('--zones-only', action='store_true', help='rewrite refinement-zones/l4 points/report only')
    a = p.parse_args(); o = a.output; o.mkdir(parents=True, exist_ok=True); rep = {'args': {k: str(v) for k, v in vars(a).items()}}
    fl = read_fc(a.raw / 'nhdflowline_network.geojson.gz'); ct = read_fc(a.raw / 'catchmentsp.geojson.gz')
    fl['comid'] = fl.comid.astype(int); fl = fl.set_index('comid', drop=False); fl.index.name = None; ct['featureid'] = ct.featureid.astype(int)
    # ---- topology: node graph (tonode->fromnode, includes divergent branches) and hydroseq graph (dnhydroseq + dnminorhyd)
    byfrom = collections.defaultdict(set)
    for c, fn in zip(fl.comid, fl.fromnode): byfrom[fn].add(c)
    Gn = collections.defaultdict(set)
    for c, tn in zip(fl.comid, fl.tonode):
        for d in byfrom.get(tn, ()): Gn[d].add(c)
    hs = {h: c for c, h in zip(fl.comid, fl.hydroseq)}; Gh = collections.defaultdict(set)
    for c, d, dm in zip(fl.comid, fl.dnhydroseq, fl.dnminorhyd):
        if d in hs: Gh[hs[d]].add(c)
        if dm and dm in hs: Gh[hs[dm]].add(c)
    sets = {}
    for name, G in (('node', Gn), ('hydroseq', Gh)):
        up = set().union(*[upstream(r, G) for r in OUTLET_REACHES]); sets[name] = up - upstream(GAUGE_REACH, G)
    if sets['node'] != sets['hydroseq']: raise ValueError('node and hydroseq traversals disagree')
    L = sorted(int(c) for c in sets['node']); Ls = set(L)
    if 15876815 not in Ls: raise ValueError('15876815 subtree missing')
    ext = sorted({c for d in L for c in Gn.get(d, ()) if c not in Ls} | {c for d in L for c in Gh.get(d, ()) if c not in Ls})
    if ext != [GAUGE_REACH]: raise ValueError(f'unexpected external inflows {ext}')
    recv = sorted(d for d in L if GAUGE_REACH in Gn.get(d, ()))
    if recv != [RECEIVING]: raise ValueError(f'receiving reach {recv}')
    open_heads = [c for c in L if fl.loc[c, 'startflag'] != 1 and not Gn.get(c)]
    if open_heads: raise ValueError(f'local reaches with upstream outside fetch {open_heads}')
    # outflow side: local reaches draining to non-local reaches
    downs = sorted({(c, int(d)) for c in L for d in byfrom.get(fl.loc[c, 'tonode'], ()) if d not in Ls})
    div = [int(c) for c in L if fl.loc[c, 'divergence'] != 0]
    # ---- domain = union of official catchments
    cl = ct[ct.featureid.isin(Ls)].copy(); missing = sorted(set(L) - set(cl.featureid))
    zero = [c for c in missing if fl.loc[c, 'areasqkm'] == 0]
    if set(missing) - set(zero): raise ValueError(f'missing nonzero catchments {sorted(set(missing) - set(zero))}')
    c32 = cl.to_crs(32612); dom = make_valid(unary_union(list(c32.geometry))).buffer(0)
    dom = unary_union([g for g in getattr(dom, 'geoms', [dom]) if g.geom_type in ('Polygon', 'MultiPolygon')])
    parts = list(getattr(dom, 'geoms', [dom]))
    holes = sorted([Polygon(i).area for pg in parts for i in pg.interiors], reverse=True)
    # fill digitizing slivers between adjacent catchments (holes < 1000 m2); larger holes would be kept
    filled = [Polygon(pg.exterior, [i for i in pg.interiors if Polygon(i).area >= 1000]) for pg in parts]
    dom = unary_union(filled); parts = list(getattr(dom, 'geoms', [dom]))
    expected = fl.loc[15876711, 'totdasqkm'] + fl.loc[15876707, 'totdasqkm'] - fl.loc[GAUGE_REACH, 'totdasqkm']
    rep['topology'] = {'localReachCount': len(L), 'catchmentCount': len(cl), 'zeroAreaReachIdsWithoutCatchment': zero, 'divergentLocalReaches': div,
                       'sumLocalReachAreasqkm': float(fl.loc[L, 'areasqkm'].sum()), 'sumCatchmentAreasqkm': float(cl.areasqkm.sum()),
                       'totdaExpectedKm2': float(expected), 'domainAreaKm2': dom.area / 1e6, 'domainParts': len(parts),
                       'partAreasKm2': sorted([round(g.area / 1e6, 4) for g in parts], reverse=True), 'sliverHolesFilledCount': len(holes), 'remainingHoles': sum(len(pg.interiors) for pg in parts),
                       'largestSliverHolesM2': [round(h, 3) for h in holes[:5]], 'externalInflows': ext, 'receivingReach': recv,
                       'downstreamLinks': downs, 'traversal': 'tonode->fromnode node graph; verified identical to dnhydroseq+dnminorhyd graph',
                       'excludedGaugeCatchmentKm2': float(fl.loc[GAUGE_REACH, 'areasqkm']),
                       'domainBoundsLonLat': list(gpd.GeoSeries([dom], crs=32612).to_crs(4326).total_bounds)}
    fl32 = fl.to_crs(32612)
    inter = fl32[fl32.intersects(dom) & ~fl32.comid.isin(Ls)]
    rep['nonLocalFlowlinesTouchingDomain'] = [{'comid': int(c), 'gnis': g.strip(), 'ftype': ft, 'lengthInsideM': round(geom.intersection(dom).length, 1),
                                               'drainsIntoLocal': any(c in Gn.get(d, ()) for d in L)}
                                              for c, g, geom, ft in zip(inter.comid, inter.gnis_name, inter.geometry, inter.ftype)]
    # ---- live domains and roads
    live = {k: gpd.read_file(TOPO / f'{k}-domain.geojson').to_crs(32612).geometry.union_all() for k in LIVE}; live_u = unary_union(list(live.values()))
    inside = dom.difference(live_u)
    rep['overlapWithLiveKm2'] = {k: round(dom.intersection(v).area / 1e6, 2) for k, v in live.items()}
    rep['domainOutsideLiveKm2'] = round(inside.area / 1e6, 2)
    lp = fl.loc[15876711, 'levelpathi']; main = fl32[fl32.comid.isin(Ls) & (fl32.levelpathi == lp)]
    main_line = unary_union(list(main.geometry))
    rep['brawleyMainstem'] = {'levelpath': float(lp), 'reaches': sorted(int(c) for c in main.comid), 'lengthKm': round(main_line.length / 1000, 2),
                              'names': sorted(set(n.strip() for n in main.gnis_name))}
    net = fl32[fl32.intersects(dom.buffer(a.network_buffer))].copy()

    def single(g):
        if g.geom_type == 'MultiLineString':
            m = linemerge(g); return m if m.geom_type == 'LineString' else g
        return g
    net['geometry'] = net.geometry.apply(single)
    man = json.loads((a.tiles / 'manifest.json').read_text()); roads = []
    for f in man['files']:
        if f['tier'] != 'area': continue
        for nm, lo, la in decode(a.tiles / f['path']):
            if len(lo) < 2: continue
            x, y = TO32.transform(lo, la); roads.append((nm or '', LineString(np.c_[x, y])))
    rep['roadTiles'] = {'box': man['box'], 'areaTiles': sum(f['tier'] == 'area' for f in man['files']), 'areaLines': len(roads)}
    pri = collections.defaultdict(list)
    for nm, g in roads:
        k = next((k for k, pats in PRIORITY.items() if any(s in nm.lower() for s in pats)), None)
        if k: pri[k].append((nm, g))
    tr = []
    for k in PRIORITY:
        if not pri.get(k): continue
        g = unary_union([x[1] for x in pri[k]]); g = linemerge(g) if g.geom_type == "MultiLineString" else g
        tr.append({'id': k.lower().replace(' ', '-'), 'name': k, 'roadNames': sorted({x[0] for x in pri[k]}), 'km': round(g.length / 1000, 2),
                   'kmInDomain': round(g.intersection(dom).length / 1000, 2), 'kmInDomainOutsideLive': round(g.intersection(inside).length / 1000, 2),
                   'source': 'floodplain-road-heights-v1 area tiles (10 m station lines), box lat>=32.16', 'geometry': g})
    trg = gpd.GeoDataFrame(tr, geometry='geometry', crs=32612)
    rep['priorityRoads'] = {r['name']: {'km': r['km'], 'kmInDomain': r['kmInDomain'], 'kmInDomainOutsideLive': r['kmInDomainOutsideLive'], 'roadNames': r['roadNames']} for r in tr}
    rep['priorityRoadsNotFound'] = [k for k in PRIORITY if not pri.get(k)]
    if not a.zones_only:
        fc_write(gpd.GeoDataFrame({'case': [CASE]}, geometry=[as_multi(dom)], crs=32612), o / 'active-domain.geojson', 'active-domain')
        fc_write(gpd.GeoDataFrame({'case': [CASE], 'version': [3]}, geometry=[dom], crs=32612).to_crs('OGC:CRS84'), o / f'{CASE}-domain.geojson', f'{CASE}-domain')
        fc_write(cl[['featureid', 'gridcode', 'areasqkm', 'geometry']].sort_values('featureid').to_crs('OGC:CRS84'), o / f'{CASE}-catchments.geojson', f'{CASE}-catchments')
        keep = ['comid', 'flowdir', 'gnis_name', 'ftype', 'streamorde', 'levelpathi', 'hydroseq', 'dnhydroseq', 'dnminorhyd', 'fromnode', 'tonode',
                'divergence', 'startflag', 'areasqkm', 'totdasqkm', 'lengthkm']
        nout = net[keep + ['geometry']].copy(); nout['local'] = nout.comid.isin(Ls)
        for c in ('levelpathi', 'hydroseq', 'dnhydroseq', 'dnminorhyd', 'fromnode', 'tonode'): nout[c] = nout[c].astype('int64')
        fc_write(nout.to_crs('OGC:CRS84'), o / f'{CASE}-network.geojson', f'{CASE}-network')
        fc_write(trg.drop(columns=['roadNames']).assign(roadNames=[';'.join(r['roadNames']) for r in tr]).to_crs('OGC:CRS84'), o / 'target-routes.geojson', 'target-routes')
    if net.loc[RECEIVING].geometry.geom_type != 'LineString': raise ValueError('receiving reach multipart')
    rep['network'] = {'features': len(net), 'local': int(net.comid.isin(Ls).sum()), 'bufferM': a.network_buffer, 'flowdirValues': sorted(set(net.flowdir)),
                      'multipartRemaining': [int(c) for c, g in zip(net.comid, net.geometry) if g.geom_type != 'LineString']}
    # ---- L4 points: dips + road/wash crossings inside domain and outside live domains
    txt = subprocess.run(['git', 'show', a.dips_ref], capture_output=True, text=True, check=True).stdout
    dips = list(csv.DictReader(io.StringIO(txt))); pts = []; nin = 0
    for r in dips:
        x, y = TO32.transform(float(r['lon']), float(r['lat'])); q = Point(x, y)
        nin += dom.contains(q)
        if inside.contains(q):
            pts.append({'kind': 'dip', 'x': x, 'y': y, 'lon': float(r['lon']), 'lat': float(r['lat']), 'road': r['road_name'],
                        'depthM': float(r['dip_depth_m']), 'comid': None, 'wash': None, 'streamOrder': None})
    rep['dips'] = {'csvRows': len(dips), 'inDomain': int(nin), 'inDomainOutsideLive': len(pts),
                   'depthGE03': sum(q['depthM'] >= 0.3 for q in pts), 'depthGE1': sum(q['depthM'] >= 1 for q in pts)}
    rtree = gpd.GeoDataFrame({'name': [r[0] for r in roads]}, geometry=[r[1] for r in roads], crs=32612)
    wash = net[net.intersects(inside)]
    wg = gpd.GeoDataFrame({'wcomid': wash.comid.values, 'gnis': wash.gnis_name.values, 'order': wash.streamorde.values}, geometry=wash.geometry.values, crs=32612)
    cand = gpd.sjoin(rtree, wg, predicate='intersects'); crs_ = []
    for i, row in cand.iterrows():
        g = rtree.geometry[i].intersection(wash.loc[row.wcomid].geometry)
        for q in getattr(g, 'geoms', [g]):
            if q.geom_type != 'Point' or not inside.contains(q): continue
            if any(math.hypot(q.x - c['x'], q.y - c['y']) < 15 for c in crs_): continue
            lo, la = TO84.transform(q.x, q.y)
            crs_.append({'kind': 'crossing', 'x': q.x, 'y': q.y, 'lon': lo, 'lat': la, 'road': row['name'], 'depthM': None,
                         'comid': int(row.wcomid), 'wash': row.gnis.strip() or None, 'streamOrder': float(row.order)})
    rep['crossings'] = {'inDomainOutsideLive': len(crs_), 'onBrawley': sum(c['wash'] == 'Brawley Wash' for c in crs_),
                        'byOrder': dict(collections.Counter(str(c['streamOrder']) for c in crs_)),
                        'namedRoad': sum(bool(c['road']) for c in crs_)}
    sel = [q for q in pts if q['depthM'] >= a.min_dip_m] + crs_
    rep['l4WindowPoints'] = {'dips': sum(q['kind'] == 'dip' for q in sel), 'crossings': len(crs_), 'minDipM': a.min_dip_m, 'windowM': a.window}
    h = a.window / 2
    L4 = unary_union([box(q['x'] - h, q['y'] - h, q['x'] + h, q['y'] + h) for q in sel]).intersection(dom)
    road_u = unary_union(list(trg.geometry))
    L3 = unary_union([road_u.buffer(a.l3_road_buffer), main_line.buffer(a.l3_wash_buffer)]).intersection(dom).difference(L4)
    L2 = main_line.buffer(a.l2_buffer).intersection(dom).difference(unary_union([L3, L4]))
    L1 = main_line.buffer(a.l1_buffer).intersection(dom).difference(unary_union([L2, L3, L4]))
    zones = []
    for lvl, g in ((1, L1), (2, L2), (3, L3), (4, L4)):
        g = make_valid(g).buffer(0)
        if not g.is_empty: zones.append({'refinement_level': lvl, 'cell_size_m': 100 / 2 ** lvl, 'area_km2': round(g.area / 1e6, 3), 'geometry': as_multi(g)})
    zg = gpd.GeoDataFrame(zones, geometry='geometry', crs=32612); fc_write(zg, o / 'refinement-zones.geojson', 'refinement-zones')
    wp = gpd.GeoDataFrame(sel, geometry=[Point(q['x'], q['y']) for q in sel], crs=32612).drop(columns=['x', 'y'])
    fc_write(wp.to_crs('OGC:CRS84'), o / 'l4-window-points.geojson', 'l4-window-points')
    b = dom.bounds; x0, y0 = np.floor(np.array(b[:2]) / 100) * 100; x1, y1 = np.ceil(np.array(b[2:]) / 100) * 100
    nm = int((y1 - y0) / 100) * int((x1 - x0) / 100)
    est = nm + sum(z['geometry'].area / (100 / 2 ** z['refinement_level']) ** 2 for z in zones)
    zu = unary_union([z['geometry'] for z in zones])
    rep['zones'] = {str(z['refinement_level']): {'areaKm2': z['area_km2'], 'cellsAtLevel': round(z['geometry'].area / (100 / 2 ** z['refinement_level']) ** 2)} for z in zones}
    rep['meshEstimate'] = {'formula': 'prepare_route_case_mesh.py line 19: n*m + sum(area/cell^2)', 'rectangleCells': nm, 'estimate': round(est),
                           'boundsEPSG32612': [float(x0), float(y0), float(x1), float(y1)],
                           'inDomainActiveEstimate': round(dom.difference(zu).area / 1e4 + sum(z['geometry'].area / (100 / 2 ** z['refinement_level']) ** 2 for z in zones))}
    if not a.zones_only:
        reg = {'case': CASE, 'modelVersion': MODEL_VERSION, 'routeIds': [], 'targetRoads': [r['name'] for r in tr],
               'activeCatchmentReachIds': sorted(int(c) for c in cl.featureid), 'activeReachIds': L, 'addedConnectingCatchmentIds': [],
               'areaKm2': dom.area / 1e6, 'connectedComponents': [L] if len(parts) == 1 else None, 'componentCount': len(parts),
               'cumulativeInletDoubleCountPairs': [], 'externalCatchmentIdsAreDisjoint': True,
               'terrainGapNote': 'all-route-context-v2 (10 m) stops near lat 32.170 and lon -111.398; new context and 1 m terrain needed south/west.',
               'corridorMissingAreaM2': 0.0,
               'externalInlets': [{'reachId': str(GAUGE_REACH), 'receivingReachId': str(RECEIVING), 'linkField': 'dnhydroseq',
                                   'note': 'USGS 09487000 Brawley Wash near Three Points. NWM inflow of the gauge reach injected on 15876923. The 27.47 km2 local catchment of 15876941 below the gauge is excluded from the domain; its runoff arrives only through the NWM inflow.'}],
               'outflow': {'type': 'open', 'localOutletReachIds': list(OUTLET_REACHES), 'downstreamLinks': downs, 'node': 720060498, 'lonLat': [-111.2930, 32.3647],
                           'note': 'Open downstream edge at the Northern case inlet point. Northern keeps its NWM inlets 15876711/15876707; models are independent.'},
               'missingFlowlineIds': [], 'unresolvedPrimaryUpstreamHydrosequences': [], 'missingOriginalIssueForecastIds': [], 'version': 3, 'parentVersion': None,
               'addedForSecondaryPathClosure': [], 'closureIterations': [], 'externalSplitReachesRequiringNoAssumedFractions': [],
               'secondaryBranchEvidence': [{'from': int(c), 'to': int(hs.get(fl.loc[c, 'dnminorhyd'], 0)), 'field': 'dnminorhyd'} for c in L if fl.loc[c, 'dnminorhyd']],
               'zeroLocalCatchmentAreaReachIds': zero, 'missingCatchmentIds': [], 'unresolvedActiveOrInletLinks': [],
               'forcingStatus': {'historyFile': f'{CASE}-history.json', 'forecastFile': f'{CASE}-forecast.json',
                                 'status': 'pending: 15876941 is not in .sfincs-runs/nwm-frozen-13z/crosswalk.json'},
               'excluded': {'gaugeReachId': GAUGE_REACH, 'gaugeLocalCatchmentAreaKm2': float(fl.loc[GAUGE_REACH, 'areasqkm']),
                            'upstreamOfGaugeTotdaKm2': float(fl.loc[GAUGE_REACH, 'totdasqkm'])},
               'source': {'flowlines': 'raw/nhdflowline_network.geojson.gz', 'catchments': 'raw/catchmentsp.geojson.gz', 'traversal': rep['topology']['traversal']},
               'status': 'brawley-avra-west version3-schema registry. Graph closure verified: only 15876941 drains into the local set.'}
        (o / 'boundary-registry.json').write_text(json.dumps(reg, indent=1) + '\n', encoding='utf-8')
    (o / 'build-report.json').write_text(json.dumps(rep, indent=1, default=float) + '\n', encoding='utf-8')
    print(json.dumps(rep, indent=1, default=float))


if __name__ == '__main__':
    main()
