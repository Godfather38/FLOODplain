# Road-dip model scope and implementation

This is a new prepared mesh, not a completed or validated hydraulic model. The frozen simulated-live result at dec86fe remains unchanged.

## Selected coverage

Use the complete existing `trico` and `avra` routes: North Trico Road, Trico-Marana/Marana route, and Avra Valley Road through Brawley and Santa Cruz. Route geometry comes from app commit929ff13994f68565f88931feb79de1b58cda6317. Refine the entire route length, not only mapped water crossings, so unnamed depressions are not filtered out. This first scope does not claim every Avra Valley or El Tiro road.

Eleven public NHD catchments intersect the 500m road neighborhoods (423.05km2). Union with the retained Cortaro-Trico catchments gives 13 catchments and483.13km2. `active-domain.geojson`, `target-routes.geojson`, and `refinement-zones.geojson` are actual prepared geometries. `boundary-candidates.json` lists14 external-to-active inlet reaches; four match the frozen case. The ten added reach IDs require verified provider crosswalks and same frozen-issue flows. In particular945050xxx NHD IDs must not be presumed present in NWM. Missing forecasts are not zero.

## Executable refinement method

Installed HydroMT-SFINCS1.2.2 has read support but its setup_grid has an unimplemented refinement TODO. Use the existing Deltares-research/cht_sfincs `build_quadtree_xugrid` and `cut_inactive_cells`, pinned8d29dcc7d4138e75001ecce1708137791cc3eb6f, GPL3. No custom mesh or runoff equations. The source was used unmodified locally; one standard dependency matplotlib3.10.7 was added, preserving numpy1.26.4.

Actual prepared active mesh:398591cells;44242at100m,1739at50m,4076at25m,171758at12.5m,176776at6.25m. Finest zone is100m either side of all selected roads;12.5m zone extends500m. Buffer widths are computational focus choices, not predicted flood boundaries. Full catchments remain active beyond them. Official mesh construction took about20s; native mesh is local at `.sfincs-runs/road-dip-refinement-v1/active-refinement-mesh.nc` (56.9MB). `prepare_road_refinement.py` reproduces the preparation using the pinned builder path.

## Inputs to reuse and obtain

Reuse the saved SFINCS executable, frozen issue times, existing mainstem topology/flows, public2021/2023 terrain provenance, WorldCover2021/official Manning mapping, and canonically licensed GCN10 scenario. Never upscale the10m raster and call it1m detail. Use actual prepared1m USGS raster windows for road zones; use coarser source-supported terrain away from roads. `terrain-catalog.json` contains40actual public catalog results, including2021and2023 products. Catalog intersection is not proof of complete1m coverage; verify relevant windows during intake. No2015 fallback.

Needed before any expanded simulation: native quadtree source/outlet placement; full1m coverage within fine zones; official quadtree subgrid/roughness/infiltration import; ten additional frozen-issue boundary series or a supported domain adjustment that preserves road coverage; expanded precipitation footprint using the archived same issue; site-linked structure openings where absent; explicit initial state. The existing forecast crop does not cover the westernmost new catchments. Do not replace missing input with guessed values.

## Quantity and bridge requirements

`planned-output-settings.json` enables native `storezvolume=1`, which the saved source already supports, rather than reconstructing cell-average depth from cell-minimum elevations. Retain water-surface elevation with datum, cell volume, timestamps, local high-resolution terrain and explicit wetting masks. Terrain downscaling describes distribution within a cell; it does not create finer independent hydraulics.6.25m flow cells with1m terrain improve road-neighborhood representation but do not establish passability or resolve an unsurveyed culvert.

`bridge-evidence-registry.json` separates deck, low chord, approaches, vertical datum, gauge-datum connection, documented site events, and actual closure records. Unknowns stay null; map bridge tags are not surveys. The September9,2014 Santa Cruz/Trico report is recorded as site-name-based historical evidence, not a measured overtopping elevation and not a Los Robles event. No generic bridge multiplier. Compare elevations only after compatible datum/units/location are established. Existing GIS clearance nulls do not justify guessed bridge geometry.

## Cost and completion criteria

No paid services or new solver build. Fine-zone source terrain is about33km2: roughly132MB of float32 elevation before compression at1m, plus surrounding coarser windows and network data. Actual total downloads depend on remote raster blocks. Native forecast output for15times at398591cells is about24MB per float32 variable before compression; full warm-up increases this.

The baseline13.59s is not an ETA for this mesh. Active cells increase13.4times and finest spacing is16times smaller; simple global-CFL scaling is about49minutes, only a planning heuristic. Wetness, adaptive timestep, I/O and subgrid build can change it greatly. First execution has a20minute wall-time budget; do not silently expand budget or reduce resolution. Mesh preparation is complete; hydraulic runtime remains unmeasured.

Completion means target routes and off-channel cells lie inside active coverage; actual1m terrain supports fine zones; every external inflow and local rain area is accounted once; native model loads with sourced parameters; a bounded run finishes; native volume/water-surface outputs and road-support masks reach the app with precise missing-structure labels. A successful process exit alone is not completion of the road-dip objective.

Sources: https://github.com/Deltares-research/cht_sfincs/blob/8d29dcc7d4138e75001ecce1708137791cc3eb6f/cht_sfincs/quadtree_builder.py ; https://api.water.usgs.gov/fabric/pygeoapi/collections/catchmentsp/items ; https://tnmaccess.nationalmap.gov/api/v1/products ; https://tucson.com/news/local/northwest/collection_2f2d6d1e-3872-11e4-9781-0019bb2963f4.html


## Connected domain update

The original candidate boundary list contained cumulative-flow overlap: external reaches 15876639 and 15876653 drain through active 15876633, then external 15876625, then active 15876621. Injecting all three would count upstream flow twice. `connected-v2` adds the official 0.208 km² intervening catchment 15876625 and replaces that cumulative inlet with its external tributary 15876641. A directed-network traversal finds no nested selected inlets after this correction. No flow subtraction or rescaling is used.

The updated domain is 483.336 km² with 398,613 active cells. The existing rectangular mesh is reused; only its active selection changes (22 additional 100 m cells). The original v1 mesh and parameter table remain preserved. All 14 corrected inlets have 47 archived analysis timestamps and 18 forecast timestamps from the original fixed issue. See `tools/sfincs/data/road-dip-refinement/connected-v2/frozen-analysis.json` and `frozen-forecast.json`.

All 78 road terrain windows have complete required 1 m coverage. The context raster uses 2021/2023 professional terrain, with 1.3337 km² of otherwise missing peripheral context from the 2019 Brawley/Rillito acquisition. This is not 2015 terrain and not a claim of a 2026 survey. Native roughness uses the official WorldCover mapping and native retention uses the official HydroMT CN transformation; fair ARCII remains an explicit soil-state assumption.

The corrected native parameter preparation is separate from solver execution. The 6.25 m mesh and approximately 1.04 m subgrid sampling do not establish road-depth accuracy. The frozen precipitation package must cover [-111.41,32.26,-110.99,32.61] for Oct 30 16Z through Nov 2 07Z, using the original archived observations and forecast issues. Do not refresh or zero-fill missing coverage.

Bridge guidance is a hobbyist height/history comparison, not a full bridge physics model. The evidence registry now distinguishes inventory dimensions, historical Cortaro marks, datum conversion references, and missing current elevations. Historic roadway estimates must not become current thresholds; bare-earth bridge-centre terrain is not deck height. No generic bridge penalty is introduced.


### Completed native component

The corrected official subgrid build completed in 454.6 seconds. Native boundary placement completed with 14 provider series at nine receiving locations and 16 outflow cells. Directed source placement moved 1–43 m downstream to the first active native cell; it did not relocate sources by elevation. Co-located inputs are distinct non-nested tributaries, not duplicate copies of a cumulative river flow.

The assembled local component is `.sfincs-runs/road-native-case-v2/`, with 64 discharge timestamps and the original 63-hour antecedent/forecast window. `connected-v2/native-component.json` identifies the remaining expanded-rainfall dependency. No solver execution has occurred. The pinned source explicitly requires NetCDF infiltration for quadtree grids (`inffile=infiltration.nc`, `inftype=cna`); the legacy regular-grid binary retention file is not used in this case. See the pinned `source/src/sfincs_infiltration.f90` lines 301–315 and `sfincs_ncinput.F90` quadtree reader.

Map output is limited to the 14-hour forecast window at 15-minute spacing; the full antecedent period still runs. `storezvolume=1` retains actual native volume. This keeps output size bounded without mistaking cell-minimum-relative water level for road depth. The existing saved executable and 20-minute first-run cap remain unchanged.

Additional standard optional dependencies needed by the unmodified builders: numba-celltree 0.4.2 and datashader 0.19.1. Existing terrain and native table files are reused when present; do not rebuild unchanged tables. After the wider original-issue rainfall is supplied, serialize it with the existing HydroMT forcing adapter, produce the final `current-case.json` and archive, and use the saved-engine workflow. Do not dispatch the incomplete component.


### Frozen execution dispatched

The rainfall dependency is resolved. Original raw HRRR, Stage IV and MRMS bytes were restored from the existing app branch objects; no weather source was refreshed or redownloaded. The expanded crop has 63 hourly frames on a 36×43 EPSG:4326 reporting grid, with no missing cells after the same explicitly recorded MRMS replacement. Native precipitation serialization uses the existing HydroMT adapter. The reporting grid does not improve the native meteorological resolution.

The assembled case is archived permanently at `tools/sfincs/data/road-current-20261101-13z-v2.tar.gz` (91,989,228 bytes), with its hash manifest beside it. Run 41339621278 uses input commit b32d291 and saved engine run 41290378239. Solver wall time remains capped at 1,200 seconds. Native progress is streamed to the job log and archived in solver.log. `connected-v2/current-case.json` supersedes the earlier incomplete native-component status. No result is claimed until the native run completes.


### Result consumer handoff

This case uses native quadtree output, not the baseline regular 100 m grid. Read face geometry/ordering from `sfincs.nc` or the map's UGRID topology. Retain each face's actual level/area; do not reshape the result into a rectangular 100 m raster. Expected native fields enabled in this case are `zs` (absolute water level), `subgrid_volume` (m³ per cell), and `precipitation_rate` (mm/hour). `subgrid_volume / cell_area` is water volume per total computational-cell area, not local road depth or mean wet-area depth. Use sourced terrain and a documented downscaling method for local depth; bridge deck elevations remain separate. Map times are forecast-period only. No section discharge is claimed unless a native section output was actually recorded.


### Actual bounded outcome — partial, not completed

Run 41339621278 exhausted its 1,200-second native budget. The last logged progress milestone was 85%; 21 fully populated quarter-hour maps cover November 1 17:00–22:00 UTC. Nine requested hours remain. GitHub incorrectly reported job success because the logging pipeline masked timeout status; explicit pipefail is now added. No second run was launched.

Raw output includes water surface and subgrid volume. All 398,613 faces match the input mesh through exact unique projected rectangle bounds and polygon-area checks, not an assumption based on equal array lengths. `output-to-source-face-id.npy` records this verified mapping to existing input mesh IDs. The output does not carry a separate native face-ID variable. End-summary fields and timemax remain unwritten; open partial files with decode_times=False and use only actual time frames. Do not fabricate a full completion marker or endpoint.

There are 1,243 negative-volume cell-frames (845 distinct cells); the worst signed volume divided by its own cell area is -0.0004192 m. Raw signed values remain unchanged. This is disclosed numerical undershoot, not negative physical water. Any display tolerance must be explicit and tied to this result.

Five actual restart files (18:00–22:00 UTC) and all raw outputs are preserved in `tools/sfincs/data/road-result-41339621278/`, with archive and input hashes. The latest restart has intact Fortran records and type 1. However, the pinned official reader restores zs/q/uvmean, not the cumulative rainfall/infiltration state used by `inftype=cna`. A blind restart would reset that accounting. It has not been tested or represented as an identical continuation. Source: pinned `source/src/sfincs_initial_conditions.F90`, read_binary_restart_file, and `sfincs_infiltration.f90`, initialize_infiltration.

The solver also reports a precipitation end-coverage warning: the left-labeled hourly input contains the 06:00–07:00 rate but its final timestamp is 06:00. The final interval exists; there is no absent weather hour. A future serialization should retain an explicit terminal endpoint at 07:00 without adding a new rainfall interval. The original raw input/output are preserved as executed.

### Approved completion run: full interval delivered

Run 41344983607 executed the exact same connected-v2 archive with the retained executable, after explicit approval for one fresh 40-minute native budget. It reached 100% and `Simulation finished` at 2026-11-01T20:45:32Z. Native runtime was 2,368.126 seconds (39.47 minutes), with an average step of 1.141816 seconds. The full 63-hour simulation ends at 2026-11-02T07Z; 57 quarter-hour forecast frames cover 2026-11-01T17Z through that endpoint. The earlier partial output remains preserved separately. No additional run was launched.

This is a simulated-live replay of the original frozen NWM 13Z / HRRR 14Z input package, not a new forecast issuance. Permanent output is `tools/sfincs/data/road-result-41344983607/manifest.json`; concatenate its listed archive parts, verify SHA256, then extract. Reuse the unchanged input archive for mesh, subgrid and forcing. The actual map has native `zs` and `subgrid_volume`; all 398,613 faces match the input using exact unique polygon rectangle bounds. The explicit output-to-input native-ID mapping is retained, because the output does not contain a separate face-ID variable.

All 22,720,941 volume samples are finite. There are 1,414 negative cell-frames, with worst signed volume divided by full cell area of -0.0004192 m. Raw values are preserved. Total stored water rises from 731,792.3 m3 to 4,388,145.1 m3 over the forecast frames; this is storage, not a complete inflow/outflow mass balance. Native forecast precipitation rates range from 0 to 15.37 mm/hour. The sum of 14 disjoint forecast inlet series ranges from 6.43 to 71.02 m3/s; no downstream river-section discharge was recorded.

The largest volume divided by full cell area is 11.015 m in a 100 m cell at [-111.160066, 32.418626], 1.766 km from the selected routes. This is substantial modeled storage requiring cautious interpretation, not 11 m of road flooding or independently verified hydraulic accuracy. Native water surface and volume time series are included for all nine selected crossing records and 24 screened terrain minima. These are not bridge-deck depths or passability judgments.

All 14 hourly restart files have intact Fortran record boundaries, including 07Z. Their type-1 format still does not preserve cumulative CNA precipitation/infiltration state; an identical continuation is not established. The original final-hour precipitation timestamp warning remains disclosed; the 06-07Z rate was present and held at the endpoint. No input was silently corrected during this run.

The independent coverage audit in `ROAD-COVERAGE-AUDIT.md` verifies complete 6.25 m coverage within 100 m of both selected routes and 12.5 m coverage within 500 m, including endpoints. It found no selected-route geometry gap requiring a new mesh. Broader app-route coverage and unknown structure elevations remain explicitly limited.
