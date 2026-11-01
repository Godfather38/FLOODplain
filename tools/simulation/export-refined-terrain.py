"""Export display-only terrain tiles for the actual retained partial refined run.

No solver invocation, network intake, old regular-grid arrays, or new water data.
"""
import argparse, gzip, hashlib, json, time, base64
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

def coarse_native_tiles(dest):
    """Add a minimal native-face level, without mutating any published artifact."""
    old_descriptor=read(dest/'terrain-display.json');old_index_path=dest/old_descriptor['artifact']['path']
    assert sha(old_index_path)==old_descriptor['artifact']['sha256']
    index=read(old_index_path);to_projected=Transformer.from_crs(4326,32612,always_xy=True)
    total_triangles=total_bytes=boundary_edges=0;seen_faces=set();maximum_triangles=maximum_bytes=0;started=time.perf_counter()
    def twice_area(ring,xy):
        origin=xy[ring[0]];p=[xy[j]-origin for j in ring]
        return sum(p[j-1][0]*p[j][1]-p[j][0]*p[j-1][1] for j in range(len(p)))
    def triangulate(boundary,xy):
        remaining=boundary.copy();result=[];signed=twice_area(remaining,xy);orientation=1 if signed>0 else -1
        assert abs(signed)>1e-5
        while len(remaining)>3:
            for j in range(len(remaining)):
                a,b,c=remaining[j-1],remaining[j],remaining[(j+1)%len(remaining)]
                ab,ac=xy[b]-xy[a],xy[c]-xy[a];cross=ab[0]*ac[1]-ab[1]*ac[0]
                reduced=remaining[:j]+remaining[j+1:]
                if cross*orientation>1e-5 and twice_area(reduced,xy)*orientation>1e-5:
                    result.append([a,b,c]);remaining=reduced;break
            else:raise ValueError('Native polygon could not be triangulated without losing its boundary')
        result.append(remaining)
        assert len(result)==len(boundary)-2
        actual=sum(abs(twice_area(t,xy)) for t in result)
        assert abs(actual-abs(signed))<1e-5, 'Coarse triangle area differs from native polygon'
        counts={}
        for t in result:
            for j in range(3):
                edge=tuple(sorted((t[j],t[(j+1)%3])));counts[edge]=counts.get(edge,0)+1
        expected={tuple(sorted((boundary[j],boundary[(j+1)%len(boundary)]))) for j in range(len(boundary))}
        assert {edge for edge,count in counts.items() if count==1}==expected, 'Coarse boundary segment mismatch'
        assert all(count in [1,2] for count in counts.values())
        return result
    for serial,tile in enumerate(index['tiles']):
        entry=next(v for v in tile['levels'] if v['level']==0);path=dest/entry['artifact']['path'];assert sha(path)==entry['artifact']['sha256'];source=read(path)
        assert source['runId']==index['runId'] and source['geometrySha256']==index['geometrySha256'] and source['verticalDatum']==index['verticalDatum']
        v=np.asarray(source['vertices']);x,y=to_projected.transform(v[:,0],v[:,1]);xy=np.column_stack([x,y]);face_fans={}
        for triangle,face_id in zip(source['triangles'],source['triangleFaceId']):face_fans.setdefault(face_id,[]).append(triangle)
        assert not seen_faces.intersection(face_fans);seen_faces.update(face_fans)
        triangles=[];ids=[]
        for face_id,fan in face_fans.items():
            boundary=[t[1] for t in fan]
            assert len(set(boundary))==len(boundary) and len({t[0] for t in fan})==1
            assert all(fan[j][2]==boundary[(j+1)%len(boundary)] for j in range(len(boundary)))
            minimal=triangulate(boundary,xy);triangles.extend(minimal);ids.extend([face_id]*len(minimal));boundary_edges+=len(boundary)
        used=sorted({i for t in triangles for i in t});remap={old:new for new,old in enumerate(used)}
        value={key:source[key] for key in ['kind','runId','geometrySha256','verticalDatum','tileId']}
        value.update({'level':2,'coarseFallback':True,'vertices':[source['vertices'][i] for i in used],
            'triangles':[[remap[i] for i in t] for t in triangles],'triangleFaceId':ids,
            'displayMethod':'Minimal triangulation of each native face; all original boundary/hanging vertices and L0 elevations retained exactly; centre/interior vertices omitted. No face merging or hydraulic refinement.',
            'sourceArtifact':entry['artifact']})
        output=artifact(dest/f"terrain-tile-{tile['id']}-coarse.json.gz",value)
        tile['levels'].append({'level':2,'coarseFallback':True,'triangles':len(triangles),'vertices':len(used),'artifact':output})
        total_triangles+=len(triangles);total_bytes+=output['bytes'];maximum_triangles=max(maximum_triangles,len(triangles));maximum_bytes=max(maximum_bytes,output['bytes'])
        if serial%400==0:print(f'coarse {serial}/{len(index["tiles"])}; {total_triangles} triangles',flush=True)
    assert len(seen_faces)==index['coverage']['terrainFaceCount']
    assert total_triangles==index['totals']['trianglesByLevel'][0]-2*len(seen_faces)
    provenance={'method':'Minimal native-face triangulation retaining exact L0 native boundary/hanging vertices and elevations. No interior centre samples, no face aggregation, no new solver output.',
        'sourceIndex':old_descriptor['artifact'],'boundarySegmentsVerified':boundary_edges,'nativeFacesVerified':len(seen_faces),'nativeBoundaryHeights':'identical to L0, including all hanging-edge nodes','interiorTerrainLimit':'Interior depressions/curvature omitted at this fallback LOD; zoom/upgrades restore L0/L1.'}
    index['provenance']['coarseFallback']=provenance
    index['totals']['trianglesByLevel'].append(total_triangles);index['totals']['compressedTileBytes']+=total_bytes
    descriptor=old_descriptor.copy();descriptor['artifact']=artifact(dest/'terrain-index-coarse.json.gz',index)
    descriptor['note']='Lazy native-geometry terrain tiles with minimal native-face coarse fallback; partial output remains17:00-22:00UTC. Coarse interior terrain is approximate, not new hydraulics.'
    (dest/'terrain-display-coarse.json').write_text(json.dumps(descriptor,indent=2)+'\n',encoding='utf-8')
    result={'kind':'actual_refined_coarse_terrain_verification','runId':index['runId'],'geometrySha256':index['geometrySha256'],'verticalDatum':index['verticalDatum'],
        'tiles':len(index['tiles']),'nativeFaces':len(seen_faces),'coarseTriangles':total_triangles,'l0Triangles':index['totals']['trianglesByLevel'][0],
        'coarseCompressedBytes':total_bytes,'maximumTileTriangles':maximum_triangles,'maximumTileBytes':maximum_bytes,'provenance':provenance,'index':descriptor['artifact'],'elapsedSeconds':time.perf_counter()-started}
    (dest/'terrain-coarse-verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result),flush=True)

def overview_native_terrain(root,dest):
    """Separate bounded ground hierarchy and static native water support.

    Ground triangles deliberately have no native face ID; native water topology
    retains exact per-face boundaries and never borrows the overview ground mesh.
    """
    import shapely
    from rasterio.features import shapes
    from rasterio.transform import Affine
    descriptor=read(dest/'terrain-display-coarse.json');index_path=dest/descriptor['artifact']['path'];assert sha(index_path)==descriptor['artifact']['sha256'];index=read(index_path)
    geometry=read(dest/'geometry.json.gz');assert sha(dest/'geometry.json.gz')==index['geometrySha256'];face_map={c['nativeFaceId']:i for i,c in enumerate(geometry['cells'])};n=len(face_map)
    vertex_offsets=np.zeros(n+1,dtype='<u4');vertex_offsets[1:]=np.cumsum([len(r) for r in geometry['rings']]);triangle_offsets=np.zeros(n+1,dtype='<u4');triangle_offsets[1:]=np.cumsum([len(r)-2 for r in geometry['rings']]);heights=np.full(int(vertex_offsets[-1]),np.nan,dtype='<f4');local_indices=np.zeros(int(triangle_offsets[-1])*3,dtype='u1');seen=set();maximum_float32_error=0.
    started=time.perf_counter()
    for serial,tile in enumerate(index['tiles']):
        level=next(l for l in tile['levels'] if l.get('coarseFallback'));a=level['artifact'];assert sha(dest/a['path'])==a['sha256'];data=read(dest/a['path']);groups={}
        for triangle,face_id in zip(data['triangles'],data['triangleFaceId']):groups.setdefault(face_id,[]).append(triangle)
        for face_id,triangles in groups.items():
            assert face_id not in seen;seen.add(face_id);i=face_map[face_id];ring=geometry['rings'][i];used={j for t in triangles for j in t};mapping={};offset=int(vertex_offsets[i])
            for j in used:
                lon,lat,z=data['vertices'][j];dist=[abs(lat-p[0])+abs(lon-p[1]) for p in ring];k=int(np.argmin(dist));assert dist[k]<1e-12 and k not in mapping.values(),'Coarse node does not match exact native ring';mapping[j]=k;heights[offset+k]=z;maximum_float32_error=max(maximum_float32_error,abs(float(heights[offset+k])-z))
            assert len(mapping)==len(ring) and len(triangles)==len(ring)-2
            start=int(triangle_offsets[i])*3;local_indices[start:start+3*len(triangles)]=[mapping[j] for t in triangles for j in t]
        if serial%500==0:print('water support',serial,'/',len(index['tiles']),flush=True)
    assert len(seen)==n and np.isfinite(heights).all()
    arrays={'boundaryElevationM':('Float32Array',heights),'faceVertexOffsets':('Uint32Array',vertex_offsets),'faceTriangleOffsets':('Uint32Array',triangle_offsets),'localTriangleIndices':('Uint8Array',local_indices)}
    binding={'runId':index['runId'],'geometrySha256':index['geometrySha256'],'meshSha256':index['provenance']['meshSha256'],'verticalDatum':index['verticalDatum']}
    decoded_bytes=sum(v.nbytes for _,v in arrays.values())
    support={'kind':'native_face_water_support',**binding,'faceOrder':'geometry.cells-order','faceCount':n,'byteOrder':'little-endian','decodedBytes':decoded_bytes,
        'encoding':{key:{'type':kind,'base64':base64.b64encode(value.tobytes()).decode()} for key,(kind,value) in arrays.items()},
        'provenance':{'sourceIndex':descriptor['artifact'],'nativeFaceCount':n,'triangles':int(triangle_offsets[-1]),'method':'Exact native ring order and minimal n-minus-2 coarse triangulation; retained L0 boundary elevations encoded as Float32. Positions come from matching geometry.rings. No aggregated water surface or changed native quantities.','maximumElevationFloat32ErrorM':maximum_float32_error}}
    support_artifact=artifact(dest/'terrain-water-support.json.gz',support);index['waterSupport']={'kind':support['kind'],'faceCount':n,'triangles':int(triangle_offsets[-1]),'decodedBytes':decoded_bytes,'artifact':support_artifact}
    print('water support complete',support_artifact,'decodedBytes',decoded_bytes,flush=True)
    mesh=root/'road-native-case-v2/sfincs.nc';assert sha(mesh)==binding['meshSha256']
    with xr.open_dataset(mesh) as ds:
        nodes=np.column_stack([ds.mesh2d_node_x.values,ds.mesh2d_node_y.values]);con=ds.mesh2d_face_nodes.values;p=nodes[np.nan_to_num(con,nan=0).astype(int)];p[np.isnan(con)]=np.nan;lo=np.nanmin(p,axis=1);hi=np.nanmax(p,axis=1)
    native_area=np.array([c['areaM2'] for c in geometry['cells']]);assert np.allclose(np.prod(hi-lo,axis=1),native_area,rtol=0,atol=1e-7)
    resolution=float(np.min(hi-lo));origin=lo.min(axis=0);end=hi.max(axis=0);size=np.rint((end-origin)/resolution).astype(int);mask=np.zeros((size[1],size[0]),dtype='uint8');a=(lo-origin)/resolution;b=(hi-origin)/resolution
    assert np.max(np.abs(a-np.rint(a)))<1e-7 and np.max(np.abs(b-np.rint(b)))<1e-7
    for left,right in zip(np.rint(a).astype(int),np.rint(b).astype(int)):mask[left[1]:right[1],left[0]:right[0]]=1
    domain_parts=[shapely.geometry.shape(g) for g,value in shapes(mask,mask=mask>0,transform=Affine(resolution,0,origin[0],0,resolution,origin[1]),connectivity=4)]
    domain=shapely.union_all(domain_parts);assert domain.is_valid and abs(domain.area-float(native_area.sum()))<1e-6
    domain_hash=hashlib.sha256(shapely.to_wkb(domain)).hexdigest();components=list(shapely.get_parts(domain));holes=sum(len(p.interiors) for p in components)
    coverage={'exactNativeDomain':True,'areaM2':float(domain.area),'components':len(components),'holes':holes,'domainProjectedWkbSha256':domain_hash,'nativeFaceCount':n,'method':'Exact union of axis-aligned native polygons on their existing finest coordinate lattice; no domain dilation or hole filling.'}
    sampler=RetainedSampler(root);to_geo=Transformer.from_crs(32612,4326,always_xy=True);overview_levels=[];coverage_checks=[]
    for level,spacing in enumerate([400,200,100]):
        start=time.perf_counter();xmin,ymin,xmax,ymax=domain.bounds;xs=np.arange(np.floor(xmin/spacing)*spacing,xmax,spacing);ys=np.arange(np.floor(ymin/spacing)*spacing,ymax,spacing);x=np.tile(xs,len(ys));y=np.repeat(ys,len(xs));boxes=shapely.box(x,y,x+spacing,y+spacing);selected=shapely.intersects(boxes,domain);clipped=shapely.intersection(boxes[selected],domain)
        polygon_parts=[p for p in shapely.get_parts(clipped) if p.geom_type=='Polygon' and p.area>1e-8]
        collections=shapely.constrained_delaunay_triangles(np.array(polygon_parts,dtype=object));triangle_polygons=list(shapely.get_parts(collections));triangle_polygons=[p for p in triangle_polygons if p.geom_type=='Polygon' and p.area>1e-8]
        triangulated=shapely.union_all(triangle_polygons);difference=float(shapely.symmetric_difference(triangulated,domain).area)
        assert difference<1e-5,'Overview changed native active-domain coverage'
        vertices_xy=[];lookup={};triangles=[]
        for triangle in triangle_polygons:
            points=list(triangle.exterior.coords)[:-1];assert len(points)==3;ids=[]
            for point in points:
                key=tuple(point);j=lookup.get(key)
                if j is None:j=len(vertices_xy);lookup[key]=j;vertices_xy.append(key)
                ids.append(j)
            triangles.append(ids)
        z,source_resolution=sampler.sample(vertices_xy);assert np.isfinite(z).all(),'Missing source terrain in overview; no fill allowed'
        x,y=np.array(vertices_xy).T;lon,lat=to_geo.transform(x,y)
        value={'kind':'native_domain_terrain_overview',**binding,'level':level,'terrainOnly':True,'samplingM':spacing,'projectedCrs':'EPSG:32612','coverage':coverage,
            'vertices':[[float(a),float(b),round(float(c),6)] for a,b,c in zip(lon,lat,z)],'triangles':triangles,
            'provenance':{'sourceIndex':descriptor['artifact'],'terrain':sampler.provenance,'method':'Constrained triangulation of sampling-grid cells clipped to exact native active-domain union including holes. Source terrain heights only; triangles intentionally have no native hydraulic face ID. Water support is a separate native artifact.','sourceResolutionM':[int(source_resolution.min()),int(source_resolution.max())]}}
        art=artifact(dest/f'terrain-overview-{spacing}m.json.gz',value);overview_levels.append({'level':level,'terrainOnly':True,'samplingM':spacing,'triangles':len(triangles),'vertices':len(vertices_xy),'artifact':art});coverage_checks.append({'samplingM':spacing,'triangles':len(triangles),'vertices':len(vertices_xy),'domainSymmetricDifferenceM2':difference,'bytes':art['bytes'],'seconds':time.perf_counter()-start})
        print('overview',coverage_checks[-1],flush=True)
    index['overviewLevels']=overview_levels;index['provenance']['overviewTerrain']={'coverage':coverage,'waterSupportSeparate':True,'method':'Source-supported ground LOD; no face-ID reassignment, new hydraulic resolution, water-level interpolation or new forecast frames.'}
    updated=descriptor.copy();updated['artifact']=artifact(dest/'terrain-index-overview.json.gz',index);updated['note']='Lazy source-bound terrain overview and native water support for wide 3D views; native quantities and time interval unchanged.'
    (dest/'terrain-display-overview.json').write_text(json.dumps(updated,indent=2)+'\n',encoding='utf-8')
    report={'kind':'actual_refined_terrain_overview_verification',**binding,'coverage':coverage,'waterSupport':index['waterSupport'],'maximumBoundaryElevationFloat32ErrorM':maximum_float32_error,'overviewLevels':coverage_checks,'index':updated['artifact'],'elapsedSeconds':time.perf_counter()-started}
    (dest/'terrain-overview-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report),flush=True)

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
    parser.add_argument('--coarse-only',action='store_true',help='Add minimal native-face fallback from existing L0; never rewrite existing index or tiles')
    parser.add_argument('--overview-only',action='store_true',help='Add bounded terrain-only overview hierarchy plus global native water support; preserve existing assets')
    args=parser.parse_args();root=args.retained_root;dest=args.package
    if args.coarse_only:return coarse_native_tiles(dest)
    if args.overview_only:return overview_native_terrain(root,dest)
    manifest=read(dest/'manifest.json');geometry=read(dest/manifest['geometry']['path'])
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
