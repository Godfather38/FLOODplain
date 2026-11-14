"""Restricted numerical refinement tests, not fabricated hydrologic evidence."""
from pathlib import Path
import unittest
from run_design_storm import refine_numerics, config

class NumericalRefinementTests(unittest.TestCase):
    def setUp(self):
        self.text = 'alpha                = 0.5\nscenario = keep\ndtmax = 60.0\ntheta = 1.0\nhuthresh = 0.01\n'

    def test_baseline_is_byte_identical_for_all_scenarios_and_cases(self):
        for case in ('northern', 'picture-rocks', 'gates'):
            for scenario in ('stress', 'extreme'):
                self.assertEqual(refine_numerics(self.text, case, scenario), (self.text, None))

    def test_only_alpha_changes_and_provenance_is_explicit(self):
        changed, meta = refine_numerics(self.text, 'gates', 'stress', 'gates-stress-alpha025')
        self.assertEqual(changed, self.text.replace('alpha                = 0.5', 'alpha = 0.25'))
        before, after = config(self.text), config(changed)
        self.assertEqual({k:v for k,v in before.items() if k!='alpha'}, {k:v for k,v in after.items() if k!='alpha'})
        self.assertEqual((meta['originalValue'],meta['value']),(.5,.25))
        self.assertIn('unchanged 1 mm',meta['purpose'])

    def test_restricted_case_scenario_and_profile(self):
        for case,scenario,profile in [('northern','stress','gates-stress-alpha025'),('gates','extreme','gates-stress-alpha025'),('gates','stress','other')]:
            with self.assertRaisesRegex(ValueError,'restricted'):
                refine_numerics(self.text,case,scenario,profile)

    def test_missing_duplicate_or_changed_alpha_rejected(self):
        for text in [self.text.replace('0.5','0.6'),self.text.replace('alpha','unknown'),self.text+'alpha = 0.5\n']:
            with self.assertRaisesRegex(ValueError,'exactly one pinned alpha'):
                refine_numerics(text,'gates','stress','gates-stress-alpha025')

    def test_only_read_only_preview_workflow_with_original_bounds(self):
        text=(Path(__file__).resolve().parents[2]/'.github/workflows/design-storm-refinement.yml').read_text()
        for required in ['contents: read','actions: read','timeout --signal=KILL 5400','max-parallel: 3','profile: gates-stress-alpha025',"steps.solver.outcome == 'success' && steps.audit.outcome == 'success'",'rejected-refinement-', 'action=diagnostic-export', "if [ '${{ steps.solver.outcome }}' = success ]; then action=export; fi"]:
            self.assertIn(required,text)
        for forbidden in ['contents: write','git push','deploy-pages','workflow_run:','schedule:']:
            self.assertNotIn(forbidden,text)
        self.assertEqual(text.count('profile: gates-stress-alpha025'),1)

if __name__ == '__main__': unittest.main()
