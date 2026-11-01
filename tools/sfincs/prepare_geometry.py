"""Import USGS fine terrain and connected NOAA river geometry with official HydroMT setup methods."""
import argparse,hashlib,json
from pathlib import Path
import geopandas as gpd
import numpy as np
import rasterio
from shapely.geometry import LineString
from hydromt_sfincs import SfincsModel
from hydromt import DataCatalog
from prepare_reach import prepare


def build(root,terrain,upstream,forcing,fine_terrain,rivers):
    root=Path(root);fine_terrain=Path(fine_terrain);rivers=Path(rivers)
    evidence=json.loads((fine_terrain/'provenance.json').read_text())
    if hashlib.sha256((fine_terrain/'terrain.tif').read_bytes()).hexdigest()!=evidence['sha256']:
        raise ValueError('Fine terrain provenance mismatch')
    with rasterio.open(fine_terrain/'terrain.tif') as ds:
        z=ds.read(1,masked=True)
        if ds.crs.to_epsg()!=32612 or ds.res!=(10.,10.) or np.ma.getmaskarray(z).any() or not np.isfinite(z).all():
            raise ValueError('Require complete raw metric 10 m terrain')
    prepare(root,terrain,upstream,forcing=forcing,dry_start=True)
    model=SfincsModel(root=str(root),mode='r+',write_gis=False)
    model.data_catalog=DataCatalog(fallback_lib=None)
    model.read()
    lines=gpd.read_file(rivers).to_crs(32612)
    lookup={int(row.HydroID):row.geometry for _,row in lines.iterrows()}
    # Orient published segments using their explicit downstream topology, not target observations.
    for i,row in lines.iterrows():
        next_line=lookup.get(int(row.NextDownID))
        coords=list(row.geometry.coords)
        if next_line is not None:
            from shapely.geometry import Point
            if Point(coords[0]).distance(next_line)<Point(coords[-1]).distance(next_line):
                lines.at[i,'geometry']=LineString(coords[::-1])
    before=int((model.mask.values==3).sum())
    model.setup_river_outflow(rivers=lines,reset_bounds=True,river_width=500,keep_rivers_geom=True)
    after=int((model.mask.values==3).sum())
    if not 0<after<before:
        raise ValueError(f'Expected localized downstream outflow, got {after} versus {before}')
    model.setup_subgrid(datasets_dep=[{'elevtn':str((fine_terrain/'terrain.tif').resolve())}],
                       nr_subgrid_pixels=10,nlevels=10,manning_land=.04,manning_sea=.04,
                       huthresh=.01,write_dep_tif=False)
    model.setup_config(storehsubgrid=True,storezvolume=True)
    # Preserve already-written rainfall/discharge inputs; do not reopen a lazily-read NetCDF for writing.
    model.write_grid();model.write_subgrid();model.write_config()
    case=json.loads((root/'case.json').read_text())
    case['geometryIntegration']={'method':'HydroMT-SFINCS setup_subgrid and setup_river_outflow',
        'documentation':'https://deltares.github.io/hydromt_sfincs/stable/_modules/hydromt_sfincs/sfincs.html',
        'terrain':evidence,'riverGeometrySha256':hashlib.sha256(rivers.read_bytes()).hexdigest(),
        'riverSource':json.loads(rivers.read_text())['metadata'],'originalOutflowCells':before,'outflowCells':after,
        'outflowWidthM':500,'outflowWidthBasis':'Explicit HydroMT default; not a surveyed channel/bridge opening',
        'subgridPixelsPerCell':10,'subgridLevels':10,'channelBurning':False,
        'depthDefinition':'cell-average water depth from native subgrid volume divided by full cell area'}
    case['limitations'][2]='Contemporary 10 m USGS terrain represented by native subgrid tables; no surveyed submerged bathymetry, bridges, culverts or 2014 morphology'
    case['limitations'][5]='Published directed river topology selects downstream open cells using HydroMT default 500 m width; other outer edges closed; omitted lateral boundary inflows remain unresolved'
    case['limitations'].append('NOAA HAND geometry is DEM-derived, not survey cross sections; synthetic rating curves and relative HAND heights are not used as absolute bed elevations')
    case['inputArtifacts']=[{'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(root.iterdir()) if p.is_file() and (p.name.startswith('sfincs.') or p.name.startswith('sfincs_') or p.name in {'sections.crs','rainfall.nc'})]
    (root/'case.json').write_text(json.dumps(case,indent=2)+'\n')
    print(json.dumps({'outflowCells':after,'previousOutflowCells':before,'subgridFile':model.config.get('sbgfile'),'channelBurning':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root')
    for name in ['terrain','upstream','forcing','fine-terrain','rivers']:p.add_argument('--'+name,required=True)
    a=p.parse_args();build(a.root,a.terrain,a.upstream,a.forcing,a.fine_terrain,a.rivers)
