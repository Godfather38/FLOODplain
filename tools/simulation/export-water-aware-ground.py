"""Display-only static ground for the actual 57-frame completed native run.

Keep native boundary terrain under every face with displayed water in any frame;
clip coarse source terrain to the remaining domain. Never change native water.
"""
import base64, gzip, hashlib, json, struct, time
from pathlib import Path
import numpy as np
import shapely
from pyproj import Transformer

ROOT = Path('public/simulation/data')
FULL = ROOT/'refined-full-compact-41344983607'
SOURCE = ROOT/'refined-partial-41339621278'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(gzip.decompress(p.read_bytes()))
def columns(p, expected):
    assert sha(p)==expected
    raw=gzip.decompress(p.read_bytes()); n=struct.unpack('<I',raw[:4])[0]
    h=json.loads(raw[4:4+n]); types={'d':'<f8','f':'<f4','I':'<u4'}
    return h['metadata'],{k:np.frombuffer(raw,dtype=types[v['type']],count=v['count'],offset=4+n+v['offset']) for k,v in h['columns'].items()}
def artifact(p,value):
    p.write_bytes(gzip.compress(json.dumps(value,separators=(',',':'),allow_nan=False).encode(),compresslevel=6,mtime=0))
    return {'path':p.name,'sha256':sha(p),'bytes':p.stat().st_size}

def main():
    started=time.perf_counter();manifest=json.loads((FULL/'manifest.json').read_text());assert manifest['status']=='complete' and len(manifest['frames'])==57
    metadata,g=columns(FULL/manifest['geometry']['path'],manifest['geometry']['sha256'])
    threshold=.01; wet=np.zeros(len(g['areaM2']),bool)
    for frame in manifest['frames']:
        fm,f=columns(FULL/frame['path'],frame['sha256']);assert fm['runId']==manifest['runId'] and fm['geometrySha256']==manifest['geometry']['sha256']
        wet |= (f['nativeVolumeM3']/g['areaM2']>=threshold)&np.isfinite(f['waterSurfaceM'])
    index=read(SOURCE/'terrain-index-overview.json.gz');descriptor=index['waterSupport'];support=read(SOURCE/descriptor['artifact']['path']);assert sha(SOURCE/descriptor['artifact']['path'])==descriptor['artifact']['sha256']
    assert support['meshSha256']==manifest['provenance']['meshSha256'] and support['verticalDatum']==manifest['provenance']['verticalDatum']=='NAVD88'
    equivalence=manifest['terrainDisplay']['geometryEquivalence'];assert equivalence['sourceGeometrySha256']==support['geometrySha256'] and equivalence['targetGeometrySha256']==manifest['geometry']['sha256']
    types={'Float32Array':'<f4','Uint32Array':'<u4','Uint8Array':'u1'}
    arrays={k:np.frombuffer(base64.b64decode(v['base64']),dtype=types[v['type']]) for k,v in support['encoding'].items()}
    offsets=arrays['faceVertexOffsets'];toff=arrays['faceTriangleOffsets'];local=arrays['localTriangleIndices'];heights=arrays['boundaryElevationM']
    assert np.array_equal(offsets,g['ringOffsets']) and len(wet)==support['faceCount']
    geo=g['vertices'].reshape(-1,2);to_xy=Transformer.from_crs(4326,32612,always_xy=True);to_geo=Transformer.from_crs(32612,4326,always_xy=True)
    xx,yy=to_xy.transform(geo[:,1],geo[:,0]);xy=np.round(np.column_stack([xx,yy]),6)
    # Native vertices lie on the source metric lattice; round-trip noise removed only.
    assert np.max(np.abs(xy-np.column_stack([xx,yy])))<0.000001
    wet_polys=[];native_triangles=[];native_vertices=[];lookup={};boundary_segments=[];boundary_z=[]
    def vertex(point,z):
        key=(float(point[0]),float(point[1]));i=lookup.get(key)
        if i is None:i=len(native_vertices);lookup[key]=i;native_vertices.append([key[0],key[1],float(z)])
        else:assert abs(native_vertices[i][2]-z)<.0002
        return i
    for i in np.flatnonzero(wet):
        a,b=map(int,offsets[i:i+2]);ring=xy[g['ringIndices'][a:b]];z=heights[a:b];wet_polys.append(shapely.Polygon(ring));ids=[vertex(p,h) for p,h in zip(ring,z)]
        start,end=map(int,toff[i:i+2]);native_triangles.extend([[ids[int(k)] for k in t] for t in local[start*3:end*3].reshape(-1,3)])
        for j in range(len(ring)):
            k=(j+1)%len(ring);boundary_segments.append([ring[j],ring[k]]);boundary_z.append([z[j],z[k]])
    wet_union=shapely.union_all(wet_polys);assert wet_union.is_valid
    assert abs(wet_union.area-float(g['areaM2'][wet].sum()))<1e-5
    segments=np.array(boundary_segments);segment_z=np.array(boundary_z);tree=shapely.STRtree(shapely.linestrings(segments))
    print(json.dumps({'everDisplayedWaterFaces':int(wet.sum()),'nativeGroundTriangles':len(native_triangles),'areaM2':wet_union.area,'seconds':time.perf_counter()-started}),flush=True)
    outputs=[]
    # One bounded tier: finer coarse sampling adds cost without improving native
    # terrain beneath the displayed-water union, which already stays exact.
    for spacing in [400]:
        entry=next(v for v in index['overviewLevels'] if v['samplingM']==spacing);p=SOURCE/entry['artifact']['path'];assert sha(p)==entry['artifact']['sha256'];coarse=read(p)
        v=np.asarray(coarse['vertices']);cx,cy=to_xy.transform(v[:,0],v[:,1]);cxy=np.round(np.column_stack([cx,cy]),6);tris=np.asarray(coarse['triangles']);polys=shapely.polygons(cxy[tris]);remaining=shapely.difference(polys,wet_union)
        vertices=[list(v) for v in native_vertices];out_triangles=[list(t) for t in native_triangles];out_lookup=dict(lookup);dry_polys=[];wet_boundary_points=0
        def add_dry(point,source_triangle):
            nonlocal wet_boundary_points
            key=tuple(map(float,point));existing=out_lookup.get(key)
            if existing is not None:return existing
            hit=tree.query(shapely.Point(point),predicate='dwithin',distance=1e-7)
            if len(hit):
                edge=int(hit[0]);a,b=segments[edge];t=np.clip(np.dot(point-a,b-a)/np.dot(b-a,b-a),0,1);z=float(segment_z[edge,0]*(1-t)+segment_z[edge,1]*t);wet_boundary_points+=1
            else:
                a,b,c=cxy[source_triangle];weights=np.linalg.solve(np.column_stack([b-a,c-a]),np.asarray(point)-a);z=float(v[source_triangle[0],2]+weights[0]*(v[source_triangle[1],2]-v[source_triangle[0],2])+weights[1]*(v[source_triangle[2],2]-v[source_triangle[0],2]))
            result=len(vertices);out_lookup[key]=result;vertices.append([key[0],key[1],z]);return result
        for j,part in enumerate(remaining):
            if part.is_empty:continue
            for polygon in shapely.get_parts(part):
                if polygon.geom_type!='Polygon' or polygon.area<1e-10:continue
                dry_polys.append(polygon)
                for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(polygon)):
                    points=list(triangle.exterior.coords)[:-1];assert len(points)==3
                    out_triangles.append([add_dry(np.asarray(point),tris[j]) for point in points])
        dry_union=shapely.union_all(dry_polys);original_domain=shapely.union_all(polys);combined=shapely.union_all([dry_union,wet_union]);difference=float(shapely.symmetric_difference(original_domain,combined).area);overlap=float(shapely.intersection(dry_union,wet_union).area)
        assert difference<.001 and overlap<.001
        vertices=np.asarray(vertices);lon,lat=to_geo.transform(vertices[:,0],vertices[:,1]);output_vertices=np.column_stack([lon,lat,vertices[:,2]]).tolist()
        provenance={'method':'Static display-only ground: union of exact native faces with finite native zs and cell-average depth >= 0.01 m in any of all 57 completed frames. Those faces retain the same native boundary terrain triangles used for water clipping; source coarse ground is subtracted there. Remaining dry-display ground intersections use original coarse-triangle plane heights, except shared native boundaries interpolate matching native boundary elevations for continuity. No water level, quantity, hydraulic geometry or safety tolerance changed.',
            'displayThresholdM':threshold,'thresholdMeaning':'Existing renderer display threshold; subthreshold is not declared hydraulically dry or safe.', 'sourceManifestSha256':sha(FULL/'manifest.json'),'sourceGeometry':manifest['geometry'],'sourceFrames':manifest['frames'],'sourceNativeMapSha256':manifest['provenance']['nativeMapSha256'],'nativeWaterSupport':descriptor['artifact'],'coarseTerrain':entry['artifact'],'sourceTerrainIndexSha256':sha(SOURCE/'terrain-index-overview.json.gz'),'geometryEquivalence':equivalence,'wetFaceMaskSha256':hashlib.sha256(wet.astype('u1').tobytes()).hexdigest(),'nativeWetFaceCount':int(wet.sum()),'nativeGroundTriangles':len(native_triangles),'coarseRemainderTriangles':len(out_triangles)-len(native_triangles),'sharedBoundaryNewVertices':wet_boundary_points,'projectedCoordinateRoundTripToleranceM':.000001,'coverageSymmetricDifferenceM2':difference,'nativeCoarseOverlapM2':overlap}
        value={'kind':'native_domain_terrain_overview','runId':manifest['runId'],'geometrySha256':manifest['geometry']['sha256'],'meshSha256':manifest['provenance']['meshSha256'],'verticalDatum':'NAVD88','terrainOnly':True,'samplingM':spacing,'waterAware':True,'level':0 if spacing==400 else 1,'vertices':output_vertices,'triangles':out_triangles,'coverage':coarse['coverage'],'provenance':provenance}
        art=artifact(SOURCE/f'terrain-water-aware-{spacing}m.json.gz',value);result={'samplingM':spacing,'triangles':len(out_triangles),'vertices':len(vertices),'artifact':art,'nativeGroundTriangles':len(native_triangles),'coarseRemainderTriangles':len(out_triangles)-len(native_triangles),'coverageSymmetricDifferenceM2':difference,'nativeCoarseOverlapM2':overlap};outputs.append(result);print(json.dumps(result),flush=True)
    report={'kind':'completed_water_aware_ground_verification','runId':manifest['runId'],'geometrySha256':manifest['geometry']['sha256'],'displayThresholdM':threshold,'frameCount':57,'nativeWetFaceCount':int(wet.sum()),'nativeWetAreaM2':wet_union.area,'outputs':outputs,'elapsedSeconds':time.perf_counter()-started}
    (SOURCE/'terrain-water-aware-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':main()
