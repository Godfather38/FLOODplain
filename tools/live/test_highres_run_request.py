import copy
import datetime as dt
import unittest

from validate_highres_run_request import CASES, FIXED_COARSE_COMMIT, REQUEST_PATH, validate_launch, validate_request

NOW = dt.datetime(2026, 11, 6, 2, 0, tzinfo=dt.timezone.utc)
PARENT = "a" * 40
HEAD = "b" * 40
REQUEST = {"schemaVersion": 1, "requestId": "highres-20261106T020000Z", "requestedAt": "2026-11-06T02:00:00Z",
           "modelCommit": PARENT, "cases": CASES, "cycle": "", "solverCapSeconds": 5400}
EVENT = {"before": PARENT, "after": HEAD}


class RequestTests(unittest.TestCase):
    def check(self, **changes):
        value = copy.deepcopy(REQUEST)
        value.update(changes)
        validate_request(value, PARENT, NOW)

    def test_valid(self):
        self.check()

    def test_reject_bad_inputs(self):
        for change in [{"cases": ["northern"]}, {"cycle": "2026-11-01T00:00:00Z"}, {"solverCapSeconds": 600},
                       {"solverCapSeconds": "5400"}, {"schemaVersion": True}, {"modelCommit": HEAD},
                       {"requestId": "another-run"}, {"unexpected": "ignored?"}, {"cases": CASES + ["unknown"]}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.check(**change)

    def test_reject_stale_or_future(self):
        for stamp, run_id in [("2026-11-05T02:00:00Z", "highres-20261105T020000Z"),
                              ("2026-11-06T03:00:00Z", "highres-20261106T030000Z")]:
            with self.subTest(stamp=stamp), self.assertRaises(ValueError):
                self.check(requestedAt=stamp, requestId=run_id)


class LaunchTests(unittest.TestCase):
    def setUp(self):
        self.commit = {"files": [{"filename": REQUEST_PATH, "status": "added"}], "parents": [{"sha": PARENT}]}
        self.coarse = []
        self.all_route = [{"id": 9, "head_sha": HEAD, "status": "in_progress"}]
        self.comparison = "identical"

    def api(self, path):
        if "/commits/" in path:
            return self.commit
        if "/compare/" in path:
            return {"status": self.comparison}
        if "live-sfincs.yml/runs" in path:
            return {"workflow_runs": self.coarse}
        if "live-all-route.yml/runs" in path:
            return {"workflow_runs": self.all_route}
        raise AssertionError(path)

    def launch(self, event=EVENT, request=REQUEST):
        return validate_launch(event, HEAD, "9", "owner/repo", request, NOW, self.api)

    def test_request_launches(self):
        self.assertTrue(self.launch())

    def test_replayed_request_blocks(self):
        with self.assertRaisesRegex(ValueError, "cannot be replayed"):
            validate_launch(EVENT, HEAD, "9", "owner/repo", REQUEST, NOW, self.api, attempt=2)

    def test_workflow_update_does_not_launch(self):
        self.commit["files"] = [{"filename": ".github/workflows/live-all-route.yml", "status": "modified"}]
        self.assertFalse(self.launch(request=None))

    def test_deleted_request_does_not_launch(self):
        self.commit["files"][0]["status"] = "removed"
        self.assertFalse(self.launch(request=None))

    def test_no_multifile_launch(self):
        self.commit["files"].append({"filename": "model.py", "status": "modified"})
        with self.assertRaises(ValueError):
            self.launch()

    def test_no_multicommit_push(self):
        with self.assertRaises(ValueError):
            self.launch(event={"before": "c" * 40, "after": HEAD})

    def test_unsafe_coarse_run_blocks(self):
        self.coarse = [{"id": 1, "head_sha": "old", "status": "in_progress"}]
        self.comparison = "behind"
        with self.assertRaisesRegex(ValueError, "unsafe publisher"):
            self.launch()

    def test_fixed_coarse_successor_allows(self):
        self.coarse = [{"id": 1, "head_sha": FIXED_COARSE_COMMIT, "status": "in_progress"}]
        self.assertTrue(self.launch())

    def test_completed_old_coarse_allows(self):
        self.coarse = [{"id": 1, "head_sha": "old", "status": "completed"}]
        self.comparison = "behind"
        self.assertTrue(self.launch())

    def test_active_all_route_blocks(self):
        for status in ["in_progress", "queued", "waiting"]:
            self.all_route = [{"id": 10, "head_sha": PARENT, "status": status}]
            with self.subTest(status=status), self.assertRaisesRegex(ValueError, "already exists or is active"):
                self.launch()

    def test_duplicate_completed_run_blocks(self):
        self.all_route = [{"id": 10, "head_sha": HEAD, "status": "completed"}]
        with self.assertRaises(ValueError):
            self.launch()

    def test_different_completed_run_allows(self):
        self.all_route = [{"id": 10, "head_sha": PARENT, "status": "completed"}]
        self.assertTrue(self.launch())


if __name__ == "__main__":
    unittest.main()
