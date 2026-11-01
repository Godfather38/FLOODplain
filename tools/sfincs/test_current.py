"""Adapter-only tests: no terrain, hydraulic execution or predictive outputs."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import pandas as pd
import xarray as xr
from hydromt_sfincs import SfincsModel
from prepare_current import apply_discharge, apply_precipitation, apply_current_forcing, discharge_table


class CurrentAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.model = SfincsModel(root=self.tmp.name, mode='w', write_gis=False)
        self.model.setup_grid(x0=467000, y0=3577000, dx=100, dy=100,
                              nmax=190, mmax=265, rotation=0, epsg=32612)
        self.model.set_grid(self.model.mask.copy(data=np.ones((190,265),dtype=np.uint8)), name='msk')
        self.model.setup_config(tref='20261101 140000', tstart='20261101 140000', tstop='20261101 160000')
        self.registry=json.loads((Path(__file__).parent/'data/current-boundary-registry.json').read_text())
        self.times=['2026-11-01T14:00:00Z','2026-11-01T15:00:00Z','2026-11-01T16:00:00Z']
        self.series=[{'reachId':self.registry['sources'][0]['reachId'],'status':'ok',
                      'issuedAt':'2026-11-01T13:00:00Z','retrievedAt':'2026-11-01T13:30:00Z',
                      'points':[{'time':t,'flowM3s':q} for t,q in zip(self.times,[1.,2.,3.])]}]
        self.meta={'status':'complete','units':'mm/h','issuedAt':'2026-11-01T13:00:00Z',
                   'asOf':'2026-11-01T13:30:00Z','intervalSeconds':3600,
                   'intervalEndUtc':'2026-11-01T17:00:00Z',
                   'sourceArtifacts':[{'kind':'adapter_test_fixture_not_weather'}]}
        self.rain=xr.DataArray(np.ones((3,10,12),dtype=np.float32),dims=('time','y','x'),
                              coords={'time':pd.to_datetime(self.times,utc=True).tz_localize(None),
                                      'y':np.arange(3602000,3572000,-3000),
                                      'x':np.arange(464000,500000,3000)},name='precip')
        self.rain.raster.set_crs(32612)

    def tearDown(self):
        for handler in list(self.model.logger.handlers):
            handler.close()
            self.model.logger.removeHandler(handler)
        self.tmp.cleanup()

    def test_official_discharge_preserves_values(self):
        result=apply_discharge(self.model,self.registry,self.series,self.times[0],self.times[-1],self.meta['asOf'])
        self.assertEqual(result['sourceCount'],1)
        np.testing.assert_allclose(self.model.forcing['dis'].values.reshape(-1),[1,2,3])

    def test_official_precip_preserves_rates(self):
        result=apply_precipitation(self.model,self.rain,self.meta)
        self.assertEqual(result['intervalLabel'],'start')
        np.testing.assert_allclose(self.model.forcing['precip_2d'].values,1)

    def test_missing_rain_rejected_before_hydromt_zero_fill(self):
        self.rain.values[1,4,4]=np.nan
        with self.assertRaisesRegex(ValueError,'missing/negative'):
            apply_precipitation(self.model,self.rain,self.meta)

    def test_wrong_reach_and_uncovered_end_rejected(self):
        series=copy.deepcopy(self.series);series[0]['reachId']='15890430'
        with self.assertRaisesRegex(ValueError,'Missing usable'):
            discharge_table(self.registry,series,self.times[0],self.times[-1],self.meta['asOf'])
        with self.assertRaisesRegex(ValueError,'endpoints'):
            discharge_table(self.registry,self.series,self.times[0],'2026-11-01T17:00:00Z',self.meta['asOf'])

    def test_partial_physical_case_not_prepared(self):
        with self.assertRaisesRegex(ValueError,'Incomplete physical'):
            apply_current_forcing(self.model,self.registry,{},self.rain,self.meta,{})

    def test_rain_footprint_cannot_be_extended_as_zero(self):
        with self.assertRaisesRegex(ValueError,'cover entire'):
            apply_precipitation(self.model,self.rain.isel(x=slice(4,6)),self.meta)


if __name__=='__main__':
    unittest.main()

