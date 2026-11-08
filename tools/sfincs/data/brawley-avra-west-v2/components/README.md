# brawley-avra-west components, domain v2

Case `brawley-avra-west`, modelVersion `all-routes-brawley-avra-west-v1` (unchanged). Experimental branch only; nothing here is live.

## Why v2

The v1 domain was only the Brawley local set: everything draining to 15876711/15876707 minus the area above the
USGS 09487000 gauge reach 15876941. Several priority roads drain somewhere else, so v1 had none or little of them:
Avra Valley Rd west, Anway and Agua Dulce Ranch (0 km inside), Cocorague Ranch (2.24 of 8.37 km), Tucker
(1.61 of 7.08 km), and Lambert and Pump Station (not in the v1 list). Their washes drain to the Northern case's
west-side external inlets (15876623, 15876639, 15876641, 15876653) or end at NHD terminal nodes in the valley floor.
Before v2, 101 of the 366 candidate dips were in no model, 27 of them at least 1 m deep (Cocorague 5.26 m, Agua
Dulce 3.69 m, Tucker 2.04 m).

## What changed

Built with `tools/sfincs/brawley/build_components.py --version v2 --window 150` from the wider NHDPlus V2 fetch in
`raw/` (bbox -111.75,31.90,-110.95,32.60; 1,025 flowlines, 1,052 catchments, 2 pages each, provenance json beside
them). With `--version v1` (the default) the script still reproduces the v1 domain, zones, L4 points, network and
target routes byte for byte. The v1 registry differs only in `forcingStatus`, which was resolved by hand after the
v1 build.

**Domain** = v1 local set (103 reaches) UNION these complete upstream subtrees (69 more reaches, 172 in all):

| Outlet reach | Wash | How it ends | Where it ends | New reaches | New km² | Roads it carries |
|---|---|---|---|---|---|---|
| 15876639 | Blanco Wash | Northern west inlet | joins 15876633 (Northern) | 21 | 159.95 | Agua Dulce, Anway, Avra Valley Rd west, Lambert, Manville, Pump Station, Tucker |
| 15876653 | (unnamed) | Northern west inlet | joins 15876633 (Northern) | 1 | 9.55 | Lambert, Pump Station |
| 15876641 | (unnamed) | Northern west inlet | joins 15876625 (Northern) | 1 | 6.67 | Pump Station |
| 15876623 | Cocio Wash | Northern west inlet | joins 15876621 (Northern) | 12 (11 shared with 15876613) | 7.07 | Pump Station |
| 15876613 | (unnamed) | joins Blanco Wash below Northern | joins 15876605 | 12 | 58.79 | Pump Station |
| 15876627 | (unnamed) | joins the reach below Northern | joins 15876593 | 1 | 13.96 | Pump Station |
| 15876757 | (unnamed) | NHD terminal node | 5.5 km inside the domain | 8 (1 shared with 15876639) | 65.86 | Anway, Cocorague Ranch, Garcia Ranch, Manville |
| 15876719 | (unnamed) | NHD terminal node | 6.4 km inside | 15 | 47.56 | Agua Dulce Ranch |
| 15876669 | (unnamed) | NHD terminal node | 3.1 km inside | 5 | 23.20 | Agua Dulce Ranch |
| 15876675 | (unnamed) | NHD terminal node | 4.1 km inside | 5 | 9.05 | Tucker |

How the subtrees were chosen (all in the script):
- The four Northern external inlets west of -111.25 are taken whole. Their whole upstream lies outside Northern's
  domain (0 km² overlap). Northern's other inlets are either ours already (15876707/15876711) or east (15902351/63).
- Each catchment touched by a priority road west of -111.25 (road lines from the floodplain-road-heights-v1 area
  tiles) is followed down the NHD main path until it ends at a terminal node, or until the next reach carries water
  from a live case or from the v1 set. The reach before that is the outlet, and its full upstream is added.
- A subtree may not contain any live case's active catchment or any v1 reach. The check passed for all ten.
- Two NHD divergences make headwater reaches shared by two outlets: 11 reaches by 15876613 and 15876623, and
  15876855 by 15876639 and 15876757. The union counts each catchment once.
- Skipped: Pump Station catchments 15876593 and 15876595. Their reaches already carry water from every live case
  (Santa Cruz system below Northern), so they cannot be modelled independently.

Checks:
- The only external inflow is still 15876941 into receiving reach 15876923. No added reach has upstream outside
  the fetch, and every reach has a catchment.
- Area balance: catchments sum to 1241.34 km² against 1241.33 km² expected. The domain is one polygon of
  **1240.37 km²** (v1 839.02 km²), after filling 88 slivers of about 0 m².
- Overlap with live domains: Northern 0, Picture Rocks 0, Gates 139.42 km² (the same as v1). Outside all live
  domains: 1100.95 km².
- Bounds: lon -111.506..-111.043, lat 31.937..32.472. EPSG:32612 rectangle x 452400-496000, y 3533400-3592800.

**Outflows.** Models stay independent. Northern keeps its own NWM inlets, and every subtree that joins a reach
carrying another case's water ends in an open outflow. The registry lists them under `outflow.additionalOutlets`.
A HydroMT `river_source_points` preview on this network and domain gives 8 outflow points: 2 at the v1 outlet and
6 at the joins of 15876639/653, 641, 623, 613 and 627. The real placement happens in prepare_route_case_boundaries.
The four terminal subtrees have no river leaving the domain, so no outflow is placed. Their terminal ends are
3-6 km inside the domain, and water spreads over the 2D surface from there. Where that water reaches the shared
50 km edge with Northern outside the 6 river outflows, the edge is closed (a modelling limit, not checked).

**Registry.** `boundary-registry.json` is the version3 schema plus `domainVersion: v2`, `v1LocalReachIds` and
`addedSubtrees`. `forcingStatus` is copied from v1 with `--forcing-from`, because the external inlet is the same.
The inflow files are unchanged: the v1 `brawley-avra-west-history*.json` / `-forecast*.json`.

**Refinement zones** (`refinement-zones.geojson`, disjoint levels like v1):
- **L4 (6.25 m):** 150 m squares at every candidate dip inside the domain. That is 203 dips, all at least 0.3 m
  deep, 46 at least 1 m, including the 73 in the Gates overlap that v1 left at coarse cells. Also every road-wash
  crossing inside the domain that is more than 15 m from a `public/data/routes.geojson` line: 177 crossings,
  5 of them on Brawley Wash. Total 7.471 km².
- **L3 (12.5 m):** within 100 m of the priority roads, which are now Sandario, Manville, Avra Valley Rd west, Anway,
  Mile Wide, Snyder Hill, Nelson Quihuis, Garcia Ranch, Cocorague Ranch, Agua Dulce Ranch, Tucker, Lambert, Pump
  Station and Donaldson Ranch. Also within 100 m of the Brawley mainstem. Total 28.672 km².
- **L2 (25 m):** 400 m of the mainstem, 19.066 km². **L1 (50 m):** 1500 m of the mainstem, 68.035 km².

Priority-road km inside the domain (v1 -> v2, of total):

| Road | v1 | v2 | total |
|---|---|---|---|
| Sandario | 14.99 | 14.99 | 29.82 |
| Manville | 9.26 | 20.02 | 20.02 |
| Avra Valley Rd west | 0 | 10.06 | 28.93 |
| Anway | 0 | 11.36 | 17.08 |
| Mile Wide | 8.89 | 8.89 | 8.89 |
| Snyder Hill | 12.55 | 12.55 | 12.55 |
| Nelson Quihuis | 2.40 | 2.40 | 2.40 |
| Garcia Ranch | 7.21 | 8.70 | 8.70 |
| Cocorague Ranch | 2.24 | 8.37 | 8.37 |
| Agua Dulce Ranch | 0 | 6.38 | 6.38 |
| Tucker | 1.61 | 6.88 | 7.08 |
| Lambert | - | 2.14 | 20.24 (most is east of I-10) |
| Pump Station | - | 7.72 | 10.42 |
| Donaldson Ranch | - | 6.10 | 6.10 |

Totals are the matching area-tile lines, including pieces east of -111.25 that belong to other cases.

Candidate dips in no model: 101 before (27 at least 1 m deep), **19 now** (6 at least 1 m). Most of the 19 are
along W Silverbell Rd and N Red Hill Rd near 32.445 N, -111.41 (up to 3.95 m), in catchments below the live cases.

## Mesh (`.sfincs-runs/brawley-avra-west-mesh-v2`, not in git)

`prepare_route_case_mesh.py --builder .sfincs-runs/cht-refinement-source/quadtree_builder.py --case-root
tools/sfincs/data/brawley-avra-west-v2/components --output .sfincs-runs/brawley-avra-west-mesh-v2` took 244 s
(exit 0).
- Script estimate: 691,453 (cap 750,000). The in-domain estimate is 544,182.
- **Active cells: 643,056** (limit 650,000), from 779,247 faces before the cut.
- levelCounts (1 = 100 m ... 5 = 6.25 m): 1: 106,791, 2: 38,108, 3: 54,086, 4: 222,385, 5: 221,686.
- No shrink step was needed.

## Station ownership (`tools/live/road-stations/brawley-avra-west-local-v2.json.gz`)

Built with `tools/live/build_local_road_stations.py --domain <this folder>/brawley-avra-west-domain.geojson
--exclude --routes public/data/routes.geojson --route-buffer-m 15`. Tiles are read from road-heights-integrity
39b34afd and hash-checked.
- New rule: the case owns every area-tile station in its domain that is more than 15 m from a rated route line.
  Route stations stay with the route cases, and the Gates-overlap stations are now owned here.
- Counts: 59,870 stations in the domain, 1,730 near routes, **58,140 owned**, 571 of them with no road height.
  Those are kept and reported as no height, never as dry.
- File: 554,463 bytes, sha256 f820259a...8dce8c. v1's 31,680-station file is unchanged.
- The road tiles stop at lon -111.42 and lat 32.16. Road stations and road geometry therefore do not exist west
  or south of that line, even though the domain does. The dip windows there come from the dips CSV.

## Terrain, context, rain (`.sfincs-runs`, not in git)

- **1 m terrain top-up** (`import_brawley_terrain.py --skip-present-in .sfincs-runs/brawley-avra-west-terrain-1m-v1`,
  31 s, catalog `../terrain-catalog.json`, 80 TNM items):
  - The v2 L>=3 zones + 50 m need 319 windows: 158 come from terrain-1m-v1, 15 from all-routes-terrain-v1, and
    146 were written new into brawley-avra-west-terrain-1m-v2 (no name already present anywhere).
  - 0 of 58,133,421 required pixels are missing. 0 of 7,563,519 L4 pixels (205 windows) are missing, across the
    union of folders, in the order the parameter step loads them.
- **Context:** context-v1 (y up to 3586000) does not cover the v2 domain + 300 m (north edge 3593088). So
  brawley-avra-west-context-v2 was built with the same `prepare_context.py`, sources and priority, with bounds
  [452000, 3532000, 500000, 3594000] (320 s).
  - The check is `check_context.py --buffer 300`: pass, 13,244,286 cells, 0 missing terrain, lulc or cn.
  - 1/3 arc-second cells inside the domain: 16.97 km², mostly at -111.40, 32.20 and along the west edge near
    -111.45..-111.50. No 1 m tile has data there, and no L3/L4 zone is there.
- **Rain:** rainfall-v1 stops at lat 32.435. brawley-avra-west-rainfall-v2 uses the same retained bytes and scripts
  (`prepare_brawley.py --grid -111.52 31.92 -110.98 32.49`, 21 s).
  - 63 x 58 x 55, 0 missing cell-hours. The Stage IV 12-13Z gap hour is MRMS-replaced exactly as before.
  - On shared cells it is identical to v1, except 18 MRMS-hour cells that differ by up to 0.3 mm (the known
    nearest-cell edge tie).

## Limits

- NHD terminal nodes are a map convention. Real flow past them is not represented; see the note on outflows above.
- Bare-earth lidar is not a surveyed road deck. Cell water level must be compared with road height. Depth averaged
  over a cell is not a water level.
- The NWM-forced inflow variant still fails V1 (1.70 vs 49.27 m³/s). Nothing in v2 changes that.
