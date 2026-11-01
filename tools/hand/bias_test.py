#!/usr/bin/env python3
"""Does a simple correction fix the Santa Cruz model flow's high bias? Fit on early years, check on later ones.

Daily means from the NWM v3.0 retrospective and USGS. The later years are never used
for fitting. Writes public/inundation/data/bias-test.json. Needs what backtest.py needs.
"""
import datetime, json
from pathlib import Path

import numpy as np
import s3fs
import xarray as xr

from backtest import CFS_PER_M3S, GAUGES, OUT, ZARR, clusters, usgs_daily

FIT_END, CHECK_START = '2015-12-31', '2016-01-01'
THRESHOLDS = (300, 650, 1000, 3000)
SITES = ('SCTA3', 'CSCA3')


def quantile_map(fit_model, fit_obs):
    """Moves a model flow to the observed flow at the same percentile in the fitting years."""
    q = np.linspace(0, 1, 1001)
    xs, ys = np.quantile(fit_model, q), np.quantile(fit_obs, q)
    xs = np.maximum.accumulate(xs + np.arange(q.size) * 1e-9)
    # Above the fitted range, keep the same ratio instead of flattening: the top is where few days are.
    top = ys[-1] / max(xs[-1], 1e-6)
    return lambda m: np.where(m > xs[-1], m * top, np.interp(m, xs, ys))


def subtract_base(fit_model, fit_obs):
    """Removes the model's usual base flow, the simplest possible fix."""
    base = float(np.median(fit_model) - np.median(fit_obs))
    return lambda m: np.maximum(m - base, 0)


def score(obs, mod):
    out = {'meanObservedCfs': round(float(obs.mean()), 1), 'meanFlowCfs': round(float(mod.mean()), 1),
           'meanAbsoluteErrorCfs': round(float(np.abs(obs - mod).mean()), 1),
           'daysFlowAtLeast100': int((mod >= 100).sum()), 'daysObservedAtLeast100': int((obs >= 100).sum()), 'events': []}
    for t in THRESHOLDS:
        real, model = clusters(obs >= t), clusters(mod >= t)
        seen = sum(any(mod[max(0, i - 1):i + 2].max() >= t for i in c) for c in real)
        backed = sum(any(obs[max(0, i - 1):i + 2].max() >= t / 2 for i in c) for c in model)
        out['events'].append({'thresholdCfs': t, 'realEvents': len(real), 'seenWithinOneDay': int(seen), 'modelEvents': len(model), 'backedByGauge': int(backed)})
    return out


def main():
    ds = xr.open_zarr(s3fs.S3Map(ZARR, s3=s3fs.S3FileSystem(anon=True)), consolidated=True)
    result = {'schemaVersion': 1, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'fitYears': '2008-2015', 'checkYears': '2016-2022', 'gauges': {}}
    for lid in SITES:
        site, feature, name = GAUGES[lid]
        obs_all = usgs_daily(site)
        series = ds['streamflow'].sel(feature_id=feature, time=slice('2008-01-01', '2022-12-31')).load().resample(time='1D').mean() * CFS_PER_M3S
        days = [str(t)[:10] for t in series['time'].values]
        model = dict(zip(days, map(float, series.values)))
        shared = sorted(set(days) & set(obs_all))
        fit = [d for d in shared if d <= FIT_END]
        check = [d for d in shared if d >= CHECK_START]
        fo, fm = np.array([obs_all[d] for d in fit]), np.array([model[d] for d in fit])
        co, cm = np.array([obs_all[d] for d in check]), np.array([model[d] for d in check])
        result['gauges'][lid] = {'name': name, 'fitDays': len(fit), 'checkDays': len(check),
                                 'noCorrection': score(co, cm),
                                 'subtractBaseFlow': score(co, subtract_base(fm, fo)(cm)),
                                 'percentileMatch': score(co, quantile_map(fm, fo)(cm))}
        print(lid, json.dumps(result['gauges'][lid], indent=0)[:2500], flush=True)
    Path(OUT).with_name('bias-test.json').write_text(json.dumps(result, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
