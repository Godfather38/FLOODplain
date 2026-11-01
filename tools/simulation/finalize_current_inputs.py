"""Serialize acquired HRRR and registry forecasts for the existing HydroMT adapter."""
import argparse,datetime as dt,hashlib,json,subprocess
from pathlib import Path
import numpy as np
import xarray as xr
from pyproj import CRS,Transformer

def finalize(directory):
 root=Path(directory);read=lambda n:json.loads((root/n).read_text(encoding='utf-8-sig'));m=read('manifest.json');snapshot=read('boundary-snapshot.json');r=read('rainfall.json');registry=read('boundary-registry.json');p=read('rainfall-provenance.json');stamp=lambda s:dt.datetime.fromisoformat(s.replace('Z','+00:00'))
 m['acquisitionStartedAt']=m.get('acquisitionStartedAt',m['asOf']);m['issueCutoffAt']=m.get('issueCutoffAt',m['asOf']);m['asOf']=snapshot['asOf']
 start,end=map(stamp,[snapshot['start'],snapshot['end']]);frames=[f for f in r['frames'] if stamp(f['start'])>=start and stamp(f['end'])<=end];values=np.array([f['precipMmH'] for f in frames],dtype=float)
 if not frames or stamp(frames[0]['start'])!=start or stamp(frames[-1]['end'])!=end or not np.isfinite(values).all() or np.any(values<0):raise ValueError('Incomplete rainfall window')
 times=np.array([np.datetime64(stamp(f['start']).replace(tzinfo=None),'ns') for f in frames]);
 if np.any(np.diff(times)!=np.timedelta64(1,'h')):raise ValueError('Nonhourly/gapped accumulation windows')
 x=np.array(r['lon']);y=np.array(r['lat']);dx=float(np.diff(x)[0]);dy=abs(float(np.diff(y)[0]));footprint=[float(x.min()-dx/2),float(y.min()-dy/2),float(x.max()+dx/2),float(y.max()+dy/2)]
 needed=Transformer.from_crs(registry['crs'],'EPSG:4326',always_xy=True).transform_bounds(*registry['bounds'],densify_pts=41)
 if not(footprint[0]<=needed[0] and footprint[1]<=needed[1] and footprint[2]>=needed[2] and footprint[3]>=needed[3]):raise ValueError('Rainfall crop does not cover registry domain')
 crs=CRS.from_epsg(4326);da=xr.DataArray(values,dims=('time','y','x'),coords={'time':times,'y':y,'x':x,'spatial_ref':0},name='precip',attrs={'units':'mm/hour','grid_mapping':'spatial_ref','long_name':'HRRR one-hour mean forecast precipitation rate','issuedAt':r['issuedAt'],'interval_label':'start','interval_seconds':3600})
 da.x.attrs={'axis':'X','standard_name':'longitude','units':'degrees_east'};da.y.attrs={'axis':'Y','standard_name':'latitude','units':'degrees_north'};da.spatial_ref.attrs={**crs.to_cf(),'spatial_ref':crs.to_wkt(),'crs_wkt':crs.to_wkt()};da.to_netcdf(root/'precipitation.nc',engine='netcdf4')
 with xr.open_dataset(root/'precipitation.nc',decode_coords='all') as loaded:
  if not np.array_equal(loaded.precip.values,values) or loaded.precip.dims!=('time','y','x'):raise ValueError('NetCDF roundtrip mismatch')
 used=[s for s in p['sources'] if int(s['metadata']['startStep'])>=int((start-stamp(r['issuedAt'])).total_seconds()/3600) and int(s['metadata']['endStep'])<=int((end-stamp(r['issuedAt'])).total_seconds()/3600)]
 meta={'status':'complete','units':'mm/h','intervalSeconds':3600,'intervalEndUtc':snapshot['end'],'issuedAt':r['issuedAt'],'asOf':m['asOf'],'sourceArtifacts':used,'geography':{'crs':'EPSG:4326','rasterOuterBounds':footprint,'registryDomainGeographicBounds':needed,'coversRegistryDomain':True},'nativeResolutionM':3000,'sampling':'Nearest native HRRR cell; no artificial spatial refinement','observationOrForecast':'forecast'}
 (root/'precipitation-metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
 m.update(candidateWindow={'start':start.isoformat().replace('+00:00','Z'),'end':end.isoformat().replace('+00:00','Z'),'basis':'Exact verified inlet native timestamps intersected with complete HRRR accumulation intervals'},boundarySnapshotFile='boundary-snapshot.json',boundaryRegistryFile='boundary-registry.json',boundaryRegistryCommit='b15eb25',precipitationFile='precipitation.nc',precipitationMetadataFile='precipitation-metadata.json',inletAssignments=[{'sourceId':s['sourceId'],'reachId':s['reachId']} for s in registry['sources']],status='forcing_contract_ready_physical_setup_pending')
 m['sourceIssuePolicy']='Issues are bounded by issueCutoffAt; asOf is completed source acquisition, after every retained retrieval. Individual provider issue times remain distinct.'
 m['dependencies']=['Solver owner retains full-inlet coverage and provider network-version verification.','Disjoint contributing areas/rainfall accounting, professional geometry/structures, losses and initial state remain explicit physical dependencies.','No solver run executed; immutable snapshots require freshness rechecking before a later current run.'];m['files']={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in root.iterdir() if f.is_file() and f.name!='manifest.json'};(root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n');print('NetCDF',values.shape,'domain covered',footprint,'inlet',[s['reachId'] for s in snapshot['series']])
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('directory');a=p.parse_args();finalize(a.directory)
