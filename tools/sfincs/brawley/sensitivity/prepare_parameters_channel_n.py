"""SENSITIVITY copy of tools/sfincs/prepare_route_case_parameters.py: same Deltares quadtree subgrid and HydroMT CN
parameter intake, except that Manning n inside a sand-bed channel mask (NHD flowlines of stream order >= --min-order
inside the active domain, buffered by half the lidar-measured channel width) is set to one documented value.
Everything else (terrain sources and their priority, WorldCover mapping outside the mask, builder settings,
infiltration) is unchanged. No solver run. Not a calibrated or validated roughness; label results as sensitivity.

Channel n (default 0.030): Chow (1959) Open-Channel Hydraulics, Table 5-6, A-1 natural minor streams,
"clean, straight, full stage, no rifts or deep pools": minimum 0.025, normal 0.030, maximum 0.033. The normal value
is used. It sits inside the range built with Arcement & Schneider (1989, USGS WSP 2339) for a sand channel:
Table 1 base n 0.012-0.026 for median grain 0.2-1.0 mm, plus minor irregularity (0.001-0.005) and small
vegetation (0.002-0.010), giving about 0.015-0.041. Values are quoted from the published tables as recalled;
check them against the source before citing outside this sensitivity test.

Channel width: measured on the 1 m lidar windows the subgrid build uses (same files, same later-wins priority).
A cross-section perpendicular to the NHD line every --spacing m (half-length 150/200/400 m for order 3/4/5+) is
smoothed with a 9 m running median. The thalweg is the lowest smoothed point within the middle half of the section.
Incision D = section median - thalweg. If D >= 0.3 m, the width is the contiguous run around the thalweg below
thalweg + D/2 (half-depth width). It is rejected if the run reaches either end of the section. Sections with no
lidar, no incision or an unbounded run take the reach median of the valid widths. Failing that, the order median of
all valid widths in the domain, and failing that --fixed-width for that order.

Mask geometry: each section paints a rectangle as wide as its width and --spacing long (along the NHD tangent).
--centerline lidar (default) centres the rectangle on the measured channel (the middle of the half-depth run) where
the section is valid, and on the NHD line otherwise. --centerline nhd always centres it on the NHD line, which is
the literal "NHD buffered by half the width". NHD (1:100k) is often tens to hundreds of m off the lidar channel
here; channel-report.json reports how often. The mask is burned into the 10 m WorldCover-derived n raster by pixel
centre, and every NHD centreline pixel is also burned (all touched), so the effective minimum width is 1 pixel (10 m).
"""
import argparse,importlib.util,json,hashlib,re
from pathlib import Path
import numpy as np,pandas as pd,xarray as xr,xugrid as xu,rioxarray
import geopandas as gpd,rasterio
from rasterio import features
from shapely.geometry import Polygon,LineString,mapping
from pyproj import CRS
from cht_bathymetry.database import BathymetryDatabase
from hydromt_sfincs.workflows import cn_to_s

HALF_LENGTH={3:150.,4:200.}  # order >= 5: 400 m
FIXED_WIDTH={3:10.,4:25.,5:40.,6:60.}  # last-resort widths only (used when no valid lidar width exists at all)
SOURCES={'channelN':'Chow 1959 Open-Channel Hydraulics Table 5-6 A-1a natural minor stream, clean, straight, full stage: min 0.025 / normal 0.030 / max 0.033 (normal used)','crossCheck':'Arcement & Schneider 1989 USGS WSP 2339 Table 1 sand channel base n 0.012-0.026 (0.2-1.0 mm) plus Table 2 minor irregularity 0.001-0.005 and small vegetation 0.002-0.010','widthMethod':'1 m lidar cross-sections, 9 m running median, half-depth width around the thalweg (D = section median - thalweg >= 0.3 m)'}

class Lidar:
 """Point sampler over 1 km x 1 km, 1 m terrain-1m-<x>-<y>.tif windows (later dict entries already won by name)."""
 def __init__(self,files):
  self.tiles={};self.cache={}
  for f in files:
   m=re.match(r'terrain-1m-(\d+)-(\d+)$',f.stem)
   if m:self.tiles[(int(m.group(1)),int(m.group(2)))]=f
 def tile(self,k):
  if k not in self.cache:
   if len(self.cache)>80:self.cache.pop(next(iter(self.cache)))
   with rasterio.open(self.tiles[k]) as s:
    t=s.transform
    if (abs(t.a-1)>1e-9 or abs(t.e+1)>1e-9 or abs(t.c-k[0])>1e-6 or abs(t.f-k[1]-1000)>1e-6 or s.shape!=(1000,1000)):raise ValueError(f'unexpected window grid {self.tiles[k]}')
    a=s.read(1).astype('float32')
    if s.nodata is not None:a[a==s.nodata]=np.nan
   self.cache[k]=a
  return self.cache[k]
 def sample(self,x,y):
  out=np.full(x.shape,np.nan);kx=(np.floor(x/1000)*1000).astype(int);ky=(np.floor(y/1000)*1000).astype(int)
  for k in set(zip(kx.tolist(),ky.tolist())):
   if k not in self.tiles:continue
   a=self.tile(k);s=(kx==k[0])&(ky==k[1])
   out[s]=a[np.clip((k[1]+1000-y[s]).astype(int),0,999),np.clip((x[s]-k[0]).astype(int),0,999)]
  return out

def measure(z,s,order):
 """Return (incision D, width, centre offset) for one section; width/centre None when not measurable."""
 if not np.isfinite(z).all():return None,None,None,'no_lidar'
 zs=pd.Series(z).rolling(9,center=True,min_periods=1).median().values
 mid=np.abs(s)<=s.max()/2;i0=int(np.where(mid)[0][np.argmin(zs[mid])]);z0=zs[i0];D=float(np.median(zs)-z0)
 if D<0.3:return D,None,None,'no_incision'
 w=zs<=z0+D/2;lo=hi=i0
 while lo>0 and w[lo-1]:lo-=1
 while hi<len(zs)-1 and w[hi+1]:hi+=1
 if lo==0 or hi==len(zs)-1:return D,None,None,'unbounded'
 return D,float(s[hi]-s[lo]+1),float((s[lo]+s[hi])/2),'measured'

def channel_mask(network,domain,lidar,min_order,spacing,centerline):
 rivers=gpd.read_file(network).to_crs(32612);dom=gpd.read_file(domain).to_crs(32612).geometry.union_all()
 rivers=rivers[rivers.streamorde>=min_order].copy();rivers['geometry']=rivers.geometry.intersection(dom);rivers=rivers[~rivers.geometry.is_empty]
 rows=[];lines=[]
 for _,r in rivers.iterrows():
  order=int(r.streamorde);L=HALF_LENGTH.get(order,400.);s=np.arange(-L,L+1,1.)
  for part in getattr(r.geometry,'geoms',[r.geometry]):
   if part.geom_type!='LineString' or part.length<1:continue
   lines.append({'comid':int(r.comid),'order':order,'geometry':part})
   ds=np.arange(spacing/2,part.length,spacing)
   if len(ds)==0:ds=np.array([part.length/2])
   seg=min(spacing,part.length)
   for d in ds:
    p=part.interpolate(d);a=part.interpolate(max(d-25,0));b=part.interpolate(min(d+25,part.length));t=np.array([b.x-a.x,b.y-a.y]);t/=np.hypot(*t);nrm=np.array([-t[1],t[0]])
    D,w,c,status=measure(lidar.sample(p.x+s*nrm[0],p.y+s*nrm[1]),s,order)
    rows.append({'comid':int(r.comid),'order':order,'gnis':str(r.gnis_name).strip(),'x':p.x,'y':p.y,'tx':t[0],'ty':t[1],'segment':seg,'incisionM':D,'measuredWidthM':w,'centreOffsetM':c,'status':status})
 sec=pd.DataFrame(rows)
 reach=sec.groupby('comid').measuredWidthM.median();order_med=sec.groupby('order').measuredWidthM.median()
 def width(q):
  if pd.notna(q.measuredWidthM):return q.measuredWidthM,'section'
  if pd.notna(reach.get(q.comid)):return reach[q.comid],'reach_median'
  if pd.notna(order_med.get(q.order)):return order_med[q.order],'order_median'
  return FIXED_WIDTH.get(q.order,60.),'fixed'
 sec[['widthM','widthSource']]=sec.apply(lambda q:pd.Series(width(q)),axis=1)
 use=(centerline=='lidar')&sec.centreOffsetM.notna();sec['offsetUsedM']=np.where(use,sec.centreOffsetM,0.)
 polys=[]
 for q in sec.itertuples():
  t=np.array([q.tx,q.ty]);nrm=np.array([-t[1],t[0]]);c=np.array([q.x,q.y])+q.offsetUsedM*nrm;h=q.widthM/2;l=q.segment/2+1
  polys.append(Polygon([tuple(c+i*l*t+j*h*nrm) for i,j in((-1,-1),(1,-1),(1,1),(-1,1))]))
 mask=gpd.GeoDataFrame(sec.drop(columns=['tx','ty']),geometry=polys,crs=32612)
 # The literal NHD-buffered mask is always computed for the report, so both centreline choices are quantified.
 nhd=gpd.GeoSeries([Polygon([tuple(np.array([q.x,q.y])+i*(q.segment/2+1)*np.array([q.tx,q.ty])+j*q.widthM/2*np.array([-q.ty,q.tx])) for i,j in((-1,-1),(1,-1),(1,1),(-1,1))]) for q in sec.itertuples()],crs=32612)
 return mask,gpd.GeoDataFrame(lines,crs=32612),sec,nhd

def burn(lulc,mask,lines):
 shape=lulc.shape;t=lulc.rio.transform()
 m=features.rasterize(((mapping(g),1) for g in mask.geometry),out_shape=shape,transform=t,all_touched=False,dtype='uint8').astype(bool)
 m|=features.rasterize(((mapping(g),1) for g in lines.geometry),out_shape=shape,transform=t,all_touched=True,dtype='uint8').astype(bool)
 return m

def main():
 p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter);p.add_argument('--output',type=Path,required=True);p.add_argument('--mesh',type=Path,default=Path('.sfincs-runs/road-dip-refinement-v1/active-refinement-mesh.nc'));p.add_argument('--context',type=Path,default=Path('.sfincs-runs/road-context-rasters-v1'));p.add_argument('--extra-fine',type=Path,action='append',default=[],help='1 m window folders whose same-named tiles replace cached ones')
 p.add_argument('--network',type=Path,required=True,help='NHDPlus V2 network geojson with streamorde (components/brawley-avra-west-network.geojson)');p.add_argument('--domain',type=Path,required=True,help='active-domain.geojson that clips the flowlines')
 p.add_argument('--channel-n',type=float,default=0.030);p.add_argument('--min-order',type=int,default=3);p.add_argument('--spacing',type=float,default=100.);p.add_argument('--centerline',choices=['lidar','nhd'],default='lidar')
 p.add_argument('--mask-only',action='store_true',help='write the channel mask, sections and report, then stop (no subgrid build)');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 if not 0.01<=a.channel_n<=0.06:raise ValueError('channel n outside the documented natural-channel range')
 mesh=a.mesh;context=a.context;fine=Path('.sfincs-runs/road-terrain-1m-v1');grid=xu.open_dataset(mesh).load();db=BathymetryDatabase(check_online=False);bathy=[]
 fine_files={p.name:p for p in fine.glob('terrain-1m-*.tif')};fine_files.update({p.name:p for p in Path('.sfincs-runs/silverbell-terrain-v1').glob('terrain-1m-*.tif')})
 fine_files.update({p.name:p for p in Path('.sfincs-runs/all-routes-terrain-v1').glob('terrain-1m-*.tif')})
 for extra in a.extra_fine:fine_files.update({p.name:p for p in extra.glob('terrain-1m-*.tif')})
 # --- sensitivity addition: channel mask from the same 1 m windows the subgrid build uses ---
 cmask,clines,sec,nhd=channel_mask(a.network,a.domain,Lidar(fine_files.values()),a.min_order,a.spacing,a.centerline)
 lulc=rioxarray.open_rasterio(context/'lulc.tif').squeeze('band',drop=True);mapping_csv=pd.read_csv(context/'esa_worldcover_mapping.csv',index_col=0)
 values=np.full(lulc.shape,np.nan,dtype='float32')
 for code,row in mapping_csv.iterrows():values[lulc.values==int(code)]=row['N']
 if not np.isfinite(values).all() or (values<=0).any():raise ValueError('Missing roughness mapping')
 inside=burn(lulc,cmask,clines);inside_nhd=burn(lulc,gpd.GeoDataFrame(geometry=nhd),clines);before=values[inside].copy();values[inside]=a.channel_n
 px=abs(lulc.rio.transform().a*lulc.rio.transform().e)
 thalweg=sec.centreOffsetM.notna();outside_nhd=(sec.centreOffsetM.abs()>sec.widthM/2)&thalweg
 classes={int(c):int(v) for c,v in zip(*np.unique(lulc.values[inside],return_counts=True))}
 creport={'sensitivityVariant':True,'change':f'Manning n set to {a.channel_n} inside the order>={a.min_order} sand-bed channel mask; WorldCover mapping elsewhere unchanged','channelN':a.channel_n,'minOrder':a.min_order,'spacingM':a.spacing,'centerline':a.centerline,'sources':SOURCES,
  'reaches':int(sec.comid.nunique()),'flowlineKm':round(float(clines.length.sum())/1e3,3),'flowlineKmByOrder':{str(k):round(float(v)/1e3,3) for k,v in clines.groupby('order').geometry.apply(lambda g:g.length.sum()).items()},
  'sections':int(len(sec)),'sectionStatus':sec.status.value_counts().to_dict(),'sectionStatusByOrder':{str(k):v.value_counts().to_dict() for k,v in sec.groupby('order').status},'widthSource':sec.widthSource.value_counts().to_dict(),
  'measuredWidthM':{str(k):{q:round(float(v.quantile(f)),1) for q,f in (('p10',.1),('p25',.25),('median',.5),('p75',.75),('p90',.9))}|{'n':int(v.notna().sum())} for k,v in sec.groupby('order').measuredWidthM if v.notna().any()},
  'nhdVsLidar':{'measuredSections':int(thalweg.sum()),'lidarChannelCentreOutsideNhdBuffer':int(outside_nhd.sum()),'fraction':round(float(outside_nhd.sum()/max(thalweg.sum(),1)),3),'absOffsetM':{q:round(float(sec.centreOffsetM.abs().quantile(f)),1) for q,f in (('median',.5),('p90',.9))} if thalweg.any() else None},
  'rasterPixelM':float(abs(lulc.rio.transform().a)),'maskPolygonAreaKm2':round(float(cmask.geometry.union_all().area)/1e6,4),'burnedPixels':int(inside.sum()),'burnedAreaKm2':round(float(inside.sum()*px)/1e6,4),'literalNhdMaskBurnedAreaKm2':round(float(inside_nhd.sum()*px)/1e6,4),'overlapWithLiteralNhdMaskKm2':round(float((inside&inside_nhd).sum()*px)/1e6,4),
  'previousClassPixels':classes,'previousNInsideMask':{'mean':round(float(before.mean()),4) if len(before) else None,'fractionRaised':round(float((before<a.channel_n).mean()),4) if len(before) else None,'fractionLowered':round(float((before>a.channel_n).mean()),4) if len(before) else None}}
 cmask.to_file(a.output/'channel-mask.geojson',driver='GeoJSON');sec.to_csv(a.output/'channel-sections.csv',index=False)
 (a.output/'channel-report.json').write_text(json.dumps(creport,indent=2)+'\n',encoding='utf-8');print(json.dumps(creport))
 if a.mask_only:return
 # --- unchanged from prepare_route_case_parameters.py below, except the manning values above ---
 for f in sorted(fine_files.values()):
  db.add_dataset_from_file(f.stem,str(f));bathy.append({'name':f.stem})
 db.add_dataset_from_file('context',str(context/'terrain.tif'));bathy.append({'name':'context'})
 man=lulc.copy(data=values);man.rio.write_nodata(np.nan,inplace=True);db.add_dataarray_dataset(man,'manning')
 target=a.output/'sfincs_subgrid.nc'
 if not target.exists():
  spec=importlib.util.spec_from_file_location('official_subgrid','.sfincs-runs/cht-refinement-source/subgrid_quadtree_builder.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  table=module.build_subgrid_table_quadtree(grid,bathymetry_sets=bathy,roughness_sets=[{'name':'manning'}],nr_levels=10,nr_subgrid_pixels=6,depth_factor=1.0,zfill=None,bathymetry_database=db,quiet=False)
  # Official builder zero-fills missing raster samples: reject a local zero-elevation artifact.
  for name in ['z_zmin','uv_zmin']:
   if not np.isfinite(table[name]).all() or float(table[name].min())<=0:raise ValueError('Uncovered local terrain reached native subgrid tables')
  table.to_netcdf(target)
 cn_raster=rioxarray.open_rasterio(context/'cn.tif').squeeze('band',drop=True).astype('float32');db.add_dataarray_dataset(cn_raster,'cn');xy=grid.grid.face_coordinates;cn=db.get_bathymetry_on_grid(xy[:,0],xy[:,1],CRS.from_epsg(32612),[{'name':'cn'}],method='nearest',coords='points',dxmin=6.25)
 if not np.isfinite(cn).all() or (cn<1).any() or (cn>100).any():raise ValueError('Missing native CN support')
 scs=cn_to_s(xr.DataArray(cn,dims='np'),xr.DataArray(np.ones(len(cn),dtype=bool),dims='np')).round(3)
 xr.Dataset({'scs':xr.DataArray(scs.values.astype('float32'),dims='mesh2d_nFaces',attrs={'units':'inches','long_name':'SCS retention; fair ARCII undrained scenario'})}).to_netcdf(a.output/'infiltration.nc')
 result={'status':'parameters_prepared_not_runnable_case','sensitivityVariant':True,'roughnessChange':{k:creport[k] for k in ('change','channelN','minOrder','centerline','burnedAreaKm2','sources')},'cells':len(cn),'subgridPixelsPerCellSide':6,'finestSubgridSamplingM':6.25/6,'sourceFineResolutionM':1,'terrainSources':'2021/2023 road windows;2019 only missing peripheral context','roughness':f'WorldCover2021 with pinned official mapping through official quadtree builder; SENSITIVITY: n={a.channel_n} inside channel-mask.geojson','infiltration':'GCN10 fair ARCII undrained scenario; official HydroMT cn_to_s; retention inches','cnRange':[float(cn.min()),float(cn.max())],'scsRangeInches':[float(scs.min()),float(scs.max())],'nativeInput':{'inffile':'infiltration.nc','inftype':'cna'},'solverExecuted':False,'files':[{'name':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in [target,a.output/'infiltration.nc',a.output/'channel-mask.geojson']]}
 (a.output/'parameter-report.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':main()
