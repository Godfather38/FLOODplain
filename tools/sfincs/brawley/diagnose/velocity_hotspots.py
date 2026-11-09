"""Where and when the u/v velocity is high in a Brawley SFINCS result (read-only).

Two velocity estimates from the hourly restarts (q is the stored u/v flux per metre, m2/s):
  proxy  = |q| / (max(zs) - max(zb)), only where that depth > 0.1 m (the validate_extended.py proxy);
  subgrid = |q| / huv, huv the SFINCS subgrid average flux depth (stability_common.Geometry.huv), only where huv > 0.01 m.
For the top links the script reports both cells (msk, size, zb, subgrid zmin), zs, q, discharge and Froude number,
plus road stations within 2 km. Usage: velocity_hotspots.py --run <result dir> --output <json> [--stations <gz>]
"""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np

from stability_common import Geometry, TO_UTM, read_rst, rst_time, run_dir

p = argparse.ArgumentParser(); p.add_argument('--run', required=True); p.add_argument('--output', required=True)
p.add_argument('--stations', default='tools/live/road-stations/brawley-avra-west-local-v2.json.gz'); p.add_argument('--top', type=int, default=12)
a = p.parse_args(); D = run_dir(a.run); G = Geometry(D)
is3 = G.msk == 3; bnd = is3[G.nm] | is3[G.nmu]; g = 9.81
rst = sorted(D.glob('sfincs.*.rst')); allidx = np.arange(G.NPUV)
res = {'run': str(a.run), 'restarts': len(rst), 'hourly': {}, 'top': []}
best = []
for pth in rst:
    zs, q, nrec = read_rst(pth); q = q[:G.NPUV]; t = rst_time(pth)
    hh = np.maximum(zs[G.nm], zs[G.nmu]) - np.maximum(G.zb[G.nm], G.zb[G.nmu]); ok = hh > 0.1
    vp = np.where(ok, np.abs(q) / np.where(ok, hh, 1), 0.0)
    hu, zsuv = G.huv(zs, allidx); oks = hu > 0.01
    vs = np.where(oks, np.abs(q) / np.where(oks, hu, 1), 0.0)
    rec = {'proxyMax': round(float(vp.max()), 3), 'proxyMaxAtBoundaryLink': bool(bnd[int(np.argmax(vp))]),
           'proxyMaxInterior': round(float(vp[~bnd].max()), 3), 'subgridMax': round(float(vs.max()), 3),
           'subgridMaxAtBoundaryLink': bool(bnd[int(np.argmax(vs))]), 'subgridMaxInterior': round(float(vs[~bnd].max()), 3),
           'linksProxyGt3': int((vp > 3).sum()), 'linksProxyGt3Boundary': int(((vp > 3) & bnd).sum()),
           'linksSubgridGt3': int((vs > 3).sum()), 'linksSubgridGt3Boundary': int(((vs > 3) & bnd).sum()),
           'boundaryOutflowM3s': round(float((q[bnd] * G.w[bnd] * np.where(is3[G.nmu[bnd]], 1.0, -1.0)).sum()), 3)}
    res['hourly'][t] = rec
    for i in np.argsort(-vp)[:a.top]:
        best.append((float(vp[i]), t, int(i), float(hh[i]), float(hu[i]), float(zsuv[i]), float(q[i]), zs[G.nm[i]], zs[G.nmu[i]]))
best.sort(reverse=True); seen = set()
for v, t, i, hh, hu, zsuv, qi, z1, z2 in best:
    if i in seen: continue
    seen.add(i); c1, c2 = int(G.nm[i]), int(G.nmu[i])
    res['top'].append({'time': t, 'link': i, 'dir': str(G.dirn[i]), 'proxyMs': round(v, 3), 'subgridMs': round(abs(qi) / hu, 3) if hu > 0.01 else None,
                       'qM2s': round(qi, 4), 'dischargeM3s': round(qi * float(G.w[i]), 3), 'widthM': float(G.w[i]),
                       'depthProxyM': round(hh, 4), 'huvSubgridM': round(hu, 4), 'zsuv': round(zsuv, 3), 'uvZmin': round(float(G.uv_zmin[i]), 3), 'uvZmax': round(float(G.uv_zmax[i]), 3),
                       'froudeProxy': round(v / np.sqrt(g * hh), 2),
                       'cells': [{'face': c, 'msk': int(G.msk[c]), 'cellM': float(G.size[c]), 'zbMap': round(float(G.zb[c]), 3), 'zSubgridMin': round(float(G.z_zmin[c]), 3),
                                  'zSubgridMax': round(float(G.z_zmax[c]), 3), 'zs': round(float(z), 3), 'lonlat': G.lonlat(c)} for c, z in ((c1, z1), (c2, z2))],
                       'bedDropBetweenCentresM': round(float(G.zb[c1] - G.zb[c2]), 3), 'centreDistM': round(float(np.hypot(G.xc[c1] - G.xc[c2], G.yc[c1] - G.yc[c2])), 2)})
    if len(res['top']) >= a.top: break
# time series at the single worst link
if res['top']:
    i = res['top'][0]['link']; ser = {}
    for pth in rst:
        zs, q, _ = read_rst(pth); hh = max(zs[G.nm[i]], zs[G.nmu[i]]) - max(G.zb[G.nm[i]], G.zb[G.nmu[i]])
        hu, _ = G.huv(zs, np.array([i])); ser[rst_time(pth)] = {'q': round(float(q[i]), 4), 'depthProxy': round(float(hh), 4), 'huv': round(float(hu[0]), 4),
                                                              'zs': [round(float(zs[G.nm[i]]), 3), round(float(zs[G.nmu[i]]), 3)]}
    res['worstLinkHourly'] = ser
# road stations within 2 km of any link with proxy > 3 m/s at any hour
st = json.load(gzip.open(a.stations))['columns']; sx, sy = TO_UTM.transform(np.array(st['lon']), np.array(st['lat']))
hot = sorted({c for r in res['top'] if r['proxyMs'] > 3 for c in (r['cells'][0]['face'], r['cells'][1]['face'])})
if hot:
    dmin = np.min(np.hypot(sx[:, None] - G.xc[hot][None, :], sy[:, None] - G.yc[hot][None, :]), axis=1)
    near = np.where(dmin <= 2000)[0]
    res['roadStationsWithin2kmOfHotCells'] = {'hotFaces': hot, 'count': int(near.size), 'nearestM': round(float(dmin.min()), 1),
                                             'nearestRoad': str(st['road'][int(np.argmin(dmin))]),
                                             'roads': sorted({str(st['road'][k]) for k in near})}
res['boundaryCells'] = {'msk3': int(is3.sum()), 'boundaryLinks': int(bnd.sum())}
Path(a.output).write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n'); print('ok', a.output)
