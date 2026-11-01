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
