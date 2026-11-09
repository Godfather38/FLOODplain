"""Score the brawley-avra-west v3l-obsrain-cnb run (infiltration SENSITIVITY 2: SFINCS cnb, CN with recovery) against base B.

No model input is changed. Reads both runs' map files (cumprcp, cuminf) and validate_extended.py outputs. Writes:
  - runoff budget (rain - infiltration, from the solver's own cumprcp / cuminf) over the ALERT 6443 contributing areas
    (same NHDPlus V2 delineation as tools/sfincs/brawley/diagnose/runoff_volume.py), whole run and from the first map frame;
  - ALERT 6443 against the PRIMARY county series (gauges.json), Black Wash band and both bands, with and without the
    suspect 08:45-16:20Z Nov 2 plateau, observed windows starting 16Z and 18Z Nov 1 (same method as score_v3l.py);
  - sections, roads, mass balance, negative depth and stability from the validate_extended.py outputs.

  python -I score_cnb.py --wt . --run <cnb>/runs/current --base-run <B>/runs/current --validation <cnb validation-full.json> \
     --base-validation <B validation-full.json> --base-tag B --output summary.json
"""
import argparse, json, math
from pathlib import Path
import geopandas as gpd
import numpy as np, xarray as xr
from shapely import contains_xy
from shapely.ops import unary_union

p = argparse.ArgumentParser()
for k in ('--wt', '--run', '--base-run', '--validation', '--base-validation', '--output'): p.add_argument(k, type=Path, required=True)
p.add_argument('--base-tag', default='B'); a = p.parse_args(); WT = a.wt; BT = a.base_tag
BW, BB = 'Mile Wide Black Wash 15876815 band (ALERT 6443)', 'Mile Wide both bands'

# ---------------- runoff budget from the solver's cumulative fields ----------------
q = xr.open_dataset(a.run / 'sfincs.nc'); DX = float(q.attrs['dx']); level = q['level'].values.astype(int); q.close()
area = (DX / 2.0 ** (level - 1)) ** 2


def cum(run):
    m = xr.open_dataset(run / 'sfincs_map.nc')
    T = [str(t)[:16] + 'Z' for t in m['time'].values]; TM = str(m['timemax'].values[-1])[:16] + 'Z'
    assert m['cumprcp'].dims[0] == 'timemax'
    P = m['cumprcp'].values.astype(np.float64); F = m['cuminf'].values.astype(np.float64)
    fx, fy = m.mesh2d_face_x.values, m.mesh2d_face_y.values; m.close()
    assert not np.isnan(P).any() and not np.isnan(F).any(), 'NaN in cumprcp/cuminf'
    return T, TM, P, F, fx, fy


Tc, TMc, Pc, Fc, fx, fy = cum(a.run); Tb, TMb, Pb, Fb, fxb, fyb = cum(a.base_run)
assert Tc == Tb and TMc == TMb and np.array_equal(fx, fxb)
rainDiff = float(np.abs(Pc - Pb).max()); assert rainDiff < 5e-4, f'cumprcp differs between runs by {rainDiff} m: not the same rain'
COMP = WT / 'tools/sfincs/data/brawley-avra-west-v2/components'
net = gpd.read_file(COMP / 'brawley-avra-west-network.geojson'); cat = gpd.read_file(COMP / 'brawley-avra-west-catchments.geojson').to_crs(32612)
by_to = {}
for r in net.itertuples(): by_to.setdefault(int(r.tonode), []).append(int(r.comid))
fromnode = {int(r.comid): int(r.fromnode) for r in net.itertuples()}


def upstream(c, stop=()):
    out, todo = set(), [c]
    while todo:
        k = todo.pop()
        if k in out or k in stop: continue
        out.add(k); todo += by_to.get(fromnode[k], [])
    return out


bw = upstream(15876815); br = upstream(15877627, stop={15876941})
AREAS = {'Black Wash 15876815 (gauge reach)': bw, 'Union (both bands, combined flow at Mile Wide)': bw | br, 'Whole mesh': None}
budget = {}
for k, s in AREAS.items():
    sel = np.ones(fx.size, bool) if s is None else contains_xy(unary_union(cat[cat.featureid.isin(list(s))].geometry.values), fx, fy)
    A = area[sel]; At = A.sum(); r = {'faceAreaKm2': round(float(At) / 1e6, 2)}
    for wn, i0 in (('wholeRun 2026-10-30T16Z..' + TMc, None),):
        w = {}
        for tag, P, F in (('cnb', Pc, Fc), (BT, Pb, Fb)):
            dP = (P[-1] - (0 if i0 is None else P[i0]))[sel]; dF = (F[-1] - (0 if i0 is None else F[i0]))[sel]
            rain = float((dP * A).sum() / At * 1000); inf = float((dF * A).sum() / At * 1000)
            w[tag] = {'rainMm': round(rain, 2), 'infiltrationMm': round(inf, 2), 'runoffMm': round(rain - inf, 2),
                      'runoffM3': round((rain - inf) / 1000 * float(At)), 'C': round((rain - inf) / rain, 3)}
        r[wn] = w
    budget[k] = r
budget['note'] = ('runoff = cumprcp - cuminf of the solver (map file, written only on the timemax frames, cumulative from tstart); the last one (' + TMc + ') is used, so only whole-run totals are available from the solver; the split by window is not in the outputs. ' +
                  ' Max |cumprcp cnb - base| on any face/frame: '
                  + f'{rainDiff * 1000:.4f} mm (same rain forcing; float32 accumulation over different solver time steps).')

# ---------------- ALERT 6443 against the primary county series (score_v3l.py method) ----------------
VC, VB = (json.loads(f.read_text(encoding='utf-8')) for f in (a.validation, a.base_validation))
hours = list(VC['sectionsHourlyM3s'][BW]); assert hours == list(VB['sectionsHourlyM3s'][BW])
gauges = json.loads((WT / 'tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json').read_text(encoding='utf-8'))
G = next(s for s in gauges['sensors'] if s['id'] == 'ALERT 6443')
obs = [(np.datetime64(r['timeUtc'][:19]), r['flowM3s']) for r in G['series'] if r.get('flowM3s') is not None]
assert all(not math.isnan(v) for _, v in obs)
PL0, PL1 = np.datetime64('2026-11-02T08:45:00'), np.datetime64('2026-11-02T16:20:00'); END = np.datetime64('2026-11-02T18:00:00')


def otrap(t0, t1):
    o = [(t, v) for t, v in obs if t0 <= t <= t1]; assert o[0][0] == t0 and o[-1][0] == t1, 'window must start and end on a report'
    return float(sum((o[i][1] + o[i + 1][1]) / 2 * ((o[i + 1][0] - o[i][0]) / np.timedelta64(1, 's')) for i in range(len(o) - 1)))


plateau = otrap(PL0, PL1); ovol = {}
for st in ('16Z', '18Z'):
    full = otrap(np.datetime64(f'2026-11-01T{st[:2]}:00:00'), END); ovol[st] = {'withPlateau': full, 'withoutPlateau': full - plateau}
gv = gauges['mileWideComparison']['volumeM3']
for st in ('16Z', '18Z'):
    assert abs(ovol[st]['withPlateau'] - gv[f'observed{st}to18Z']) < 1.0 and abs(ovol[st]['withoutPlateau'] - gv[f'observed{st}to18ZWithoutPlateau']) < 1.0
mvol = lambda s: float(sum((s[h] + s[h2]) / 2 * 3600 for h, h2 in zip(list(s)[:-1], list(s)[1:])))
obs_at_hour = {str(t)[:16] + 'Z': v for t, v in obs}
in_plateau = lambda h: PL0 <= np.datetime64(h[:16]) <= PL1


def metrics(sec, excl):
    pr = [(obs_at_hour[h], sec[h]) for h in hours if h in obs_at_hour and not (excl and in_plateau(h))]
    o = np.array([x for x, _ in pr]); m = np.array([y for _, y in pr]); assert not np.isnan(o).any() and not np.isnan(m).any()
    return {'hours': len(pr), 'nse': round(float(1 - ((m - o) ** 2).sum() / ((o - o.mean()) ** 2).sum()), 3), 'rmseM3s': round(float(np.sqrt(((m - o) ** 2).mean())), 3),
            'meanModelOverMeanObserved': round(float(m.mean() / o.mean()), 3), 'maxAbsErrorM3s': round(float(np.abs(m - o).max()), 3)}


def first_reach(sec, thr):
    s = [sec[h] for h in hours]
    for j in range(1, len(s)):
        if s[j - 1] < thr <= s[j]:
            return str(np.datetime64(hours[j - 1][:16]) + np.timedelta64(int(round((thr - s[j - 1]) / (s[j] - s[j - 1]) * 60)), 'm')) + 'Z'
    return None


OBSPEAK = G['summaryTaskWindow']['max']['flowM3s']; OBS03 = obs_at_hour['2026-11-02T03:00Z']
alert = {'observedSource': 'gauges.json ALERT 6443 primary county series (provisional, UTC)', 'observedPeak': {'m3s': OBSPEAK, 'timeUtc': G['summaryTaskWindow']['max']['timeUtc']},
         'observed03Z': OBS03, 'plateauVolumeM3': round(plateau),
         'plateauNote': 'suspect low-stage rating step 08:45-16:20Z Nov 2; without-plateau totals are a bracket, not a measurement (true flow then unknown, not zero)',
         'modelWindowNote': 'model hourly restart flux exists from 18Z Nov 1 only; for the 16Z observed start the model volume is still 18Z-18Z, so that ratio is a LOWER bound',
         'runs': {}}
for tag, V in (('cnb', VC), (BT, VB)):
    r = {}
    for band, key in (('blackWashBand', BW), ('bothBands', BB)):
        sec = V['sectionsHourlyM3s'][key]; mv = mvol(sec); pk = V['sectionPeaks'][key]
        vols = {f'{st}start{"" if pl == "withPlateau" else "NoPlateau"}': {'observedM3': round(ovol[st][pl]), 'modelM3': round(mv), 'ratio': round(mv / ovol[st][pl], 3),
                                                                          **({'ratioIsLowerBound': True} if st == '16Z' else {})}
                for st in ('16Z', '18Z') for pl in ('withPlateau', 'withoutPlateau')}
        r[band] = {'peak': pk, 'peakOverObservedPeak': round(pk['m3s'] / OBSPEAK, 3),
                   'peakLagHoursAfterObserved1820Z': round(float((np.datetime64(pk['time'][:16]) - np.datetime64('2026-11-01T18:20')) / np.timedelta64(1, 'm')) / 60, 2),
                   'q03Z': round(sec['2026-11-02T03:00Z'], 3), 'ratio03Z': round(sec['2026-11-02T03:00Z'] / OBS03, 3),
                   'q18Z_Nov1': round(sec['2026-11-01T18:00Z'], 3), 'q19Z_Nov1': round(sec['2026-11-01T19:00Z'], 3),
                   'firstReachObserved03Z': first_reach(sec, OBS03), 'firstReachObservedPeak': first_reach(sec, OBSPEAK), 'volumes': vols,
                   'hourlyFit18Zto18Z': {'withPlateau': metrics(sec, False), 'withoutPlateauHours': metrics(sec, True)}}
    alert['runs'][tag] = r
alert['hourly'] = [{'hourUtc': h, 'observedM3s': obs_at_hour.get(h), 'inPlateau': bool(in_plateau(h)),
                    **{f'{t}{b}': round(V['sectionsHourlyM3s'][k][h], 3) for t, V in (('cnb', VC), (BT, VB)) for b, k in (('BlackWash', BW), ('Both', BB))}} for h in hours]

sections = {k: {'cnb': VC['sectionPeaks'][k], BT: VB['sectionPeaks'][k],
                'volume18Zto18ZM3': {t: round(mvol(V['sectionsHourlyM3s'][k])) for t, V in (('cnb', VC), (BT, VB))}} for k in VC['sectionPeaks'] if k in VB['sectionPeaks']}
roads = []
for kind in ('crossings', 'dips'):
    for rc, rb in zip(VC[kind], VB[kind]):
        assert rc['label'] == rb['label']
        roads.append({'kind': kind[:-1], 'label': rc['label'], 'maxOverCnb': rc['maxOver'], f'maxOver{BT}': rb['maxOver'],
                      'change': None if rc['maxOver'] is None or rb['maxOver'] is None else round(rc['maxOver'] - rb['maxOver'], 3),
                      'timeCnb': rc.get('maxWseTime'), 'firstOverCnb': rc.get('firstOver')})
res = {'label': 'SENSITIVITY infiltration 2 (cnb, CN with recovery) vs base ' + BT + '; not tuned to observations, not for live registration',
       'runs': {'cnb': str(a.run), BT: str(a.base_run)}, 'runoffBudget': budget, 'alert6443': alert, 'sections': sections,
       'massBalance': {t: V['balanceInputsWholeRunOutflowFromFirstRestart'] for t, V in (('cnb', VC), (BT, VB))},
       'negativeDepth': {t: V['negativeDepth'] for t, V in (('cnb', VC), (BT, VB))},
       'stability': {t: V['stability'] for t, V in (('cnb', VC), (BT, VB))},
       'roads': roads, 'stationsOverTotal': {t: V['stationsOverTotal'] for t, V in (('cnb', VC), (BT, VB))},
       'notes': ['Road comparisons are cell zs vs station roadZ in wet frames only (validate_extended.py); frames that are not wet are never dry evidence',
                 'Model outflow and section flow before the first hourly restart (18Z Nov 1) are not in the outputs']}
a.output.write_text(json.dumps(res, indent=1) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({k: v for k, v in budget.items()}, indent=1)); print('ok', a.output)
