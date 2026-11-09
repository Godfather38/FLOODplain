"""Copy a prepared (unpackaged) SFINCS native case folder and apply exactly ONE named change.

Usage (cwd = repo root):
  python tools/sfincs/brawley/variants/make_variant.py BASE OUT --name NAME --source "physical source" \
      (--infiltration-file FILE.nc --inftype cna|cnb|gai|c2d  |  --inp-set key=value)
      [--allow-coupled "reason the keys are one physical change" --inp-set key=value --inp-set key=value ...]

The change is one of two kinds, never both:
  --infiltration-file  replaces infiltration.nc with FILE.nc (copied under the name infiltration.nc) and sets
                       inftype in sfincs.inp; inffile stays infiltration.nc. The file must hold one value per
                       mesh2d_nFaces face of BASE/sfincs.nc, with the variables SFINCS reads for --inftype, and no NaN.
  --inp-set            sets ONE key in sfincs.inp. Several --inp-set are refused unless --allow-coupled gives the
                       reason they are one physical change (e.g. btfilter and btrelax); the reason is stored.
                       Keys are matched case-insensitively against the refusal lists and must be spelled exactly as
                       SFINCS f3647fc reads them (find_value in sfincs_read.f90 compares keys case-sensitively and
                       stops at the first match, so 'Alpha' or 'alpah' would be silently ignored). Refused: every
                       *file key (they point at other files), every time/run-window/output-timing key, and inftype
                       and its aliases.
Everything else is copied byte for byte. The script then verifies that the only files whose bytes differ are the
ones the change names (sfincs.inp and, for infiltration, infiltration.nc; current-case.json gets a
"variantChange" record), and prints the diff of every file. It refuses to write into an existing folder.
--source is required: every parameter change needs a physical source; it is stored in variantChange.
Package the result with tools/sfincs/package_route_case.py and labels that say SENSITIVITY.
"""
import argparse, difflib, hashlib, json, shutil, sys
from pathlib import Path

# Every keyword (and legacy alias) that read_sfincs_input() in Deltares/SFINCS commit f3647fc
# source/src/sfincs_input.f90 (sha256 6a4d365e54b57eee54673c3d4c977299961c8f671d4ea6c84f74bb33df4e943b) reads from
# sfincs.inp via get_keyword*/find_value: 234 names, all lowercase. Anything else is unknown or misspelt.
SFINCS_KEYS = frozenset([
    'advection', 'advection_mask', 'advection_scheme', 'advlim', 'alpha', 'ampfile', 'amprblock', 'amprfile',
    'amrfile', 'amufile', 'amvfile', 'baro', 'bathtub', 'bathtub_dt', 'bathtub_fachs', 'bcafile', 'bdrfile',
    'bndfile', 'bndtype', 'btfilter', 'btrelax', 'bzifile', 'bzsfile', 'cdnrb', 'cdval', 'cdwnd', 'coriolis',
    'crsfile', 'crsgeo', 'cstfile', 'debug', 'depfile', 'disfile', 'dkbfile', 'drnfile', 'dthisout', 'dtmapout',
    'dtmax', 'dtmaxout', 'dtout', 'dtoutfixed', 'dtrstout', 'dtwave', 'dtwnd', 'dx', 'dy', 'epsg', 'f0file',
    'factor_prcp', 'factor_pres', 'factor_spw_size', 'factor_wind', 'fcfile', 'freqmaxig', 'freqmaxinc',
    'freqminig', 'freqmininc', 'friction2d', 'gapres', 'global', 'global_model', 'h73table', 'hmin_cfl',
    'horton_kr_kd', 'huthresh', 'huvmin', 'indexfile', 'inffile', 'infiltration_file', 'infiltration_type',
    'infiltrationfile', 'infiltrationtype', 'inftype', 'inifile', 'inputformat', 'kdfile', 'ksfile', 'latitude',
    'manning', 'manning_land', 'manning_sea', 'manningfile', 'mmax', 'mskfile', 'nc_deflate_level', 'netampfile',
    'netamprfile', 'netamuamvfile', 'netbndbzsbzifile', 'netspwfile', 'netsrcdisfile', 'nfreqsig', 'nfreqsinc',
    'nh_fnudge', 'nh_itermax', 'nh_tol', 'nh_tstop', 'nmax', 'nonh', 'nuvisc', 'nuviscfac', 'obsfile',
    'output_on_quadtree_mesh', 'outputformat', 'outputtype_his', 'outputtype_map', 'pavbnd', 'percentage_done',
    'prcfile', 'prcpfile', 'precipfile', 'psifile', 'qinf', 'qinf_zmin', 'qinffile', 'qtrfile', 'radstr',
    'regular_output_on_mesh', 'rgh_lev_land', 'rhoa', 'rhow', 'rotation', 'rstfile', 'rugdepth', 'rugfile',
    'sbgfile', 'scsfile', 'sefffile', 'sfacinf', 'sigmafile', 'slopelim', 'smaxfile', 'snapwave',
    'snapwave_use_nearest', 'snapwave_vegetation', 'snapwave_waveforces_factor', 'snapwave_waveforces_ratio',
    'snapwave_wind', 'spinup_meteo', 'spwfile', 'spwmergefrac', 'srcfile', 'store_cumulative_urban_drainage',
    'store_dynamic_bed_level', 'store_river_discharge', 'store_tsunami_arrival_time',
    'store_urban_drainage_discharge', 'storecumprcp', 'storefluxmax', 'storefw', 'storehmean', 'storehsubgrid',
    'storemaxwind', 'storemeteo', 'storestoragevolume', 'storetwet', 'storetzsmax', 'storevel', 'storevelmax',
    'storewavdir', 'storezvolmax', 'storezvolume', 'structure_relax', 't0out', 't1out', 'thdfile', 'theta',
    'timestep_analysis', 'tref', 'trstout', 'tspinup', 'tstart', 'tstop', 'tsunami_arrival_threshold',
    'twet_threshold', 'urbfile', 'use_bcafile', 'usespwprecip', 'utmzone', 'uvlim', 'uvmax', 'vegetation',
    'vegetationfile', 'vegetationtype_toml', 'vegfile', 'vegtype', 'viscosity', 'volfile',
    'wave_enhanced_roughness', 'waveage', 'waveforces_ratio', 'wavemaker_filter_fred', 'wavemaker_filter_time',
    'wavemaker_freqmax_ig', 'wavemaker_freqmax_inc', 'wavemaker_freqmin_ig', 'wavemaker_freqmin_inc',
    'wavemaker_gammax', 'wavemaker_hig', 'wavemaker_hinc', 'wavemaker_hm0_ig_factor', 'wavemaker_hm0_inc_factor',
    'wavemaker_hmin', 'wavemaker_nfreqs_ig', 'wavemaker_nfreqs_inc', 'wavemaker_signal', 'wavemaker_surfslope',
    'wavemaker_timeseries_wvmfile', 'wavemaker_tinc2ig', 'wavemaker_tpmin', 'wavemaker_wfpfile',
    'wavemaker_whifile', 'wavemaker_wstfile', 'wavemaker_wtifile', 'wavemaker_wvmfile', 'weirfile', 'wfpfile',
    'whifile', 'wiggle_factor', 'wiggle_suppression', 'wiggle_threshold', 'wmfred', 'wmhmin', 'wmsignal',
    'wmtfilter', 'wndfile', 'writeruntime', 'wstfile', 'wtifile', 'wvmfile', 'x0', 'y0', 'z0lfile', 'zsini'
])
# Any key ending in 'file' points at another file (qinffile, ksfile, smaxfile, sefffile, psifile, sigmafile,
# precipfile, netamprfile, wndfile, inifile, weirfile, thdfile, drnfile, srcfile, disfile, ...). zsinifile and
# ncinifile are not read by f3647fc; they are listed so the refusal says 'file key', not only 'unknown'.
EXTRA_FILE_KEYS = {'zsinifile', 'ncinifile'}
# Time, run-window and output-timing keys: they change what is simulated or written, not the physics.
TIME_KEYS = {'tref', 'tstart', 'tstop', 'tspinup', 't0out', 't1out', 'dtout', 'dtmapout', 'dthisout', 'dtrstout',
             'trstout', 'dtmaxout'}
# inftype and its aliases change only through --infiltration-file.
INFILTRATION_TYPE_KEYS = {'inftype', 'infiltrationtype', 'infiltration_type'}
assert TIME_KEYS | INFILTRATION_TYPE_KEYS <= SFINCS_KEYS


def refuse_reason(key):
    """Why a key may not be set with --inp-set, or None. Matching is case-insensitive."""
    k = key.lower()
    if k.endswith('file') or k in EXTRA_FILE_KEYS:
        return 'a file key (points at another file)'
    if k in TIME_KEYS:
        return 'a time/run-window/output-timing key'
    if k in INFILTRATION_TYPE_KEYS:
        return 'the infiltration type (use --infiltration-file --inftype)'
    if k not in SFINCS_KEYS:
        return 'not a key SFINCS f3647fc reads (unknown or misspelt)'
    if key != k:
        return f'spelled {key!r}; SFINCS matches keys case-sensitively and reads only {k!r}'
    return None
INFTYPE_VARS = {'cna': ['scs'], 'cnb': ['smax', 'seff', 'ks'], 'gai': ['ksat', 'psi', 'sigma'], 'c2d': ['qinf']}


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 22), b''):
            h.update(b)
    return h.hexdigest()


def read_inp(p):
    """Return ([key, value, original line] rows, line ending) so untouched lines keep their bytes."""
    rows = []
    text = p.read_bytes().decode('utf-8')
    eol = '\r\n' if '\r\n' in text else '\n'
    for line in text.split(eol):
        if '=' in line:
            k, v = line.split('=', 1)
            rows.append([k.strip(), v.strip(), line])
        elif line.strip():
            raise ValueError(f'unparsed sfincs.inp line: {line!r}')
    return rows, eol


def write_inp(p, rows, eol):
    """Write back with the base file's own line ending, so untouched lines stay byte-identical."""
    p.write_bytes(''.join(r[2] + eol for r in rows).encode('utf-8'))


def set_key(rows, key, value):
    """Set key (exact SFINCS spelling). Refuses when the base holds the key twice or in another case, since
    SFINCS reads only the first exact-case match and the edit could land on a line SFINCS ignores."""
    w = len(rows[0][2].split('=', 1)[0]) if rows else 21
    hits = [r for r in rows if r[0].lower() == key.lower()]
    if len(hits) > 1:
        raise SystemExit(f'base sfincs.inp has {key} {len(hits)} times ({[r[0] for r in hits]}); refusing')
    if hits and hits[0][0] != key:
        raise SystemExit(f'base sfincs.inp spells {key} as {hits[0][0]!r}, which SFINCS ignores; refusing')
    if hits:
        r = hits[0]; old = r[1]; r[1] = value; r[2] = r[2].split('=', 1)[0] + '= ' + value; return old
    rows.append([key, value, key.ljust(w) + '= ' + value]); return None


def check_infiltration(nc, base, inftype, expect):
    import numpy as np, xarray as xr
    with xr.open_dataset(base / 'sfincs.nc') as m:
        nfaces = m.sizes['mesh2d_nFaces']
    with xr.open_dataset(nc) as ds:
        names = list(ds.data_vars)
        need = expect or INFTYPE_VARS.get(inftype)
        if need is None:
            raise SystemExit(f'unknown inftype {inftype}; pass --expect-vars naming the variables SFINCS reads')
        missing = [v for v in need if v not in names]
        if missing:
            raise SystemExit(f'{nc} lacks {missing} needed for inftype {inftype} (has {names})')
        stats = {}
        for v in names:
            a = ds[v]
            if a.dims != ('mesh2d_nFaces',) or a.size != nfaces:
                raise SystemExit(f'{v} has dims {a.dims} size {a.size}; need (mesh2d_nFaces,) size {nfaces}')
            x = a.values.astype('float64')
            if np.isnan(x).any():
                raise SystemExit(f'{v} has {int(np.isnan(x).sum())} NaN faces; refusing (no zero-fill)')
            stats[v] = {'min': float(x.min()), 'mean': float(x.mean()), 'max': float(x.max())}
    return stats


def nc_diff(a, b):
    import numpy as np, xarray as xr
    out = []
    with xr.open_dataset(a) as x, xr.open_dataset(b) as y:
        for v in sorted(set(x.variables) | set(y.variables)):
            if v not in x.variables or v not in y.variables:
                out.append(f'    {v}: only in {"new" if v in y.variables else "base"}'); continue
            p, q = x[v].values, y[v].values
            if p.shape != q.shape:
                out.append(f'    {v}: shape {p.shape} -> {q.shape}'); continue
            if p.dtype.kind in 'fc':
                ne = ~((p == q) | (np.isnan(p) & np.isnan(q)))
            else:
                ne = p != q
            n = int(np.count_nonzero(ne))
            if n:
                out.append(f'    {v}: {n} of {p.size} values differ')
        if dict(x.attrs) != dict(y.attrs):
            out.append('    global attributes differ')
    return out or ['    bytes differ but every variable and attribute is equal']


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('base', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--name', required=True, help='short name of the change, e.g. ARCI-cn')
    p.add_argument('--source', required=True, help='physical source of the change (cited into variantChange)')
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--infiltration-file', type=Path)
    g.add_argument('--inp-set', action='append', metavar='KEY=VALUE')
    p.add_argument('--allow-coupled', metavar='REASON',
                   help='permit more than one --inp-set; REASON (why the keys are one physical change) is stored')
    p.add_argument('--inftype', help='required with --infiltration-file')
    p.add_argument('--expect-vars', help='comma list overriding the variables required for --inftype')
    a = p.parse_args()

    base, out = a.base, a.output
    for f in ('sfincs.inp', 'sfincs.nc', 'current-case.json'):
        if not (base / f).is_file():
            raise SystemExit(f'{base} is not a prepared case folder (missing {f})')
    if out.exists():
        raise SystemExit(f'{out} exists; refusing to overwrite')
    if any(d.is_dir() for d in base.iterdir()):
        raise SystemExit(f'{base} has subfolders; expected a flat prepared case folder')
    rows, eol = read_inp(base / 'sfincs.inp')
    change = {'name': a.name, 'source': a.source, 'baseCase': str(base).replace('\\', '/')}
    allowed = {'sfincs.inp', 'current-case.json'}

    if a.infiltration_file:
        if not a.inftype:
            raise SystemExit('--infiltration-file needs --inftype')
        if a.allow_coupled:
            raise SystemExit('--allow-coupled applies only to --inp-set')
        if a.inftype not in INFTYPE_VARS and not a.expect_vars:
            raise SystemExit(f'--inftype {a.inftype!r}: use one of {sorted(INFTYPE_VARS)} (lowercase)')
        inffile = [r[1] for r in rows if r[0].lower() == 'inffile']
        inffile = inffile[0] if len(inffile) == 1 else (inffile or None)
        if inffile != 'infiltration.nc':
            raise SystemExit(f'base inffile is {inffile!r}, expected infiltration.nc')
        expect = a.expect_vars.split(',') if a.expect_vars else None
        stats = check_infiltration(a.infiltration_file, base, a.inftype, expect)
        allowed.add('infiltration.nc')
        change.update(kind='infiltration', file=str(a.infiltration_file).replace('\\', '/'),
                      fileSha256=sha(a.infiltration_file), variables=stats, inftype=a.inftype)
        sets = [('inftype', a.inftype)]
    else:
        sets = []
        if len(a.inp_set) > 1 and not (a.allow_coupled and a.allow_coupled.strip()):
            raise SystemExit(f'{len(a.inp_set)} --inp-set given; one change per variant. Pass --allow-coupled '
                             '"reason" only when the keys are one physical change')
        for kv in a.inp_set:
            if '=' not in kv:
                raise SystemExit(f'--inp-set needs key=value, got {kv!r}')
            k, v = (s.strip() for s in kv.split('=', 1))
            if not k or not v:
                raise SystemExit(f'empty key or value in {kv!r}')
            why = refuse_reason(k)
            if why:
                raise SystemExit(f'--inp-set {k}: refused, {why}')
            if k.lower() in {x.lower() for x, _ in sets}:
                raise SystemExit(f'{k} given twice')
            sets.append((k, v))
        change['kind'] = 'inp'
        if len(sets) > 1:
            change['coupledReason'] = a.allow_coupled.strip()

    trial = [list(r) for r in rows]  # run every refusal in set_key before anything is written
    for k, v in sets:
        set_key(trial, k, v)
    out.mkdir(parents=True)
    for f in sorted(base.iterdir()):
        shutil.copy2(f, out / f.name)
    if a.infiltration_file:
        shutil.copyfile(a.infiltration_file, out / 'infiltration.nc')
    changed = []
    for k, v in sets:
        old = set_key(rows, k, v)
        changed.append({'key': k, 'from': old, 'to': v})
        if old == v:
            print(f'warning: {k} already {v} in base', file=sys.stderr)
    change['inpChanges'] = changed
    write_inp(out / 'sfincs.inp', rows, eol)
    cc = json.loads((out / 'current-case.json').read_text(encoding='utf-8'))
    if 'variantChange' in cc:
        prior = cc['variantChange']
        change['priorVariantChanges'] = prior.get('priorVariantChanges', []) + [{k: prior[k] for k in prior if k != 'priorVariantChanges'}]
    cc['variantChange'] = change
    (out / 'current-case.json').write_bytes((json.dumps(cc, indent=2) + '\n').encode('utf-8'))

    print(f'variant {a.name}: {base} -> {out}')
    bad = []
    for f in sorted(base.iterdir()):
        g2 = out / f.name
        same = sha(f) == sha(g2)
        print(f'{"same   " if same else "CHANGED"} {f.name}')
        if same:
            continue
        if f.name not in allowed:
            bad.append(f.name)
        if f.suffix in ('.inp', '.json', '.txt', '.dis', '.src', '.log'):
            for line in difflib.unified_diff(f.read_text(encoding='utf-8').splitlines(),
                                             g2.read_text(encoding='utf-8').splitlines(), 'base/' + f.name,
                                             'new/' + f.name, n=0, lineterm=''):
                print('    ' + line)
        elif f.suffix == '.nc':
            print('\n'.join(nc_diff(f, g2)))
    extra = sorted({x.name for x in out.iterdir()} - {x.name for x in base.iterdir()})
    if extra or bad:
        shutil.rmtree(out)
        raise SystemExit(f'unexpected changes {bad} or extra files {extra}; output removed')
    print(json.dumps(change, indent=1))


if __name__ == '__main__':
    main()
