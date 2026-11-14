# Saved wider-domain design-storm display packages

`build_display_packages.py` packages completed native output for the isolated test
app. It never runs SFINCS, changes forcing, reuses saved water, publishes anything,
or writes to live-data refs. `stress` and `extreme` remain the original selector IDs.

## Run

```
python tools/scenarios/build_display_packages.py --source NATIVE_ROOT --saved SAVED_ALL_ROUTE_13Z --out NEW_DISPLAY_ROOT --forcing-root FORCING_ROOT
```

Required inputs, for each scenario `stress` / `extreme` and each case `northern` /
`picture-rocks` / `gates`:

- `NATIVE_ROOT/SCENARIO/CASE/compact/manifest.json`
- `geometry.bin.gz`, every `frame-N.bin.gz`, `road-forecast.json`, and
  `scenario-case.json` in the same compact folder.
- `SAVED_ALL_ROUTE_13Z/package.json` and each case's `cells-web.bin.gz` and
  `cells-full.bin.gz` from the existing saved all-route display package.
- Optional `FORCING_ROOT/SCENARIO/CASE/sfincs.dis`. If `--forcing-root` is supplied,
  all six files must exist and each exact byte hash must match the completed
  case's `modifiedInputSha256["sfincs.dis"]`. The target column must match the
  pinned registry inlet. Non-target inlet curves are not invented or summed.

`--registry` defaults to `tools/live/all-route-cases.json`. `--scenarios stress`
can build only that complete three-case package, but the default builds both.
Existing output scenario folders are refused, not overwritten or deleted.

Every case must be the pinned mesh, a clean completed synthetic native run, and
have all 57 quarter-hour frames from 2026-11-01 17:00Z through 2026-11-02 07:00Z.
All requested cases must come from one preview workflow run. Missing, partial,
live, wrong-scenario, wrong-face-order, stale-hash or mixed-run input is rejected.
All native frames are validated before any output is written. `package.json` is
written last as a completeness marker. Failed partial folders are never promoted.

## Output and provenance

The output contains `all-route-stress/` and `all-route-extreme/`, each with:

- `package.json`: `floodplain-all-route-web/v1`, `live:false`,
  `executionMode:"synthetic_design_storm"`, original scenario ID, return-period
  label, actual historical scenario clock, forcing, limits and all three cases.
- `route-points.json`: exact float32 native route series; regular `depth` and `zs`
  are null for invalid native volume. `nativeVolumeM3`, `nativeDepthM`, and
  `nativeWaterSurfaceM` preserve signed residuals/raw values. Nonfinite native
  samples become JSON null, never NaN, Infinity, or invented zero.
- Per-case exact saved `cells-web.bin.gz` / `cells-full.bin.gz` and new
  `web-N.bin.gz` / `full-N.bin.gz` frames.
- Per-case byte-exact `native-manifest.json`, `scenario-case.json`,
  `road-forecast.json`, and optional `sfincs.dis`, each with an output hash.

Every native geometry file is hash-checked against the pinned registry, then its
face IDs, centres, resolutions and areas are checked against saved full geometry.
The web keep/join mapping, complete block area, route-cell identity and every
retained/aggregated overlap flag are checked. Saved cell bytes are then copied
unchanged. `geometrySource.sourceCommit` describes only that reused geometry;
source frame/manifests and their hashes identify the new native storm water.
`nativeGeometry` is a source descriptor, not a new file in the display folder.
No historic overlap-water comparison is copied into the new scenario metadata.

Map depths follow the existing volume/full-cell-area rule and 5 mm sparse listing
threshold. Sparse depths use rounded millimetres and cap at 65.535 m, as before.
Route arrays preserve native float32 precision. Native negative residuals are not
clipped or changed; their raw values remain available and they are unknown for
map queries. Blocks with any unknown member are unknown rather than averaging
missing water as zero. Unknown cells are omitted from water painting, which is
not evidence that they are dry.

## Backward-compatible unknown-cell extension

FPQW frame headers add `unknownCells`, a nonnegative integer (absent means zero
for old packages). The existing body still starts with `listed` uint32 deltas,
`listed` uint16 depths, padding to four-byte alignment, `routeCells` float32
route depths and `routeCells` float32 surfaces. Then append `unknownCells`
sorted unique uint32 display-cell indices. They do not overlap listed wet cells.

For existing decoder variables `L = header.listed`, `rc = header.routeCells`:

```
ro = 6 * L + ((-2 * L) % 4 + 4) % 4
unknownOffset = ro + 8 * rc
unknown = new Uint32Array(body, unknownOffset, header.unknownCells || 0)
```

Consumers must range-check these indices and return depth null when a queried
cell is unknown. Do not interpret every absent sparse cell as dry. IEEE NaN in
FPQW route arrays remains the established binary missing-value representation;
no JSON output contains nonstandard numeric tokens. A finite zero volume with a
missing dry-sentinel surface remains known depth zero and unknown surface.

## Forcing UI contract

`package.forcing.frames` has 57 entries:

```
{ "time": "2026-11-01T17:00:00Z", "rainMmH": 0.0, "inflowM3s": null }
```

Match by exact ISO frame time. Null is unavailable, never zero.

- `forcing.rain.samples` preserves every supplied `{time, elapsedSeconds,
  mmPerHour}`. Frame values linearly interpolate between supplied samples only.
  The source series ends at elapsed hour 62, so frames after that sample are null
  rather than extrapolated. The package records modified precipitation hashes.
- `forcing.inflow.byCase[CASE]` records `targetReachId`, `designPeakM3s`, exact
  supplied `samples:[{time,elapsedSeconds,flowM3s}]`, `available`, and an
  `unavailableReason` when necessary. With verified forcing files, Northern's
  actual Santa Cruz series is available; areas without that inlet say so.
- Every `forcing.inflow.byCase[CASE].inlets` entry preserves one actual native
  source column: `reachId`, `column`, `eastingM`, `northingM`, `crs:"EPSG:32612"`,
  `role:"design_santa_cruz"` or `"unchanged_baseline"`, `label`, `samples`,
  `available`, and the verified `sourceSha256`. Marker locations come directly
  from the pinned native registry. Samples cover the scenario window. Verified
  zero baseline flows are real zeros. If forcing files are omitted, locations
  remain known but samples are empty/unavailable. Do not sum or merge colocated
  reaches or overlapping cases. Generic labels name the NWM reach; they do not
  invent river names.
- The single frame `inflowM3s` represents the Santa Cruz design inlet, not all
  river inflows or a sum across overlapping cases. Label it accordingly.
- Without verified discharge samples, inflow is null, even if peak metadata
  exists. A peak is never reused as a per-frame value.
- Linear interpolation is supported by the pinned SFINCS
  `f3647fc0289bb15cb2512d60686cef74cb853c78` source:
  `source/src/sfincs_discharges.f90:update_discharges` and
  `source/src/sfincs_meteo.f90:update_meteo_forcing`. Source links are included in
  package metadata. Interpolated chart values are input readouts, not observations
  or native water results.

The source scenario's limitations and mixed-vintage Gates terrain warning remain
visible. Return period describes imposed rainfall, not a calibrated joint flood
probability. Build/export timestamps do not make the scenario current conditions.

## Tests

```
python -B -m unittest discover -s tools/scenarios -p test_display_packages.py -v
```

Tests use small, temporary, explicitly synthetic software fixtures, never fake
hydrologic results for publication. They cover exact geometry/routes, frame
hashes, forcing hashes, complete clock, invalid/missing/live inputs, mixed native
runs, face order, overlap flags, signed residuals, missing cells/blocks, dry
sentinels, JSON validity, and existing-output refusal. Passing fixtures is not a
substitute for building and checking the six actual native job outputs.
