import unittest,tempfile
from pathlib import Path
import numpy as np
from native_dry_residuals import NativeDryEvidence,load_evidence,SOURCE_COMMIT,MAX_DEPTH_M,MAX_VOLUME_M3
from test_export_road_forecast import forecast,station
class ResidualTests(unittest.TestCase):
 def test_limits_missing_and_contradictory_surface(self):
  v=np.array([-1e-8,-2e-5,-2e-7,np.nan,-99999,-1e-8,-1e-8,-1e-8,0,1e-8]);a=np.ones(10);z=np.full(10,np.nan);z[5]=10;z[6]=np.inf;z[7]=-99999
  e=NativeDryEvidence(np.ones(10),np.ones(10)*600,np.ones(10),{})
  np.testing.assert_array_equal(e.classify(v,z,a),[1,0,0,0,0,0,0,1,0,0])
  self.assertEqual(v[0],-1e-8)
 def test_inactive_bottom_capacity_and_area_unknown(self):
  e=NativeDryEvidence([0,1,1,1,1],[600,np.nan,600,600,600],[1,1,0,np.nan,1],{})
  self.assertFalse(e.classify(np.full(5,-1e-8),np.full(5,np.nan),[1,1,1,1,np.nan]).any())
 def test_exact_bounds_not_extended(self):
  e=NativeDryEvidence([1,1],[600,600],[1,1],{})
  np.testing.assert_array_equal(e.classify([-MAX_DEPTH_M,np.nextafter(-MAX_DEPTH_M,-np.inf)],[np.nan,np.nan],[1,1]),[1,0])
  np.testing.assert_array_equal(e.classify([-MAX_VOLUME_M3,np.nextafter(-MAX_VOLUME_M3,-np.inf)],[np.nan,np.nan],[1000,1000]),[1,0])
 def test_default_unknown_and_evidence_dry_counts(self):
  v=np.array([0.,-1e-6,0.]);z=np.full(3,np.nan);original=v.copy();f=forecast();f.add_frame('a',v,z);self.assertEqual(f.routes['trico']['frames'][0]['validStations'],0)
  f=forecast();f.native_dry_evidence=NativeDryEvidence([1]*3,[600]*3,[1]*3,{})
  f.add_frame('a',v,z);self.assertEqual(f.routes['trico']['frames'][0]['validStations'],1);self.assertEqual(f.routes['trico']['frames'][0]['nativeDryResidualStations'],1);np.testing.assert_array_equal(v,original)
 def test_unknown_road_height_and_outside_remain_unknown(self):
  f=forecast([station(height=None),station(lon=9)]);f.native_dry_evidence=NativeDryEvidence([1]*3,[600]*3,[1]*3,{})
  f.add_frame('a',np.full(3,-1e-8),np.full(3,np.nan));self.assertEqual(f.routes['trico']['frames'][0]['validStations'],0)
 def test_missing_wrong_source_or_unfinished_disables(self):
  with tempfile.TemporaryDirectory() as d:
   for case,complete,source in [('picture-rocks',True,SOURCE_COMMIT),('northern',True,SOURCE_COMMIT),('picture-rocks',False,SOURCE_COMMIT),('picture-rocks',True,'other')]:
    self.assertIsNone(load_evidence(d,np.arange(3),case,complete,source))
