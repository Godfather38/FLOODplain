"""Prepare analytical SFINCS fixtures; these are not Avra Valley predictions."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from hydromt_sfincs import SfincsModel

SOURCE_COMMIT = "f3647fc0289bb15cb2512d60686cef74cb853c78"


def prepare(root, rain_mm_hr):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    model = SfincsModel(root=str(root), mode="w", write_gis=False)
    model.setup_grid(x0=470000, y0=3585000, dx=50, dy=50,
                     nmax=20, mmax=20, rotation=0, epsg=32612)
    model.set_grid(model.mask.copy(data=np.zeros((20, 20), dtype=np.float32)), name="dep")
    model.set_grid(model.mask.copy(data=np.ones((20, 20), dtype=np.uint8)), name="msk")
    model.setup_config(tref="20140908 000000", tstart="20140908 000000",
                       tstop="20140908 010000", dtout=300, dtmaxout=3600,
                       dtmax=10, zsini=0, qinf=0, manning=0.04,
                       advection=1, storecumprcp=1, ampr_block=1,
                       indexfile="sfincs.ind", mskfile="sfincs.msk",
                       depfile="sfincs.dep", precipfile="sfincs.prcp")
    # Explicit timestamps avoid implicit resampling/interpolation of accumulations.
    rain = pd.Series([rain_mm_hr, rain_mm_hr],
                     index=pd.to_datetime(["2014-09-08T00:00", "2014-09-08T01:00"]),
                     name="precip").rename_axis("time")
    model.set_forcing(rain.to_xarray(), name="precip")
    model.write()
    artifacts = [{"path": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                 for p in sorted(root.glob("sfincs.*")) if p.is_file()]
    manifest = {
        "fixture": "synthetic_closed_flat_basin", "sourceCommit": SOURCE_COMMIT,
        "crs": "EPSG:32612", "verticalDatum": "arbitrary synthetic zero; not NAVD88",
        "timeZone": "UTC", "grid": {"nx": 20, "ny": 20, "dxM": 50, "dyM": 50},
        "rainMmHr": rain_mm_hr, "durationSeconds": 3600,
        "expectedFinalDepthM": rain_mm_hr / 1000,
        "expectedFinalVolumeM3": rain_mm_hr / 1000 * 1000000,
        "boundary": "closed; all active mask cells are 1; no external inflow/outflow",
        "losses": "zero infiltration and evaporation; no drainage structures",
        "inputArtifacts": artifacts,
        "limitations": ["Synthetic terrain and rainfall; not a historical reconstruction",
                        "Checks storage and dry-state behavior, not local flood accuracy",
                        "No roads, culverts, soil calibration, or passability inference"]}
    (root / "case.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("--rain-mm-hr", type=float, default=10)
    args = parser.parse_args()
    if not np.isfinite(args.rain_mm_hr) or args.rain_mm_hr < 0:
        parser.error("rain must be finite and nonnegative")
    prepare(args.root, args.rain_mm_hr)
