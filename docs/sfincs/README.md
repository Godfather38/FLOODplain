# Experimental SFINCS execution

Branch: `experiment/sfincs-engine`. This does not deploy or alter the general site.

The solver is built from official Deltares SFINCS GPL-3.0 source at
`f3647fc0289bb15cb2512d60686cef74cb853c78`. HydroMT-SFINCS 1.2.2 prepares
inputs. No separately licensed downloadable Deltares executable is used or
redistributed. Source: https://github.com/Deltares/SFINCS/tree/f3647fc0289bb15cb2512d60686cef74cb853c78
and https://github.com/Deltares/hydromt_sfincs .

## Reproduce on Linux

Install `gfortran build-essential autoconf automake libtool pkg-config libnetcdf-dev`
and Python 3.12. In an isolated Python environment:

```sh
python -m pip install -r tools/sfincs/requirements.txt
python -m unittest discover -s tools/sfincs -p 'test_*.py'
bash tools/sfincs/build-source.sh /tmp/floodplain-sfincs-source
python tools/sfincs/prepare_case.py .sfincs-runs/dry --rain-mm-hr 0
python tools/sfincs/prepare_case.py .sfincs-runs/rain --rain-mm-hr 10
export OMP_NUM_THREADS=2
for case in dry rain; do
  (cd ".sfincs-runs/$case" && /tmp/floodplain-sfincs-source/source/src/sfincs > solver.log 2>&1)
  python tools/sfincs/export_run.py ".sfincs-runs/$case"
done
```

The dedicated GitHub workflow performs the same source build with a 30-minute
limit on the public repository's standard Linux runner. Its artifact contains
input files, solver logs, original NetCDF, check reports and app JSON, not the
solver binary. No deployment step or credentials are needed.

## What the first checks establish

Two synthetic 20×20-cell closed flat domains, 50 m cells, one hour duration:
zero rain must remain dry; uniform 10 mm/h rainfall must store 10 mm depth and
10,000 m³ by the end. Every output frame is compared with the analytical
accumulation. The numerical tolerance is 0.00001 m; it is **not** a prediction
confidence interval. All cells are active; any missing output is an error.
Initial water level equals the synthetic bed. No infiltration, evaporation,
external inflow, outlets, structures or initial water volume are imposed.

The pinned source's `advection=1` enables its simplified shallow-water advection
scheme. This basic test cannot establish suitability for steep flash floods,
hydraulic jumps, bridge openings or sediment scour. Local terrain and calibration
remain separate work. Synthetic zero elevation has no real vertical datum.

## App boundary

`export_run.py` emits schema v1 `SFINCS` / `inundation_scenario`, WGS84 cell
centers and UTC `frames[].depthM`, matching the experimental branch's
`public/simulation/inundation-contract.js`. Original projected NetCDF is retained.
Input SHA-256 values, source commit, projected CRS, vertical datum and check
results travel with provenance. `uncertainty.plusMinus` remains null. There is
no flow estimate inferred from a depth, road passability score, or live forecast.
The present exporter deliberately accepts only the fully covered analytical
fixture; local runs need their own completeness and budget checks.

## Planned local forcing interface

Terrain/rain crop bounds: WGS84 `[-111.34, 32.40, -111.27, 32.49]`, projected
solver CRS EPSG:32612. This covers a local Trico window, not the full upstream
Santa Cruz basin. Reuse the other experiment's decoded rainfall JSON: geographic
`grid`, `frames[].start`, `durationMinutes`, `rates` in mm/h, with original source
hashes and missing-data flags. Do not interpolate missing rain to zero or label a
local rain-only run as the complete September 2014 river flood reconstruction.

## Local Windows runtime limitation

HydroMT runs in the isolated `.venv`. No local Fortran compiler was found.
Existing Docker Desktop fails opening its `sailor-ingest.sock` reparse point with
“The file cannot be accessed by the system.” Removing only that inactive zero-byte
socket also failed. No factory reset, security setting change or binary license
acceptance was performed. Linux CI is the reproducible solver execution route;
the local Windows solver is not yet operational.

## Completed runs

See [RESULTS.md](RESULTS.md) for actual solver checks, the recorded Trico scenario, durable output paths, and outstanding validation limits. The workflow also includes a synthetic inclined-bed outlet case to check wet-to-dry behavior. Use a new empty directory for each run; preparation refuses to overwrite previous evidence.
