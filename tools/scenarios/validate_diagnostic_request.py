"""Validate the opt-in, bounded diagnostic recovery request. Never launches a solver."""
import argparse
import json
from pathlib import Path
import re

ALLOWED = {('gates', 'stress'), ('gates', 'extreme')}
SOURCE_WORKFLOW = '.github/workflows/design-storm-preview.yml'
SOURCE_BRANCH = 'experiment/all-route-storm-preview'


def validate_request(request):
    if (request.get('schemaVersion') != 1 or request.get('purpose') != 'diagnostic_recovery_only'
            or request.get('productionPublication') is not False or request.get('acceptForDisplay') is not False
            or request.get('solverCapSeconds') != 5400 or request.get('maximumRecoveryJobs') != 2
            or not isinstance(request.get('enabled'), bool)
            or not re.fullmatch(r'[1-9][0-9]*', str(request.get('originalRunId', '')))):
        raise ValueError('Recovery request must remain diagnostic-only, bounded, and explicitly enabled/disabled')
    jobs = request.get('jobs', [])
    if not isinstance(jobs, list) or not 1 <= len(jobs) <= 2:
        raise ValueError('Recovery must request one or two explicit jobs')
    pairs = [(job.get('case'), job.get('scenario')) for job in jobs]
    if len(set(pairs)) != len(pairs) or any(pair not in ALLOWED for pair in pairs):
        raise ValueError('Only explicit Gates stress/extreme diagnostic recovery is supported')
    return {'include': [{'case': case, 'scenario': scenario} for case, scenario in pairs]}


def verify_original_run(request, run, jobs):
    if (str(run.get('id')) != str(request['originalRunId']) or run.get('path') != SOURCE_WORKFLOW
            or run.get('head_branch') != SOURCE_BRANCH):
        raise ValueError('Original run identity differs from the isolated scenario workflow')
    native = [job for job in jobs if re.fullmatch(r'run \([^)]+\)', job.get('name', ''))]
    if len(native) != 6:
        raise ValueError('Could not verify all six original native jobs')
    remaining = [job for job in native if job.get('status') != 'completed']
    if len(remaining) > 1:
        raise ValueError('More than one original solver remains queued/running; recovery must wait')
    for target in request['jobs']:
        name = f"run ({target['case']}, {target['scenario']})"
        matching = [job for job in native if job['name'] == name]
        if len(matching) != 1 or matching[0].get('status') != 'completed' or matching[0].get('conclusion') != 'failure':
            raise ValueError('Requested recovery is not a completed failed original job: ' + name)
        failed = [step.get('name') for step in matching[0].get('steps', []) if step.get('conclusion') == 'failure']
        if failed != ['Export and validate preview output only']:
            raise ValueError('Recovery target did not fail at the expected native export/quality gate: ' + name)
    return len(remaining)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('request'); parser.add_argument('--run'); parser.add_argument('--jobs'); parser.add_argument('--github-output')
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text()); matrix = validate_request(request)
    enabled = request['enabled']
    if enabled:
        if not args.run or not args.jobs:
            raise ValueError('Enabled recovery requires a current original-run and jobs snapshot')
        run = json.loads(Path(args.run).read_text()); jobs = json.loads(Path(args.jobs).read_text())
        verify_original_run(request, run, jobs['jobs'])
    result = {'enabled': 'true' if enabled else 'false', 'matrix': json.dumps(matrix, separators=(',', ':'))}
    if args.github_output:
        with Path(args.github_output).open('a') as stream:
            for key, value in result.items():
                stream.write(f'{key}={value}\n')
    print(json.dumps({'enabled': enabled, 'diagnosticOnly': True, 'matrix': matrix}, separators=(',', ':')))


if __name__ == '__main__':
    main()
