#!/usr/bin/env python3
"""Validate an explicit experimental-branch model run request before dispatching cases.

Ordinary workflow edits do not launch models. A launch is a separate commit
changing only all-route-run-request.json after the tested model commit.
All GitHub API operations here are read-only; github.token stays inside gh.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess

REQUEST_PATH = "tools/live/all-route-run-request.json"
CASES = ["northern", "picture-rocks", "gates"]
FIXED_COARSE_COMMIT = "c8b28460083a7e0e07725655c082f13bdfd8aeff"
MODEL_BRANCH = "refs/heads/experiment/all-route-models"
FIELDS = {"schemaVersion", "requestId", "requestedAt", "modelCommit", "cases", "cycle", "solverCapSeconds"}


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


def validate_request(request, parent_sha, now):
    if not isinstance(request, dict) or set(request) != FIELDS:
        raise ValueError("Run request fields do not match schema version 1")
    if type(request["schemaVersion"]) is not int or request["schemaVersion"] != 1:
        raise ValueError("Unsupported run request schema version")
    if request["cases"] != CASES or request["cycle"] != "":
        raise ValueError("Request must run the three known cases with the newest cycle")
    if type(request["solverCapSeconds"]) is not int or request["solverCapSeconds"] != 5400:
        raise ValueError("Request must use the tested 5400-second solver limit")
    if not re.fullmatch(r"[0-9a-f]{40}", str(request["modelCommit"])) or request["modelCommit"] != parent_sha:
        raise ValueError("Request must follow its exact validated model commit")
    stamp = request["requestedAt"]
    if not isinstance(stamp, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", stamp):
        raise ValueError("requestedAt must be a UTC timestamp")
    requested = dt.datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    if request["requestId"] != requested.strftime("highres-%Y%m%dT%H%M%SZ"):
        raise ValueError("requestId must identify the requested UTC instant")
    age = (now - requested).total_seconds()
    if not -300 <= age <= 21600:
        raise ValueError("Run request is stale or in the future")


def workflow_runs(repo, workflow, get=api):
    # Paginate rather than assuming an inactive run is on the first page.
    for page in range(1, 21):
        data = get(f"repos/{repo}/actions/workflows/{workflow}/runs?per_page=100&page={page}")
        runs = data["workflow_runs"]
        yield from runs
        if len(runs) < 100:
            return
    raise ValueError("Too many workflow runs to verify launch safely")


def validate_launch(event, sha, run_id, repo, request, now, get=api, attempt=1):
    commit = get(f"repos/{repo}/commits/{sha}")
    files = commit.get("files", [])
    request_changes = [f for f in files if f["filename"] == REQUEST_PATH and f["status"] in ("added", "modified")]
    if not request_changes:
        return False  # A workflow edit or request deletion is not a launch.
    if attempt != 1:
        raise ValueError("An explicit request cannot be replayed; inspect results before creating a new request")
    if len(files) != 1 or len(commit["parents"]) != 1:
        raise ValueError("Launch commit must change only the model run request")
    parent_sha = commit["parents"][0]["sha"]
    if event.get("before") != parent_sha or event.get("after") != sha:
        raise ValueError("Launch must be a single new request commit, not a branch reset or multi-commit push")
    validate_request(request, parent_sha, now)
    for run in workflow_runs(repo, "live-sfincs.yml", get):
        if run["status"] == "completed":
            continue
        comparison = get(f"repos/{repo}/compare/{FIXED_COARSE_COMMIT}...{run['head_sha']}")
        if comparison["status"] not in ("identical", "ahead"):
            raise ValueError(f"Coarse run {run['id']} still uses the old unsafe publisher")
    for run in workflow_runs(repo, "live-all-route.yml", get):
        if str(run["id"]) == str(run_id):
            continue
        if run["head_sha"] == sha or run["status"] != "completed":
            raise ValueError(f"All-route run {run['id']} already exists or is active; inspect before retrying")
    return True


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    push_request = os.environ["GITHUB_EVENT_NAME"] == "push" and os.environ["GITHUB_REF"] == MODEL_BRANCH
    should_run = True
    if push_request:
        request_path = Path(REQUEST_PATH)
        request = json.loads(request_path.read_text()) if request_path.exists() else None
        should_run = validate_launch(event, os.environ["GITHUB_SHA"], os.environ["GITHUB_RUN_ID"],
                                     os.environ["GITHUB_REPOSITORY"], request, dt.datetime.now(dt.timezone.utc),
                                     attempt=int(os.environ["GITHUB_RUN_ATTEMPT"]))
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        out.write(f"run={'true' if should_run else 'false'}\n")
        out.write(f"cases={','.join(CASES) if push_request and should_run else ''}\n")
    print("Validated explicit all-route model request" if push_request and should_run else
          "No model request change; skipping" if not should_run else "Existing manual or rain-triggered run")


if __name__ == "__main__":
    main()
