"""Software-only toy fixtures, never publishable hydrology results."""
from contextlib import redirect_stdout
import copy
import gzip
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np

import build_display_packages as b


def inverse_utm(east, north):
    a=6378137.; f=1/298.257223563; k=.9996; e2=f*(2-f); ep2=e2/(1-e2)
    mu=(north/k)/(a*(1-e2/4-3*e2*e2/64-5*e2**3/256)); e1=(1-np.sqrt(1-e2))/(1+np.sqrt(1-e2))
    p=mu+(3*e1/2-27*e1**3/32)*np.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*np.sin(4*mu)+(151*e1**3/96)*np.sin(6*mu)+(1097*e1**4/512)*np.sin(8*mu)
    s,c,t=np.sin(p),np.cos(p),np.tan(p); n=a/np.sqrt(1-e2*s*s); r=a*(1-e2)/(1-e2*s*s)**1.5
    tt=t*t; cc=ep2*c*c; d=(east-500000)/(n*k)
    lat=(p-n*t/r*(d*d/2-(5+3*tt+10*cc-4*cc*cc-9*ep2)*d**4/24+(61+90*tt+298*cc+45*tt*tt-252*ep2-3*cc*cc)*d**6/720))*180/np.pi
    lon=-111+(d-(1+2*tt+cc)*d**3/6+(5-2*cc+28*tt-3*cc*cc+8*ep2+24*tt*tt)*d**5/120)/c*180/np.pi
    return lon,lat


def native_blob(metadata, columns):
    offset=0; descriptors={}; blocks=[]
    for name, values in columns.items():
        values=np.asarray(values); raw=values.tobytes()
        descriptors[name]=dict(type='d' if values.dtype.itemsize==8 else 'f', offset=offset, count=len(values))
        blocks.append(raw); offset+=len(raw)
    header=b.json_bytes(dict(format='floodplain-columns-v1', metadata=metadata, columns=descriptors))
    return gzip.compress(struct.pack('<I',len(header))+header+b''.join(blocks),mtime=0)


def save_native(folder, name, raw):
    (folder/name).write_bytes(raw)
    return dict(path=name,bytes=len(raw),sha256=b.sha(raw))


def read_fpqw(path):
    raw=gzip.decompress(path.read_bytes()); size=struct.unpack('<I',raw[4:8])[0]
    return b.json_load(raw[8:8+size]),raw[8+size:]


class DisplayPackages(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='floodplain-software-test-')
        self.root=Path(self.temp.name); self.source=self.root/'native'; self.saved=self.root/'saved'; self.out=self.root/'display'; self.forcing=self.root/'forcing'
        self.saved.mkdir(); self.registry={'cases':[]}; infos=[]
        ix=np.array([16,0,4,0,4]); iy=np.array([0,0,0,4,4]); level=np.array([3,2,2,2,2]); flags=np.array([0,2,2,2,2],dtype='u1')
        area=(b.UNIT*2.**level)**2
        lon,lat=inverse_utm(480000+ix*b.UNIT+np.sqrt(area)/2,3580000+iy*b.UNIT+np.sqrt(area)/2)
        geometry=native_blob({'nativeFaceIds':[str(i) for i in range(5)]},dict(lon=lon,lat=lat,resolutionM=np.sqrt(area),areaM2=area))
        for key in b.CASE_ORDER:
            directory=self.saved/key; directory.mkdir()
            variants={}
            for variant in ('full','web'):
                x,y,l,fl,route=(ix,iy,level,flags,np.array([0])) if variant=='full' else (np.array([16,0]),np.array([0,0]),np.array([3,3]),np.array([0,2],dtype='u1'),np.array([0]))
                header=dict(format='floodplain-quad-cells-v1',case=key,e0=480000,n0=3580000,unitM=b.UNIT,count=len(x),routeCells=1)
                g=b.pack(directory/f'cells-{variant}.bin.gz',header,[x.astype('<u2'),y.astype('<u2'),l.astype('u1'),fl,np.zeros((-2*len(x))%4,'u1'),route.astype('<u4')])
                variants[variant]=dict(cells=len(x),geometry=g,frameBytes=0)
            infos.append(dict(key=key,label=key,e0=480000,n0=3580000,nativeCells=5,variants=variants,routes=[key],routePoints=[dict(id='point',slot=0,nativeCell=0,lon=float(lon[0]),lat=float(lat[0]),routes=[key])],outline=[],labelAt=[float(lat[0]),float(lon[0])],bounds=[[32,-111],[33,-110]]))
            entry=dict(case=key,modelVersion='toy-'+key,archiveSha256='case-archive',meshSha256='mesh-hash',geometry=dict(sha256=b.sha(geometry)),inlets=[dict(reachId='15902363' if key=='northern' else 'other',x=480100.,y=3580000.)])
            self.registry['cases'].append(entry)
            for scenario in b.SCENARIOS:
                folder=self.source/scenario/key/'compact'; folder.mkdir(parents=True)
                force_dir=self.forcing/scenario/key; force_dir.mkdir(parents=True)
                dis=''.join(f'{i*3600} {100+i}\n' for i in range(64)).encode(); (force_dir/'sfincs.dis').write_bytes(dis)
                river=dict(targetReachId='15902363' if key=='northern' else None,targetColumn=1 if key=='northern' else None,designPeakM3s=163 if key=='northern' else None)
                meta=dict(kind='expanded_design_storm_case',executionMode=b.MODE,scenario=scenario,case=key,returnPeriodYears=b.SCENARIOS[scenario][0],sourceArchiveSha256=b.SCENARIOS[scenario][1],modelVersion=entry['modelVersion'],caseArchiveSha256=entry['archiveSha256'],physicalInputSha256={'sfincs.nc':entry['meshSha256']},modifiedInputSha256={'sfincs.dis':b.sha(dis),'precip_2d.nc':'rain-hash'},reference='2026-10-30T16:00:00Z',validFrom=b.TIMES[0],validTo=b.TIMES[-1],frameSeconds=900,rain=[dict(elapsedSeconds=h*3600,mmPerHour=10. if h==53 else 0.) for h in range(49,63)],river=river,limitations='Synthetic software fixture only; not native simulation evidence.')
                (folder/'scenario-case.json').write_bytes(b.json_bytes(meta))
                run_id=f'toy-{key}-{scenario}-preview-123'
                geom=save_native(folder,'geometry.bin.gz',geometry)
                frames=[]
                for i,time in enumerate(b.TIMES):
                    raw=native_blob(dict(runId=run_id,time=time,geometrySha256=geom['sha256']),dict(nativeVolumeM3=(area*np.array([1.234567,1,2,3,4])).astype('<f4'),waterSurfaceM=np.array([700.125,700,701,702,703],dtype='<f4')))
                    frames.append(dict(time=time,**save_native(folder,f'frame-{i}.bin.gz',raw)))
                road=dict(kind='saved_all_route_road_forecast',status='complete',executionMode=b.MODE,scenario=scenario,case=key,runId=run_id,times=b.TIMES,validFrom=b.TIMES[0],validTo=b.TIMES[-1],provenance={'geometrySha256':geom['sha256']},scenarioInputs=meta)
                road_descriptor=save_native(folder,'road-forecast.json',b.json_bytes(road))
                manifest=dict(kind='quadtree_output_package',status='complete',executionMode=b.MODE,scenario=scenario,case=key,runId=run_id,modelVersion=entry['modelVersion'],caseArchiveSha256=entry['archiveSha256'],geometry=geom,frames=frames,roadForecast=road_descriptor,scenarioInputs=meta,validFrom=b.TIMES[0],validTo=b.TIMES[-1],issuedAt='2026-11-14T00:00:00Z',solverCompletion={'status':'complete','nativeStatus':[0]})
                (folder/'manifest.json').write_bytes(b.json_bytes(manifest))
        (self.saved/'package.json').write_bytes(b.json_bytes(dict(schema='floodplain-all-route-web/v1',unitM=b.UNIT,web={'blockM':b.BLOCK_M},caseOrder=b.CASE_ORDER,cases=infos)))

    def tearDown(self):
        self.temp.cleanup()

    def run_build(self,**kwargs):
        with redirect_stdout(io.StringIO()):
            return b.build(self.source,self.saved,self.out,self.registry,**kwargs)

    def change_manifest(self,change,scenario='stress',case='northern'):
        path=self.source/scenario/case/'compact/manifest.json'; value=b.json_load(path.read_bytes()); change(value); path.write_bytes(b.json_bytes(value))

    def test_complete_packages_and_exact_geometry_route_values(self):
        outputs=self.run_build(forcing_root=self.forcing)
        self.assertEqual(len(outputs),2)
        for output in outputs:
            package=b.json_load((output/'package.json').read_bytes())
            self.assertFalse(package['live']); self.assertEqual(package['executionMode'],b.MODE)
            self.assertEqual(package['validFrom'],b.TIMES[0]); self.assertEqual(package['validTo'],b.TIMES[-1])
            self.assertEqual(package['forcing']['frames'][1]['inflowM3s'],149.25)
            inlet=package['forcing']['inflow']['byCase']['northern']['inlets'][0]
            self.assertEqual((inlet['eastingM'],inlet['northingM'],inlet['role']),(480100.,3580000.,'design_santa_cruz'))
            self.assertEqual(len(inlet['samples']),15)
            self.assertEqual(package['forcing']['inflow']['byCase']['gates']['inlets'][0]['role'],'unchanged_baseline')
            self.assertEqual(package['forcing']['frames'][13]['rainMmH'],2.5)
            self.assertIsNone(package['forcing']['frames'][-1]['rainMmH'])
            for case in package['cases']:
                self.assertEqual(len(case['frames']),57)
                for variant in ('web','full'):
                    self.assertEqual((output/case['key']/f'cells-{variant}.bin.gz').read_bytes(),(self.saved/case['key']/f'cells-{variant}.bin.gz').read_bytes())
                    for frame in case['frames']:
                        raw=b.file_bytes(output/case['key'],frame[variant],'file'); header,body=read_fpqw(output/case['key']/frame[variant]['file'])
                        self.assertEqual(header['unknownCells'],0)
                        ro=6*header['listed']+(-2*header['listed'])%4
                        depth=np.frombuffer(body,'<f4',1,ro)[0]; zs=np.frombuffer(body,'<f4',1,ro+4)[0]
                        self.assertEqual(depth,np.float32(np.float32(2500*1.234567)/2500)); self.assertEqual(zs,np.float32(700.125))
                self.assertEqual((output/case['key']/'sfincs.dis').read_bytes(),(self.forcing/output.name.removeprefix('all-route-')/case['key']/'sfincs.dis').read_bytes())
        with self.assertRaisesRegex(ValueError,'already exists'):
            self.run_build()

    def test_missing_case_rejected_before_any_output(self):
        (self.source/'extreme/gates/compact/manifest.json').unlink()
        with self.assertRaises(FileNotFoundError): self.run_build()
        self.assertFalse(self.out.exists())

    def test_missing_frame_rejected(self):
        self.change_manifest(lambda m:m['frames'].pop())
        with self.assertRaisesRegex(ValueError,'57 ordered'): self.run_build()
        self.assertFalse(self.out.exists())

    def test_live_cannot_be_relabelled_scenario(self):
        self.change_manifest(lambda m:m.update(executionMode='live_current_forcing'))
        with self.assertRaisesRegex(ValueError,'scenario identity'): self.run_build()

    def test_native_hash_tampering_rejected(self):
        path=self.source/'stress/northern/compact/frame-0.bin.gz'; path.write_bytes(path.read_bytes()+b'x')
        with self.assertRaisesRegex(ValueError,'checksum'): self.run_build()

    def test_geometry_position_change_rejected(self):
        info=b.json_load((self.saved/'package.json').read_bytes())['cases'][0]
        full=b.read_cells((self.saved/'northern/cells-full.bin.gz').read_bytes())
        meta,geom=b.read_columns((self.source/'stress/northern/compact/geometry.bin.gz').read_bytes())
        geom['lon']=geom['lon'].copy(); geom['lon'][0]+=.001
        with self.assertRaisesRegex(ValueError,'positions'): b.validate_geometry(meta,geom,full,info)

    def test_face_order_change_rejected(self):
        info=b.json_load((self.saved/'package.json').read_bytes())['cases'][0]
        full=b.read_cells((self.saved/'northern/cells-full.bin.gz').read_bytes())
        meta,geom=b.read_columns((self.source/'stress/northern/compact/geometry.bin.gz').read_bytes())
        meta['nativeFaceIds'][0]='4'
        with self.assertRaisesRegex(ValueError,'face count/order'): b.validate_geometry(meta,geom,full,info)

    def test_overlap_flag_change_rejected(self):
        full=list(b.read_cells((self.saved/'northern/cells-full.bin.gz').read_bytes()))
        web=list(b.read_cells((self.saved/'northern/cells-web.bin.gz').read_bytes()))
        web[4]=web[4].copy(); web[4][1]=0
        with self.assertRaisesRegex(ValueError,'overlap flags'): b.web_mapping(full,web)

    def test_forcing_wrong_hash_rejected(self):
        (self.forcing/'stress/northern/sfincs.dis').write_text('0 1\n226800 2\n')
        with self.assertRaisesRegex(ValueError,'Forcing file differs'): self.run_build(forcing_root=self.forcing)

    def test_missing_inflow_remains_null(self):
        output=self.run_build(scenarios=('stress',))[0]
        package=b.json_load((output/'package.json').read_bytes())
        self.assertFalse(package['forcing']['inflow']['available'])
        self.assertTrue(all(frame['inflowM3s'] is None for frame in package['forcing']['frames']))

    def test_unknowns_and_signed_residuals_preserved(self):
        folder=self.source/'stress/northern/compact'
        manifest=b.json_load((folder/'manifest.json').read_bytes()); descriptor=manifest['frames'][0]
        meta,cols=b.read_columns((folder/descriptor['path']).read_bytes())
        cols={k:v.copy() for k,v in cols.items()}; cols['nativeVolumeM3'][0]=-.25; cols['nativeVolumeM3'][1]=np.nan
        descriptor.update(save_native(folder,descriptor['path'],native_blob(meta,cols)))
        (folder/'manifest.json').write_bytes(b.json_bytes(manifest))
        output=self.run_build(scenarios=('stress',))[0]
        points=b.json_load((output/'route-points.json').read_bytes())['cases']['northern']['points']['point']
        self.assertIsNone(points['depth'][0]); self.assertIsNone(points['zs'][0]); self.assertEqual(points['nativeVolumeM3'][0],-.25)
        self.assertEqual(np.float32(points['nativeDepthM'][0]),np.float32(-.25/2500))
        for variant,expected in [('full',[0,1]),('web',[0,1])]:
            header,body=read_fpqw(output/'northern'/f'{variant}-0.bin.gz'); ro=6*header['listed']+(-2*header['listed'])%4
            unknown=np.frombuffer(body,'<u4',header['unknownCells'],ro+8*header['routeCells'])
            np.testing.assert_array_equal(unknown,expected)
        # No NaN JSON token can be produced, even when native arrays contain it.
        for path in output.rglob('*.json'): b.json_load(path.read_bytes())

    def test_dry_volume_with_missing_surface_is_not_unknown_depth(self):
        folder=self.source/'stress/northern/compact'
        manifest=b.json_load((folder/'manifest.json').read_bytes()); descriptor=manifest['frames'][0]
        meta,cols=b.read_columns((folder/descriptor['path']).read_bytes())
        cols={k:v.copy() for k,v in cols.items()}; cols['nativeVolumeM3'][0]=0.; cols['waterSurfaceM'][0]=np.nan
        descriptor.update(save_native(folder,descriptor['path'],native_blob(meta,cols)))
        (folder/'manifest.json').write_bytes(b.json_bytes(manifest))
        output=self.run_build(scenarios=('stress',))[0]
        points=b.json_load((output/'route-points.json').read_bytes())['cases']['northern']['points']['point']
        self.assertEqual(points['depth'][0],0.); self.assertIsNone(points['zs'][0])
        header,_=read_fpqw(output/'northern/full-0.bin.gz'); self.assertEqual(header['unknownCells'],0)

    def test_mixed_workflow_runs_rejected(self):
        folder=self.source/'stress/northern/compact'
        manifest=b.json_load((folder/'manifest.json').read_bytes()); new_id=manifest['runId'].replace('preview-123','preview-456')
        manifest['runId']=new_id
        for descriptor in manifest['frames']:
            metadata,cols=b.read_columns((folder/descriptor['path']).read_bytes()); metadata['runId']=new_id
            descriptor.update(save_native(folder,descriptor['path'],native_blob(metadata,cols)))
        road=b.json_load((folder/'road-forecast.json').read_bytes()); road['runId']=new_id
        manifest['roadForecast']=save_native(folder,'road-forecast.json',b.json_bytes(road))
        (folder/'manifest.json').write_bytes(b.json_bytes(manifest))
        with self.assertRaisesRegex(ValueError,'one matching preview workflow run'): self.run_build()
        self.assertFalse(self.out.exists())

    def test_invalid_json_rejected(self):
        with self.assertRaisesRegex(ValueError,'Non-finite'): b.json_load('{"bad":NaN}')
        with self.assertRaises(ValueError): b.json_bytes({'bad':float('inf')})

    def test_path_traversal_rejected(self):
        with self.assertRaisesRegex(ValueError,'Unsafe'): b.file_bytes(self.source,dict(path='../manifest.json'))


if __name__=='__main__':
    unittest.main()
