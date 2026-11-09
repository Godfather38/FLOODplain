"""Validation only: observed Stage IV hourly rain for the brawley-avra-west extended window (v2x).

Same source and processing as the frozen package's analysis hours (tools/sfincs/brawley/rain/build_initialization_rainfall.py):
IEM archive ST4.<YYYYMMDDHH>.01h.grib (hour-ending name), the same GRIB header checks (tp, kg m**-2, accum, 1 h),
the same native HRAP grid (md5GridSection must equal the frozen provenance nativeGridHash) and the frozen
nearest-neighbour cell mapping read from <frozen>/initialization-rainfall/provenance.json. Bitmap/missing/negative
values stay missing (NaN): never zero. A Stage IV hour with any missing cell is replaced explicitly by NOAA MRMS
MultiSensor QPE 01H Pass2 (same method as resolve_initialization_rainfall.py); if that is incomplete too, the build stops.
No HRRR or other forecast is used.

  python -I tools/sfincs/brawley/extend/fetch_stage4_extension.py --frozen .sfincs-runs/brawley-avra-west-rainfall-v2 \
     --output .sfincs-runs/brawley-avra-west-rainfall-v2x --first 2026-11-01T14 --last 2026-11-02T17 --case-first 2026-11-02T07

Hours are interval STARTS (netcdf interval_label start). Every hour in [first, last] is decoded; observed-extension-precipitation.nc
holds [case-first, last] (the case forcing); stage4-reference-precipitation.nc holds [first, case-first) for comparison with
the frozen HRRR frames only (not forcing).
"""
import argparse, csv, datetime as dt, gzip, hashlib, json, time, urllib.request
from pathlib import Path
import eccodes as ec, numpy as np, xarray as xr
from pyproj import CRS

iso = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')
sha = lambda b: hashlib.sha256(b).hexdigest()
H = dt.timedelta(hours=1)


def get(url, path, limit=60_000_000):
    if path.exists(): return path.read_bytes(), None, 'cached_from_earlier_fetch_in_this_task'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                b = r.read(limit + 1); lm = r.headers.get('Last-Modified')
            if len(b) > limit: raise ValueError('download exceeded bound')
            path.write_bytes(b); return b, lm, 'network'
        except urllib.error.HTTPError as e:
            if e.code in (404, 410): raise
            time.sleep(3)
        except OSError:
            time.sleep(3)
    raise RuntimeError('failed ' + url)


def stage4(begin, raw, mapping, grid):
    finish = begin + H; name = f'ST4.{finish:%Y%m%d%H}.01h.grib'
    url = f'https://mesonet.agron.iastate.edu/archive/data/{finish:%Y/%m/%d}/stage4/{name}'
    b, lm, delivery = get(url, raw / name)
    h = ec.codes_new_from_message(b)
    try:
        keys = ['edition', 'shortName', 'units', 'stepType', 'stepUnits', 'startStep', 'endStep', 'dataDate', 'dataTime', 'validityDate', 'validityTime', 'gridType', 'Nx', 'Ny', 'bitmapPresent', 'missingValue', 'centre', 'generatingProcessIdentifier', 'typeOfGeneratingProcess', 'md5GridSection']
        meta = {k: ec.codes_get(h, k) for k in keys}
        if meta['shortName'] != 'tp' or meta['units'] != 'kg m**-2' or meta['stepType'] != 'accum' or meta['stepUnits'] != 1 or meta['endStep'] - meta['startStep'] != 1: raise ValueError('Unrecognized Stage IV accumulation ' + name)
        valid = dt.datetime.strptime(str(meta['validityDate']) + f"{meta['validityTime']:04}", '%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
        ref = dt.datetime.strptime(str(meta['dataDate']) + f"{meta['dataTime']:04}", '%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
        if valid != finish or ref + dt.timedelta(hours=meta['startStep']) != begin or ref + dt.timedelta(hours=meta['endStep']) != finish: raise ValueError('Header and requested interval disagree ' + name)
        if meta['md5GridSection'] != grid: raise ValueError('Stage IV native grid differs from the frozen package ' + name)
        values = ec.codes_get_values(h); bitmap = ec.codes_get_array(h, 'bitmap') if meta['bitmapPresent'] else None
        out = np.full((len(mapping), len(mapping[0])), np.nan)
        for i, row in enumerate(mapping):
            for j, cell in enumerate(row):
                k = cell['index']; v = float(values[k])
                if (bitmap is not None and not bitmap[k]) or v == meta['missingValue'] or not np.isfinite(v) or v < 0: continue
                out[i, j] = v
    finally:
        ec.codes_release(h)
    src = {'product': 'NCEP Stage IV 01h via IEM', 'url': url, 'rawFile': 'raw-stage4/' + name, 'sha256': sha(b), 'bytes': len(b), 'start': iso(begin), 'end': iso(finish),
           'gribReferenceTime': iso(ref), 'delivery': delivery, 'httpLastModified': lm, 'retrievedAt': iso(dt.datetime.now(dt.timezone.utc)) if delivery == 'network' else None, 'metadata': meta,
           'missingCells': int(np.isnan(out).sum())}
    return out, src


def mrms(begin, raw, table, ys, xs):
    finish = begin + H; name = f'MRMS_MultiSensor_QPE_01H_Pass2_00.00_{finish:%Y%m%d-%H}0000.grib2.gz'
    url = f'https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MultiSensor_QPE_01H_Pass2_00.00/{finish:%Y%m%d}/{name}'
    b, lm, delivery = get(url, raw / name)
    h = ec.codes_new_from_message(gzip.decompress(b))
    keys = ['discipline', 'parameterCategory', 'parameterNumber', 'dataDate', 'dataTime', 'Ni', 'Nj', 'latitudeOfFirstGridPointInDegrees', 'longitudeOfFirstGridPointInDegrees', 'iDirectionIncrementInDegrees', 'jDirectionIncrementInDegrees', 'iScansNegatively', 'jScansPositively', 'jPointsAreConsecutive', 'productDefinitionTemplateNumber', 'stepType', 'bitmapPresent']
    meta = {k: ec.codes_get(h, k) for k in keys}
    assert (meta['discipline'], meta['parameterCategory'], meta['parameterNumber']) == (209, 6, 37)
    assert (meta['dataDate'], meta['dataTime']) == (int(f'{finish:%Y%m%d}'), int(f'{finish:%H}00'))
    assert not any(meta[k] for k in ['iScansNegatively', 'jScansPositively', 'jPointsAreConsecutive'])
    row = next(r for r in table if r['Discipline'] == '209' and r['Category'] == '6' and r['Parameter'] == '37'); assert row['Unit'] == 'mm'
    values = ec.codes_get_values(h); bitmap = ec.codes_get_array(h, 'bitmap') if meta['bitmapPresent'] else None; ec.codes_release(h)
    out = np.empty((len(ys), len(xs)))
    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            r = int(np.rint((meta['latitudeOfFirstGridPointInDegrees'] - y) / meta['jDirectionIncrementInDegrees'])); c = int(np.rint(((x % 360) - meta['longitudeOfFirstGridPointInDegrees']) / meta['iDirectionIncrementInDegrees']))
            idx = r * meta['Ni'] + c; v = values[idx]
            out[iy, ix] = np.nan if v < 0 or not np.isfinite(v) or (bitmap is not None and not bitmap[idx]) else v
    return out, {'product': 'NOAA MRMS MultiSensor QPE 01H Pass2', 'url': url, 'rawFile': 'raw-stage4/' + name, 'sha256': sha(b), 'bytes': len(b), 'start': iso(begin), 'end': iso(finish), 'delivery': delivery, 'httpLastModified': lm, 'gribMetadata': meta, 'missingCells': int(np.isnan(out).sum())}


def netcdf(values, times, ys, xs, path, role, note):
    crs = CRS.from_epsg(4326)
    da = xr.DataArray(values, dims=('time', 'y', 'x'), coords={'time': np.array([np.datetime64(t.replace(tzinfo=None), 'ns') for t in times]), 'y': ys, 'x': xs, 'spatial_ref': 0}, name='precip',
                      attrs={'units': 'mm/hour', 'grid_mapping': 'spatial_ref', 'data_role': role, 'interval_label': 'start', 'interval_seconds': 3600})
    da.x.attrs = {'axis': 'X', 'standard_name': 'longitude', 'units': 'degrees_east'}; da.y.attrs = {'axis': 'Y', 'standard_name': 'latitude', 'units': 'degrees_north'}
    da.spatial_ref.attrs = {**crs.to_cf(), 'spatial_ref': crs.to_wkt(), 'crs_wkt': crs.to_wkt()}
    ds = da.to_dataset(); ds.attrs['source_note'] = note; ds.to_netcdf(path, engine='netcdf4')


def main():
    p = argparse.ArgumentParser(); p.add_argument('--frozen', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--first', required=True); p.add_argument('--last', required=True); p.add_argument('--case-first', required=True); a = p.parse_args()
    t = lambda s: dt.datetime.strptime(s, '%Y-%m-%dT%H').replace(tzinfo=dt.timezone.utc)
    first, last, cfirst = t(a.first), t(a.last), t(a.case_first)
    prov = json.loads((a.frozen / 'initialization-rainfall/provenance.json').read_text()); mapping = prov['mapping']; grid = prov['nativeGridHash']
    with xr.open_dataset(a.frozen / 'precipitation.nc', decode_coords='all') as ds: ys, xs = ds.y.values.copy(), ds.x.values.copy()
    assert len(mapping) == len(ys) and len(mapping[0]) == len(xs)
    assert all(abs(mapping[i][0]['lat'] - ys[i]) < .05 for i in range(len(ys))) and all(abs(mapping[0][j]['lon'] - xs[j]) < .05 for j in range(len(xs)))
    a.output.mkdir(parents=True, exist_ok=True); raw = a.output / 'raw-stage4'; raw.mkdir(exist_ok=True)
    table = list(csv.DictReader((a.frozen / 'initialization-rainfall/raw/UserTable_MRMS_v12.2.csv').read_text(encoding='utf-8-sig').splitlines()))
    hours = []; cur = first
    while cur <= last: hours.append(cur); cur += H
    frames, sources, replaced = [], [], []
    for begin in hours:
        v, s = stage4(begin, raw, mapping, grid)
        if np.isnan(v).any():
            m, ms = mrms(begin, raw, table, ys, xs)
            if np.isnan(m).any(): raise SystemExit(f'{iso(begin)}: Stage IV missing {s["missingCells"]} cells and MRMS Pass2 incomplete; no zero-fill')
            replaced.append({'start': iso(begin), 'stage4MissingCells': s['missingCells'], 'mrms': ms}); s['replacedBy'] = 'MRMS Pass2'; v = m
        frames.append(v); sources.append(s); print(iso(begin), s['delivery'], 'missing', s['missingCells'], 'max', float(v.max()), flush=True)
    arr = np.array(frames); assert np.isfinite(arr).all()
    ci = hours.index(cfirst)
    netcdf(arr[ci:], hours[ci:], ys, xs, a.output / 'observed-extension-precipitation.nc', 'observation_based_analysis' if not any(r['start'] >= iso(cfirst) for r in replaced) else 'observation_based_analysis_mixed_sources',
           'Stage IV 01h (IEM) on the frozen brawley-avra-west-rainfall-v2 grid and mapping; explicit MRMS Pass2 replacement listed in observed-extension-metadata.json; no forecast, no zero-fill')
    if ci: netcdf(arr[:ci], hours[:ci], ys, xs, a.output / 'stage4-reference-precipitation.nc', 'observation_based_analysis_reference_not_forcing', 'Reference only: observed Stage IV for hours that the case forces with the frozen HRRR frames')
    meta = {'schemaVersion': 1, 'status': 'complete', 'purpose': 'Validation-only extended-window rain (brawley-avra-west v2x). Not live forcing.', 'units': 'mm/h', 'intervalSeconds': 3600, 'intervalLabel': 'start',
            'caseExtension': {'file': 'observed-extension-precipitation.nc', 'start': iso(cfirst), 'endExclusive': iso(last + H), 'frames': len(hours) - ci},
            'reference': {'file': 'stage4-reference-precipitation.nc' if ci else None, 'start': iso(first), 'endExclusive': iso(cfirst), 'frames': ci},
            'frozenPackage': str(a.frozen), 'nativeGridHash': grid, 'mapping': 'frozen initialization-rainfall/provenance.json mapping (nearest HRAP cell, < 5 km)',
            'conversion': 'GRIB one-hour tp kg/m2 -> mm accumulation -> numeric mm/h mean rate', 'replacements': replaced, 'sources': sources, 'missingCellHours': 0,
            'files': {f.name: {'sha256': sha(f.read_bytes()), 'bytes': f.stat().st_size} for f in a.output.glob('*.nc')},
            'stats': {iso(h): {'mean': float(arr[i].mean()), 'max': float(arr[i].max())} for i, h in enumerate(hours)}}
    (a.output / 'observed-extension-metadata.json').write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: meta[k] for k in ('caseExtension', 'reference')} | {'replaced': [r['start'] for r in replaced]}))


if __name__ == '__main__': main()
