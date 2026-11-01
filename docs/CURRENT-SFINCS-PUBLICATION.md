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
