import unittest

from hand_tool import classify_point, rating_problem, stage_for_flow

STATIONS = {'SCTA3': {'usgsId': '09486520', 'reachId': '15890430'}}


def reach(distance=20, feature=15890430, name='Santa Cruz River'):
    return {'distanceM': distance, 'featureId': feature, 'name': name}


class Classify(unittest.TestCase):
    def status(self, *args, **kw):
        return classify_point(*args, stations=STATIONS, **kw)[0]

    def test_each_outcome(self):
        self.assertEqual(self.status(None), 'no_hand_catchment')
        self.assertEqual(self.status(reach(distance=101), water='Santa Cruz River'), 'not_on_modeled_reach')
        self.assertEqual(self.status(reach(feature=1), water='Santa Cruz River'), 'hand_reach_no_forecast')
        self.assertEqual(self.status(reach()), 'needs_review')
        self.assertEqual(self.status(reach(), water='Los Robles Wash'), 'needs_review')
        self.assertEqual(self.status(reach(), water='santa cruz river'), 'forecast_linked')


class Rating(unittest.TestCase):
    def test_bad_curves_are_named(self):
        self.assertEqual(rating_problem([0], [0]), 'too few points')
        self.assertEqual(rating_problem([0, 0], [0, 1]), 'stage does not rise')
        self.assertEqual(rating_problem([0, 1], [2, 1]), 'discharge falls as stage rises')
        self.assertEqual(rating_problem([0, 1], [0, 0]), 'no flow above zero')
        self.assertEqual(rating_problem([0, 1], [0, float('nan')]), 'non-finite or negative value')
        self.assertIsNone(rating_problem([0, 1], [0, 5]))

    def test_lookup_matches_the_app(self):
        self.assertEqual(stage_for_flow(5, [0, 1, 2], [0, 10, 30]), .5)
        self.assertIsNone(stage_for_flow(31, [0, 1, 2], [0, 10, 30]))


if __name__ == '__main__':
    unittest.main()
