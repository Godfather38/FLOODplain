"""Loadable 2021 terrain/roughness model component; never executes SFINCS."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
import rasterio
import geopandas as gpd
import xarray as xr
from hydromt import DataCatalog, io
from hydromt_sfincs import SfincsModel


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--rasters',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--active-domain',type=Path)
    p.add_argument('--rivers',type=Path,help='Directed professional network for standard free-outflow boundary selection')
    p.add_argument('--cn-local',type=Path,help='Local-only licensed candidate; derived model must not be publicly redistributed')
    a=p.parse_args()
    if a.output.exists():raise FileExistsError('Preserve existing preparation')
    manifest=json.loads((a.rasters/'manifest.json').read_text())
    for item in manifest['artifacts']:
        if hashlib.sha256((a.rasters/item['path']).read_bytes()).hexdigest()!=item['sha256']:
            raise ValueError('Raster provenance mismatch')
    mapping=pd.read_csv(a.rasters/'esa_worldcover_mapping.csv',index_col=0)
    with rasterio.open(a.rasters/'lulc.tif') as r:classes=np.unique(r.read(1))
    if any(c not in mapping.index or mapping.loc[c,'N']<=0 for c in classes):
        raise ValueError('Unmapped/nonphysical roughness class')
    model=SfincsModel(root=str(a.output),mode='w',write_gis=False)
    model.data_catalog=DataCatalog(fallback_lib=None)
    xmin,ymin,xmax,ymax=manifest['bounds']
    nx,ny=int((xmax-xmin)/100),int((ymax-ymin)/100)
    model.setup_grid(x0=xmin,y0=ymin,dx=100,dy=100,nmax=ny,mmax=nx,rotation=0,epsg=32612)
    model.set_grid(model.mask.copy(data=np.ones((ny,nx),dtype=np.uint8)),name='msk')
    dep=[{'elevtn':str((a.rasters/'terrain.tif').resolve())}]
    model.setup_dep(datasets_dep=dep)
    if a.active_domain:
        region=gpd.read_file(a.active_domain).to_crs(model.crs)
        model.setup_mask_active(mask=region,fill_area=0,drop_area=0,all_touched=False)
    if a.rivers:
        rivers=gpd.read_file(a.rivers).to_crs(model.crs)
        if 'flowdir' in rivers and set(rivers.flowdir)!={'With Digitized'}:raise ValueError('Unverified river direction')
        model.setup_river_outflow(rivers=rivers,river_upa=0,river_len=0,river_width=500,
                                  keep_rivers_geom=True,reset_bounds=True)
        if not (model.mask.values==3).any():raise ValueError('No free-outflow cells established')
    lulc=io.open_raster(str(a.rasters/'lulc.tif')).rename('lulc')
    model.setup_subgrid(datasets_dep=dep,
        datasets_rgh=[{'lulc':lulc,'reclass_table':str((a.rasters/'esa_worldcover_mapping.csv').resolve())}],
        nr_subgrid_pixels=10,nlevels=10,write_dep_tif=True,write_man_tif=True)
    cn_info=None
    if a.cn_local:
        cn=io.open_raster(str(a.cn_local)).rename('cn')
        if not np.isfinite(cn.values).all() or (cn.values<=0).any() or (cn.values>100).any():
            raise ValueError('Invalid curve-number source')
        model.setup_cn_infiltration(cn=cn,antecedent_moisture=None)
        if not np.isfinite(model.grid['scs'].values[model.mask.values>0]).all():raise ValueError('Missing SCS retention')
        cn_info={'source':str(a.cn_local),'sha256':hashlib.sha256(a.cn_local.read_bytes()).hexdigest(),
                 'assumption':'GCN10 fair cover / ARCII average / undrained scenario, not observed moisture',
                 'nativeRetentionUnits':'inches','method':'official setup_cn_infiltration antecedent_moisture=None',
                 'retentionRangeInches':[float(model.grid['scs'].values[model.mask.values>0].min()),float(model.grid['scs'].values[model.mask.values>0].max())],
                 'publicRedistribution':'withheld pending source license resolution'}
    # No arbitrary infiltration, dry start, boundary hydrograph, or run period.
    for key in ['qinf','zsini','tstart','tstop','tref']:
        model.config.pop(key,None)
    model.setup_config(indexfile='sfincs.ind',mskfile='sfincs.msk',depfile='sfincs.dep',
                       tref=datetime.now(timezone.utc).strftime('%Y%m%d 000000'))
    model.write()
    for handler in list(model.logger.handlers):handler.close();model.logger.removeHandler(handler)
    reopened=SfincsModel(root=str(a.output),mode='r',write_gis=False)
    reopened.data_catalog=DataCatalog(fallback_lib=None);reopened.read()
    with xr.open_dataset(a.output/'sfincs_subgrid.nc') as ds:
        for name in ds.data_vars:
            if not np.isfinite(ds[name].values).all():raise ValueError('Invalid subgrid '+name)
        variables={k:list(v.shape) for k,v in ds.data_vars.items()}
    artifacts=[{'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
               for p in a.output.glob('sfincs*') if p.is_file()]
    result={'schemaVersion':1,'kind':'current_geometry_component','loadable':True,'runReady':False,
            'infiltration':cn_info,'activeCells':int((model.mask.values>0).sum()),'outflowCells':int((model.mask.values==3).sum()),
            'outflowMethod':'Official HydroMT directed river outflow;500m default corridor; downstream tailwater not prescribed',
            'activeDomain':str(a.active_domain) if a.active_domain else None,
            'sourceManifest':manifest,'roughnessClasses':{str(c):float(mapping.loc[c,'N']) for c in classes},
            'roughnessAppliedInSubgrid':True,'channelBurning':False,'solverExecuted':False,
            'timeReferenceRole':'Serialization epoch only; no forecast time window or forcing supplied',
            'subgridVariables':variables,'artifacts':artifacts,
            'unfilledFields':[
                'Four external NHD inlet series with catchment-aligned rainfall partition',
                'Complete HRRR forcing issue with native accumulation semantics',
                'Measured antecedent moisture and channel transmission losses remain unknown; imported ARCII is a scenario' if cn_info else 'Supported infiltration/loss parameters and antecedent moisture assumption',
                'Initial hydraulic state and open-boundary configuration',
                'Relevant structure openings/inverts where missing; localized 2026 Cortaro works',
                'Channel-bed adequacy at wetted reaches; no fabricated bathymetry']}
    (a.output/'model-component.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'output':str(a.output),'loadable':True,'runReady':False,'roughnessClasses':result['roughnessClasses']},indent=2))


if __name__=='__main__':main()
