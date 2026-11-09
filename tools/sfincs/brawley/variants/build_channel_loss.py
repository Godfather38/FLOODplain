"""SENSITIVITY: channel transmission loss on top of a prepared SFINCS case, with NO solver change.

Route (SFINCS f3647fc, source/src/sfincs_urban_drainage.f90): an `injection_well` urban-drainage zone removes water
from every wet cell of its polygon and does not return it to the model:
    qmax(nm) = injection_rate * cell_area(nm) / zone_area          (initialize_urban_drainage, pass 2)
    qd       = min(qmax(nm), z_volume(nm) / dt)  when zs > subgrid_z_zmin   (update_urban_drainage, subgrid)
    qsrc(nm) -= qd
so it is a depth-limited (never more than the water present) sink on standing or routed water, which runs ALONGSIDE
any inftype (here cnb, which acts on rainfall only). Cells are stamped by cell centre (z_xz, z_yz, real*4) inside a
named tek polygon; last zone wins on overlap; zones stop at maximum_capacity (set far above any possible volume).

Loss rate: one published value, not tuned. NRCS NEH Part 630 Ch. 19 Transmission Losses (Aug 2007), Table 19C-2
(Wilson, DeCook & Neuman 1980, from Matlock 1965 streamflow data): "Average for Tucson area" effective hydraulic
conductivity K = 1.65 in/h = 41.91 mm/h (Santa Cruz, Rillito, Pantano reach ranges 0.5-5.5 in/h). It lies in
Table 19-1 bed group 3 "moderately high loss rate, sand and gravel mixture with low silt-clay content" (1.0-3.0 in/h)
and next to the Walnut Gulch fitted K of 1.03-1.55 in/h (Table 19C-1, Lane, Ferreira & Shirley 1980).

Where: faces whose centre lies in the v2n lidar-centred sand-bed channel mask (NHD order >= 3 buffered by the
lidar half-depth width; tools/sfincs/brawley/sensitivity/prepare_parameters_channel_n.py), msk 1 only. Loss area:
K acts on the channel-bed area, not on the whole cell. Each zone's injection_rate = K * area(mask n zone cells), so
SFINCS spreads exactly K x bed area over the zone's cells when they are wet (a cell larger than the bed loses at
K * bed fraction). This keeps the loss volume tied to the measured bed width, not to the quadtree cell size.

Zones: the selected cell squares are dissolved; every hole is opened by a vertical cut 1.0 m right of a cell edge
(never within 1 m of any cell centre, which all lie on 3.125 m offsets of the 6.25 m grid), so each part has no
interior ring; each part is one zone and one named tek polygon. The script then replays the SFINCS stamping
(float32 centres, point in polygon, last wins) and refuses unless the stamped set equals the selected set exactly.

  python -I tools/sfincs/brawley/variants/build_channel_loss.py --base .sfincs-runs/brawley-avra-west-case-v3l-obsrain-cnb \
      --mask .sfincs-runs/brawley-avra-west-parameters-v2n/channel-mask.geojson \
      --output .sfincs-runs/brawley-avra-west-case-v3l-obsrain-cnb-chl --report <report.json>
Writes the variant case folder (copy of base + sfincs.urb + channel-loss.tek, sfincs.inp gains urbfile and the two
urban-drainage store keys, current-case.json gets variantChange) and verifies that nothing else changed.
"""
import argparse, hashlib, json, shutil, sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import xarray as xr
from shapely import contains_xy
from shapely.geometry import LineString, Polygon, box
from shapely.ops import split, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_variant import read_inp, set_key, sha, write_inp  # noqa: E402

K_IN_H = 1.65
K_MM_H = K_IN_H * 25.4
K_SOURCE = ('NRCS NEH Part 630 Ch. 19 Transmission Losses (210-VI-NEH, Aug 2007) Table 19C-2, Wilson, DeCook & '
            'Neuman (1980) from Matlock (1965) streamflow data: "Average for Tucson area" effective hydraulic '
            'conductivity 1.65 in/h (reach ranges: Santa Cruz 1.5-3.4 and 3.2-3.7, Rillito 0.5-3.3 and 2.2-5.5, '
            'Pantano 1.6-2.0 in/h); bed group 3 of Table 19-1 (sand and gravel, low silt-clay, 1.0-3.0 in/h); '
            'Walnut Gulch fitted K 1.03-1.55 in/h (Table 19C-1, Lane, Ferreira & Shirley 1980)')
CAPACITY = 1.0e12  # m3; far above the whole event volume, so the cap never binds


def centres(q):
    """Cell centres exactly as SFINCS sfincs_domain.f90 builds z_xz/z_yz (rotation 0), in float32."""
    lev = q['level'].values.astype(np.int64)
    dx = np.float32(q.attrs['dx']) / np.float32(2.0) ** (lev - 1).astype(np.float32)
    dy = np.float32(q.attrs['dy']) / np.float32(2.0) ** (lev - 1).astype(np.float32)
    n = q['n'].values.astype(np.float32); m = q['m'].values.astype(np.float32)
    x = (np.float32(q.attrs['x0']) + (m - np.float32(0.5)) * dx).astype(np.float32)
    y = (np.float32(q.attrs['y0']) + (n - np.float32(0.5)) * dy).astype(np.float32)
    return x, y, dx.astype(np.float64), dy.astype(np.float64)


def open_holes(poly):
    """Split a polygon with vertical cuts until no part has an interior ring."""
    todo, done = [poly], []
    while todo:
        p = todo.pop()
        if not p.interiors:
            done.append(p); continue
        xmin = min(Polygon(r).bounds[0] for r in p.interiors)
        cut = LineString([(xmin + 1.0, p.bounds[1] - 10), (xmin + 1.0, p.bounds[3] + 10)])
        parts = [g for g in split(p, cut).geoms if g.area > 0]
        if len(parts) < 2:
            raise SystemExit('hole cut failed')
        todo += parts
    return done


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', type=Path, required=True); ap.add_argument('--mask', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True); ap.add_argument('--report', type=Path, required=True)
    a = ap.parse_args()
    if a.output.exists():
        raise SystemExit(f'{a.output} exists; refusing to overwrite')
    rows, eol = read_inp(a.base / 'sfincs.inp')
    inp = {r[0]: r[1] for r in rows}
    if inp.get('inftype') != 'cnb' or 'urbfile' in inp:
        raise SystemExit('base must be the cnb case without an urbfile')

    q = xr.open_dataset(a.base / 'sfincs.nc')
    if float(q.attrs.get('rotation', 0.0)) != 0.0:
        raise SystemExit('rotated grid not handled')
    x, y, dx, dy = centres(q); msk = q['mask'].values; q.close()
    area = dx * dy
    mask = gpd.read_file(a.mask).to_crs(32612)
    bed = unary_union(mask.geometry.values)
    sel = contains_xy(bed, x.astype(np.float64), y.astype(np.float64)) & (msk == 1)
    idx = np.where(sel)[0]
    cells = [box(x[i] - dx[i] / 2, y[i] - dy[i] / 2, x[i] + dx[i] / 2, y[i] + dy[i] / 2) for i in idx]
    merged = unary_union(cells)
    geoms = list(getattr(merged, 'geoms', [merged]))
    parts = [g for p in geoms for g in open_holes(p)]
    parts.sort(key=lambda g: (-g.area, g.bounds))

    # Replay SFINCS stamping on float32 centres: every active face, every polygon, last wins.
    stamp = np.zeros(len(x), dtype=np.int64)
    xs, ys = x.astype(np.float64), y.astype(np.float64)
    for iz, g in enumerate(parts, start=1):
        ext = Polygon(np.asarray(g.exterior.coords, dtype=np.float32).astype(np.float64))
        b = ext.bounds
        cand = np.where((xs >= b[0]) & (xs <= b[2]) & (ys >= b[1]) & (ys <= b[3]))[0]
        inside = cand[contains_xy(ext, xs[cand], ys[cand])]
        stamp[inside] = iz
    # Cut slivers that hold no cell centre stamp nothing; drop them (the replay above already included them).
    keep = [iz for iz in range(1, len(parts) + 1) if (stamp == iz).any()]
    dropped = len(parts) - len(keep)
    remap = np.zeros(len(parts) + 1, dtype=np.int64); remap[keep] = np.arange(1, len(keep) + 1)
    stamp = remap[stamp]; parts = [parts[iz - 1] for iz in keep]
    if not np.array_equal(stamp > 0, sel):
        raise SystemExit(f'stamp mismatch: {int(((stamp > 0) & ~sel).sum())} extra, {int((sel & (stamp == 0)).sum())} missing')

    k_ms = K_MM_H / 1000.0 / 3600.0
    zones, tek = [], []
    for iz, g in enumerate(parts, start=1):
        f = np.where(stamp == iz)[0]
        if len(f) == 0:
            raise SystemExit(f'zone {iz} has no cells')
        cell_area = float(area[f].sum())
        bed_area = float(unary_union([cells[np.searchsorted(idx, i)] for i in f]).intersection(bed).area)
        name = f'chl{iz:04d}'
        zones.append({'name': name, 'cells': int(len(f)), 'cellAreaM2': cell_area, 'bedAreaM2': bed_area,
                      'injectionRateM3s': bed_area * k_ms, 'lossRateOnCellMmH': K_MM_H * bed_area / cell_area})
        co = np.asarray(g.exterior.coords)
        tek.append(f'{name}\n{len(co)} 2\n' + ''.join(f'{c[0]:.3f} {c[1]:.3f}\n' for c in co))
    urb = ['# SENSITIVITY channel transmission loss (injection_well sink, water leaves the model)',
           f'# K = {K_IN_H} in/h = {K_MM_H:.2f} mm/h on the channel-bed area of each zone; source: NEH 630 Ch.19 Table 19C-2',
           '# built by tools/sfincs/brawley/variants/build_channel_loss.py', '']
    for z in zones:
        urb += ['[[urban_drainage_zone]]', f'name = "{z["name"]}"', 'type = "injection_well"',
                'polygon_file = "channel-loss.tek"', f'injection_rate = {z["injectionRateM3s"]:.9e}',
                f'maximum_capacity = {CAPACITY:.1e}', 'h_threshold = 0.0', '']

    base = a.base; out = a.output
    out.mkdir(parents=True)
    for f in sorted(base.iterdir()):
        if f.is_dir():
            shutil.rmtree(out); raise SystemExit('base has subfolders')
        shutil.copy2(f, out / f.name)
    with open(out / 'channel-loss.tek', 'w', newline='\n') as fh:
        fh.write(''.join(tek))
    with open(out / 'sfincs.urb', 'w', newline='\n') as fh:
        fh.write('\n'.join(urb))
    changes = []
    for k, v in (('urbfile', 'sfincs.urb'), ('store_cumulative_urban_drainage', '1'), ('store_urban_drainage_discharge', '1')):
        changes.append({'key': k, 'from': set_key(rows, k, v), 'to': v})
    write_inp(out / 'sfincs.inp', rows, eol)

    totals = {'zones': len(zones), 'emptyCutSliversDropped': dropped, 'faces': int(sel.sum()), 'cellAreaKm2': sum(z['cellAreaM2'] for z in zones) / 1e6,
              'bedAreaInZoneCellsKm2': sum(z['bedAreaM2'] for z in zones) / 1e6, 'maskAreaKm2': bed.area / 1e6,
              'totalInjectionRateM3s': sum(z['injectionRateM3s'] for z in zones),
              'facesByLevel': {int(l): int(c) for l, c in zip(*np.unique(np.round(np.log2(100.0 / dx[sel])) + 1, return_counts=True))}}
    totals['lossVolumePerWetHourAllBedM3'] = totals['totalInjectionRateM3s'] * 3600
    change = {'name': 'channel-transmission-loss', 'kind': 'urban_drainage_injection_well',
              'source': K_SOURCE, 'kInH': K_IN_H, 'kMmH': K_MM_H, 'baseCase': str(base).replace('\\', '/'),
              'mask': str(a.mask).replace('\\', '/'), 'maskSha256': sha(a.mask),
              'solverRoute': 'SFINCS f3647fc sfincs_urban_drainage.f90 injection_well: qd = min(injection_rate*A_cell/A_zone, z_volume/dt) on wet cells, removed from the model; runs alongside inftype cnb',
              'inpChanges': changes, 'addedFiles': {'sfincs.urb': sha(out / 'sfincs.urb'), 'channel-loss.tek': sha(out / 'channel-loss.tek')},
              'totals': totals}
    cc = json.loads((out / 'current-case.json').read_text(encoding='utf-8'))
    if 'variantChange' in cc:
        prior = cc['variantChange']
        change['priorVariantChanges'] = prior.get('priorVariantChanges', []) + [{k: prior[k] for k in prior if k != 'priorVariantChanges'}]
    cc['variantChange'] = change
    (out / 'current-case.json').write_bytes((json.dumps(cc, indent=2) + '\n').encode('utf-8'))

    allowed = {'sfincs.inp', 'current-case.json'}
    bad = [f.name for f in base.iterdir() if f.name not in allowed and sha(f) != sha(out / f.name)]
    extra = sorted({p.name for p in out.iterdir()} - {p.name for p in base.iterdir()})
    if bad or extra != ['channel-loss.tek', 'sfincs.urb']:
        shutil.rmtree(out); raise SystemExit(f'unexpected changes {bad} / extra {extra}')
    report = {'label': 'SENSITIVITY - not for live registration; not tuned', 'variantChange': change, 'zones': zones}
    with open(a.report, 'w', newline='\n') as fh:
        fh.write(json.dumps(report, indent=1) + '\n')
    print(json.dumps(totals, indent=1))


if __name__ == '__main__':
    main()
