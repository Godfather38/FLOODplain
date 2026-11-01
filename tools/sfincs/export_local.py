"""Export a completed local scenario, preserving unvalidated input/support limits."""
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
    case = json.loads((root / "case.json").read_text())
    if case["fixture"] != "trico_local_rainfall_scenario":
        raise ValueError("Expected local scenario metadata")
    if "Simulation finished" not in (root / "solver.log").read_text(errors="replace"):
        raise ValueError("Solver completion marker missing")
    for item in case["inputArtifacts"]:
        if hashlib.sha256((root / item["path"]).read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Input hash mismatch: " + item["path"])
    with xr.open_dataset(root / "sfincs_map.nc") as ds:
        if ds.h.attrs.get("units") != "m":
            raise ValueError("Native depth units are not metres")
        dims = tuple(d for d in ds.h.dims if d != "time")
        depth = ds.h.transpose("time", *dims).values
        x, y = ds.x.transpose(*dims).values, ds.y.transpose(*dims).values
        times = pd.DatetimeIndex(ds.time.values).tz_localize("UTC")
        expected_times = pd.date_range(case["start"], case["end"], freq="1h")
        if not times.equals(expected_times):
            raise ValueError("Incomplete or unexpected hourly output coverage")
        if depth.shape[1:] != (case["grid"]["ny"], case["grid"]["nx"]):
            raise ValueError("Output grid shape differs from inputs")
        if not all(np.isfinite(a).all() for a in (depth, x, y)):
            raise ValueError("Missing output in fully active local domain; no zero fill")
        if depth.min() < -1e-5 or depth[0].max() > 1e-5:
            raise ValueError("Invalid negative depth or non-dry initial state")
        depth = np.maximum(depth, 0)
        volume = depth.sum(axis=(1, 2))*case["grid"]["dxM"]*case["grid"]["dyM"]
        input_volume = case["rainfallVolumeM3"]
        if volume.max() > input_volume * 1.01 + 1:
            raise ValueError("Stored volume exceeds all supplied rainfall without an inflow source")
        lon, lat = Transformer.from_crs(case["crs"], 4326, always_xy=True).transform(x.ravel(), y.ravel())
        if not (np.isfinite(lon).all() and np.isfinite(lat).all()):
            raise ValueError("Invalid geographic coordinates")
        checks = {"completed": True, "timeFrames": len(times), "missingCells": 0,
                  "maximumDepthM": float(depth.max()), "rainfallVolumeM3": input_volume,
                  "finalStoredVolumeM3": float(volume[-1]),
                  "unresolvedBoundaryAndNumericalResidualM3": input_volume-float(volume[-1]),
                  "massBalanceStatus": "not_closed: artificial boundary loss not independently measured",
                  "fieldValidation": "none", "forcingStatus": case["forcingStatus"]}
        run = {"schemaVersion": 1, "model": "SFINCS", "kind": "inundation_scenario", "status": "complete",
               "crs": "EPSG:4326", "cells": [{"lon": float(a), "lat": float(b)} for a, b in zip(lon, lat)],
               "frames": [{"time": t.isoformat().replace("+00:00", "Z"), "depthM": h.ravel().tolist()}
                          for t, h in zip(times, depth)],
               "provenance": {"solverVersion": "source@"+case["sourceCommit"],
                              "runId": "trico-"+hashlib.sha256((root/"sfincs_map.nc").read_bytes()).hexdigest()[:16],
                              "inputArtifacts": case["inputArtifacts"], "projectedCrs": case["crs"],
                              "verticalDatum": case["verticalDatum"], "qualityChecks": checks,
                              "forcingStatus": case["forcingStatus"], "forcingQuality": case["forcingQuality"],
                              "terrainEvidence": case["terrainEvidence"], "forcingProvenance": case["forcingProvenance"]},
               "support": {"domainDescription": "Trico local 100 m terrain scenario, rainfall only, artificial open edges",
                           "limitations": case["limitations"]},
               "uncertainty": {"status": "not_quantified", "plusMinus": None}}
    (root / "checks.json").write_text(json.dumps(checks, indent=2)+"\n")
    (root / "inundation.json").write_text(json.dumps(run, allow_nan=False)+"\n")
    print(json.dumps(checks))
    return run


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    export(parser.parse_args().root)
