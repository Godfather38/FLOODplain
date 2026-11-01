import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('storm_forcing','tools/simulation/storm_forcing.py')
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)

class StormForcingTests(unittest.TestCase):
    def test_obsolete_palette_is_rejected_even_when_missing_is_allowed(self):
        with self.assertRaisesRegex(ValueError,'Obsolete historical palette'):
            adapter.load_forcing('public/simulation/data/storm-2014/manifest.json',require_complete=False)

    def test_real_event_is_contiguous_georeferenced_and_reproducible(self):
        result=adapter.load_forcing('public/simulation/data/storm-2014-legacy/manifest.json',[-111.34,32.40,-111.27,32.49],require_complete=False)
        self.assertEqual(result['status'],'insufficient_data');self.assertEqual(len(result['frames']),72)
        self.assertEqual(result['frames'][0]['start'],'2014-09-08T07:00:00Z')
        self.assertEqual(result['frames'][-1]['end'],'2014-09-11T07:00:00Z')
        self.assertGreater(result['missingCellHours'],0)
        self.assertGreater(result['lat'][0],result['lat'][-1]);self.assertLess(result['lon'][0],result['lon'][-1])
        self.assertEqual(result['units'],'mm/h')

    def test_missing_hour_is_never_zero_and_domain_outside_coverage_fails(self):
        original=Path('public/simulation/data/storm-2014-legacy/manifest.json')
        with self.assertRaises(ValueError):adapter.load_forcing(original,[-115,30,-111,33])
        manifest=json.loads(original.read_text());manifest['hours']=[{**manifest['hours'][0],'status':'unavailable'}]
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as folder:
            target=Path(folder)/'manifest.json';target.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'missing cell-hours'):adapter.load_forcing(target)
            result=adapter.load_forcing(target,require_complete=False)
            self.assertEqual(result['status'],'insufficient_data');self.assertIsNone(result['frames'][0]['precipMmH'][0][0])

if __name__=='__main__':unittest.main()
