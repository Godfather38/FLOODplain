"""Synthetic geometry/volume checks only; never a forecast artifact."""
import importlib.util
from pathlib import Path
import unittest
import tempfile,json,gzip
import numpy as np
import xarray as xr
spec=importlib.util.spec_from_file_location('exporter',Path(__file__).parents[1]/'tools/simulation/export_quadtree_output.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class QuadtreeExport(unittest.TestCase):
    def test_synthetic_package_reorders_native_ids_and_never_publishes_current(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1]) as tmp:
            root=Path(tmp)
            mesh=xr.Dataset({'mesh':xr.DataArray(0,attrs={'cf_role':'mesh_topology','topology_dimension':2,'face_node_connectivity':'nodes','node_coordinates':'x y'}),
                'nodes':(('face','corner'),[[0,1,2,3],[4,5,6,7]]),'x':('node',[0,100,100,0,100,125,125,100]),'y':('node',[0,0,100,100,0,0,25,25]),'id':('face',[90,7])})
            mesh.to_netcdf(root/'mesh.nc')
            native=xr.Dataset({'id':('face',[7,90]),'volume':(('time','face'),[[625.,10000.],[1250.,np.nan]]),'zs':(('time','face'),[[600.,601.],[602.,np.nan]])},coords={'time':np.array(['2026-11-01T17:00','2026-11-01T17:15'],dtype='datetime64[ns]')})
            native.volume.attrs['units']='m3';native.zs.attrs['units']='m';native.to_netcdf(root/'map.nc')
            (root/'solver.log').write_text('Synthetic test fixture: Simulation finished')
            config={'runId':'synthetic-code-check','executionMode':'simulated_live_frozen_inputs','meshFile':'mesh.nc','mapFile':'map.nc','logFile':'solver.log','meshTopology':'mesh','meshFaceIdVariable':'id','outputFaceIdVariable':'id','volumeVariable':'volume','surfaceVariable':'zs','projectedCrs':'EPSG:32612','verticalDatum':'synthetic-test-only','nativeTimeZone':'UTC','validFrom':'2026-11-01T17:00:00Z','validTo':'2026-11-01T17:15:00Z','assumptions':['Synthetic code check, not observations or forecast'],'inputArtifacts':[{'path':'mesh.nc','sha256':module.sha(root/'mesh.nc')}]}
            (root/'config.json').write_text(json.dumps(config));result=module.export(root/'config.json',root/'package')
            frame=json.loads(gzip.decompress((root/'package'/result['frames'][1]['path']).read_bytes()))
            self.assertEqual(frame['nativeVolumeM3'],[None,1250]);self.assertEqual(frame['depthM'],[None,2]);self.assertEqual(result['resolution']['minimumM'],25)
            self.assertFalse((root/'package/current-sfincs-manifest.json').exists())
            with self.assertRaises(ValueError):module.export(root/'config.json',root/'package')
    def test_actual_variable_areas_and_hanging_edge_node(self):
        ds=xr.Dataset({'mesh':xr.DataArray(0,attrs={'cf_role':'mesh_topology','topology_dimension':2,'face_node_connectivity':'nodes','node_coordinates':'x y'}),
          'nodes':(('face','corner'),[[1,2,3,4,5],[6,7,8,9,-999]]),
          'x':('node',[0,50,100,100,0,100,125,125,100]),'y':('node',[0,0,0,100,100,0,0,25,25]),'id':('face',[90,7])})
        ds.nodes.attrs={'start_index':1,'_FillValue':-999}
        cells,rings,areas=module.geometry(ds,'mesh','id','EPSG:32612')
        np.testing.assert_allclose(areas,[10000,625]);self.assertEqual([c['nativeFaceId'] for c in cells],['90','7']);self.assertEqual(len(rings[0]),5)
        values=module.frame_values([10000,625],[600,599],areas,0)
        self.assertEqual(values['depthM'],[1,1]);self.assertEqual(values['waterSurfaceM'],[600,599])
    def test_missing_and_small_negative_raw_volume_preserved(self):
        values=module.frame_values([np.nan,-.01],[np.nan,600],np.array([100,25]),.02)
        self.assertEqual(values['depthM'],[None,0]);self.assertEqual(values['nativeVolumeM3'],[None,-.01])
        with self.assertRaises(ValueError):module.frame_values([-1],[600],np.array([25]),.02)
        with self.assertRaises(ValueError):module.face_ids([1,1])
        with self.assertRaises(ValueError):module.face_ids([1.5])
if __name__=='__main__':unittest.main()

