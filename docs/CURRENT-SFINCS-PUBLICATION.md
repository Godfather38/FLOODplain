# Current SFINCS publication contract

The existing `routes.html` now reads `data/current-sfincs-manifest.json` at opening and during its one-action five-minute refresh. The committed file deliberately says **unavailable**: no current hydraulic output has yet been published. Historical artifacts are never a fallback. This adds no page, backend, workflow or solver.

## Solver-owner handoff

Publish the gzip output in `public/simulation/data/`, then replace the manifest **last**, after the immutable output is present. Manifest schema:

```json
{
  "schemaVersion": 1,
  "kind": "current_inundation_manifest",
  "status": "complete",
  "runId": "<same as output provenance.runId>",
  "issuedAt": "<actual publication/forecast issue, explicit UTC>",
  "sourceAsOf": "<completed forcing snapshot time, not after issue>",
  "validFrom": "<first supported forecast valid time>",
  "validTo": "<last supported forecast valid time>",
  "artifact": {"path": "data/<immutable-run>.json.gz", "sha256": "<original gzip SHA256>"},
  "outputQuantity": {"name": "cell_average_depth", "units": "m", "definition": "Water volume divided by full grid-cell area; not road or channel depth"},
  "assumptions": ["<actual geometry/date, input forecast sources, losses, initial-state and boundary assumptions>"],
  "crossings": [{"crossingId": "<existing failure-point ID>", "status": "supported_neighborhood", "cellIndex": 0, "evidence": "<actual export mapping/footprint basis>"}]
}
```

The existing output geometry/frame envelope remains `schemaVersion:1, model:SFINCS, kind:inundation_scenario, status:complete`, EPSG4326 cells and timestamped depthM arrays with missing cells null. This reuses the existing structural reader; **forecast semantics come from matching provenance**, not relabeling a scenario. Required additional `run.provenance.forecast`:

```json
{"inputRole":"forecast","issuedAt":"<identical to manifest>","validFrom":"<identical to manifest>","validTo":"<identical to manifest>"}
```

Preserve existing solverVersion, runId, inputArtifacts, support and uncertainty fields. Every frame must have an explicit timezone; frames must cover the declared valid window. Do not create historical validation fields or claim observed forcing was a future forecast. `sourceAsOf` and individual source issue/valid times belong in provenance/assumptions; no replacement of older source issue dates by publication time.

Only `cell_average_depth` is currently supported for this viewer; a different native/downscaled quantity needs an explicit compatible contract rather than silent relabeling. The current map/time slider, source details and original download share the one-screen app. Expired or stale output remains clearly labeled context, not usable current ranking. The existing 24-hour issue freshness policy is a display/decision policy, not an accuracy guarantee.

Crossing mappings are optional for map display. Without them, current model output does not affect routes. A supported-neighborhood entry requires the actual cell index and mapping evidence; the app independently checks the cell is within the existing150m neighborhood policy. This supplies modeled nearby water concern, not roadway inundation or bridge clearance. Unmapped crossings remain unsupported. Model-dry cells never clear observed danger or official closure. Historical and current evidence coexist separately.

## Verification status

Unavailable-state loading and rejection of a real historical artifact as current are checked. No current output was fabricated for the app. Actual produced current-run checksum, quantity, time coverage and display remain to be verified when the solver owner publishes it. Existing observations, closures, HAND and historical controls continue independently.


## Native current-run publisher

Owner: app thread; file `tools/simulation/publish_current_sfincs.py`. It does not modify model preparation or execute SFINCS. Uses existing xarray/NumPy/pyproj environment and native `sfincs_map.nc` readers, without a historical target gauge.

```text
python tools/simulation/publish_current_sfincs.py <completed-run-directory> --config <publication.json> --destination public/simulation/data
```

The solver owner supplies `publication.json` with actual values (no generated sample forecast):

- `inputRole: "forecast"`, `nativeTimeZone: "UTC"`, `runId` (letters/digits/underscore/hyphen), `solverVersion`.
- Explicit timezone timestamps `issuedAt`, `sourceAsOf`, `validFrom`, `validTo`; publication issue must follow completed source acquisition. Individual provider issues remain under `sourceMetadata` and input provenance.
- `projectedCrs`, `verticalDatum`, positive constant `cellAreaM2`, `domainDescription`, nonempty `assumptions` documenting actual geometry/initialization/forcing/losses.
- `inputArtifacts: [{path,sha256,...}]` relative to completed run directory, copied from real preparation records. Every file is verified. Extra provenance fields are retained.
- `activeMaskNpy`: relative NumPy boolean mask in exactly native spatial dimension order; include its artifact hash. This avoids treating inactive/dry cells as interchangeable. Output cell ordering follows row-major active-mask order.
- Optional `mapFile` (default sfincs_map.nc), `logFile` (default solver.log), `negativeVolumeToleranceM3` (default0; owner must justify any nonzero tolerance in assumptions), `uncertainty` (default not_quantified/null), `crossings` as above. Crossing indices refer to the exported active-cell ordering; no automatic unsupported route mapping.

Native `subgrid_volume` must have m3 units. The publisher divides by full cell area to produce cell-average depth. It deliberately refuses native `h` as a substitute because subgrid h may mean depth above cell minimum. Native missing values become null; negative volumes beyond declared display tolerance reject export. Within tolerance they are clamped only for display, with raw minimum/tolerance recorded. Native output must include exact valid endpoints; historical warmup frames outside the forecast window are omitted.

Outputs are immutable `<runId>.json.gz`, `<runId>-provenance.json`, then atomically replaced `current-sfincs-manifest.json` last. Raw NetCDF, preparation inputs, export config and active mask hashes are retained. Existing output filenames are never overwritten. No validation/accuracy scores are fabricated.

`--diagnostic` writes `diagnostic-sfincs-manifest.json`, removes forecast provenance and marks the output diagnostic. It cannot overwrite the current manifest. Normal mode refuses expired output. The available archived regular-grid reference file lacks subgrid_volume and is correctly rejected rather than relabeled; successful native-volume export and app acceptance await the primary worker's actual current volume output. Python syntax and actual archived-file rejection were checked; no solver rerun or current artifact was fabricated.


## Frozen-input simulated live operation

User-selected mode: retain the completed2026 forecast package permanently and stop source refreshes. Publish its real solver output with `--simulated-live`. This preserves original source/issue/valid timestamps, sets matching `executionMode: simulated_live_frozen_inputs` on manifest/output and starts the existing time slider at validFrom. Moving the slider is the explicit simulated clock; the frame label states frozen inputs/not current weather. This is the new2026 run, not the2013/2014 diagnostics. Expired validity is allowed only in this explicitly labeled mode. No dates are shifted to today. Its evidence status is simulated_live, so it is not silently mixed into current route ranking. Existing live observation controls remain separate and user-triggered.

The retained input package is `current-inputs-catchments-20261101-refresh`, commit c65fa35. No further acquisition is required to replay it. The normal current manifest remains unavailable until actual native output is exported; no fabricated replay artifact is included.


## Actual frozen2026 run published

Workflow41327417204, input commit6285d6f: the existing viewer now loads `frozen-20261101-nwm13z-41327417204.json.gz`. Native computation covered63 hours/64 frames; display exports only the15 hourly forecast-window frames17Z November1-07Z November2 over29,685 active cells. Original NWM13Z/HRRR14Z issues remain in source metadata; publication time is separately recorded. No input refresh or solver rerun occurred.

Actual native output omitted time-varying volume. `reconstruct_sfincs_display.py` applies SFINCS's existing `compute_initial_subgrid_volumes` stage/storage relationship to native zs and saved z_level/z_volmax tables, including its0.001m interpolation denominator floor and full-cell extension. This is display reconstruction, not new hydrology or an exact copy of internal native storage. The native sfincs.ind ordering was checked against the mask. Missing water levels stay null. Native maxima are not substituted for time-varying frames. Depth remains full-cell average, not road/channel depth. No explicit crossing mapping has been asserted.

Attribution and the ODbL derived retention database/grid are included under `public/simulation/data/frozen-20261101-attribution/`. The app reader accepted the actual gzip as simulated_live with15frames/29685cells. Browser interaction remains unavailable under the earlier restriction; no visual success is claimed.

Launch `npm run start:experimental`, open `/simulation/routes.html`, expand the SFINCS map and move its simulated clock slider. It loads the frozen output without acquiring new weather. Original live assessment is a separate explicit button. No main merge or production deployment.


## Map-mode test interface

The same `/simulation/routes.html` opens with a responsive HAND / 2D model / Aggregate map, independent rain/river-flow/flooding/route-crossing controls, playback, local inspection and full-domain/HAND-window framing. It uses the existing canvas map approach and unchanged pinned HAND engine. HAND uses retained RFC points at the selected frame; 2D uses actual2026 output. Rain is retained HRRR14Z; river symbols show four NWM13Z inlet discharge magnitudes in m3/s, not velocity arrows. The final07Z frame has no following rainfall interval and says unavailable.

Aggregate displays separate estimates and existing closure/observation fusion. Saved observations become stale at playback time; no fresh route recommendation is fabricated. 2D lacks explicit verified crossing mappings and remains map/context evidence. Route markers are configured crossings, not invented road polylines. Comparison describes spatial disagreements rather than averaging unlike depths. Live-source controls are collapsed separately and are never automatically refreshed by this map.

Actual-data checks: both HAND windows produce masks at all15 playback times; rainfall has14 nonoverlapping intervals; four existing routes load; actual2D contract accepts29685cells/15frames. Module imports bundle successfully. Browser visual QA remains restricted and was not claimed.
