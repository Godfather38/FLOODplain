# Current forecast pipeline: implementation design

Status: design only, 2026-11-01. Solver branch `fec8846`; app interfaces inspected at `dcb11ab`. No new model execution, terrain substitution or calibration. Intended deliverable is a current, time-varying river inundation prediction connected to the existing one-screen app. The live provider display is already usable, but it is not completion of that solver deliverable.

## What exists, and what remains

| Component | Available implementation/data | Remaining dependency |
|---|---|---|
| Observations and forecasts | App `observations.js`; `forecast-engine.js:createForecastEngine().predict()/ensemble()` for RFC/HEFS; `nwm-context.js:normalizeNwm()/fetchNwmContext()` | Export one immutable issue-consistent boundary package for the solver; current helpers are app context, not all domain boundary inputs |
| Topology | Verified NHD/NOAA river paths and reach identifiers; official HydroMT river-source selection | Map every actual domain inlet to its forecast reach and contributing area; establish direction, reach-version crosswalk and no duplicated inflow |
| Terrain/model | Professionally prepared 2021 terrain candidate; complete study GIS POST archive: 168 cross-sections, 126 domain BFE contours | Obtain adequate professional channel/structure package, dates, datums, losses/roughness and boundary definitions. GIS water-surface/bed scalars are not full geometry. County native package is optional; sufficient professional public layers are the alternative |
| Rainfall | Historical Stage IV import; `storm_forcing.py:load_forcing`; live `qpf-context.js` handles one NWS cell | Complete spatial future-rainfall coverage with interval semantics; one cell must not become uniform whole-domain rainfall |
| Solver | Saved pinned SFINCS executable, existing Linux workflow, HydroMT-SFINCS 1.2.2 | Adapt input preparation to current forcings and received professional geometry; no new engine/build |
| Export and app | `export_reach.py:export`; `inundation-contract.js:acceptInundationRun`; `route-fusion.js:sfincsEvidence()/fuseRoutes`; `routes-app.js` | Remove historical-only exporter assumptions through a separate current-case entrypoint; automatic current-manifest loading and explicit output depth semantics |
| Acquisition | `export_professional_data.py` standard POST, raw batches/hashes, completeness checks | Native model files are not present in these services; no inferred profiles or dimensions |

## Ordinary public inputs and the next implementation slice

The public [Pima catalog](https://gis.pima.gov/DataPortal/AllPortalLayersIframe.cfm) supplies ordinary metadata, REST and download links. Reuse [Wash Network](https://gisopendata.pima.gov/datasets/wash-network), [Hydrologic Soils](https://gisopendata.pima.gov/datasets/hydrologic-soils-group-map), [PC-HYDRO vegetation](https://gisopendata.pima.gov/datasets/vegetation-map-for-pc-hydro-modeling), and [HUC polygons](https://gis.pima.gov/data/contents/metadet.cfm?name=hucs). Filter HUC TYPE to one level before treating polygons as disjoint. Researchers already exported 414 soil polygons and 5,543 vegetation features; reuse their bytes rather than repeat bulk downloads.

These are professional components for standard import, not manual blueprints. Wash/NHD networks support topology; 2021 GeoTIFF supports terrain; complete structure attributes support native structure methods. Soil groups and vegetation classes can feed existing documented HydroMT parameterization only with a verified class mapping and required parameters: PC_HYDRO vegetation class is not automatically Manning roughness, and soil group alone is not a complete infiltration configuration. The dates of surveys, studies and service edits remain distinct. Age alone does not make a network unusable or a terrain suitable; assess the particular modeled feature and known changes.

**A complete native-model ZIP is useful, not a universal prerequisite.** The model manifest can instead describe sufficient professional public layers imported through supported HydroMT methods. Missing transverse profiles or structure dimensions matter only where the chosen representation actually requires them; do not declare all public inputs unusable because a native archive is absent. Do not invent required values to conceal a specific gap.

**Next coherent implementation slice:** create one immutable current-forcing package from existing gauge/RFC/NWM adapters, a topology-linked inlet registry, and full-domain precipitation acquisition, sharing one domain and issue time. Populate the professional-input manifest from the ordinary catalog and existing exports. Report overlap/coverage and genuinely unresolved physical fields together. These adapters can be built now without waiting for a county ZIP. Execute the hydraulic case when this standard setup has its required inputs; no custom runoff equations or arbitrary terrain changes.

The detailed references below to a professional package include this sufficient-public-layer route. County delivery is not the only path and does not block adapter development.

## One coherent execution path

```text
professional model package OR sufficient public layers + prepared terrain
        -> standard supported HydroMT geometry/structure inputs (versioned once)
verified directed river topology -> unique domain inlet registry
gauges + one selected RFC/NWM issue per inlet -> discharge series
full-domain forecast precipitation + professional loss configuration
compatible initial/restart state
        -> immutable current-case inputs -> saved SFINCS executable
        -> native NetCDF + checks -> versioned map/series/crossing evidence
        -> existing routes.html assessment, with issue/valid time and limitations
```

A county HEC-RAS project is not automatically a SFINCS project. Inspect it in its native version, retain supplied terrain, structures and full geometry, and use supported exports/imports where available. Confirm representation compatibility before promising a conversion time. An unsupported structure/geometry transfer is an explicit dependency, not permission to reconstruct it from summary maps. PC-HYDRO can supply documented design-storm local runoff scenarios; it is not the live-rainfall/mainstem engine and does not enter this forecast path as a substitute.

## Boundary and rainfall accounting

Use installed HydroMT `SfincsModel.setup_river_inflow(rivers=..., keep_rivers_geom=True)` with professionally defined domain and verified upstream-to-downstream NHD lines. It identifies domain entries, can move sources toward nearby confluences, modifies nearby boundary mask cells, and initially assigns zero discharge. Therefore retain and inspect its actual generated coordinates and reject any source still lacking a matched time series; do not accept default zero as a forecast. Use professional inlet widths/boundary configuration rather than the helper's generic 500 m width. `setup_discharge_forcing(timeseries=..., locations=...)` takes matching integer source IDs and m³/s series. The helper does not prove NWM reach equivalence or eliminate cumulative-flow duplication.

Create a registry with source ID, projected XY, original intersection, reach ID and network version, provider station/series, flow direction, contributing-area identity, source-placement adjustment and evidence. Select one source per external contributing branch. Never inject both an upstream mainstem flow and its downstream cumulative flow. A reach entering, leaving and re-entering a domain needs explicit treatment; do not count it twice. A forecast reach spanning the boundary may include in-domain drainage; require an aligned boundary/catchment cut or a professional coupling rule before treating that discharge as exclusively external. Nearest-gauge matching alone is insufficient.

At Cortaro use an RFC forecast only if its location matches the modeled inlet; elsewhere use mapped NWM reach forecasts where supported. Do not use the downstream Trico target forecast as a second inflow. Do not difference cumulative hydrographs to manufacture lateral runoff. RFC and NWM are alternative boundary sources, not additive contributions. HEFS marginal quantiles are not coherent spatial ensemble members: do not independently combine high quantiles at several boundaries or call resulting depths a calibrated interval.

Apply gridded rainfall only to explicitly modeled local contributing land, with the professional model's documented loss/storage treatment. External watershed runoff is already represented by inlet hydrographs. Exclude local areas already represented by injected cumulative discharge, or stop preparation if that partition cannot be established. Conversely, do not omit local runoff silently. Retain source precipitation and loss metadata; do not reuse the historical zero-infiltration assumption for a current forecast. The minimal full mode includes all required disjoint boundary flows and the local rainfall contribution. A river-only mode is permissible only when its narrower physical scope and treatment of local contributions are explicitly justified, not as an unannounced shortcut.

## Time, units and initial state

- Store forecast issuance, retrieval, observation time, valid start/end and native cadence separately in UTC. Preserve observed/forecast flags. Use only data available by the run issue; no future observations.
- Discharge is m³/s (`cfs * 0.028316846592`; kcfs additionally *1000). Stage requires a known gauge datum before becoming an absolute boundary elevation. Never treat gauge height in feet as NAVD88 metres.
- HydroMT `setup_precip_forcing_from_grid` accepts interval accumulation in mm or rate in mm/hour. Set `cumulative_input`, `time_label` and interval boundaries from the provider metadata, preserving interval volume. Native forcing uses rate over the upcoming interval. Temporal interpolation must not imply finer forecast skill; missing intervals remain unavailable.
- Run only through the common valid coverage of all required inputs. Keep provider freshness rules explicit. No held-last-value extension across missing forecast coverage.
- Prefer a compatible saved state at run start from the same geometry/parameters and continuously forced predecessor. Otherwise initialize using the professional model's documented initial-state procedure plus observed antecedent inputs. Required duration is not an arbitrary fixed spinup. `prepare_reach.py` presently restores only water levels through `zsini`, not a full velocity restart; it must not be called a complete hotstart. No reuse of its historical dry-start defaults.

## Concrete adapter work and dependency order

1. **Model intake:** version the native package OR sufficient public professional layers and standard exports under a model manifest containing acquisition dates, CRS/vertical datum, structures, roughness/losses, domain and supported initial/outlet conditions. Stop at genuinely missing fields. Existing acquisition command remains the source archive entrypoint.
2. **Proposed `tools/sfincs/prepare_current.py`:** `select_boundary_sources(model, topology)` writes the audited registry; `normalize_forcing(snapshot, registry)` validates UTC/m³/s and coverage; `prepare_current(model_manifest, forcing_manifest, state_manifest, output)` uses official HydroMT methods. These functions do not exist yet. Keep historical `prepare_reach.py` intact as evidence.
3. **Proposed current snapshot export in existing app tools:** reuse `createForecastEngine`, `normalizeNwm`, observation normalizers and complete spatial QPF acquisition. Write source bytes/hashes and provider issue metadata. No new runoff model. Extend the one-cell QPF adapter only after a supported full-domain product is selected.
4. **Existing `.github/workflows/sfincs.yml`:** add a current-case input path and reuse the pinned saved executable. Do not rebuild. Hash input/model/state/issue tuple to avoid duplicate execution; invoke for a new complete forcing issue, not every five-minute UI refresh. Confirm artifact availability before dispatch; no silent compile fallback.
5. **Current export entrypoint beside `export_reach.py`:** retain native completion/unit/hash/budget checks, but remove the requirement for historical target observations and hourly historical windows. Export issue/validity/model version/state provenance and the existing v1 inundation fields. Publish an immutable run manifest, then update the current pointer only after complete validation. Failed refresh leaves old output visibly stale.
6. **App:** extend the existing historical loader pattern for a current manifest, pass validated frames to `sfincsEvidence` and existing fusion. Keep closure precedence and unknown/stale handling. Crossing extraction records geometry/support, model cell footprint, time and quantity; it does not interpret coarse cell-average depth as surveyed road-deck depth.

Existing subgrid exports use cell-volume/full-cell-area for display. That is an equivalent mean depth, not channel depth or water depth over the roadway. Current outputs must state this quantity or provide a supported native/downscaled water-surface product tied to professional road elevations. Nearest-cell matching cannot manufacture crossing clearance. Add explicit crossing support status where this comparison is unavailable.

## Minimal delivery and effort bounds

Before a complete current case is assembled: existing one-screen live RFC/NWM/HEFS/observations/HAND display, historical solver artifacts, working professional-data acquisition and adapter development can operate. This does not complete current SFINCS inundation prediction. Once standard professional inputs support the setup and source partition/initialization are settled: one deterministic current forecast issue, one mapped domain, complete forcing horizon, saved-engine execution, map/time series/crossing support output in the same screen. No new model stack or paid service is needed for that engineering path.

Conditional engineering estimates, not delivery promises: boundary/current forcing adapters 4–8 focused hours once sources and semantics are fixed; current-case runner/export and app connection 3–6 hours once a ready SFINCS-compatible model/state is supplied. Full-domain QPF acquisition and native HEC-RAS transfer cannot be bounded yet because product/format compatibility is unresolved. County delivery time is unknown. Measured historical solver runtime was 105 seconds for 96 hours and 537 seconds for 432 hours on the existing runner; queue/download/setup time is additional and a different professional grid may cost more. Do not extrapolate an exact current runtime before its model size is known.

No accuracy tolerance is invented here. Define the intended decision, horizon, flow/timing errors and treatment of missed events before accepting data or presenting performance. Existing N=2 historical diagnostics with mismatched-era geometry do not give a current calibrated error margin. Provider ensemble spread is not total inundation uncertainty. These are unresolved product/performance requirements, separate from specific missing physical attributes and adapter tasks; absence of a native ZIP alone is not a blocker.

## References checked

- Installed HydroMT-SFINCS 1.2.2: `sfincs.py` methods `setup_river_inflow`, `setup_discharge_forcing`, `setup_precip_forcing_from_grid`; semantics checked directly against the installed implementation.
- Official [river inflow API](https://deltares.github.io/hydromt_sfincs/stable/_generated/hydromt_sfincs.SfincsModel.setup_river_inflow.html) and [discharge forcing API](https://deltares.github.io/hydromt_sfincs/stable/_generated/hydromt_sfincs.SfincsModel.setup_discharge_forcing.html).
- Existing repo `PREPARED-DATA-ACQUISITION.md`, `PUBLISHED-CHANNEL-RESULTS.md`, `FORECAST-ENGINE.md`, `inundation-contract.js` and actual adapters named above. Some older app prose predates completed solver integration; inspected code and committed artifacts determine current availability.

