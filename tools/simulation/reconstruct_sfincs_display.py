"""Reconstruct display volume using SFINCS saved stage/storage tables; missing zs stays missing."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
import xarray as xr
p=argparse.ArgumentParser();p.add_argument('root');a=p.parse_args();root=Path(a.root)
with xr.open_dataset(root/'sfincs_map.nc') as ds,xr.open_dataset(root/'sfincs_subgrid.nc') as sub:
 mask=ds.msk.values>0; rows,cols=np.where(mask.T);rows,cols=cols,rows
 assert len(rows)==sub.sizes['np'];assert ds.zs.attrs['units']=='m'
 levels=sub.z_level.values;vmax=sub.z_volmax.values;zmax=sub.z_zmax.values
 assert np.all(np.diff(levels,axis=1)>=0)
 area=10000.0 # Actual frozen case dx=dy=100m; asserted from sfincs.inp below.
 inp=(root/'sfincs.inp').read_text();params={line.split('=')[0].strip():line.split('=')[1].strip() for line in inp.splitlines() if '=' in line};assert float(params['dx'])*float(params['dy'])==area
 z=ds.zs.transpose('time','n','m').values[:,rows,cols];volume=np.full_like(z,np.nan,dtype=float)
 for i in range(len(rows)):
  good=np.isfinite(z[:,i]);zs=z[good,i];iv=np.searchsorted(levels[i],zs,side='right')-1;iv=np.clip(iv,0,levels.shape[1]-2);dv=vmax[i]/(levels.shape[1]-1);fac=(zs-levels[i,iv])/np.maximum(levels[i,iv+1]-levels[i,iv],.001);vol=(iv+fac)*dv;vol=np.where(zs>=zmax[i],vmax[i]+area*(zs-zmax[i]),vol);volume[good,i]=np.maximum(vol,0)
 full=np.full(ds.zs.shape,np.nan);full[:,rows,cols]=volume
 result=xr.Dataset({'subgrid_volume':xr.DataArray(full,dims=ds.zs.dims,attrs={'units':'m3','derivation':'Reconstructed from native zs and saved SFINCS stage/storage table; not native time-varying volume output'}),'x':ds.x,'y':ds.y},coords={'time':ds.time});result.to_netcdf(root/'display-volume.nc');np.save(root/'active-mask.npy',mask)
 report={'method':'SFINCS compute_initial_subgrid_volumes stage/storage relation; regular projected grid, same saved z_level/z_volmax; .001m interpolation denominator floor','notNativeVolumeOutput':True,'missingWaterLevelsRemainMissing':True,'nativeMapSha256':hashlib.sha256((root/'sfincs_map.nc').read_bytes()).hexdigest(),'subgridSha256':hashlib.sha256((root/'sfincs_subgrid.nc').read_bytes()).hexdigest(),'maximumReconstructedDepthM':float(np.nanmax(volume)/area),'finiteCellFrames':int(np.isfinite(volume).sum()),'missingCellFrames':int(np.isnan(volume).sum()),'sourceFunction':'sfincs_subgrid.F90:compute_initial_subgrid_volumes','limitations':['Finite output precision and wet/dry masking prevent exact recovery of internal storage.','No inference of roadway depth or missing-cell dryness.']};(root/'display-reconstruction.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
