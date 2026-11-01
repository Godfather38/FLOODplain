import unittest

from hand_tool import display_water, exclusion, forecast_for, match_confidence, name_agreement, rating_problem, reach_forecast_problem, slug, stage_for_flow

STATIONS = {'SCTA3': {'usgsId': '09486520', 'reachId': '15890430'}}


def reach(distance=20, feature=15890430, name='Santa Cruz River'):
    return {'distanceM': distance, 'featureId': feature, 'name': name}


class Confidence(unittest.TestCase):
    GAUGE, MODEL = {'kind': 'gauge', 'station': 'SCTA3'}, {'kind': 'nwm_reach', 'reachId': '1'}

    def test_names(self):
        self.assertEqual(name_agreement('Santa Cruz River', 'santa cruz river'), 'agree')
        self.assertEqual(name_agreement('Yuma Mine Wash', 'Santa Cruz River'), 'conflict')
        self.assertEqual(name_agreement(None, 'Los Robles Wash'), 'one_name')
        self.assertEqual(name_agreement('Silvercroft Wash', ''), 'one_name')
        self.assertEqual(name_agreement(None, ''), 'no_name')
        self.assertEqual(name_agreement(None, 'Central Arizona Project Aqueduct'), 'canal')
        self.assertEqual(display_water(None, 'Los Robles Wash', 'one_name'), 'Los Robles Wash (NOAA name)')
        self.assertIsNone(display_water(None, 'Central Arizona Project Aqueduct', 'canal'))

    def test_score_is_the_sum_of_shown_factors(self):
        c = match_confidence(21, 'agree', self.GAUGE, 3.01, False)
        self.assertEqual(c['score'], sum(f['points'] for f in c['factors']))
        self.assertEqual(c['band'], 'Likely match')
        self.assertEqual(sum(f['max'] for f in c['factors']), 100)

    def test_score_falls_as_the_match_weakens(self):
        score = lambda *a: match_confidence(*a)['score']
        self.assertGreater(score(20, 'agree', self.GAUGE, 3, False), score(20, 'agree', self.GAUGE, 9, False))
        self.assertGreater(score(20, 'agree', self.GAUGE, 9, False), score(20, 'agree', self.MODEL, 0, False))
        self.assertGreater(score(20, 'agree', self.MODEL, 0, False), score(20, 'one_name', self.MODEL, 0, False))
        self.assertGreater(score(20, 'one_name', self.MODEL, 0, False), score(800, 'one_name', self.MODEL, 0, False))
        self.assertGreater(score(800, 'one_name', self.MODEL, 0, False), score(3300, 'one_name', self.MODEL, 0, False))

    def test_too_far_or_wrong_water_is_left_out(self):
        self.assertEqual(exclusion(1157, 'one_name', 'Los Robles Wash')[0], 'too_far')
        self.assertEqual(exclusion(353, 'no_name', '')[0], 'too_far')
        self.assertEqual(exclusion(198, 'no_name', '')[0], 'too_far')
        self.assertIsNone(exclusion(304, 'one_name', 'Los Robles Wash'))
        self.assertIsNone(exclusion(90, 'no_name', ''))
        self.assertEqual(exclusion(10, 'canal', 'Central Arizona Project Aqueduct')[0], 'wrong_water')
        self.assertEqual(exclusion(15, 'conflict', 'Santa Cruz River')[0], 'wrong_water')


class Forecast(unittest.TestCase):
    def test_gauge_only_when_linked_and_close(self):
        near = {'gaugeIs': 'downstream', 'alongChannelKm': 3.0}
        self.assertEqual(forecast_for(reach(), near, STATIONS)['kind'], 'gauge')
        self.assertEqual(forecast_for(reach(), {'gaugeIs': 'downstream', 'alongChannelKm': 11}, STATIONS)['kind'], 'nwm_reach')
        self.assertEqual(forecast_for(reach(), {'gaugeIs': 'unlinked', 'alongChannelKm': None}, STATIONS)['kind'], 'nwm_reach')
        self.assertEqual(forecast_for(reach(), None, STATIONS)['kind'], 'nwm_reach')
        self.assertEqual(forecast_for(reach(feature=1), near, STATIONS), {'kind': 'nwm_reach', 'reachId': '1'})

    def test_bad_reach_forecasts_are_named(self):
        good = {'reach': {'reachId': '7'}, 'shortRange': {'series': {'units': 'ft³/s', 'data': [{'flow': 0}]}}}
        self.assertIsNone(reach_forecast_problem(good, 7))
        self.assertEqual(reach_forecast_problem(good, 8), 'reach identity mismatch')
        self.assertEqual(reach_forecast_problem({'reach': {'reachId': '7'}}, 7), 'unknown units None')


class Rating(unittest.TestCase):
    def test_bad_curves_are_named(self):
        self.assertEqual(rating_problem([0], [0]), 'too few points')
        self.assertEqual(rating_problem([0, 0], [0, 1]), 'stage does not rise')
        self.assertEqual(rating_problem([0, 1], [2, 1]), 'discharge falls as stage rises')
        self.assertEqual(rating_problem([0, 1], [0, 0]), 'no flow above zero')
        self.assertIsNone(rating_problem([0, 1], [0, 5]))

    def test_lookup_matches_the_app(self):
        self.assertEqual(stage_for_flow(5, [0, 1, 2], [0, 10, 30]), .5)
        self.assertIsNone(stage_for_flow(31, [0, 1, 2], [0, 10, 30]))


class Ids(unittest.TestCase):
    def test_points_a_few_metres_apart_keep_separate_ids(self):
        self.assertEqual(slug('North Sanders Road', -111.23395, 32.43484), 'north-sanders-road-32-43484-111-23395')
        self.assertNotEqual(slug('North Sanders Road', -111.23395, 32.43484), slug('North Sanders Road', -111.23395, 32.43488))


if __name__ == '__main__':
    unittest.main()
