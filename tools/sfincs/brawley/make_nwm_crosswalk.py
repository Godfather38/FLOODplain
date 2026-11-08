"""Build the brawley-avra-west NWM feature_id crosswalk from one archived channel_rt file.

  python tools/sfincs/brawley/make_nwm_crosswalk.py <channel_rt.nc> <source-url> <out.json> --check <other channel_rt.nc>
"""
import argparse, hashlib, json
from pathlib import Path
import numpy as np, xarray as xr

REACHES = ['15876941', '15876923', '15876919', '15876811', '15876815', '15876711', '15876707']

def indices(path):
    with xr.open_dataset(path, engine='h5netcdf', decode_times=False) as ds:
        fid = ds.feature_id.values.astype('int64'); attrs = {k: str(v) for k, v in ds.attrs.items()}
        units = ds.streamflow.attrs.get('units')
    pos = {int(v): i for i, v in enumerate(fid)}
    return {r: pos.get(int(r)) for r in REACHES}, attrs, units, len(fid)

def main():
    p = argparse.ArgumentParser(); p.add_argument('nc', type=Path); p.add_argument('url'); p.add_argument('out', type=Path); p.add_argument('--check', type=Path)
    a = p.parse_args()
    idx, attrs, units, n = indices(a.nc)
    found = {k: v for k, v in idx.items() if v is not None}; missing = [k for k, v in idx.items() if v is None]
    out = {'sourceUrl': a.url, 'sha256': hashlib.sha256(a.nc.read_bytes()).hexdigest(), 'featureCount': n, 'indices': found, 'missing': missing, 'units': units,
           'attributes': {k: attrs[k] for k in ('model_initialization_time', 'model_output_valid_time', 'model_configuration', 'NWM_version_number') if k in attrs},
           'caseInletReachIds': ['15876941'], 'validationReachIds': [r for r in REACHES if r != '15876941']}
    if a.check:
        idx2, attrs2, _, n2 = indices(a.check)
        same = idx2 == idx and n2 == n
        out['orderCheck'] = {'file': a.check.name, 'featureCount': n2, 'sameIndices': same, 'model_configuration': attrs2.get('model_configuration')}
        if not same: raise SystemExit('feature ordering differs between files')
    a.out.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8'); print(json.dumps(out, indent=1))

if __name__ == '__main__': main()
