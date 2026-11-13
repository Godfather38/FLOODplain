"""Prepare a 16-cell synthetic subgrid regression, never a geographic forecast."""
from pathlib import Path
import sys,json,hashlib,tarfile
import numpy as np
import pandas as pd
import rasterio
from rasterio.transform import from_origin
from hydromt import DataCatalog
from hydromt_sfincs import SfincsModel
root=Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
dem=root/'synthetic-dem.tif'
y,x=np.mgrid[:80,:80];z=(600+.002*x+.001*y).astype('float32')
with rasterio.open(dem,'w',driver='GTiff',height=80,width=80,count=1,dtype='float32',crs='EPSG:32612',transform=from_origin(499987.5,3600037.5,.625,.625),nodata=-9999) as f:f.write(z,1)
m=SfincsModel(root=str(root/'case'),mode='w',write_gis=False);m.data_catalog=DataCatalog(fallback_lib=None)
m.setup_grid(x0=500000,y0=3600000,dx=6.25,dy=6.25,nmax=4,mmax=4,rotation=0,epsg=32612)
m.set_grid(m.mask.copy(data=np.ones((4,4),dtype='uint8')),name='msk')
m.setup_dep(datasets_dep=[{'elevtn':str(dem.resolve())}])
m.setup_subgrid(datasets_dep=[{'elevtn':str(dem.resolve())}],nr_subgrid_pixels=10,nlevels=10,manning_land=.04,manning_sea=.04)
cn=m.mask.copy(data=np.full((4,4),75,dtype='float32'));cn.raster.set_nodata(-9999)
m.setup_cn_infiltration(cn=cn,antecedent_moisture=None)
m.setup_config(indexfile='sfincs.ind',mskfile='sfincs.msk',depfile='sfincs.dep',tref='20200101 000000',tstart='20200101 000000',tstop='20200101 040000',dtmapout=60,dtmaxout=3600,alpha=.5,dtmax=10,store_zvolume=1,zsini=0)
times=pd.to_datetime(['2020-01-01 00:00','2020-01-01 00:59','2020-01-01 01:00','2020-01-01 01:59','2020-01-01 02:00','2020-01-01 04:00'])
m.setup_precip_forcing(timeseries=pd.DataFrame({'precip':[1,1,100,100,0,0]},index=times))
m.write()
files=[{'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in (root/'case').iterdir() if p.is_file()]
meta={'kind':'synthetic-native-regression-not-forecast','cells':16,'cellSizeM':6.25,'hours':4,'rainMmPerHour':[1,100,0],'curveNumber':75,'boundary':'closed','purpose':'rain/infiltration cancellation and positive wet-volume control','limitations':['Regular subgrid, not production quadtree','No real road or current forecast coverage validation'],'files':files}
(root/'fixture.json').write_text(json.dumps(meta,indent=2))
with tarfile.open(root/'fixture.tar.gz','w:gz') as t:
 for p in (root/'case').iterdir():
  if p.is_file():t.add(p,arcname=p.name)
print(json.dumps(meta))

