"""Offline regression and byte-preservation checks for the two Gates repairs."""
import copy
import gzip
import json
from pathlib import Path
import unittest

import numpy as np

from repair_road_heights import ROOT, columns, descriptor, load_evidence, measure, repair, sha
from export_road_forecast import load_roads


def original_bytes(encoded, evidence):
    """Restore only declared target fields; the pinned full-file hash proves isolation."""
    raw = bytearray(gzip.decompress(encoded))
    _, cols = columns(raw)
    for station in evidence['stations']:
        a, b = map(int, cols['lineStart'][station['lineIndex']:station['lineIndex'] + 2])
        i = station['globalIndex']
        current_cm = int(cols['dZCm'][a:i + 1].astype('int64').sum())
        delta = station['original']['encodedHeightCm'] - current_cm
        cols['dZCm'][i] += delta
        if i + 1 < b:
            cols['dZCm'][i + 1] -= delta
        for key in ('flags', 'source', 'lateralDm'):
            cols[key][i] = station['original'][key]
    return gzip.compress(raw, compresslevel=9, mtime=0)


class RepairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence, cls.pixels = load_evidence()
        cls.corrected = (ROOT / 'routes.bin.gz').read_bytes()
        cls.original = original_bytes(cls.corrected, cls.evidence)

    def test_restore_only_declared_fields_matches_entire_original_source(self):
        # gzip/zlib versions can encode the same bytes differently. The full
        # decoded baseline hash proves every unrelated byte is unchanged.
        self.assertEqual(sha(gzip.decompress(self.original)), self.evidence['inputDecodedSha256'])

    def test_repair_is_reproducible_and_only_two_decoded_stations_change(self):
        evidence = copy.deepcopy(self.evidence)
        evidence['inputSha256'] = sha(self.original)  # Locally recompressed exact baseline.
        result, measured = repair(self.original, evidence, self.pixels)
        # Binary contents reproduce across gzip/zlib versions; compressed
        # delivery bytes retain their separate pinned source.json checksum.
        self.assertEqual(gzip.decompress(result), gzip.decompress(self.corrected))
        h0, c0 = columns(gzip.decompress(self.original))
        h1, c1 = columns(gzip.decompress(result))
        self.assertEqual(h0, h1)
        expected = {s['globalIndex'] for s in self.evidence['stations']}
        for key in ('lineStart', 'dLonE6', 'dLatE6', 'dStationDm'):
            np.testing.assert_array_equal(c0[key], c1[key])
        for key in ('flags', 'source', 'lateralDm'):
            self.assertEqual(set(np.flatnonzero(c0[key] != c1[key])), expected)
        changed = set()
        for a, b in zip(c0['lineStart'][:-1], c0['lineStart'][1:]):
            before = np.cumsum(c0['dZCm'][a:b], dtype='int64')
            after = np.cumsum(c1['dZCm'][a:b], dtype='int64')
            changed.update(int(a + k) for k in np.flatnonzero(before != after))
            known = (c0['flags'][a:b] & 4) == 0
            np.testing.assert_array_equal(before[known], after[known])
        self.assertEqual(changed, expected)
        self.assertEqual([m['heightCm'] for m in measured], [73459, 73449])
        self.assertEqual([m['lateralDm'] for m in measured], [2, 1])

    def test_gates_now_has_all_heights_with_exact_repaired_values(self):
        routes, source, metadata = load_roads('gates')
        stations = routes['pr-gates']
        self.assertEqual(len(stations), 6445)
        self.assertTrue(all(s['roadM'] is not None for s in stations))
        self.assertEqual([stations[k]['roadM'] for k in (5053, 5054)], [734.59, 734.49])
        self.assertEqual([stations[k]['source'] for k in (5053, 5054)], [0, 0])
        self.assertEqual(source['baseSource']['sha256'], self.evidence['inputSha256'])
        self.assertEqual(source['repairs'][0]['sha256'], sha((ROOT / source['repairs'][0]['path']).read_bytes()))

    def test_wrong_or_already_corrected_package_rejected(self):
        for raw in (self.corrected, b'not a package'):
            with self.assertRaisesRegex(ValueError, 'exact original'):
                repair(raw, self.evidence, self.pixels)

    def test_nodata_and_nonfinite_source_pixels_rejected(self):
        station = self.evidence['stations'][0]
        col, row = station['samples'][0]['pixelCentreCoordinates']
        x = int(np.floor(col)) - self.evidence['window']['col']
        y = int(np.floor(row)) - self.evidence['window']['row']
        for missing in (self.evidence['source']['nodata'], np.nan, np.inf):
            pixels = self.pixels.copy(); pixels[y, x] = missing
            with self.assertRaisesRegex(ValueError, 'Missing source terrain'):
                measure(station, self.evidence, pixels)

    def test_station_identity_and_five_offsets_required(self):
        for key, value in [('lon', 0), ('globalIndex', 0), ('stationIndex', 5052)]:
            evidence = copy.deepcopy(self.evidence); evidence['inputSha256'] = sha(self.original)
            evidence['stations'][0][key] = value
            with self.assertRaises(ValueError):
                repair(self.original, evidence, self.pixels)
        station = copy.deepcopy(self.evidence['stations'][0]); station['samples'].pop()
        with self.assertRaisesRegex(ValueError, 'five cross-road'):
            measure(station, self.evidence, self.pixels)


if __name__ == '__main__':
    unittest.main()
