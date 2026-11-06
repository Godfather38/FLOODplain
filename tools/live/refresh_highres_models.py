"""Keep each high-resolution route model current, without duplicate/overlapping work.

Called once per hour by live-sfincs.yml after its independent HRRR rain check.
Only standard GitHub-hosted model jobs are dispatched; no app deploy is involved.
The small attempt ledger lives on live-model, survives coordinator restarts, and
is reserved BEFORE dispatch so an uncertain API result cannot cause a duplicate.
"""
import argparse
import base64
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import quote

CASES = ('northern', 'picture-rocks', 'gates')
# Includes preparation/export margin over observed ~50/35/18-minute runs.
RUNTIME_MINUTES = {'northern': 65, 'picture-rocks': 50, 'gates': 30}
ACTIVE_STATUSES = ('queued', 'in_progress', 'waiting', 'requested', 'pending')
STATE_PATH = 'highres-cadence/state.json'
MAX_AGE_MINUTES = 180
POLL_MINUTES = 60


def stamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(dt.timezone.utc) if parsed.tzinfo else None
    except ValueError:
        return None


def iso(value):
    return value.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def plan_refresh(rain, summaries, state, busy, now):
    """Pure policy function. Missing/invalid results never imply a dry model."""
    cycle = stamp(rain.get('hrrrCycle'))
    if cycle is None or not 0 <= (now - cycle).total_seconds() <= 6 * 3600:
        raise ValueError('HRRR cycle is missing, invalid, future, or over six hours old')
    checked = stamp(rain.get('checkedAt'))
    if checked is None or not 0 <= (now - checked).total_seconds() <= 20 * 60:
        raise ValueError('Rain check must have completed in the last 20 minutes')
    wet = set(rain.get('run', []))
    if not wet <= set(CASES):
        raise ValueError('Rain check contains an unknown case')
    attempts = state.get('cases', {})
    details, selected = {}, []
    for case in CASES:
        summary = summaries.get(case) or {}
        issued = stamp(summary.get('issuedAt'))
        published_cycle = stamp(summary.get('hrrrCycle'))
        valid_to = stamp(summary.get('validTo'))
        valid_from = stamp(summary.get('validFrom'))
        usable = (summary.get('schemaVersion') == 1 and summary.get('case') == case
                  and summary.get('kind') == 'live_all_route_road_forecast'
                  and summary.get('executionMode') == 'live_current_forcing'
                  and summary.get('status') == 'complete' and issued is not None
                  and issued <= now and valid_from is not None and valid_from <= now
                  and valid_to is not None and valid_to > now and published_cycle is not None
                  and published_cycle <= now)
        age = (now - issued).total_seconds() / 60 if issued else None
        # Look ahead one polling interval: waiting until exactly 2h can leave a
        # gap before the 3h freshness deadline, especially for the northern case.
        refresh_after = MAX_AGE_MINUTES - POLL_MINUTES - RUNTIME_MINUTES[case]
        last_attempt = stamp(attempts.get(case, {}).get('hrrrCycle'))
        if case in busy:
            reason = 'active_or_queued'
        elif last_attempt is not None and last_attempt >= cycle:
            reason = 'cycle_already_attempted'
        elif usable and published_cycle >= cycle:
            reason = 'cycle_already_published'
        elif not usable:
            reason = 'missing_or_incomplete_summary'
        elif case in wet:
            reason = 'rain_forecast'
        elif age >= refresh_after or valid_to <= now + dt.timedelta(minutes=POLL_MINUTES + RUNTIME_MINUTES[case]):
            reason = 'refresh_before_expiry'
        else:
            reason = 'fresh_until_next_check'
        run = reason in ('missing_or_incomplete_summary', 'rain_forecast', 'refresh_before_expiry')
        if run:
            selected.append(case)
        details[case] = {'run': run, 'reason': reason, 'issuedAt': summary.get('issuedAt'),
                         'publishedCycle': summary.get('hrrrCycle'), 'validTo': summary.get('validTo'),
                         'ageMinutes': round(age, 1) if age is not None else None,
                         'refreshAfterMinutes': refresh_after,
                         'runtimeBudgetMinutes': RUNTIME_MINUTES[case]}
    return {'schemaVersion': 1, 'checkedAt': iso(now), 'hrrrCycle': iso(cycle),
            'maxAgeMinutes': MAX_AGE_MINUTES, 'pollMinutes': POLL_MINUTES,
            'run': selected, 'cases': details}


class GitHub:
    def __init__(self, repository):
        self.repository = repository

    def api(self, path, *, payload=None, missing_ok=False):
        cmd = ['gh', 'api', f'repos/{self.repository}/{path}']
        if payload is not None:
            cmd += ['--method', 'PUT', '--input', '-']
        result = subprocess.run(cmd, input=json.dumps(payload) if payload is not None else None,
                                capture_output=True, text=True, timeout=90)
        if result.returncode:
            # Only a verified 404 means missing. Authentication, throttling, or
            # network errors must stop dispatch rather than look like stale data.
            if missing_ok and '(HTTP 404)' in result.stderr:
                return None
            raise RuntimeError(f'GitHub API failed for {path}: {result.stderr.strip()}')
        return json.loads(result.stdout)

    def pages(self, path, key):
        page = 1
        while True:
            sep = '&' if '?' in path else '?'
            result = self.api(f'{path}{sep}per_page=100&page={page}')
            rows = result[key]
            yield from rows
            if len(rows) < 100:
                return
            page += 1

    def read_file(self, path):
        item = self.api(f'contents/{path}?ref=live-model', missing_ok=True)
        if item is None:
            return None, None
        return json.loads(base64.b64decode(item['content'])), item['sha']

    def busy_cases(self):
        """Check all workflow refs: a manual run must also block its case."""
        busy = set()
        runs = {}
        for status in ACTIVE_STATUSES:
            for run in self.pages(f'actions/workflows/live-all-route.yml/runs?status={status}', 'workflow_runs'):
                runs[run['id']] = run
        for run_id in runs:
            jobs = list(self.pages(f'actions/runs/{run_id}/jobs', 'jobs'))
            # Matrix jobs may not exist while check/request is pending. Do not
            # enqueue speculative work until their case selection is known.
            model_jobs = [j for j in jobs if j['name'].startswith('run (')]
            if not model_jobs:
                busy.update(CASES)
                continue
            for job in model_jobs:
                if job['status'] == 'completed':
                    continue
                case = job['name'][5:-1] if job['name'].endswith(')') else None
                if case not in CASES:
                    busy.update(CASES)  # Unknown naming: fail closed.
                else:
                    busy.add(case)
        return busy

    def reserve(self, plan, state, state_sha, ref):
        state = {'schemaVersion': 1, 'cases': dict(state.get('cases', {}))}
        for case in plan['run']:
            state['cases'][case] = {'hrrrCycle': plan['hrrrCycle'], 'requestedAt': plan['checkedAt'],
                                    'reason': plan['cases'][case]['reason'],
                                    'coordinatorRun': os.environ.get('GITHUB_RUN_ID'),
                                    'workflowRef': ref, 'dispatchStatus': 'reserved'}
        updated = self.write_state(state, state_sha, f"Reserve high-res refresh for HRRR {plan['hrrrCycle']}")
        return state, updated['content']['sha']

    def write_state(self, state, state_sha, message):
        payload = {'message': message,
                   'branch': 'live-model',
                   'content': base64.b64encode((json.dumps(state, indent=1) + '\n').encode()).decode()}
        if state_sha:
            payload['sha'] = state_sha
        # No blind retry: a rejected update may mean another coordinator won.
        return self.api(f'contents/{STATE_PATH}', payload=payload)

    def dispatch(self, plan, ref):
        # A failed/uncertain dispatch remains reserved for this cycle. The next
        # hourly HRRR cycle can retry, without duplicate jobs after a restart.
        subprocess.run(['gh', 'workflow', 'run', 'live-all-route.yml', '--repo', self.repository,
                        '--ref', ref, '-f', f"cycle={plan['hrrrCycle']}",
                        '-f', 'cases=' + ','.join(plan['run'])], check=True, timeout=90)


def refresh(github, rain, now, *, dispatch=False, ref='experiment/all-route-models'):
    state, state_sha = github.read_file(STATE_PATH)
    state = state or {'schemaVersion': 1, 'cases': {}}
    if state.get('schemaVersion') != 1 or not isinstance(state.get('cases'), dict):
        raise ValueError('Invalid high-res attempt ledger; refusing duplicate dispatch risk')
    # Snapshot activity first. A case completing during these reads stays busy
    # for this poll rather than looking idle against its older summary.
    busy = github.busy_cases()
    summaries = {case: github.read_file(f'all-route/{case}/compact/road-forecast.json')[0]
                 for case in CASES}
    plan = plan_refresh(rain, summaries, state, busy, now)
    plan['dispatch'] = 'not_requested'
    if dispatch and plan['run']:
        reserved, reserved_sha = github.reserve(plan, state, state_sha, ref)
        try:
            github.dispatch(plan, ref)
        except (subprocess.SubprocessError, OSError) as error:
            for case in plan['run']:
                reserved['cases'][case]['dispatchStatus'] = 'uncertain'
            try:
                github.write_state(reserved, reserved_sha, 'Record uncertain high-res dispatch')
            except (RuntimeError, subprocess.SubprocessError, OSError):
                pass  # Reservation still prevents a duplicate even if reporting fails.
            raise RuntimeError('High-res dispatch failed or is uncertain; this cycle remains reserved') from error
        plan['dispatch'] = 'accepted'
        for case in plan['run']:
            reserved['cases'][case]['dispatchStatus'] = 'accepted'
        try:
            github.write_state(reserved, reserved_sha, 'Record accepted high-res dispatch')
        except (RuntimeError, subprocess.SubprocessError, OSError) as error:
            plan['warning'] = f'Dispatch accepted; ledger status update failed: {error}'
    elif dispatch:
        plan['dispatch'] = 'not_needed'
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rain-check', required=True)
    parser.add_argument('--output', default='highres-refresh.json')
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', 'Godfather38/FLOODplain'))
    parser.add_argument('--ref', default=os.environ.get('ALL_ROUTE_REF', 'experiment/all-route-models'))
    parser.add_argument('--dispatch', action='store_true')
    args = parser.parse_args()
    rain = json.loads(Path(args.rain_check).read_text())
    plan = refresh(GitHub(args.repo), rain, dt.datetime.now(dt.timezone.utc),
                   dispatch=args.dispatch, ref=args.ref)
    Path(args.output).write_text(json.dumps(plan, indent=1) + '\n')
    print(json.dumps(plan))


if __name__ == '__main__':
    main()
