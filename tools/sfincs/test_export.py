"""Unit fixtures test parsing only; they are never presented as solver runs."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

from export_run import export


class ExportTests(unittest.TestCase):
    def fixture(self, root, missing=False, short=False):
        t = pd.date_range("2014-09-08", periods=2, freq="1h")
        if short:
            t = t[:-1]
        zs = np.zeros((len(t), 20, 20), dtype=np.float32)
        if missing:
            zs[0, 0, 0] = np.nan
        x, y = np.meshgrid(470025 + np.arange(20) * 50, 3585025 + np.arange(20) * 50)
        ds = xr.Dataset({"h": (("time", "n", "m"), zs, {"units": "m"}),
                         "zb": (("n", "m"), np.zeros((20, 20)), {"units": "m"}),
                         "x": (("n", "m"), x), "y": (("n", "m"), y)}, coords={"time": t})
        ds.to_netcdf(root / "sfincs_map.nc")
        (root / "solver.log").write_text("Simulation finished")
        (root / "case.json").write_text(json.dumps({"inputArtifacts": [], "rainMmHr": 0,
            "expectedFinalVolumeM3": 0, "crs": "EPSG:32612", "sourceCommit": "TEST",
            "verticalDatum": "synthetic", "fixture": "unit_test", "limitations": ["test only"]}))

    def test_dry_export(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root)
            run = export(root)
            self.assertEqual(len(run["cells"]), 400)
            self.assertEqual(run["frames"][-1]["time"], "2014-09-08T01:00:00Z")
            self.assertIsNone(run["uncertainty"]["plusMinus"])

    def test_missing_is_not_dry(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root, missing=True)
            with self.assertRaisesRegex(ValueError, "Missing"):
                export(root)

    def test_incomplete_run_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root, short=True)
            with self.assertRaisesRegex(ValueError, "Incomplete"):
                export(root)

    def test_mass_error_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root)
            manifest = json.loads((root / "case.json").read_text())
            manifest["rainMmHr"] = 10
            (root / "case.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "storage check failed"):
                export(root)


if __name__ == "__main__":
    unittest.main()
