"""Shared readers for the Brawley stability diagnostics (read-only on run outputs).

Geometry, u/v-point order and the restart reader follow tools/sfincs/brawley/extend/validate_extended.py.
Subgrid flux depth follows the SFINCS subgrid momentum rule: zsuv = max(zs_nm, zs_nmu); below uv_zmax the
average depth is interpolated in uv_havg over equal level steps from uv_zmin to uv_zmax, above it the depth
is uv_havg[last] + (zsuv - uv_zmax).
"""
import math
from pathlib import Path

import numpy as np
import pyproj
import xarray as xr

TO_UTM = pyproj.Transformer.from_crs(4326, 32612, always_xy=True)
TO_LL = pyproj.Transformer.from_crs(32612, 4326, always_xy=True)


def run_dir(result):
    d = Path(result)
    c = d / 'artifact/runs/current'
    return c if c.exists() else d


class Geometry:
    def __init__(self, d, subgrid=True):
        q = xr.open_dataset(d / 'sfincs.nc')
        self.X0, self.Y0, self.DX = float(q.attrs['x0']), float(q.attrs['y0']), float(q.attrs['dx'])
        level = q['level'].values.astype(int); n = q['n'].values.astype(int); m = q['m'].values.astype(int)
        nb = {k: q[k].values.astype(np.int64) for k in ['mu', 'mu1', 'mu2', 'nu', 'nu1', 'nu2']}; q.close()
        self.NF = level.size; self.size = self.DX / 2.0 ** (level - 1); self.area = self.size ** 2
        self.xc = self.X0 + (m - 0.5) * self.size; self.yc = self.Y0 + (n - 0.5) * self.size
        nm, nmu, dirn = [], [], []
        for c in range(self.NF):
            for fl, a1, a2, dn in [('mu', 'mu1', 'mu2', 'u'), ('nu', 'nu1', 'nu2', 'v')]:
                if nb[a1][c] > 0: nm.append(c); nmu.append(nb[a1][c] - 1); dirn.append(dn)
                if nb[fl][c] >= 1 and nb[a2][c] > 0: nm.append(c); nmu.append(nb[a2][c] - 1); dirn.append(dn)
        self.nm = np.array(nm); self.nmu = np.array(nmu); self.dirn = np.array(dirn); self.NPUV = self.nm.size
        self.w = np.minimum(self.size[self.nm], self.size[self.nmu])
        mp = xr.open_dataset(d / 'sfincs_map.nc')
        self.msk = mp['msk'].values.astype(int); self.zb = mp['zb'].values.astype(np.float64)
        self.T = [str(t)[:16] + 'Z' for t in mp['time'].values]; mp.close()
        if subgrid:
            s = xr.open_dataset(d / 'sfincs_subgrid.nc')
            assert s.sizes['npuv'] == self.NPUV, (s.sizes['npuv'], self.NPUV)
            self.uv_zmin = s['uv_zmin'].values.astype(np.float64); self.uv_zmax = s['uv_zmax'].values.astype(np.float64)
            self.uv_havg = s['uv_havg'].values.astype(np.float64); self.uv_navg = s['uv_navg'].values.astype(np.float64)
            self.z_zmin = s['z_zmin'].values.astype(np.float64); self.z_zmax = s['z_zmax'].values.astype(np.float64)
            self.z_volmax = s['z_volmax'].values.astype(np.float64); s.close()

    def lonlat(self, f):
        lo, la = TO_LL.transform(float(self.xc[f]), float(self.yc[f])); return [round(lo, 5), round(la, 5)]

    def huv(self, zs, idx):
        """Subgrid average flux depth at u/v points idx for cell water levels zs."""
        zsuv = np.maximum(zs[self.nm[idx]], zs[self.nmu[idx]]); zmin = self.uv_zmin[idx]; zmax = self.uv_zmax[idx]
        hav = self.uv_havg[idx]; nl = hav.shape[1]; dz = (zmax - zmin) / (nl - 1)
        out = np.zeros(idx.size)
        above = zsuv >= zmax; out[above] = hav[above, -1] + (zsuv[above] - zmax[above])
        mid = (~above) & (zsuv > zmin)
        with np.errstate(invalid='ignore', divide='ignore'):
            fr = np.where(dz[mid] > 0, (zsuv[mid] - zmin[mid]) / dz[mid], 0.0)
        il = np.clip(np.floor(fr).astype(int), 0, nl - 2); t = fr - il; r = np.where(mid)[0]
        out[mid] = hav[r, il] * (1 - t) + hav[r, il + 1] * t
        return out, zsuv


def read_rst(path):
    b = Path(path).read_bytes(); recs, i = [], 0
    while i < len(b):
        n = int(np.frombuffer(b[i:i + 4], '<i4')[0]); recs.append(b[i + 4:i + 4 + n]); i += 8 + n
    return np.frombuffer(recs[1], '<f4').astype(np.float64), np.frombuffer(recs[2], '<f4').astype(np.float64), len(recs)


def rst_time(path):
    p = Path(path).name.split('.'); return f'{p[1][:4]}-{p[1][4:6]}-{p[1][6:8]}T{p[2][:2]}:00Z'
