"""Prepare published HydroGeom dimensions using the installed official HydroMT workflow."""
import hashlib,json,shutil,sys
from pathlib import Path
import geopandas as gpd
import numpy as np
from hydromt_sfincs import SfincsModel
from hydromt import DataCatalog
b=Path(sys.argv[1]);source=b/'.sfincs-runs/ci-41297523344/runs/reach-antecedent-2013';root=b/'.sfincs-runs/prefab-channel-preparation';out=b/'tools/sfincs/data/prefab-channel'
if root.exists():raise FileExistsError(root)
case=json.loads((source/'case.json').read_text());root.mkdir()
for item in case['inputArtifacts']:
 raw=(source/item['path']).read_bytes()
 assert hashlib.sha256(raw).hexdigest()==item['sha256']
 (root/item['path']).write_bytes(raw)
raw=json.loads((out/'hydrogeom-reaches.geojson').read_text());lookup={int(f['properties']['comid']):f['properties'] for f in raw['features']}
lines=gpd.read_file(b/'tools/sfincs/data/hand-river/cortaro-trico-flowpath.geojson').to_crs(32612)
lines['rivwth']=[lookup[int(k)]['bnk_width'] for k in lines.feature_id]
lines['rivdph']=[lookup[int(k)]['bnk_depth'] for k in lines.feature_id]
assert np.isfinite(lines[['rivwth','rivdph']].values).all() and (lines[['rivwth','rivdph']].values>0).all()
lines['manning']=.04  # Preserve prior roughness, not fit against target.
lines.to_file(out/'hydrogeom-hand-rivers.gpkg',driver='GPKG')
model=SfincsModel(root=str(root),mode='r+',write_gis=False);model.data_catalog=DataCatalog(fallback_lib=None);model.read()
model.setup_subgrid(datasets_dep=[{'elevtn':str((b/'tools/sfincs/data/reach-terrain-10m/terrain.tif').resolve())}],datasets_riv=[{'centerlines':lines}],nr_subgrid_pixels=10,nlevels=10,manning_land=.04,manning_sea=.04,huthresh=.01,write_dep_tif=True)
model.write_subgrid()
shutil.copy2(root/'sfincs_subgrid.nc',out/'sfincs_subgrid.nc')
meta={'method':'Official HydroMT-SFINCS 1.2.2 setup_subgrid(datasets_riv), internal burn_river_rect; no custom terrain surgery','documentation':'https://deltares.github.io/hydromt_sfincs/stable/_modules/hydromt_sfincs/workflows/bathymetry.html','publishedStudyFramework':'https://doi.org/10.5281/zenodo.16759100','widthField':'HydroGeom bnk_width in metres','depthField':'HydroGeom bnk_depth in metres','riverSegments':len(lines),'distinctComids':len(lookup),'roughness':.04,'bankQuantile':.5,'segmentLengthM':500,'subgridSha256':hashlib.sha256((out/'sfincs_subgrid.nc').read_bytes()).hexdigest(),'riverVectorSha256':hashlib.sha256((out/'hydrogeom-hand-rivers.gpkg').read_bytes()).hexdigest(),'sourcePointEPSG32612':[491030.431,3579398.680],'limitations':['Published ML estimates, not surveyed bed geometry; bankfull depth approximated as rectangular depth','Modern data may contain training observations after 2013; not independent historical geometry','Official workflow estimates bank level from terrain outside river mask; no absolute bed observations','No target-flow fitting; same geometry and placement for both events; lateral boundary flows remain absent']}
(out/'preparation.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta,indent=2))
