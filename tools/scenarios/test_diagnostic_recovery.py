"""Diagnostic recovery tests use temporary toy columns, never native model evidence."""
from contextlib import redirect_stdout
import copy
import gzip
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import run_design_storm as s
from validate_diagnostic_request import validate_request, verify_original_run


class NumericalAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='floodplain-diagnostic-test-')
        self.root = Path(self.temp.name); self.out = self.root/'out'; self.out.mkdir()
        self.area = np.array([1.,39.0625],dtype='<f4')
        self.samples = {'pr-gates': ([{},{}],np.array([0,1]),np.array([9.,9.]))}

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, out, run_id, failures=()):
        geom=s.live.pack(out/'geometry.bin.gz',{},dict(areaM2=self.area))
        start=s.dt.datetime(2026,11,1,17); times=[s.live.ISO(start+s.dt.timedelta(seconds=900*i)) for i in range(57)]
        frames=[]; road_frames=[]
        for i,time in enumerate(times):
            volume=np.array([1.,0.],dtype='<f4'); surface=np.array([10.,np.nan],dtype='<f4')
            if i in failures: volume[1]=np.float32(-.0815087929368)
            frame=s.live.pack(out/f'frame-{i}.bin.gz',dict(runId=run_id,time=time,geometrySha256=geom['sha256']),dict(nativeVolumeM3=volume,waterSurfaceM=surface))
            frames.append(dict(time=time,**frame)); road_frames.append(dict(validStations=1 if i in failures else 2,wetStations=1))
        manifest=dict(kind='quadtree_output_package',executionMode='live_current_forcing',status='complete',
            case='gates',runId=run_id,geometry=geom,frames=frames,validFrom=times[0],validTo=times[-1],
            solverCompletion={'status':'complete','nativeStatus':[0],'nativeRuntimeSeconds':100.})
        road=dict(kind='live_all_route_road_forecast',executionMode='live_current_forcing',status='complete',
            case='gates',runId=run_id,times=times,hrrrCycle=None,routes={'pr-gates':{'totalStations':2,'frames':road_frames}})
        manifest['roadForecast']=s._json_write(out/'road-forecast.json',road)
        s._json_write(out/'manifest.json',manifest)
        return manifest,road,times

    def test_full_negative_statistics_and_existing_gate(self):
        vol=np.array([1.,-.0815087929368],dtype='<f4'); surface=np.array([10.,np.nan],dtype='<f4'); before=vol.tobytes()
        stats,indices=s.audit_native_frame(vol,surface,self.area,'frame-28',self.samples)
        self.assertEqual(vol.tobytes(),before)
        self.assertEqual(stats['negativeVolume']['count'],1); self.assertEqual(stats['negativeVolume']['areaM2'],39.0625)
        self.assertAlmostEqual(stats['negativeVolume']['minimumEquivalentDepthM'],-.0020866250991821287)
        self.assertAlmostEqual(stats['negativeVolume']['deficitM3'],float(-vol[1]))
        self.assertEqual(stats['beyondResidualLimit']['count'],1); self.assertTrue(stats['qualityFailures'])
        self.assertEqual(indices['negativeVolume'],[1]); self.assertEqual(indices['routeStationIndices']['pr-gates']['unknownResult'],[1])
        self.assertEqual(stats['positiveVolume']['totalM3'],1.)

    def test_dry_missing_surface_stays_valid(self):
        stats,indices=s.audit_native_frame(np.array([1.,0.],dtype='<f4'),np.array([10.,np.nan],dtype='<f4'),self.area,'dry',self.samples)
        self.assertFalse(stats['qualityFailures']); self.assertEqual(stats['routeCoverage']['pr-gates']['validStations'],2)
        self.assertEqual(stats['nonfiniteSurface']['count'],1); self.assertEqual(indices['nonfiniteSurface'],[1])
        self.assertEqual(stats['unknownVolume']['count'],0)

    def test_nonfinite_counts_areas_and_infinities_reject(self):
        area=np.array([2.,3.,4.]); volume=np.array([1.,np.nan,np.inf]); surface=np.array([0.,np.nan,-np.inf])
        stats,indices=s.audit_native_frame(volume,surface,area,'nonfinite')
        self.assertEqual(stats['nonfiniteVolume']['count'],2); self.assertEqual(stats['nonfiniteVolume']['areaM2'],7.)
        self.assertEqual(stats['nonfiniteVolume']['nanCount'],1); self.assertEqual(stats['nonfiniteVolume']['positiveInfinityCount'],1)
        self.assertEqual(stats['nonfiniteSurface']['negativeInfinityCount'],1); self.assertEqual(indices['nonfiniteVolume'],[1,2])
        self.assertTrue(stats['qualityFailures']); json.dumps(stats,allow_nan=False)

    def test_audits_all_57_after_first_failure_and_keeps_bytes(self):
        man,road,times=self.fixture(self.out,'test-diagnostic',failures=(28,56))
        hashes=[s.sha((self.out/f['path']).read_bytes()) for f in man['frames']]
        with patch.object(s.RoadForecast,'load',return_value=SimpleNamespace(samples=self.samples)):
            report=s.audit_compact('gates',man,road,self.out,times,'test-diagnostic')
        self.assertEqual(report['framesAudited'],57); self.assertEqual(report['framesWithStatistics'],57)
        self.assertEqual(report['failedFrames'],[28,56]); self.assertEqual(report['qualityStatus'],'rejected')
        self.assertEqual(report['negativeNativeSamplesRetained'],2); self.assertEqual(len(list(self.out.glob('audit-indices-*.json.gz'))),57)
        self.assertEqual(hashes,[s.sha((self.out/f['path']).read_bytes()) for f in man['frames']])
        indices=json.loads(gzip.decompress((self.out/'audit-indices-28.json.gz').read_bytes()))
        self.assertEqual(indices['beyondResidualLimit'],[1]); json.dumps(report,allow_nan=False)
        self.assertIn('not a solver mass-balance error',report['negativeVolumeDeficitMeaning'])

    def test_corrupted_frame_does_not_hide_later_frames(self):
        man,road,times=self.fixture(self.out,'test-diagnostic',failures=(56,))
        raw=gzip.compress(b'x',mtime=0); path=self.out/'frame-28.bin.gz'; path.write_bytes(raw)
        man['frames'][28].update(bytes=len(raw),sha256=s.sha(raw))
        with patch.object(s.RoadForecast,'load',return_value=SimpleNamespace(samples=self.samples)):
            report=s.audit_compact('gates',man,road,self.out,times,'test-diagnostic')
        self.assertEqual(report['framesAudited'],57); self.assertEqual(report['framesWithStatistics'],56)
        self.assertEqual(report['failedFrames'],[28,56]); self.assertEqual(report['frames'][-1]['index'],56)

    def export_fixture(self, failures, diagnostic_only):
        work=self.root/'work'; work.mkdir(); engine=self.root/'engine'; engine.mkdir()
        engine_bytes=b'fixture-only-engine'; (engine/'sfincs').write_bytes(engine_bytes); (engine/'SOURCE_COMMIT').write_text(s.SOURCE_COMMIT)
        meta=dict(case='gates',scenario='stress',modelVersion='test-gates',validFrom='2026-11-01T17:00:00Z',
            sourceArchiveSha256='fixture',limitations='Software fixture only')
        s._json_write(work/'scenario-case.json',meta)
        def fake_export(case, folder, out, run_id):
            self.fixture(out,run_id,failures)
        with patch.object(s,'ENGINE_SHA256',s.sha(engine_bytes)),patch.object(s.live,'export',side_effect=fake_export),patch.object(s.RoadForecast,'load',return_value=SimpleNamespace(samples=self.samples)),patch.dict(s.os.environ,{'GITHUB_RUN_ID':'test'}),redirect_stdout(io.StringIO()):
            if failures:
                with self.assertRaisesRegex(ValueError,'quality rejected'):
                    s.export('gates','stress',work,self.out,diagnostic_only)
            else:
                s.export('gates','stress',work,self.out,diagnostic_only)
        return json.loads((self.out/'manifest.json').read_text()),json.loads((self.out/'road-forecast.json').read_text())

    def test_bad_post_export_metadata_cannot_leave_live_complete_labels(self):
        for problem in ('nonfinite_manifest', 'malformed_road', 'raised_export_with_malformed_metadata'):
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary); work=root/'work'; work.mkdir(); out=root/'out'; out.mkdir(); engine=root/'engine'; engine.mkdir()
                raw_engine=b'fixture-engine'; (engine/'sfincs').write_bytes(raw_engine); (engine/'SOURCE_COMMIT').write_text(s.SOURCE_COMMIT)
                meta=dict(case='gates',scenario='stress',modelVersion='test',validFrom='2026-11-01T17:00:00Z',sourceArchiveSha256='fixture',limitations='Fixture only')
                s._json_write(work/'scenario-case.json',meta)
                originals={}
                def fake_export(case, folder, target, run_id):
                    man,road,_=self.fixture(target,run_id)
                    if problem=='nonfinite_manifest':
                        man['solverCompletion']['nativeRuntimeSeconds']=float('nan')
                        (target/'manifest.json').write_text(json.dumps(man))
                    else:
                        (target/'road-forecast.json').write_text('{')
                    originals.update({name:(target/name).read_bytes() for name in ('manifest.json','road-forecast.json')})
                    if problem=='raised_export_with_malformed_metadata': raise ValueError('Simulated export failure')
                with patch.object(s,'ENGINE_SHA256',s.sha(raw_engine)), patch.object(s.live,'export',side_effect=fake_export), redirect_stdout(io.StringIO()):
                    with self.assertRaises(ValueError): s.export('gates','stress',work,out,True)
                for name in ('manifest.json','road-forecast.json'):
                    item=s._strict_json((out/name).read_bytes())
                    self.assertEqual(item['status'],'diagnostic_only'); self.assertTrue(item['diagnosticOnly'])
                    self.assertFalse(item['acceptedForDisplay']); self.assertEqual(item['executionMode'],'synthetic_design_storm_diagnostic')
                    evidence=out/item['unvalidatedMetadataEvidence']['path']
                    self.assertEqual(gzip.decompress(evidence.read_bytes()),originals[name])
                manifest=s._strict_json((out/'manifest.json').read_bytes())
                self.assertEqual(manifest['solverCompletion']['nativeStatus'],[0])
                if problem=='nonfinite_manifest': self.assertIsNone(manifest['solverCompletion']['nativeRuntimeSeconds'])
                self.assertEqual(manifest['roadForecast']['sha256'],s.sha((out/'road-forecast.json').read_bytes()))

    def test_rejected_regular_export_is_diagnostic_never_live_complete(self):
        man,road=self.export_fixture((28,),False)
        for item in (man,road):
            self.assertEqual(item['status'],'diagnostic_only'); self.assertEqual(item['executionMode'],'synthetic_design_storm_diagnostic')
            self.assertFalse(item['acceptedForDisplay']); self.assertTrue(item['diagnosticOnly']); self.assertEqual(item['qualityStatus'],'rejected')
        self.assertEqual(man['solverCompletion']['nativeStatus'],[0]); self.assertEqual(man['solverCompletion']['status'],'complete')
        self.assertEqual(len(man['frames']),57); self.assertNotIn('hrrrCycle',road)
        report=json.loads((self.out/'numerical-audit.json').read_text()); self.assertEqual(report['framesAudited'],57)
        self.assertEqual(s.sha((self.out/'road-forecast.json').read_bytes()),man['roadForecast']['sha256'])

    def test_recovery_cannot_promote_even_when_gate_passes(self):
        man,road=self.export_fixture((),True)
        self.assertEqual(man['qualityStatus'],'passed_existing_gate'); self.assertEqual(man['status'],'diagnostic_only')
        self.assertFalse(man['acceptedForDisplay']); self.assertIn('-diagnostic-',man['runId'])

    def test_clean_regular_export_preserves_existing_acceptance(self):
        man,road=self.export_fixture((),False)
        self.assertEqual(man['status'],'complete'); self.assertEqual(man['executionMode'],'synthetic_design_storm')
        self.assertTrue(man['acceptedForDisplay']); self.assertEqual(man['kind'],'quadtree_output_package')
        self.assertEqual(road['kind'],'saved_all_route_road_forecast')


class RecoveryRequestTests(unittest.TestCase):
    def setUp(self):
        self.request=dict(schemaVersion=1,purpose='diagnostic_recovery_only',enabled=False,productionPublication=False,
            acceptForDisplay=False,solverCapSeconds=5400,maximumRecoveryJobs=2,originalRunId=43538306549,jobs=[dict(case='gates',scenario='stress')])
        self.run=dict(id=43538306549,path='.github/workflows/design-storm-preview.yml',head_branch='experiment/all-route-storm-preview')
        self.jobs=[dict(name=f'run ({case}, {scenario})',status='completed',conclusion='success',steps=[])
            for case in ('northern','picture-rocks','gates') for scenario in ('stress','extreme')]
        self.jobs[4].update(conclusion='failure',steps=[dict(name='Export and validate preview output only',conclusion='failure')])

    def test_request_shape_allows_only_explicit_opt_in(self):
        path=Path(s.__file__).parent/'diagnostic-run-request.json'; actual=json.loads(path.read_text())
        validate_request(actual)
        self.assertFalse(self.request['enabled']); self.assertEqual(validate_request(self.request),{'include':[{'case':'gates','scenario':'stress'}]})
        self.request['enabled']=True
        self.assertEqual(validate_request(self.request),{'include':[{'case':'gates','scenario':'stress'}]})

    def test_only_gates_and_at_most_two(self):
        self.request['jobs']=[dict(case='northern',scenario='stress')]
        with self.assertRaises(ValueError): validate_request(self.request)
        self.request['jobs']=[dict(case='gates',scenario='stress')]*2
        with self.assertRaises(ValueError): validate_request(self.request)
        self.request['jobs']=[dict(case='gates',scenario='stress'),dict(case='gates',scenario='extreme')]
        self.assertEqual(len(validate_request(self.request)['include']),2)

    def test_limits_cannot_be_relaxed(self):
        for key,value in [('solverCapSeconds',5401),('productionPublication',True),('acceptForDisplay',True),('maximumRecoveryJobs',3),('enabled','true')]:
            request=copy.deepcopy(self.request); request[key]=value
            with self.assertRaises(ValueError): validate_request(request)

    def test_more_than_one_original_remaining_refused(self):
        self.jobs[3]['status']='in_progress'; self.jobs[5]['status']='queued'
        with self.assertRaisesRegex(ValueError,'More than one'): verify_original_run(self.request,self.run,self.jobs)

    def test_one_original_remaining_allows_bounded_recovery(self):
        self.jobs[5]['status']='in_progress'
        self.assertEqual(verify_original_run(self.request,self.run,self.jobs),1)

    def test_wrong_source_or_nonfailed_target_refused(self):
        run=copy.deepcopy(self.run); run['head_branch']='main'
        with self.assertRaises(ValueError): verify_original_run(self.request,run,self.jobs)
        self.jobs[4]['conclusion']='success'
        with self.assertRaises(ValueError): verify_original_run(self.request,self.run,self.jobs)

    def test_failed_native_step_must_be_expected_quality_gate(self):
        self.jobs[4]['steps']=[dict(name='Run bounded native scenario',conclusion='failure')]
        with self.assertRaisesRegex(ValueError,'expected native export'): verify_original_run(self.request,self.run,self.jobs)

    def test_workflow_is_separate_read_only_and_retains_rejections(self):
        text=(Path(s.__file__).resolve().parents[2]/'.github/workflows/design-storm-diagnostic-recovery.yml').read_text()
        self.assertIn('max-parallel: 2',text); self.assertIn('timeout --signal=KILL 5400',text)
        self.assertIn('contents: read',text); self.assertIn('actions: read',text)
        self.assertNotIn('contents: write',text); self.assertNotIn('git push',text)
        self.assertIn('diagnostic-export',text); self.assertIn('if: always()',text)
        self.assertIn('work/sfincs_his.nc',text); self.assertIn('work/sfincs.log',text)
        self.assertIn('group: expanded-design-storm-diagnostic-recovery',text)


if __name__=='__main__':
    unittest.main()
