"""Prepare a local terrain/radar scenario; not a full-basin flood reconstruction."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
import xarray as xr
from hydromt_sfincs import SfincsModel
from pyproj import Transformer

from prepare_case import SOURCE_COMMIT


def prepare(root, terrain, forcing):
    root, terrain, forcing = Path(root), Path(terrain), Path(forcing)
    root.mkdir(parents=True, exist_ok=True)
    evidence = json.loads((terrain / "terrain.json").read_text())
    if hashlib.sha256((terrain / "terrain.tif").read_bytes()).hexdigest() != evidence["sha256"]:
        raise ValueError("Terrain hash mismatch")
    rain = json.loads(forcing.read_text())
    if rain["kind"] != "spatial_hourly_rainfall_forcing" or rain["units"] != "mm/h" or rain["missingCellHours"]:
        raise ValueError("Require complete hourly rate forcing; no missing-to-zero fill")
    if rain["crs"] != "EPSG:4326" or not rain["frames"]:
        raise ValueError("Unsupported forcing CRS/coverage")
    with rasterio.open(terrain / "terrain.tif") as src:
        if src.crs.to_epsg() != 32612 or src.transform.b or src.transform.d:
            raise ValueError("Require north-up EPSG:32612 terrain")
        bed = src.read(1, masked=True)
        if np.ma.getmaskarray(bed).any() or not np.isfinite(bed.data).all():
            raise ValueError("Missing terrain")
        dx, dy = src.res
        west, south, east, north = src.bounds
        ny, nx = bed.shape
        bed = np.flipud(bed.data).copy()  # HydroMT regular y axis increases northward.
    model = SfincsModel(root=str(root), mode="w", write_gis=False)
    model.setup_grid(x0=west, y0=south, dx=dx, dy=dy, nmax=ny, mmax=nx, rotation=0, epsg=32612)
    model.set_grid(model.mask.copy(data=bed.astype(np.float32)), name="dep")
    mask = np.ones((ny, nx), dtype=np.uint8)
    mask[[0, -1], :] = 3
    mask[:, [0, -1]] = 3
    model.set_grid(model.mask.copy(data=mask), name="msk")
    xs, ys = np.meshgrid(west + (np.arange(nx)+0.5)*dx, south + (np.arange(ny)+0.5)*dy)
    lon, lat = Transformer.from_crs(32612, 4326, always_xy=True).transform(xs, ys)
    source_lon, source_lat = np.array(rain["lon"]), np.array(rain["lat"])
    if not (source_lon.min() <= lon.min() <= lon.max() <= source_lon.max() and
            source_lat.min() <= lat.min() <= lat.max() <= source_lat.max()):
        raise ValueError("Rainfall centers must surround entire terrain domain; request a padded crop")
    ix = np.abs(lon[..., None] - source_lon).argmin(axis=-1)
    iy = np.abs(lat[..., None] - source_lat).argmin(axis=-1)
    starts, values, previous_end = [], [], None
    for frame in rain["frames"]:
        start, end = pd.Timestamp(frame["start"]), pd.Timestamp(frame["end"])
        if start.tzinfo is None or end.tzinfo is None or (end-start).total_seconds() != 3600 or (previous_end is not None and start != previous_end):
            raise ValueError("Require contiguous, timezone-aware one-hour intervals")
        previous_end = end
        source = np.asarray(frame["precipMmH"], dtype=float)
        if source.shape != (len(source_lat), len(source_lon)) or not np.isfinite(source).all() or (source < 0).any():
            raise ValueError("Invalid rainfall grid")
        starts.append(start.tz_convert("UTC").tz_localize(None))
        values.append(source[iy, ix])
    stop = previous_end.tz_convert("UTC").tz_localize(None)
    times = starts + [stop]
    # Terminal value exists only to cover the endpoint; the run stops there.
    rate = xr.DataArray(np.asarray(values + [values[-1]], dtype=np.float32),
                        dims=("time", "y", "x"),
                        coords={"time": times, "y": ys[:, 0], "x": xs[0]},
                        name="precip_2d", attrs={"units": "mm/hr"})
    rate.raster.set_crs(32612)
    model.set_forcing(rate, name="precip_2d")
    model.setup_config(tref=starts[0].strftime("%Y%m%d %H%M%S"),
                       tstart=starts[0].strftime("%Y%m%d %H%M%S"), tstop=stop.strftime("%Y%m%d %H%M%S"),
                       dtout=3600, dtmaxout=(stop-starts[0]).total_seconds(), dtmax=20,
                       dtwnd=60, zsini=0, qinf=0, manning=0.04, advection=1,
                       storecumprcp=1, ampr_block=1, indexfile="sfincs.ind",
                       mskfile="sfincs.msk", depfile="sfincs.dep", netamprfile="rainfall.nc")
    model.write()
    inputs = [p for p in root.iterdir() if p.is_file() and (p.name.startswith("sfincs.") or p.name == "rainfall.nc")]
    artifacts = [{"path": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(inputs)]
    manifest = {"fixture": "trico_local_rainfall_scenario", "sourceCommit": SOURCE_COMMIT,
                "crs": "EPSG:32612", "verticalDatum": "NAVD88 per overlapping USGS source catalog; no conversion",
                "terrainEvidence": evidence, "forcingProvenance": rain["provenance"],
                "forcingStatus": rain["status"], "forcingQuality": rain["sourceQuality"],
                "forcingSha256": hashlib.sha256(forcing.read_bytes()).hexdigest(),
                "start": starts[0].isoformat()+"Z", "end": stop.isoformat()+"Z",
                "grid": {"nx": nx, "ny": ny, "dxM": dx, "dyM": dy},
                "rainfallVolumeM3": float(np.sum(values)*dx*dy/1000),
                "inputArtifacts": artifacts, "boundary": "All edge cells mask=3: artificial zero-depth outflow; no upstream inflow",
                "rainMapping": "Nearest original radar pixel at each model cell center; no additional spatial information",
                "limitations": ["Uncalibrated local rain-only scenario; upstream Santa Cruz inflow omitted",
                                "Rainfall product discrepancy requires review; do not treat as verified 2014 forcing",
                                "100 m contemporary DEM cannot resolve bridges, culverts, or historical channel geometry",
                                "Uniform assumed Manning 0.04; zero infiltration; no soil or roughness calibration",
                                "Artificial edge sinks affect depths and omit incoming water; not a field forecast",
                                "No passability, scour, or independently quantified uncertainty"]}
    (root / "case.json").write_text(json.dumps(manifest, indent=2)+"\n")
    print(json.dumps({"shape": [ny, nx], "hours": len(starts), "forcingStatus": rain["status"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("--terrain", required=True)
    parser.add_argument("--forcing", required=True)
    args = parser.parse_args()
    prepare(args.root, args.terrain, args.forcing)
