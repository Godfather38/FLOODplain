#!/usr/bin/env python3
"""Compare NWM v3.0 retrospective flow with USGS daily flow at gauges on modeled reaches.

The retrospective is a reanalysis run on observed weather, so it is a best case for
the model: real forecasts use predicted weather and should do no better. Writes
public/inundation/data/backtest.json. Needs: zarr s3fs xarray numpy, as well as
hand_tool's requirements. Network only; nothing here feeds the app's live numbers.
"""
import datetime, json, urllib.request
from pathlib import Path

import numpy as np
import s3fs
import xarray as xr

ZARR = 'noaa-nwm-retrospective-3-0-pds/CONUS/zarr/chrtout.zarr'
GAUGES = {'SCTA3': ('09486520', 15890430, 'Santa Cruz at Trico Road'), 'CSCA3': ('09486500', 15903137, 'Santa Cruz at Cortaro'), 'BWTA3': ('09487000', 15876941, 'Brawley Wash near Three Points')}
START, END = '2008-01-01', '2022-12-31'
CFS_PER_M3S = 35.3147
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/inundation/data/backtest.json'


def usgs_daily(site):
    url = f'https://waterservices.usgs.gov/nwis/dv/?format=json&sites={site}&parameterCd=00060&statCd=00003&startDT={START}&endDT={END}'
    with urllib.request.urlopen(url, timeout=180) as r:
        values = json.load(r)['value']['timeSeries'][0]['values'][0]['value']
    return {v['dateTime'][:10]: float(v['value']) for v in values if float(v['value']) >= 0}


def model_daily(ds, feature):
    series = ds['streamflow'].sel(feature_id=feature, time=slice(START, END)).load()
    days = series.resample(time='1D').mean() * CFS_PER_M3S
    peaks = series.resample(time='1D').max() * CFS_PER_M3S
    key = [str(t)[:10] for t in days['time'].values]
    return dict(zip(key, map(float, days.values))), dict(zip(key, map(float, peaks.values)))


def contingency(obs, mod, threshold):
    hit = int(((obs >= threshold) & (mod >= threshold)).sum())
    miss = int(((obs >= threshold) & (mod < threshold)).sum())
    false_alarm = int(((obs < threshold) & (mod >= threshold)).sum())
    return {'thresholdCfs': threshold, 'observedDays': hit + miss, 'modelDays': hit + false_alarm, 'hits': hit, 'misses': miss, 'falseAlarms': false_alarm}


def clusters(flags, gap=3):
    """Group flagged day indexes into events separated by more than gap days."""
    out = []
    for i in np.flatnonzero(flags):
        if out and i - out[-1][-1] <= gap:
            out[-1].append(int(i))
        else:
            out.append([int(i)])
    return out


def events_fair(o, hourly_peak, threshold, window=1):
    """Event counts allowing timing slack. USGS daily means understate a flash peak, so an
    observed day counts as supporting a model event at half the threshold. That favors the model."""
    obs = clusters(o >= threshold)
    mod = clusters(hourly_peak >= threshold)
    seen = sum(any(hourly_peak[max(0, i - window):i + window + 1].max() >= threshold for i in c) for c in obs)
    backed = sum(any(o[max(0, i - window):i + window + 1].max() >= threshold / 2 for i in c) for c in mod)
    return {'thresholdCfs': threshold, 'observedEvents': len(obs), 'observedEventsModelSaw': int(seen), 'modelEvents': len(mod), 'modelEventsBackedByGauge': int(backed)}


def main():
    fs = s3fs.S3FileSystem(anon=True)
    ds = xr.open_zarr(s3fs.S3Map(ZARR, s3=fs), consolidated=True)
    out = {'schemaVersion': 1, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'model': 'NWM v3.0 retrospective, daily mean of hourly flow', 'observed': 'USGS daily mean discharge', 'period': [START, END], 'gauges': {}}
    for lid, (site, feature, name) in GAUGES.items():
        obs = usgs_daily(site)
        mod, peak = model_daily(ds, feature)
        days = sorted(set(obs) & set(mod))
        o, m = np.array([obs[d] for d in days]), np.array([mod[d] for d in days])
        flowing = o >= 100
        top = sorted(days, key=lambda d: -obs[d])
        events, used = [], []
        for d in top:
            when = datetime.date.fromisoformat(d)
            if any(abs((when - u).days) <= 5 for u in used):
                continue
            used.append(when)
            near = [(when + datetime.timedelta(days=k)).isoformat() for k in range(-1, 2)]
            events.append({'date': d, 'observedCfs': round(obs[d], 1), 'modelCfsSameDay': round(mod[d], 1), 'modelCfsBestWithinOneDay': round(max(mod.get(k, 0) for k in near), 1), 'modelHourlyPeakCfsWithinOneDay': round(max(peak.get(k, 0) for k in near), 1)})
            if len(events) == 8:
                break
        out['gauges'][lid] = {
            'name': name, 'usgsSite': site, 'reach': feature, 'days': len(days),
            'correlationAllDays': round(float(np.corrcoef(o, m)[0, 1]), 3) if o.std() and m.std() else None,
            'correlationLogAllDays': round(float(np.corrcoef(np.log1p(o), np.log1p(m))[0, 1]), 3) if o.std() and m.std() else None,
            'meanObservedCfs': round(float(o.mean()), 1), 'meanModelCfs': round(float(m.mean()), 1),
            'medianModelOverObservedWhenFlowing': round(float(np.median((m[flowing] + 1) / (o[flowing] + 1))), 2) if flowing.any() else None,
            'thresholds': [contingency(o, m, t) for t in (100, 300, 1000, 3000, 5000)],
            'eventsWithinOneDay': [events_fair(o, np.array([peak[d] for d in days]), t) for t in (300, 650, 1000, 3000, 5000)],
            'biggestEvents': events,
        }
        print(lid, json.dumps(out['gauges'][lid])[:900], flush=True)
    OUT.write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
