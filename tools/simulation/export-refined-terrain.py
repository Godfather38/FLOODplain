"""Export display-only terrain tiles for the actual retained partial refined run.

No solver invocation, network intake, old regular-grid arrays, or new water data.
"""
import argparse, gzip, hashlib, json, time
from collections import OrderedDict
from pathlib import Path
import numpy as np
import rasterio
import xarray as xr
from pyproj import Transformer

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def read(path):
    p=Path(path); data=p.read_bytes()
    return json.loads(gzip.decompress(data) if p.suffix=='.gz' else data)
def artifact(path,value):
    data=gzip.compress(json.dumps(value,separators=(',',':'),allow_nan=False).encode(),compresslevel=6,mtime=0)
    path.write_bytes(data)
    return {'path':path.name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}

class RetainedSampler:
    def __init__(self,root):
        self.root=root; self.cache=OrderedDict(); self.sources=[]
        fine=read(root/'road-terrain-1m-v1/manifest.json')
        context=read(root/'road-context-rasters-v1/manifest.json')
        assert fine['verticalDatum']==context['verticalDatum']=='NAVD88'
        for item in fine['windows']:
            p=root/'road-terrain-1m-v1'/item['path']
            assert sha(p)==item['sha256'], f'Fine terrain hash mismatch: {p}'
            with rasterio.open(p) as ds:
                assert ds.crs.to_epsg()==32612
                self.sources.append({'path':p,'bounds':ds.bounds,'transform':ds.transform,'nodata':ds.nodata,'resolutionM':1,'sha256':item['sha256']})
        p=root/'road-context-rasters-v1/terrain.tif'
        with rasterio.open(p) as ds:self.context={'path':p,'bounds':ds.bounds,'transform':ds.transform,'nodata':ds.nodata,'resolutionM':10,'sha256':sha(p)}
        self.sources.append(self.context)
        self.provenance={'selection':'Same retained hierarchy as prepare_road_parameters.py: sorted 1m road windows first, retained 10m context fallback; bilinear valid-sample interpolation, never zero fill',
            'fineManifestSha256':sha(root/'road-terrain-1m-v1/manifest.json'),'contextManifestSha256':sha(root/'road-context-rasters-v1/manifest.json'),
            'acquisitionWindow':context['acquisitionWindow'],'sources':[{'path':str(x['path'].relative_to(root)).replace('\\','/'),'sha256':x['sha256'],'resolutionM':x['resolutionM']} for x in self.sources]}
    def values(self,source):
        p=source['path']
        if p not in self.cache:
            with rasterio.open(p) as ds:self.cache[p]=ds.read(1)
            while len(self.cache)>12:self.cache.popitem(last=False)
        self.cache.move_to_end(p);return self.cache[p]
    def sample(self,points):
        p=np.asarray(points);out=np.full(len(p),np.nan);resolution=np.zeros(len(p),dtype='uint8')
        for source in self.sources:
            b=source['bounds'];sel=np.flatnonzero(~np.isfinite(out)&(p[:,0]>=b.left)&(p[:,0]<=b.right)&(p[:,1]>=b.bottom)&(p[:,1]<=b.top))
            if not len(sel):continue
            data=self.values(source);t=source['transform'];x=(p[sel,0]-t.c)/t.a-.5;y=(p[sel,1]-t.f)/t.e-.5;ix=np.floor(x).astype(int);iy=np.floor(y).astype(int)
            total=np.zeros(len(sel));weight=np.zeros(len(sel))
            for dy in [0,1]:
                for dx in [0,1]:
                    xx,yy=ix+dx,iy+dy;ok=(xx>=0)&(xx<data.shape[1])&(yy>=0)&(yy<data.shape[0]);z=np.full(len(sel),np.nan);z[ok]=data[yy[ok],xx[ok]]
                    ok&=np.isfinite(z)&(z!=source['nodata']);w=(x-ix if dx else 1-x+ix)*(y-iy if dy else 1-y+iy);total[ok]+=z[ok]*w[ok];weight[ok]+=w[ok]
            ok=weight>1e-12;out[sel[ok]]=total[ok]/weight[ok];resolution[sel[ok]]=source['resolutionM']
        return out,resolution

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--retained-root',type=Path,default=Path(r'H:\AI\Projects\FloodPLAIN-sfincs\.sfincs-runs'))
    parser.add_argument('--package',type=Path,default=Path('public/simulation/data/refined-partial-41339621278'))
    parser.add_argument('--tile-size',type=int,default=500)
    args=parser.parse_args();root=args.retained_root;dest=args.package;manifest=read(dest/'manifest.json');geometry=read(dest/manifest['geometry']['path'])
    assert manifest['status']=='partial' and len(manifest['frames'])==21 and manifest['validTo']=='2026-11-01T22:00:00Z'
    assert sha(dest/manifest['geometry']['path'])==manifest['geometry']['sha256']
    mesh=root/'road-native-case-v2/sfincs.nc';assert sha(mesh)==manifest['provenance']['meshSha256']
    with xr.open_dataset(mesh) as ds:
        nodes=np.column_stack([ds.mesh2d_node_x.values,ds.mesh2d_node_y.values]);connectivity=ds.mesh2d_face_nodes.values.copy();native_ids=ds.mesh2d_nFaces.values
    assert [str(int(x)) for x in native_ids]==[c['nativeFaceId'] for c in geometry['cells']], 'Exact native face ID order mismatch'
    points=nodes[np.nan_to_num(connectivity,nan=0).astype(int)];points[np.isnan(connectivity)]=np.nan;lo=np.nanmin(points,axis=1);hi=np.nanmax(points,axis=1);centres=(lo+hi)/2
    assert np.allclose(np.prod(hi-lo,axis=1),[c['areaM2'] for c in geometry['cells']],rtol=0,atol=1e-7)
    tile_keys=np.floor(centres/args.tile_size).astype(int);groups={}
    for i,key in enumerate(map(tuple,tile_keys)):groups.setdefault(key,[]).append(i)
    sampler=RetainedSampler(root);to_geo=Transformer.from_crs(32612,4326,always_xy=True)
    provenance={'meshSha256':manifest['provenance']['meshSha256'],'nativeMapSha256':manifest['provenance']['nativeMapSha256'],'geometrySha256':manifest['geometry']['sha256'],
        'sourceCommit':'85d6af1','verticalDatum':'NAVD88','terrain':sampler.provenance,'method':'L0: native polygon boundary including hanging nodes plus centroid fan. L1: split every L0 triangle into four. Interior midpoints sample retained DEM; native-boundary midpoint position/elevation interpolate shared L0 edge endpoints to preserve mixed-LOD continuity. No new hydraulic grid or output.'}
    binding={'kind':'native_face_triangle_terrain','runId':manifest['runId'],'geometrySha256':manifest['geometry']['sha256'],'verticalDatum':'NAVD88'}
    index={'kind':'native_face_terrain_tiles','schemaVersion':1,'runId':manifest['runId'],'geometrySha256':manifest['geometry']['sha256'],'verticalDatum':'NAVD88','tileSizeM':args.tile_size,'projectedCrs':'EPSG:32612','provenance':provenance,'tiles':[]}
    started=time.perf_counter();missing_faces=[];total_triangles=[0,0];total_bytes=0;known={}
    for serial,(key,faces) in enumerate(sorted(groups.items())):
        xy=[];lookup={}
        def vertex(p):
            k=(float(p[0]),float(p[1]));v=lookup.get(k)
            if v is None:v=len(xy);lookup[k]=v;xy.append(k)
            return v
        tri0=[];ids0=[];face_ranges=[]
        for i in faces:
            row=connectivity[i];ring=[vertex(nodes[int(j)]) for j in row[np.isfinite(row)]];center=vertex(centres[i]);start=len(tri0)
            for j in range(len(ring)):tri0.append([center,ring[j],ring[(j+1)%len(ring)]]);ids0.append(str(int(native_ids[i])))
            face_ranges.append((i,start,len(tri0)))
        count0=len(xy);tri1=[];ids1=[];boundary_midpoints={}
        for tri,face_id in zip(tri0,ids0):
            a,b,c=tri;ab=vertex(((xy[a][0]+xy[b][0])/2,(xy[a][1]+xy[b][1])/2));bc=vertex(((xy[b][0]+xy[c][0])/2,(xy[b][1]+xy[c][1])/2));ca=vertex(((xy[c][0]+xy[a][0])/2,(xy[c][1]+xy[a][1])/2))
            boundary_midpoints[bc]=(b,c)
            tri1.extend([[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]]);ids1.extend([face_id]*4)
        z,resolutions=sampler.sample(xy);bad=set()
        for midpoint,(a,b) in boundary_midpoints.items():
            z[midpoint]=(z[a]+z[b])/2;resolutions[midpoint]=max(resolutions[a],resolutions[b])
        for i,start,end in face_ranges:
            if any(not np.isfinite(z[j]) for tri in tri1[start*4:end*4] for j in tri):bad.add(str(int(native_ids[i])));missing_faces.append(str(int(native_ids[i])))
        if bad:
            keep=[i for i,v in enumerate(ids0) if v not in bad];tri0=[tri0[i] for i in keep];ids0=[ids0[i] for i in keep]
            keep=[i for i,v in enumerate(ids1) if v not in bad];tri1=[tri1[i] for i in keep];ids1=[ids1[i] for i in keep]
        x,y=np.asarray(xy).T;lon,lat=to_geo.transform(x,y)
        for midpoint,(a,b) in boundary_midpoints.items():lon[midpoint]=(lon[a]+lon[b])/2;lat[midpoint]=(lat[a]+lat[b])/2
        vertices=[[float(a),float(b),round(float(c),6) if np.isfinite(c) else None] for a,b,c in zip(lon,lat,z)]
        # Compact each level independently: unavailable vertices never leak as null coordinates.
        levels=[]
        for level,triangles,ids in [(0,tri0,ids0),(1,tri1,ids1)]:
            used=sorted({j for t in triangles for j in t});remap={j:k for k,j in enumerate(used)}
            value={**binding,'tileId':f'{key[0]}-{key[1]}','level':level,'sourceTerrainResolutionM':[int(min(resolutions[used])) if used else None,int(max(resolutions[used])) if used else None],
                'vertices':[vertices[j] for j in used],'triangles':[[remap[j] for j in t] for t in triangles],'triangleFaceId':ids}
            path=dest/f'terrain-tile-{key[0]}-{key[1]}-lod{level}.json.gz';a=artifact(path,value);total_bytes+=a['bytes'];total_triangles[level]+=len(triangles)
            levels.append({'level':level,'triangles':len(triangles),'vertices':len(used),'artifact':a})
        active=[i for i in faces if str(int(native_ids[i])) not in bad]
        if active:
            bounds=[min(min(p[1] for p in geometry['rings'][i]) for i in active),min(min(p[0] for p in geometry['rings'][i]) for i in active),max(max(p[1] for p in geometry['rings'][i]) for i in active),max(max(p[0] for p in geometry['rings'][i]) for i in active)]
            index['tiles'].append({'id':f'{key[0]}-{key[1]}','bounds':bounds,'faceCount':len(active),'levels':levels})
        if serial%100==0:print(f'{serial}/{len(groups)} tiles; {total_bytes/1e6:.1f} MB; {time.perf_counter()-started:.1f}s',flush=True)
    index['coverage']={'nativeFaceCount':len(native_ids),'terrainFaceCount':len(native_ids)-len(missing_faces),'missingTerrainFaceIds':missing_faces,'outsideNativeGeometry':'never triangulated'}
    index['totals']={'tiles':len(index['tiles']),'trianglesByLevel':total_triangles,'compressedTileBytes':total_bytes}
    a=artifact(dest/'terrain-index.json.gz',index)
    descriptor={'status':'available','artifact':a,'kind':'native_face_terrain_tiles','runId':manifest['runId'],'geometrySha256':manifest['geometry']['sha256'],'verticalDatum':'NAVD88','note':'Lazy native-geometry terrain tiles; partial output remains17:00–22:00UTC only;1m/10m source terrain is not hydraulic refinement.'}
    (dest/'terrain-display.json').write_text(json.dumps(descriptor,indent=2)+'\n',encoding='utf-8')
    (dest/'terrain-export-summary.json').write_text(json.dumps({'provenance':provenance,'coverage':index['coverage'],'totals':index['totals'],'index':a,'elapsedSeconds':time.perf_counter()-started},indent=2)+'\n',encoding='utf-8')
    print(json.dumps(index['totals']),flush=True)

if __name__=='__main__':main()
