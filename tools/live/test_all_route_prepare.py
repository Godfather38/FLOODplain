"""Exercise fresh preparation without a solver or network dependency."""
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import h5py
import numpy as np

import run_live_all_route as live


class PrepareTests(unittest.TestCase):
    def test_prepare_does_not_require_completed_solver_or_export_objects(self):
        hours = live.SPIN + live.AHEAD
        case = {'modelVersion': 'fixture', 'archiveSha256': 'fixture-hash', 'inlets': []}
        def unpack(entry, work):
            with h5py.File(work / 'precip_2d.nc', 'w') as f:
                t = f.create_dataset('time', data=np.arange(hours, dtype=float))
                t.attrs['units'] = np.bytes_('minutes since 2026-11-01T00:00:00')
                f.create_dataset('x', data=[1., 2.])
                f.create_dataset('y', data=[3., 4.])
                f.create_dataset('Precipitation', shape=(hours, 2, 2), dtype='f4')
            (work / 'sfincs.inp').write_text('tref = 20261101 000000\ntstart = 20261101 000000\ntstop = 20261104 000000\nt0out = 0\ndtout = 1800\ndtrstout = 0\n')
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp) / 'case'
            with patch.object(live, 'case_entry', return_value=case), \
                    patch.object(live, 'unpack', side_effect=unpack), \
                    patch.object(live, 'utm_to_lonlat', side_effect=lambda x, y: (x, y)), \
                    patch.object(live, 'apcp_hour', return_value=(None, None, None)) as rain, \
                    patch.object(live, 'regrid', return_value=np.full((2, 2), 0.25)), \
                    patch.object(live, 'load_evidence', side_effect=AssertionError('Evidence belongs to export')) as evidence, \
                    patch.object(live, 'verified_engine_source', side_effect=AssertionError('No engine needed for prepare')) as engine:
                live.prepare('picture-rocks', work, '2026-11-14T00:00:00Z')
            self.assertEqual(rain.call_count, hours)
            evidence.assert_not_called()
            engine.assert_not_called()
            meta = json.loads((work / 'live-case.json').read_text())
            self.assertEqual(meta['hrrrCycle'], '2026-11-14T00:00:00Z')
            self.assertEqual(len(meta['rainSources']), hours)
            self.assertEqual(meta['start'], '2026-11-12T03:00:00Z')
            self.assertEqual(meta['end'], '2026-11-14T18:00:00Z')
            with h5py.File(work / 'precip_2d.nc') as f:
                np.testing.assert_array_equal(f['Precipitation'][:], np.full((hours, 2, 2), 0.25))
            self.assertFalse((work / 'sfincs_map.nc').exists())
