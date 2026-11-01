"""SFINCS wet-to-dry regression: synthetic inclined bed, initial water, one outlet."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import xarray as xr
from hydromt_sfincs import SfincsModel

from prepare_case import prepare


def setup(root):
    root = Path(root)
    prepare(root, 0)
    model = SfincsModel(root=str(root), mode="r+", write_gis=False)
    model.read()
    bed = np.broadcast_to(np.arange(20, dtype=np.float32) * 0.05, (20, 20)).copy()
    model.set_grid(model.mask.copy(data=bed), name="dep")
    mask = np.ones((20, 20), dtype=np.uint8)
    mask[:, 0] = 3  # Only downhill edge is a zero-depth outlet.
    model.set_grid(model.mask.copy(data=mask), name="msk")
    model.setup_config(zsini=1, huthresh=0.01)
    model.write()
    artifacts = [{"path": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                 for p in sorted(root.glob("sfincs.*")) if p.is_file()]
    (root / "drainage-inputs.json").write_text(json.dumps(artifacts, indent=2)+"\n")
    # This is not an analytical uniform-rain case; do not allow the other exporter.
    case = json.loads((root / "case.json").read_text())
    case.update(fixture="synthetic_inclined_drainage", inputArtifacts=artifacts,
                expectedFinalDepthM=None, expectedFinalVolumeM3=None,
                boundary="one downhill zero-depth outflow edge; remaining edges closed",
                limitations=["Synthetic wet-to-dry regression, not a local hazard scenario"])
    (root / "case.json").write_text(json.dumps(case, indent=2)+"\n")


def check(root):
    root = Path(root)
    if "Simulation finished" not in (root / "solver.log").read_text(errors="replace"):
        raise ValueError("Solver did not finish")
    for item in json.loads((root / "drainage-inputs.json").read_text()):
        if hashlib.sha256((root / item["path"]).read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Drainage inputs changed")
    with xr.open_dataset(root / "sfincs_map.nc") as ds:
        h = ds.h.transpose("time", ...).values
        if h.shape != (13, 20, 20) or not np.isfinite(h).all() or h.min() < -1e-6:
            raise ValueError("Invalid drainage depth/time coverage")
        volume = h.sum(axis=(1, 2))*2500
        # Sink flux is not independently integrated; this tests direction/stability.
        if (np.diff(volume) > 0.1).any() or volume[-1] >= 0.9*volume[0]:
            raise ValueError("No-rain outlet case must lose storage monotonically")
        dry = (h <= 0.01).sum(axis=(1, 2))
        if dry[-1] <= dry[0]:
            raise ValueError("Expected additional cells to become dry")
        report = {"passed": True, "initialVolumeM3": float(volume[0]), "finalVolumeM3": float(volume[-1]),
                  "initialDryCells": int(dry[0]), "finalDryCells": int(dry[-1]),
                  "dryThresholdM": 0.01, "scope": "wet-to-dry stability; outlet mass flux not independently measured"}
    (root / "checks.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "check"])
    parser.add_argument("root")
    args = parser.parse_args()
    (setup if args.action == "prepare" else check)(args.root)
