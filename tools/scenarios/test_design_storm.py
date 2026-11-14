"""Small offline tests for exact scenario forcing and boundary ownership."""
import unittest
import numpy as np
from run_design_storm import replace_rain, replace_boundary, START_OFFSET


class DesignStormTests(unittest.TestCase):
    def test_rain_preserves_antecedent_and_exact_scenario_values(self):
        t = np.arange(63) * 3600
        old = np.arange(63 * 6, dtype=float).reshape(63, 2, 3)
        saved = old.copy(); values = np.arange(14, dtype=float)
        new = replace_rain(old, t, t[49:], values)
        np.testing.assert_array_equal(old, saved)
        np.testing.assert_array_equal(new[:49], old[:49])
        for i, value in enumerate(values): self.assertTrue(np.all(new[49+i] == value))

    def test_missing_interval_is_not_extrapolated(self):
        with self.assertRaisesRegex(ValueError, 'intervals'):
            replace_rain(np.zeros((63, 2, 2)), np.arange(63)*3600, np.arange(49, 62)*3600, np.ones(13))

    def test_record_flow_replaces_actual_santa_cruz_not_colocated_headwater(self):
        times = np.arange(64)*3600
        baseline = np.column_stack([times, np.zeros(64), np.full(64, 28.7), np.ones(64)*4])
        original = np.column_stack([times, np.arange(64)*10., np.zeros(64)])
        inlets = [{'reachId':'15902351'}, {'reachId':'15902363'}, {'reachId':'other'}]
        changed, target = replace_boundary(baseline, original, inlets)
        self.assertEqual(target, 1)
        np.testing.assert_array_equal(changed[:49], baseline[:49])
        np.testing.assert_array_equal(changed[:, [0,1,3]], baseline[:, [0,1,3]])
        np.testing.assert_array_equal(changed[49:,2], original[49:,1])
        self.assertEqual(baseline[56,2], 28.7)

    def test_absent_river_is_not_invented_and_ambiguous_target_rejected(self):
        base = np.column_stack([np.arange(64)*3600, np.ones(64)])
        source = base.copy()
        changed, target = replace_boundary(base, source, [{'reachId':'other'}])
        self.assertIsNone(target); np.testing.assert_array_equal(changed, base)
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            replace_boundary(base, source, [{'reachId':'15902363'}, {'reachId':'15902363'}])

    def test_boundary_timestamps_must_match_exactly(self):
        with self.assertRaisesRegex(ValueError, 'timestamps'):
            replace_boundary(np.array([[0, 1],[3600,2]]), np.array([[0,1],[7200,2]]), [{'reachId':'15902363'}])
