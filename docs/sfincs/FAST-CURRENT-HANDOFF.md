# Faster current SFINCS path and ownership

The geometry/SFINCS workstream owns terrain, route/dip coverage, resolution, physical configuration, current forcing, execution and actual native output. The 2D owner retains the complete map, water layers, cell shading and UX; the 3D owner provides model visualization. A completed renderer, HAND-only view or historical replay does not complete the current SFINCS product. Missing integration must remain on the checklist rather than narrowing the requested product.

## Ready, already executed components

- Coarse physical model: 29,685 active 100 m cells, seven directed outflow cells; local `.sfincs-runs/aligned-2021-model/`. Professional 2021 terrain with the verified 2023 northern edge, existing WorldCover roughness and qualified GCN10 retention. No new survey, terrain build or calibration is required to reuse it.
- Portable, already executed native input: `tools/sfincs/data/frozen-current-20261101-13z.tar.gz`, 7,176,793 bytes, SHA256 `3b0d7cc299b35e12dce4525a7d9ae3cee39c716ccaf3858bd7531aad0e7e7508`. This supplies physical files and a reproducible old case, NOT current forcing. Preserve its source notices.
- Prior measured native runtime: 13.59 seconds for the complete 63-hour case in run 41327417204. This is evidence for a small bounded run, not a guaranteed runtime for different forcing.
- Existing saved engine: Actions run 41290378239, artifact `sfincs-engine`, source f3647fc0289bb15cb2512d60686cef74cb853c78. No source build or solver replacement.
- Existing successful result: `tools/sfincs/data/frozen-result-20261101-13z/manifest.json`. Its NWM 13Z / HRRR 14Z issues remain frozen; do not relabel it as a fresh current forecast.

## Exact current inlet and rainfall interface

Reuse `tools/sfincs/data/catchment-coupling/boundary-registry.json` and its active catchments. The four external NWM reaches are 15902351, 15902361, 15902409 and 15902411. Their receiving reaches are 15890430, 15902363, 15903137 and 15903137 respectively. Do not substitute interior Cortaro gauge/reach flow or the rectangular-domain inlet 15902419. Existing catchment partition evidence avoids double counting supplied upstream flow and rainfall inside the active domain.

Registry bounds are EPSG:32612 [467700, 3572300, 499700, 3606900]. Use the registry-aware footprint check in the existing rainfall finalizer; a convenient padded acquisition box is [-111.35, 32.28, -111.00, 32.61]. HRRR remains a native 3 km forecast product regardless of the reporting raster spacing.

Existing app-owned acquisition modules on `experiment/avra-radar-runoff` are `tools/simulation/build_current_inputs.py`, `extend-current-boundaries.mjs`, `finalize_current_inputs.py`, `build_initialization_rainfall.py` and `resolve_initialization_rainfall.py`. Reuse them with a NEW acquisition directory and the four-inlet registry. The initial provider snapshot alone is not a complete four-inlet package; the registry extension must finish. Use one coherent actual issuance and preserve all original provider timestamps and missing values. Do not copy an old cache into a new directory and call it current.

The solver assembler consumes:

- `boundary-snapshot.json`, `analysis-history.json`, `initialization-context.json`;
- `precipitation.nc` and `precipitation-metadata.json`;
- `initialization-rainfall/resolved-analysis-precipitation.nc` and `resolved-analysis-metadata.json`;
- `initialization-rainfall/forecast-transition-precipitation.nc`.

The normalized flow series use explicit UTC and m3/s. Precipitation is nonoverlapping hourly mean mm/h with explicit interval endpoints and CRS. Existing `prepare_current_history.py` joins native analysis, transition and forecast timestamps without inventing gaps. The first run uses the documented antecedent evolution from an assumed initial dry state; that is not a measured hydraulic state or demonstrated spin-up convergence. Type-1 restarts do not preserve cumulative CNA accounting, so do not blindly reuse the old final restart as a full current state.

## Assembly, bounded execution and export

From the solver checkout and existing environment:

```text
python tools/sfincs/assemble_current_case.py --model .sfincs-runs/aligned-2021-model --package NEW_COMPLETE_PACKAGE --registry tools/sfincs/data/catchment-coupling/boundary-registry.json --output NEW_NATIVE_CASE
python tools/sfincs/package_current_case.py NEW_NATIVE_CASE tools/sfincs/data/NEW_VERSIONED_CASE.tar.gz
```

The existing assembler now requests `storezvolume=1` and `storemeteo=1` so the next coarse result retains actual native volume and meteorology. This changes requested output, not geometry or physical equations. The previously executed archive is unchanged. The assembly command has now been run against the newly acquired current package; see the completed delivery below.

Use the existing saved-engine Actions workflow with that exact new archive and a **120-second native timeout**, not the refined case's 2,400-second budget. Allow ordinary runner setup and artifact upload separately. That bounded current execution completed in run 41350254061; see the actual outcome below. Change the actual native timeout before dispatch rather than relying on a description. No paid service, rebuild, main merge or production deployment is part of this path.

The app-owned exporter is `tools/simulation/publish_current_sfincs.py`, described in `docs/CURRENT-SFINCS-PUBLICATION.md`. It consumes the completed regular-grid native output, source hashes, exact active-mask ordering, source issue times and actual valid interval. Prefer the newly requested native volume field; never substitute `zs - minimum terrain` as road depth. Publish immutable output before its manifest, and retain missing surface values. The 2D and 3D owners integrate these outputs into their full existing product, not a substitute page.

## Current completion checklist

- [x] Existing coarse geometry, parameter files, saved executable and fast successful replay available.
- [x] Exact four-inlet registry and current-input assembly/export interfaces identified.
- [x] Native volume/meteo output enabled for the next coarse assembly.
- [x] Refined 63-hour result preserved separately at `tools/sfincs/data/road-result-41344983607/`.
- [x] Acquire and retain one genuinely current complete four-inlet + spatial rainfall/history package (UI/data owner commit f234d23).
- [x] Assemble a separately versioned current coarse case using those actual inputs (d7c41d5).
- [x] Execute one bounded fast case and inspect its actual interval and output quantities (41350254061; 23.26 seconds).
- [ ] Integrate current SFINCS, HAND, observations and the full map/UX; retain source-specific timestamps.

The coarse model does not gain the refined model's road coverage by reuse: its original audit supported 19 of 60 crossing records and excluded Los Robles/North Trico and Brawley/Avra Valley. Keep those locations unknown in the coarse current layer; the separately completed refined replay covers them. Do not hide this difference or claim either model has validated road-depth accuracy.


## Actual current run delivered

Run 41350254061 completed the full 63 hours in 23.2578 native seconds, inside its 120-second cap. The new source package uses NWM 18Z and HRRR 19Z, acquired at approximately 21:03 UTC on November 1. Its 15 hourly forecast frames cover November 1 22:00 through November 2 12:00 UTC. No simulated-live option was used for the current publication. The prior refined output remains preserved independently.

The unchanged index, active mask, subgrid and infiltration files match the original fast model byte for byte. All 445,275 active-cell forecast volumes are finite and nonnegative. Native water surface has 105 undefined samples, preserved in the raw output. Native volume divided by full cell area ranges from 0 to 16.116 m; the upper value is modeled storage, not road depth or validated accuracy. No river-section discharge was recorded.

The current handoff is `tools/sfincs/data/current-coarse-result-41350254061/manifest.json`. Its portable native archive includes new zs/volume output, exact active mask, all retained restart files, source notices and `publication.json`. The `publication/` subdirectory contains the immutable current v1 artifact, provenance and current manifest. The 2D owner must regenerate its terrain-supported water footprints from the new native water levels, then complete the full current map/UX integration. That final UI checkbox remains open in this simulation-owned checklist until the UI owner confirms it.

The duplicate rainfall collection started before the UI/data handoff arrived was interrupted at forecast hour 14 and was not consumed. The complete package supplied by the data owner was used unchanged. No source refresh loop, new mesh, additional solver build, recurring job, main merge or production deployment occurred.
