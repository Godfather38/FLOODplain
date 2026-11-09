"""Compare a channel-n SENSITIVITY subgrid table with its baseline (same mesh). No solver.

Checks that every elevation/volume variable is identical (only roughness-dependent variables may differ) and
reports uv_navg (mean Manning n per velocity point) inside and outside channel-mask.geojson. UV points are rebuilt
in the same order as the official builder (subgrid_quadtree_builder.py: per cell mu1, mu2, nu1, nu2) and placed at
the midpoint of the two face centres.
Usage: python compare_subgrid_n.py --mesh MESH.nc --baseline P_BASE --variant P_V2N [--output report.json]"""
import argparse,json
from pathlib import Path
import numpy as np,xarray as xr,xugrid as xu,geopandas as gpd
from shapely import contains_xy

def uv_points(grid):
 mu=grid['mu'].values;nu=grid['nu'].values;mu1=grid['mu1'].values-1;mu2=grid['mu2'].values-1;nu1=grid['nu1'].values-1;nu2=grid['nu2'].values-1
 nm=[];nmu=[]
 for ic in range(len(mu)):
  for nb in ([mu1[ic]] if mu[ic]<=0 else [mu1[ic],mu2[ic]]):
   if nb>=0:nm.append(ic);nmu.append(nb)
  for nb in ([nu1[ic]] if nu[ic]<=0 else [nu1[ic],nu2[ic]]):
   if nb>=0:nm.append(ic);nmu.append(nb)
 xy=grid.ugrid.grid.face_coordinates;nm=np.array(nm);nmu=np.array(nmu)
 return (xy[nm]+xy[nmu])/2

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--mesh',type=Path,required=True);p.add_argument('--baseline',type=Path,required=True);p.add_argument('--variant',type=Path,required=True);p.add_argument('--output',type=Path);a=p.parse_args()
 b=xr.open_dataset(a.baseline/'sfincs_subgrid.nc');v=xr.open_dataset(a.variant/'sfincs_subgrid.nc');grid=xu.open_dataset(a.mesh)
 uv=uv_points(grid)
 if len(uv)!=b.sizes['npuv']:raise ValueError(f'uv reconstruction {len(uv)} != table {b.sizes["npuv"]}')
 same={k:bool(np.array_equal(b[k].values,v[k].values,equal_nan=True)) for k in b.data_vars}
 for k in ('z_zmin','z_zmax','z_volmax','z_level','uv_zmin','uv_zmax'):
  if not same[k]:raise ValueError(f'{k} differs: the variant changed more than roughness')
 mask=gpd.read_file(a.variant/'channel-mask.geojson').to_crs(32612).geometry.union_all();inside=contains_xy(mask,uv[:,0],uv[:,1])
 nb=b.uv_navg.values;nv=v.uv_navg.values;d=nv-nb
 def stats(x):return {'n':int(x.size),'mean':round(float(np.nanmean(x)),5) if x.size else None,'p10':round(float(np.nanpercentile(x,10)),5) if x.size else None,'median':round(float(np.nanmedian(x)),5) if x.size else None,'p90':round(float(np.nanpercentile(x,90)),5) if x.size else None}
 rep={'sensitivityVariant':True,'identical':same,'uvPoints':int(len(uv)),'uvInsideMask':int(inside.sum()),'uvNavgBaselineInside':stats(nb[inside]),'uvNavgVariantInside':stats(nv[inside]),'uvNavgBaselineOutside':stats(nb[~inside]),'uvNavgVariantOutside':stats(nv[~inside]),
  'changedUv':int((np.abs(d)>1e-7).sum()),'changedUvOutsideMask':int((np.abs(d[~inside])>1e-7).sum()),'maxAbsChangeOutsideMask':round(float(np.abs(d[~inside]).max()),5) if (~inside).any() else 0.,'note':'Changes just outside the mask come from the 10 m n raster being interpolated linearly onto subgrid pixels (edge blending) and from centreline pixels burned all-touched.'}
 s=json.dumps(rep,indent=2);print(s)
 if a.output:a.output.write_text(s+'\n',encoding='utf-8')
if __name__=='__main__':main()
