"""Read-only audit of actual partial-run terrain tiles and native quantities."""
from pathlib import Path
import gzip,json,hashlib,time,importlib.util
import numpy as np
import xarray as xr

root=Path('public/simulation/data/refined-partial-41339621278')
def read(name):
    p=root/name;data=p.read_bytes();return json.loads(gzip.decompress(data) if p.suffix=='.gz' else data)
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
m=read('manifest.json');g=read(m['geometry']['path']);descriptor=read('terrain-display.json');index=read(descriptor['artifact']['path'])
assert sha(root/descriptor['artifact']['path'])==descriptor['artifact']['sha256']
assert index['runId']==m['runId'] and index['geometrySha256']==m['geometry']['sha256'] and index['verticalDatum']==m['provenance']['verticalDatum']=='NAVD88'
assert m['status']=='partial' and len(m['frames'])==21 and m['validTo']=='2026-11-01T22:00:00Z'
expected={c['nativeFaceId'] for c in g['cells']};seen=set();maximum_bytes=[0,0];maximum_triangles=[0,0];total_bytes=0;seam_count=0;known={}
start=time.perf_counter()
for k,tile in enumerate(index['tiles']):
    levels=[]
    for level,entry in enumerate(tile['levels']):
        a=entry['artifact'];assert sha(root/a['path'])==a['sha256'];data=read(a['path']);levels.append(data)
        assert data['runId']==m['runId'] and data['geometrySha256']==m['geometry']['sha256'] and data['verticalDatum']=='NAVD88'
        vertices=np.array(data['vertices']);triangles=np.array(data['triangles']);assert np.isfinite(vertices).all();assert triangles.min()>=0 and triangles.max()<len(vertices)
        assert len(triangles)==len(data['triangleFaceId'])==entry['triangles'];assert set(data['triangleFaceId'])<=expected
        maximum_bytes[level]=max(maximum_bytes[level],a['bytes']);maximum_triangles[level]=max(maximum_triangles[level],len(triangles));total_bytes+=a['bytes']
    coarse,fine=levels;face_ids=set(coarse['triangleFaceId']);assert not seen.intersection(face_ids);seen.update(face_ids);assert set(fine['triangleFaceId'])==face_ids
    c=np.array(coarse['vertices']);ct=np.array(coarse['triangles']);f=np.array(fine['vertices']);ft=np.array(fine['triangles'])
    assert len(ft)==4*len(ct)
    # Every native-boundary midpoint in L1 must lie on the shared L0 edge.
    endpoints=(c[ct[:,1]]+c[ct[:,2]])/2;midpoints=f[ft[1::4,2]]
    assert np.max(np.abs(endpoints[:,:2]-midpoints[:,:2]))<1e-13
    assert np.max(np.abs(endpoints[:,2]-midpoints[:,2]))<=1.1e-6
    seam_count+=len(ct)
    for face in ['266577','283056','387171']:
        if face in face_ids:
            ids=np.array(fine['triangleFaceId']);select=np.flatnonzero(ids==face);used=np.unique(ft[select]);coarse_select=coarse['triangleFaceId'].index(face)
            known[face]={'tileId':tile['id'],'tileArtifacts':tile['levels'],'terrainCentreM':coarse['vertices'][coarse['triangles'][coarse_select][0]][2],'fineTerrainVertexRangeM':[float(f[used,2].min()),float(f[used,2].max())],'fineTriangles':len(select)}
    if k%400==0:print('verified',k,'tiles',flush=True)
assert seen==expected and len(seen)==398613
retained=Path(r'H:\AI\Projects\FloodPLAIN-sfincs\.sfincs-runs')
native_path=retained/'road-result-41339621278/artifact/runs/current/sfincs_map.nc';assert sha(native_path)==m['provenance']['nativeMapSha256']
proof=retained/'road-result-41339621278/output-to-source-face-id.npy';output_ids=np.load(proof);assert len(set(map(int,output_ids)))==len(g['cells'])
frames=[read('frame-0.json.gz'),read('frame-20.json.gz')]
with xr.open_dataset(native_path,decode_times=False) as native:
    assert native.sizes['time']==21
    for face,value in known.items():
        i=next(i for i,c in enumerate(g['cells']) if c['nativeFaceId']==face);output_index=int(np.flatnonzero(output_ids==int(face))[0]);value['cellIndex']=i;value['cell']=g['cells'][i];value['nativeFrames']=[]
        for frame_number,frame in zip([0,20],frames):
            volume=float(native.subgrid_volume.values[frame_number,output_index]);zs=float(native.zs.values[frame_number,output_index]);depth=max(0,volume)/g['cells'][i]['areaM2']
            assert volume==frame['nativeVolumeM3'][i] and zs==frame['waterSurfaceM'][i] and depth==frame['depthM'][i]
            value['nativeFrames'].append({'time':frame['time'],'depthM':depth,'nativeVolumeM3':volume,'waterSurfaceM':zs})
spec=importlib.util.spec_from_file_location('terrain_exporter','tools/simulation/export-refined-terrain.py');exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter);sampler=exporter.RetainedSampler(retained)
with xr.open_dataset(retained/'road-native-case-v2/sfincs.nc') as mesh,xr.open_dataset(retained/'road-native-case-v2/sfincs_subgrid.nc') as subgrid:
    nodes=np.column_stack([mesh.mesh2d_node_x.values,mesh.mesh2d_node_y.values])
    for face,value in known.items():
        i=value['cellIndex'];row=mesh.mesh2d_face_nodes.values[i];polygon=nodes[row[np.isfinite(row)].astype(int)];lo=polygon.min(axis=0);hi=polygon.max(axis=0);step=(hi-lo)/6
        x=lo[0]+(np.arange(6)+.5)*step[0];y=lo[1]+(np.arange(6)+.5)*step[1];samples=np.column_stack([np.tile(x,6),np.repeat(y,6)]);z,_=sampler.sample(samples)
        sample_range=[float(z.min()),float(z.max())];native_range=[float(subgrid.z_zmin.values[i]),float(subgrid.z_zmax.values[i])]
        delta=float(np.max(np.abs(np.array(sample_range)-native_range)));assert delta<5e-5,'Retained terrain differs from native subgrid preparation'
        value['nativeSubgridTerrainCheck']={'sampled6x6RangeM':sample_range,'nativeSubgridRangeM':native_range,'maximumDifferenceM':delta,'toleranceM':5e-5}
result={'kind':'actual_refined_terrain_export_verification','runId':m['runId'],'status':'partial','validFrom':m['validFrom'],'validTo':m['validTo'],'frames':21,'geometrySha256':m['geometry']['sha256'],'nativeMapSha256':m['provenance']['nativeMapSha256'],'verifiedTiles':len(index['tiles']),'verifiedFaces':len(seen),'verifiedMixedLodBoundaryMidpoints':seam_count,'maximumTileBytesByLevel':maximum_bytes,'maximumTileTrianglesByLevel':maximum_triangles,'totalTileBytes':total_bytes,'knownNativeCells':known,'elapsedSeconds':time.perf_counter()-start}
(root/'terrain-verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in result.items() if k!='knownNativeCells'}),flush=True)
