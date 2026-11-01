"""Validate analytical solver output and export the experimental app contract."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
from pyproj import Transformer


def export(root):
    root = Path(root)
    manifest = json.loads((root / "case.json").read_text())
    log = (root / "solver.log").read_text(errors="replace")
    if "Simulation finished" not in log:
        raise ValueError("Solver completion marker missing")
    for artifact in manifest["inputArtifacts"]:
        actual = hashlib.sha256((root / artifact["path"]).read_bytes()).hexdigest()
        if actual != artifact["sha256"]:
            raise ValueError("Input changed since case preparation: " + artifact["path"])
    with xr.open_dataset(root / "sfincs_map.nc") as ds:
        if ds.zs.attrs.get("units") != "m" or ds.zb.attrs.get("units") != "m":
            raise ValueError("Expected water and bed elevations in metres")
        dims = tuple(d for d in ds.zs.dims if d != "time")
        zs = ds.zs.transpose("time", *dims).values
        zb = ds.zb.transpose(*dims).values
        x = ds.x.transpose(*dims).values
        y = ds.y.transpose(*dims).values
        times = pd.DatetimeIndex(ds.time.values)
        if times.hasnans or not times.is_monotonic_increasing or times.has_duplicates:
            raise ValueError("Output times must be finite and strictly increasing")
        if times[0] != pd.Timestamp("2014-09-08T00:00") or times[-1] != pd.Timestamp("2014-09-08T01:00"):
            raise ValueError("Incomplete analytical output time coverage")
        # These fixtures have no inactive cells. Missing data must never become dry.
        if not all(np.isfinite(a).all() for a in (zs, zb, x, y)):
            raise ValueError("Missing/invalid values in fully active analytical domain")
        depth = zs - zb
        if np.min(depth) < -1e-6:
            raise ValueError("Water surface below bed beyond roundoff tolerance")
        depth = np.maximum(depth, 0)
        if depth.shape[1:] != (20, 20):
            raise ValueError("Unexpected analytical grid shape")
        elapsed = (times - times[0]).total_seconds().to_numpy()
        expected = manifest["rainMmHr"] / 1000 * elapsed / 3600
        error = float(np.max(np.abs(depth - expected[:, None, None])))
        volume = float(depth[-1].sum() * 2500)
        tolerance_m = 1e-5  # Numerical sanity tolerance, NOT forecast uncertainty.
        if error > tolerance_m:
            raise ValueError(f"Analytical storage check failed: max depth error {error} m")
        lon, lat = Transformer.from_crs(manifest["crs"], 4326, always_xy=True).transform(x.ravel(), y.ravel())
        if not np.isfinite(lon).all() or not np.isfinite(lat).all():
            raise ValueError("Invalid geographic transformation")
        report = {"passed": True, "maximumDepthErrorM": error,
                  "finalVolumeM3": volume,
                  "expectedFinalVolumeM3": manifest["expectedFinalVolumeM3"],
                  "volumeResidualM3": volume - manifest["expectedFinalVolumeM3"],
                  "numericalToleranceM": tolerance_m,
                  "scope": "closed synthetic domain only; not field validation"}
        run = {"schemaVersion": 1, "model": "SFINCS", "kind": "inundation_scenario",
               "status": "complete", "crs": "EPSG:4326",
               "cells": [{"lon": float(a), "lat": float(b)} for a, b in zip(lon, lat)],
               "frames": [{"time": t.isoformat() + "Z", "depthM": d.ravel().tolist()}
                          for t, d in zip(times, depth)],
               "provenance": {"solverVersion": "source@" + manifest["sourceCommit"],
                              "runId": root.name + "-" + hashlib.sha256((root / "sfincs_map.nc").read_bytes()).hexdigest()[:16],
                              "inputArtifacts": manifest["inputArtifacts"],
                              "projectedCrs": manifest["crs"], "verticalDatum": manifest["verticalDatum"],
                              "fixture": manifest["fixture"], "qualityChecks": report},
               "support": {"domainDescription": "Synthetic 1 km square closed flat basin; coordinates do not imply real terrain",
                           "limitations": manifest["limitations"]},
               "uncertainty": {"status": "not_quantified", "plusMinus": None}}
    (root / "checks.json").write_text(json.dumps(report, indent=2) + "\n")
    (root / "inundation.json").write_text(json.dumps(run, allow_nan=False) + "\n")
    print(json.dumps(report))
    return run


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    export(parser.parse_args().root)
