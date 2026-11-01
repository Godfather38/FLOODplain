import unittest

from hand_tool import classify_point, forecast_for, rating_problem, reach_forecast_problem, slug, stage_for_flow

STATIONS = {'SCTA3': {'usgsId': '09486520', 'reachId': '15890430'}}


def reach(distance=20, feature=15890430, name='Santa Cruz River'):
    return {'distanceM': distance, 'featureId': feature, 'name': name}


class Classify(unittest.TestCase):
    def test_each_outcome(self):
        status = lambda *a, **k: classify_point(*a, **k)[0]
        self.assertEqual(status(None), 'no_hand_catchment')
        self.assertEqual(status(reach(distance=101), water='Santa Cruz River'), 'not_on_modeled_reach')
        self.assertEqual(status(reach(), water='Los Robles Wash'), 'needs_review')
        self.assertEqual(status(reach(name='Central Arizona Project Aqueduct')), 'needs_review')
        self.assertEqual(status(reach(), water='santa cruz river'), 'eligible')
        self.assertEqual(status(reach()), 'eligible')
        self.assertEqual(status(reach(name=''), water='Silvercroft Wash'), 'eligible')


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
