import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

from export_local import export


class LocalExportTests(unittest.TestCase):
    def fixture(self, root, final=0.01):
        (root / "sfincs.inp").write_text("unit fixture only")
        digest = hashlib.sha256((root / "sfincs.inp").read_bytes()).hexdigest()
        case = {"fixture": "trico_local_rainfall_scenario", "inputArtifacts": [{"path": "sfincs.inp", "sha256": digest}],
                "start": "2014-09-08T07:00:00Z", "end": "2014-09-08T08:00:00Z",
                "grid": {"ny": 2, "nx": 2, "dxM": 100, "dyM": 100}, "rainfallVolumeM3": 400,
                "crs": "EPSG:32612", "sourceCommit": "unit-test", "verticalDatum": "synthetic",
                "forcingStatus": "requires_quality_review", "forcingQuality": {"warning": "test discrepancy"},
                "terrainEvidence": {}, "forcingProvenance": {}, "limitations": ["unit test only"]}
        (root / "case.json").write_text(json.dumps(case))
        (root / "solver.log").write_text("Simulation finished")
        depth = np.zeros((2, 2, 2))
        depth[1] = final
        ds = xr.Dataset({"h": (("time", "n", "m"), depth, {"units": "m"}),
                         "x": (("n", "m"), [[468050, 468150], [468050, 468150]]),
                         "y": (("n", "m"), [[3584850, 3584850], [3584950, 3584950]])},
                         coords={"time": pd.date_range("2014-09-08T07:00", periods=2, freq="1h")})
        ds.to_netcdf(root / "sfincs_map.nc")

    def test_quality_and_unclosed_budget_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root)
            run = export(root)
            self.assertEqual(run["provenance"]["forcingStatus"], "requires_quality_review")
            self.assertTrue(run["provenance"]["qualityChecks"]["massBalanceStatus"].startswith("not_closed"))
            self.assertIsNone(run["uncertainty"]["plusMinus"])

    def test_missing_is_not_zero(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root, np.nan)
            with self.assertRaisesRegex(ValueError, "Missing"):
                export(root)

    def test_unexplained_water_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root, 1)
            with self.assertRaisesRegex(ValueError, "exceeds"):
                export(root)

    def test_changed_inputs_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root)
            (root / "sfincs.inp").write_text("changed after preparation")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                export(root)


if __name__ == "__main__":
    unittest.main()
