"""Offline NWPS input-contract regression tests; no solver or network calls."""
import copy
import datetime as dt
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import run_live_sfincs as live

FIXTURES = Path(__file__).parent / 'fixtures'
START = dt.datetime(2026, 11, 6, 0)
REACH = '15902351'


def response(key, values, units='ft³/s'):
    return {'reach': {'reachId': REACH}, key: {'series': {
        'referenceTime': '2026-11-06T00:00:00Z', 'units': units,
        'data': [{'validTime': live.ISO(START + dt.timedelta(hours=i)), 'flow': q}
                 for i, q in values]}}}


class NwmForcingTests(unittest.TestCase):
    def setUp(self):
        self.analysis = response('analysisAssimilation', [(0, 10), (1, 20)])
        self.short = response('shortRange', [(1, 30), (2, 0)])
        self.sleep = patch.object(live.time, 'sleep').start()
        self.addCleanup(patch.stopall)

    def hourly(self, analysis=None, short=None, hours=2):
        answers = {'analysis_assimilation': self.analysis if analysis is None else analysis,
                   'short_range': self.short if short is None else short}
        with patch.object(live, 'get', side_effect=lambda u, **kw: json.dumps(answers[u.split('=')[-1]])):
            return live.nwps_hourly(REACH, START, hours, expected_cycle=START)

    def test_complete_flows_convert_units_and_select_forecast_after_cycle(self):
        flows, missing = self.hourly()
        self.assertEqual(flows, [10 * live.FT3, 30 * live.FT3, 0])
        self.assertEqual(missing, 0)
        self.sleep.assert_not_called()

    def test_empty_after_temporal_filtering_is_missing_input_not_valueerror(self):
        self.analysis['analysisAssimilation']['series']['data'] = [{'validTime': live.ISO(START+dt.timedelta(hours=1)), 'flow': 10}]
        self.short['shortRange']['series']['data'] = [{'validTime': live.ISO(START-dt.timedelta(hours=1)), 'flow': 10}]
        with self.assertRaisesRegex(live.NwmInputError, 'no analysis hours'):
            self.hourly()

    def test_wrong_short_range_reference_rejected_despite_full_coverage(self):
        self.short['shortRange']['series']['referenceTime'] = '2026-11-05T23:00:00Z'
        with self.assertRaisesRegex(live.NwmInputError, 'differs from requested HRRR cycle'):
            self.hourly()

    def test_forecast_cannot_overwrite_historical_analysis(self):
        self.short['shortRange']['series']['data'].insert(0, {'validTime': live.ISO(START), 'flow': 999})
        self.assertEqual(self.hourly()[0][0], 10 * live.FT3)

    def test_analysis_cannot_fill_a_missing_forecast_hour(self):
        self.analysis['analysisAssimilation']['series']['data'].append({'validTime': live.ISO(START+dt.timedelta(hours=2)), 'flow': 999})
        self.short['shortRange']['series']['data'].pop()
        with self.assertRaisesRegex(live.NwmInputError, 'stale or too short'):
            self.hourly()

    def test_source_receipts_preserve_reference_valid_times_and_url(self):
        receipts = []
        with patch.object(live, 'get', return_value=json.dumps(self.short)):
            live.nwm_series(REACH, 'short_range', 'shortRange', metadata=receipts)
        self.assertEqual(receipts[0]['referenceTime'], '2026-11-06T00:00:00Z')
        self.assertEqual(receipts[0]['firstValidTime'], '2026-11-06T01:00:00Z')
        self.assertEqual(receipts[0]['lastValidTime'], '2026-11-06T02:00:00Z')
        self.assertEqual(receipts[0]['url'], live.NWM.format(r=REACH, s='short_range'))

    def test_si_units_preserve_real_zero(self):
        self.analysis['analysisAssimilation']['series']['units'] = 'm³/s'
        self.short['shortRange']['series']['units'] = 'm3/s'
        self.assertEqual(self.hourly(), ([10, 30, 0], 0))

    def test_recorded_empty_short_range_response_has_actionable_error(self):
        actual = json.loads((FIXTURES / 'nwps-short_range-20261106.json').read_text())
        with self.assertRaisesRegex(live.NwmInputError, '15902351 short_range unavailable after 3 attempts.*shortRange.series.*api.water.noaa.gov'):
            self.hourly(short=actual)
        self.assertEqual(self.sleep.call_count, 2)

    def test_recorded_stalled_analysis_cannot_supply_requested_window(self):
        actual = json.loads((FIXTURES / 'nwps-analysis_assimilation-20261106.json').read_text())
        with self.assertRaisesRegex(live.NwmInputError, 'incomplete.*required hours missing.*No zero or carried flow'):
            self.hourly(analysis=actual)

    def test_empty_data_rejected_even_when_other_series_covers_all_hours(self):
        self.analysis['analysisAssimilation']['series']['data'] = []
        self.short = response('shortRange', [(0, 10), (1, 30), (2, 0)])
        with self.assertRaisesRegex(live.NwmInputError, 'no flow readings'):
            self.hourly()

    def test_empty_200_retries_and_recovers_without_inventing_values(self):
        with patch.object(live, 'get', side_effect=[json.dumps({'reach': {'reachId': REACH}, 'shortRange': {}}),
                                                   json.dumps(self.short)]) as get:
            flows = live.nwm_series(REACH, 'short_range', 'shortRange')
        self.assertEqual(flows[START + dt.timedelta(hours=2)], 0)
        self.assertEqual(get.call_count, 2)
        self.sleep.assert_called_once_with(2)

    def test_missing_initial_hour_is_not_zero_filled(self):
        self.analysis['analysisAssimilation']['series']['data'].pop(0)
        with self.assertRaisesRegex(live.NwmInputError, 'incomplete.*2026-11-06T00:00:00Z'):
            self.hourly()

    def test_missing_middle_hour_is_not_carried(self):
        self.analysis['analysisAssimilation']['series']['data'].pop()
        self.short['shortRange']['series']['data'].pop(0)
        with self.assertRaisesRegex(live.NwmInputError, 'incomplete.*2026-11-06T01:00:00Z'):
            self.hourly()

    def test_missing_final_hour_is_not_carried(self):
        self.short['shortRange']['series']['data'].pop()
        with self.assertRaisesRegex(live.NwmInputError, 'stale or too short.*required through 2026-11-06T02:00:00Z'):
            self.hourly()

    def test_wrong_reach_is_not_used(self):
        self.short['reach']['reachId'] = '999'
        with self.assertRaisesRegex(live.NwmInputError, 'different reach'):
            self.hourly()

    def test_unknown_or_missing_units_rejected(self):
        for units in [None, '', 'gallons', 'feet']:
            with self.subTest(units=units):
                self.short['shortRange']['series']['units'] = units
                with self.assertRaisesRegex(live.NwmInputError, 'unknown flow units'):
                    self.hourly()

    def test_bad_flow_values_rejected_instead_of_dry(self):
        for value in [None, -1, True, '0', float('nan'), float('inf')]:
            with self.subTest(value=value):
                self.short['shortRange']['series']['data'][0]['flow'] = value
                with self.assertRaisesRegex(live.NwmInputError, 'invalid or missing flow'):
                    self.hourly()

    def test_bad_timestamp_rejected(self):
        for timestamp in [None, 'wrong', '2026-11-06T01:00:00', '2026-11-06T01:30:00Z']:
            with self.subTest(timestamp=timestamp):
                self.short['shortRange']['series']['data'][0]['validTime'] = timestamp
                with self.assertRaises(live.NwmInputError):
                    self.hourly()

    def test_future_reference_rejected(self):
        self.short['shortRange']['series']['referenceTime'] = '2999-11-06T01:00:00Z'
        with self.assertRaisesRegex(live.NwmInputError, 'referenceTime is in the future'):
            self.hourly()

    def test_conflicting_duplicate_reading_rejected(self):
        duplicate = copy.deepcopy(self.short['shortRange']['series']['data'][0]); duplicate['flow'] += 1
        self.short['shortRange']['series']['data'].append(duplicate)
        with self.assertRaisesRegex(live.NwmInputError, 'conflicting flow readings'):
            self.hourly()

    def test_transport_and_invalid_json_fail_after_bounded_retries(self):
        for failure in [RuntimeError('HTTP 503'), ValueError('invalid JSON')]:
            with self.subTest(failure=failure):
                with patch.object(live, 'get', side_effect=failure) as get:
                    with self.assertRaisesRegex(live.NwmInputError, 'unavailable after 3 attempts'):
                        live.nwm_series(REACH, 'short_range', 'shortRange')
                self.assertEqual(get.call_count, 3)

    def test_timezone_offset_is_normalized(self):
        self.short['shortRange']['series']['data'][0]['validTime'] = '2026-11-05T18:00:00-07:00'
        self.assertEqual(self.hourly()[0][1], 30 * live.FT3)


if __name__ == '__main__':
    unittest.main()
