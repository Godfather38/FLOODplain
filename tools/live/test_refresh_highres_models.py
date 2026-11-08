"""Offline cadence, duplicate/overlap and fail-closed regression tests."""
import datetime as dt
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import tempfile

from refresh_highres_models import CASES, RUNTIME_MINUTES, GitHub, STATE_PATH, iso, live_cases, plan_refresh, refresh

NOW = dt.datetime(2026, 11, 6, 12, 0, tzinfo=dt.timezone.utc)
CYCLE = '2026-11-06T11:00:00Z'


def rain(wet=()):
    return {'hrrrCycle': CYCLE, 'checkedAt': iso(NOW), 'run': list(wet)}


def summaries(age=30, cycle='2026-11-06T10:00:00Z'):
    return {case: {'schemaVersion': 1, 'kind': 'live_all_route_road_forecast', 'case': case,
                   'executionMode': 'live_current_forcing', 'status': 'complete', 'issuedAt': iso(NOW - dt.timedelta(minutes=age)),
                   'hrrrCycle': cycle, 'validFrom': '2026-11-06T07:00:00Z',
                   'validTo': '2026-11-07T04:00:00Z'} for case in CASES}


class PolicyTests(unittest.TestCase):
    def plan(self, s=None, *, wet=(), state=None, busy=()):
        return plan_refresh(rain(wet), s if s is not None else summaries(),
                            state or {}, set(busy), NOW)

    def test_fresh_dry_summaries_do_not_run(self):
        self.assertEqual(self.plan()['run'], [])

    def test_missing_summaries_refresh_all_even_when_dry(self):
        self.assertEqual(self.plan({})['run'], list(CASES))

    def test_predicts_expiry_per_case(self):
        self.assertEqual(self.plan(summaries(54))['run'], [])
        self.assertEqual(self.plan(summaries(55))['run'], ['northern'])
        self.assertEqual(self.plan(summaries(70))['run'], ['northern', 'picture-rocks'])
        self.assertEqual(self.plan(summaries(74))['run'], ['northern', 'picture-rocks'])
        self.assertEqual(self.plan(summaries(75))['run'], ['northern', 'picture-rocks', 'brawley-avra-west'])
        self.assertEqual(self.plan(summaries(89))['run'], ['northern', 'picture-rocks', 'brawley-avra-west'])
        self.assertEqual(self.plan(summaries(90))['run'], list(CASES))

    def test_rain_refreshes_only_affected_cases(self):
        p = self.plan(wet=('gates',))
        self.assertEqual(p['run'], ['gates'])
        self.assertEqual(p['cases']['gates']['reason'], 'rain_forecast')

    def test_same_or_newer_published_cycle_skips_even_when_stale_or_wet(self):
        for cycle in (CYCLE, '2026-11-06T12:00:00Z'):
            self.assertEqual(self.plan(summaries(125, cycle), wet=CASES)['run'], [])

    def test_prior_attempt_prevents_restart_duplicates_regardless_of_status(self):
        for status in ('reserved', 'accepted', 'uncertain'):
            state = {'cases': {c: {'hrrrCycle': CYCLE, 'dispatchStatus': status} for c in CASES}}
            self.assertEqual(self.plan({}, state=state)['run'], [])

    def test_next_cycle_can_recover_after_failed_attempt(self):
        state = {'cases': {c: {'hrrrCycle': '2026-11-06T10:00:00Z', 'dispatchStatus': 'uncertain'} for c in CASES}}
        self.assertEqual(self.plan({}, state=state)['run'], list(CASES))

    def test_busy_cases_never_enqueue(self):
        self.assertEqual(self.plan({}, busy=('northern', 'gates'))['run'], ['picture-rocks', 'brawley-avra-west'])

    def test_bad_missing_or_expired_summary_refreshes_only_its_case(self):
        changes = ({'status': 'partial'}, {'issuedAt': 'bad'}, {'issuedAt': '2026-11-07T00:00:00Z'},
                   {'validTo': '2026-11-06T11:00:00Z'}, {'hrrrCycle': '2026-11-07T00:00:00Z'},
                   {'case': 'northern'}, {'kind': 'something_else'}, {'schemaVersion': 2},
                   {'executionMode': 'frozen_storm'})
        for change in changes:
            s = summaries(); s['gates'].update(change)
            self.assertEqual(self.plan(s)['run'], ['gates'], change)

    def test_forecast_end_is_refreshed_before_next_check_can_finish(self):
        s = summaries()
        s['gates']['validTo'] = iso(NOW + dt.timedelta(minutes=89))
        self.assertEqual(self.plan(s)['run'], ['gates'])
        s['gates']['validTo'] = iso(NOW + dt.timedelta(minutes=91))
        self.assertEqual(self.plan(s)['run'], [])

    def test_partial_route_coverage_does_not_trigger_refresh_loop(self):
        s = summaries(); s['gates']['routes'] = {'gates-pass': {'coverage': 'partial'}}
        self.assertEqual(self.plan(s)['run'], [])

    def test_dry_steady_state_refreshes_each_case_every_two_hours(self):
        s, state, pending = {}, {'cases': {}}, {}
        counts = dict.fromkeys(CASES, 0)
        for hour in range(24):
            now = NOW + dt.timedelta(hours=hour)
            for case, (finish, cycle) in list(pending.items()):
                if finish <= now:
                    s[case] = summaries()[case] | {'issuedAt': iso(finish), 'hrrrCycle': cycle,
                        'validFrom': iso(now - dt.timedelta(hours=3)), 'validTo': iso(now + dt.timedelta(hours=16))}
                    del pending[case]
            r = {'hrrrCycle': iso(now - dt.timedelta(hours=1)), 'checkedAt': iso(now), 'run': []}
            plan = plan_refresh(r, s, state, set(pending), now)
            for case in plan['run']:
                counts[case] += 1
                state['cases'][case] = {'hrrrCycle': r['hrrrCycle']}
                pending[case] = (now + dt.timedelta(minutes=plan['cases'][case]['runtimeBudgetMinutes']), r['hrrrCycle'])
        self.assertEqual(counts, dict.fromkeys(CASES, 12))

    def test_rain_cycle_and_check_must_be_recent_aware_timestamps(self):
        for key, value in [('hrrrCycle', 'bad'), ('hrrrCycle', '2026-11-06T11:00:00'),
                           ('hrrrCycle', '2026-11-06T13:00:00Z'), ('hrrrCycle', '2026-11-06T00:00:00Z'),
                           ('checkedAt', '2026-11-06T11:00:00Z')]:
            r = rain(); r[key] = value
            with self.assertRaises(ValueError):
                plan_refresh(r, summaries(), {}, set(), NOW)


class FakeGitHub:
    def __init__(self, *, fail_read=False, fail_reserve=False, fail_dispatch=False, fail_update=False):
        self.fail_read, self.fail_reserve = fail_read, fail_reserve
        self.fail_dispatch, self.fail_update = fail_dispatch, fail_update
        self.events, self.state = [], None

    def read_file(self, path):
        if self.fail_read:
            raise RuntimeError('API unavailable')
        return None, None

    def busy_cases(self):
        return set()

    def reserve(self, plan, state, sha, ref):
        self.events.append('reserve')
        if self.fail_reserve:
            raise RuntimeError('Lease failed')
        return {'cases': {c: {'dispatchStatus': 'reserved'} for c in plan['run']}}, 'reserved-sha'

    def dispatch(self, plan, ref):
        self.events.append('dispatch')
        if self.fail_dispatch:
            raise subprocess.TimeoutExpired('gh', 90)

    def write_state(self, state, sha, message):
        self.events.append('update')
        self.state = state
        if self.fail_update:
            raise RuntimeError('API unavailable')


class IntegrationTests(unittest.TestCase):
    def test_reserve_before_dispatch_and_record_acceptance(self):
        g = FakeGitHub(); p = refresh(g, rain(), NOW, dispatch=True)
        self.assertEqual(g.events, ['reserve', 'dispatch', 'update'])
        self.assertEqual(p['dispatch'], 'accepted')
        self.assertEqual(g.state['cases']['gates']['dispatchStatus'], 'accepted')

    def test_busy_snapshot_precedes_summaries_to_avoid_completion_race(self):
        g = FakeGitHub(); reads = []
        def read_file(path):
            reads.append(path)
            return None, None
        def busy():
            reads.append('busy')
            return set(CASES)
        g.read_file, g.busy_cases = read_file, busy
        p = refresh(g, rain(), NOW, dispatch=True)
        self.assertEqual(p['run'], [])
        self.assertLess(reads.index('busy'), reads.index('all-route/northern/compact/road-forecast.json'))
        self.assertEqual(g.events, [])

    def test_read_failure_does_not_dispatch(self):
        g = FakeGitHub(fail_read=True)
        with self.assertRaises(RuntimeError): refresh(g, rain(), NOW, dispatch=True)
        self.assertEqual(g.events, [])

    def test_lease_failure_does_not_dispatch(self):
        g = FakeGitHub(fail_reserve=True)
        with self.assertRaises(RuntimeError): refresh(g, rain(), NOW, dispatch=True)
        self.assertEqual(g.events, ['reserve'])

    def test_uncertain_dispatch_stays_reserved_and_not_retried(self):
        g = FakeGitHub(fail_dispatch=True)
        with self.assertRaisesRegex(RuntimeError, 'uncertain'): refresh(g, rain(), NOW, dispatch=True)
        self.assertEqual(g.events, ['reserve', 'dispatch', 'update'])
        self.assertEqual(g.state['cases']['gates']['dispatchStatus'], 'uncertain')

    def test_accepted_dispatch_is_not_retried_when_status_update_fails(self):
        g = FakeGitHub(fail_update=True); p = refresh(g, rain(), NOW, dispatch=True)
        self.assertEqual(p['dispatch'], 'accepted')
        self.assertIn('ledger status update failed', p['warning'])
        self.assertEqual(g.events.count('dispatch'), 1)

    def test_dry_run_never_reserves_or_dispatches(self):
        g = FakeGitHub(); p = refresh(g, rain(), NOW)
        self.assertEqual(p['run'], list(live_cases()))
        self.assertEqual(g.events, [])

    def test_known_but_unregistered_case_is_never_read_or_dispatched(self):
        # brawley-avra-west is known (runtime budget present) before the registry lists it.
        g = FakeGitHub(); reads = []
        g.read_file = lambda path: (reads.append(path), (None, None))[1]
        p = refresh(g, rain(), NOW, dispatch=True, cases=('northern', 'picture-rocks', 'gates'))
        self.assertEqual(p['run'], ['northern', 'picture-rocks', 'gates'])
        self.assertNotIn('brawley-avra-west', p['cases'])
        self.assertFalse(any('brawley-avra-west' in r for r in reads))

    def test_registered_new_case_is_planned_with_its_runtime_budget(self):
        p = refresh(FakeGitHub(), rain(), NOW, cases=CASES)
        self.assertEqual(p['run'], list(CASES))
        self.assertEqual(p['cases']['brawley-avra-west']['runtimeBudgetMinutes'], 45)
        self.assertEqual(p['cases']['brawley-avra-west']['refreshAfterMinutes'], 75)


class RegistryTests(unittest.TestCase):
    def registry(self, names):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / 'all-route-cases.json'
        path.write_text(json.dumps({'schemaVersion': 1, 'cases': [{'case': n} for n in names]}))
        return path

    def test_every_known_case_has_a_runtime_budget(self):
        self.assertEqual(set(RUNTIME_MINUTES), set(CASES))

    def test_live_cases_follow_registry_in_known_order(self):
        self.assertEqual(live_cases(self.registry(['gates', 'northern'])), ('northern', 'gates'))
        self.assertEqual(live_cases(self.registry(['brawley-avra-west', 'northern', 'picture-rocks', 'gates'])), CASES)

    def test_registry_case_unknown_to_planner_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'unknown to the refresh planner'):
            live_cases(self.registry(['northern', 'not-a-case']))

    def test_checked_in_registry_is_a_subset_of_known_cases(self):
        self.assertTrue(set(live_cases()) <= set(CASES))

    def test_rain_for_registered_new_case_is_accepted(self):
        p = plan_refresh(rain(('brawley-avra-west',)), summaries(), {}, set(), NOW)
        self.assertEqual(p['run'], ['brawley-avra-west'])
        self.assertEqual(p['cases']['brawley-avra-west']['reason'], 'rain_forecast')

    def test_planning_an_unknown_case_is_rejected(self):
        with self.assertRaises(ValueError):
            plan_refresh(rain(), summaries(), {}, set(), NOW, cases=('northern', 'not-a-case'))


class ApiTests(unittest.TestCase):
    def test_only_confirmed_404_counts_as_missing(self):
        g = GitHub('owner/repo')
        for stderr in ('HTTP 403', 'rate limited', 'network failure'):
            with patch('subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', stderr)):
                with self.assertRaises(RuntimeError): g.read_file('missing.json')
        with patch('subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', 'gh: Not Found (HTTP 404)')):
            self.assertEqual(g.read_file('missing.json'), (None, None))

    def test_active_matrix_job_blocks_only_its_case(self):
        g = GitHub('owner/repo')
        def pages(path, key):
            if key == 'workflow_runs':
                return iter([{'id': 10}] if 'status=in_progress' in path else [])
            return iter([{'name': 'run (northern)', 'status': 'in_progress'},
                         {'name': 'run (gates)', 'status': 'completed'}])
        g.pages = pages
        self.assertEqual(g.busy_cases(), {'northern'})

    def test_new_case_matrix_job_blocks_only_its_case(self):
        g = GitHub('owner/repo')
        g.pages = lambda path, key: iter(([{'id': 10}] if 'status=in_progress' in path else []) if key == 'workflow_runs'
                                         else [{'name': 'run (brawley-avra-west)', 'status': 'in_progress'}])
        self.assertEqual(g.busy_cases(), {'brawley-avra-west'})

    def test_queued_or_check_phase_without_known_cases_blocks_all(self):
        g = GitHub('owner/repo')
        g.pages = lambda path, key: iter([{'id': 10}] if key == 'workflow_runs' else [{'name': 'check', 'status': 'in_progress'}])
        self.assertEqual(g.busy_cases(), set(CASES))

    def test_list_pagination_does_not_miss_an_older_busy_run(self):
        g = GitHub('owner/repo')
        with patch.object(g, 'api', side_effect=[{'jobs': list(range(100))}, {'jobs': [100]}]) as call:
            self.assertEqual(len(list(g.pages('actions/runs/10/jobs', 'jobs'))), 101)
            self.assertEqual(call.call_count, 2)

    def test_reservation_uses_optimistic_file_sha_and_bounded_ledger(self):
        g = GitHub('owner/repo'); p = plan_refresh(rain(), {}, {}, set(), NOW)
        with patch.object(g, 'api', return_value={'content': {'sha': 'new'}}) as call:
            state, sha = g.reserve(p, {'cases': {}}, 'old', 'experiment/all-route-models')
            payload = call.call_args.kwargs['payload']
            self.assertEqual(payload['sha'], 'old')
            self.assertEqual(payload['branch'], 'live-model')
            self.assertEqual(set(state['cases']), set(CASES))
            self.assertEqual(sha, 'new')


class WorkflowTests(unittest.TestCase):
    def test_refresh_is_independent_of_coarse_success_and_uses_existing_runner(self):
        s = Path('.github/workflows/live-sfincs.yml').read_text()
        self.assertLess(s.index('python tools/live/refresh_highres_models.py'), s.index('python tools/live/run_live_sfincs.py prepare'))
        self.assertIn('runs-on: ubuntu-24.04', s)
        self.assertIn('cancel-in-progress: false', s)
        self.assertNotIn('gh workflow run live-all-route.yml', s)


if __name__ == '__main__':
    unittest.main()
