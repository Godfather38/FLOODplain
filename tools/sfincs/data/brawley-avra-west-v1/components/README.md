# brawley-avra-west components (v1)

These are the case-root components for the SFINCS quadtree case `brawley-avra-west`
(model version `all-routes-brawley-avra-west-v1`). The case covers the west Avra Valley local
roads and Brawley Wash between USGS 09487000 (Brawley Wash near Three Points) and the Northern
case's inlet point (NHDPlus node 720060498, -111.2930, 32.3647).

This folder holds geometry and topology only. Nothing here was produced by a solver.

## Files

| File | CRS | What it is |
|---|---|---|
| `raw/nhdflowline_network.geojson.gz`, `raw/catchmentsp.geojson.gz` | EPSG:4326 | Raw NHDPlus V2 flowlines (699) and catchments (731), merged pages, gzip |
| `raw/*-provenance.json` | | URL, fetch time (UTC), bytes, sha256, feature counts |
| `brawley-avra-west-domain.geojson` | CRS84 | Domain polygon, properties `{case, version: 3}` (same layout as `all-route-ready-v3/topology-version3/*-domain.geojson`) |
| `active-domain.geojson` | EPSG:32612 | The same domain as one MultiPolygon, property `case` (read by `prepare_route_case_mesh.py` and `prepare_route_case_boundaries.py`) |
| `brawley-avra-west-catchments.geojson` | CRS84 | The 103 NHDPlus catchments that make up the domain |
| `boundary-registry.json` | | Version 3 registry schema. `externalInlets` = 15876941 → 15876923 (`dnhydroseq`) |
| `brawley-avra-west-network.geojson` | CRS84 | 150 flowlines that intersect the domain buffered by 2 km. Fields `comid`, `flowdir` (all `With Digitized`), the NHD topology fields, and `local`. Pass it as `--network` to `prepare_route_case_boundaries.py` |
| `target-routes.geojson` | CRS84 | The 11 priority roads, from the road-height area tiles |
| `refinement-zones.geojson` | EPSG:32612 | Integer `refinement_level` 1 to 4. The levels are disjoint (each level minus the higher ones) |
| `l4-window-points.geojson` | CRS84 | The 139 centres of the L4 windows (48 dips, 91 crossings) with road, depth and wash |
| `build-report.json` | | Every check and number listed below |

## Sources and licensing

- **NHDPlus V2 flowlines and catchments.** From the USGS Water Mission Area geospatial fabric pygeoapi:
  - `https://api.water.usgs.gov/fabric/pygeoapi/collections/{nhdflowline_network,catchmentsp}/items?f=json&bbox=-111.70,31.95,-110.95,32.45&limit=1000`
  - Fetched 2026-11-08T21:58Z. Each request returned a single page, with `numberMatched` equal to the features returned.
  - The API rejects `limit=2000` with HTTP 400 ("Limit of 1000 exceeded").
  - US federal data, public domain.
- **Live domains.** `tools/sfincs/data/all-route-ready-v3/topology-version3/{northern,picture-rocks-ina-twinpeaks,gates}-domain.geojson`.
- **Candidate dips.** `origin/experimental/model-upgrade-diagnostics-20261107:docs/upgrade/candidate-road-dips-20261107.csv` (366 rows).
- **Road geometry.** The `floodplain-road-heights-v1` area tiles (10 m station lines, derived from Overture/OSM):
  - Source: `origin/experiment/road-heights-integrity:public/simulation/data/road-heights/`, commit 39b34afd.
  - `manifest.json` sha256 is 5b087698…a499. The tile box is lon -111.42 to -110.93, lat 32.16 to 32.52.
  - Decoded with a copy of `tools/road_heights/encoding.py::decode_lines`.

## Method

The scripts are `tools/sfincs/brawley/fetch_nhd.py` and `tools/sfincs/brawley/build_components.py`. Run them from the repo root with the H: venv:

```
python tools/sfincs/brawley/fetch_nhd.py --output tools/sfincs/data/brawley-avra-west-v1/components/raw
python tools/sfincs/brawley/build_components.py --raw tools/sfincs/data/brawley-avra-west-v1/components/raw \
  --output tools/sfincs/data/brawley-avra-west-v1/components --tiles <road-heights folder>
python tools/sfincs/prepare_route_case_mesh.py --builder .sfincs-runs/cht-refinement-source/quadtree_builder.py \
  --case-root tools/sfincs/data/brawley-avra-west-v1/components --output .sfincs-runs/brawley-avra-west-mesh-v1
```

1. **Local set.** The local set is everything upstream of, and including, 15876711 (Brawley Wash) and 15876707, minus everything upstream of, and including, 15876941.
   - This was computed twice: with the node graph (`tonode` → `fromnode`) and with the hydrosequence graph (`dnhydroseq` plus `dnminorhyd`). Both give the same 103 reaches.
   - The set includes the 15876815 subtree (San Joaquin/Black Wash, 603.8 km² total drainage).
2. **Closure checks.** All of these pass:
   - The only non-local reach that drains into the set is 15876941, and it enters 15876923.
   - Every local reach that is not a headwater has its upstream reaches in the fetched data.
   - Every local reach has a catchment polygon, and none has zero area.
   - Area balance: local catchment areas sum to 839.65 km². Total drainage gives 2779.56 (15876711) + 37.06 (15876707) − 1976.97 (15876941) = 839.65 km².
3. **Domain.** The domain is the union of the 103 catchments in EPSG:32612.
   - 42 digitising slivers smaller than 1000 m² (each about 0 m²) between catchments were filled.
   - The result is one polygon of **839.02 km²** with no holes.
   - Bounds: lon -111.422 to -111.043, lat 31.937 to 32.371. In EPSG:32612 at 100 m: x 460200 to 496000, y 3533400 to 3581600.
4. **Outflow.** The outflow is open where 15876711 and 15876707 meet 945050510 at node 720060498.
   - There is one NHD divergence: at node 720009639, the minor branch 15902533 (`divergence=2`) leaves the domain eastward from 15902567. The main path goes through 15876935.
   - That branch reaches 94 m into the domain, so HydroMT `river_source_points` may place a second outflow there. That matches the NHD topology; no flow split is assumed.
5. **Overlap with live domains.**
   - Gates: 139.42 km². Northern: 0. Picture Rocks: 0.
   - New area outside every live domain: 699.59 km².
   - The models are independent. Existing cases keep every station inside their domains. This case owns only the stations outside all three live domains.
6. **Brawley mainstem.** Levelpath 720005313 inside the local set: 10 reaches, 33.46 km, from 15876923 to 15876711.
7. **Refinement zones.** Cell size = 100/2^L m.

   | Level | Cell | What it covers | km² | Estimated cells (line-19 formula, not the built mesh; see 8.) |
   |---|---|---|---|---|
   | L4 | 6.25 m | 200 m squares at 48 dips and 91 road–wash crossings, all inside the domain and outside the live domains | 4.634 | 118,630 |
   | L3 | 12.5 m | Within 100 m of the priority roads and of the Brawley mainstem | 16.925 | 108,321 |
   | L2 | 25 m | Within 400 m of the mainstem | 19.138 | 30,621 |
   | L1 | 50 m | Within 1500 m of the mainstem | 67.586 | 27,035 |
   | L0 | 100 m | Everything else | | |

   - Crossings are recomputed from all 31,911 area-tile road lines and every network flowline in the new domain, de-duplicated within 15 m.
   - Of the 91 crossings, 5 are on Brawley Wash; by stream order, 74 are order 1, 6 order 2, 6 order 3 and 5 order 5.
   - All 48 dips are at least 0.3 m deep, so the "drop dips under 0.3 m first" step had nothing to remove. 5 dips are at least 1 m deep.
   - All zones are clipped to the domain.
8. **Mesh check.**
   - The estimate formula (`prepare_route_case_mesh.py` line 19) gives 457,162 (the cap is 750,000). The estimate for the domain only is 357,679.
   - The real build took 120 s and gave **408,207 active cells**, under the 450,000 target. No v1b rebuild was needed.
   - Builder level counts (1 = 100 m … 5 = 6.25 m): 1: 70,760; 2: 31,751; 3: 42,124; 4: 131,285; 5: 132,287.
   - Builder sha256 37222e48…3ea3.

## Exclusions and known gaps

- **Gauge catchment.** The 27.47 km² local catchment of 15876941, below USGS 09487000, is excluded. Its runoff enters only through the NWM inflow of 15876941, which is injected on 15876923 (0.41 km long).
- **Excluded priority roads.** Three priority roads lie outside the catchment-defined domain:
  - Avra Valley Rd west, Anway and Agua Dulce Ranch have 0 km inside it.
  - Most of Cocorague Ranch (2.24 of 8.37 km inside) and Tucker (1.61 of 7.08 km inside) also lie outside.
  - Their catchments do not drain into 15876711/15876707. Following `dnhydroseq` downstream:
    - Anway, Avra Valley W, Tucker, Lambert and Pump Station go through 15876683/945050513/15876661/15876653 → 15876639/15876633. These are Northern inlet and receiving reaches.
    - Agua Dulce Ranch goes 15876671 → 15876669.
    - The Cocorague dip goes 15877619 → 15876805 → 15876767.
  - These roads include the deepest west-valley dips: Agua Dulce Ranch 3.69 m, Cocorague 5.26 m and Tucker 2.04 m. They are uncovered by this case and by every live case.
- **No road heights south of 32.146.** Roads south of lat 32.146 have no road heights, because the road-height tiles start at 32.16 and the stations stop at about 32.1466.
  - The Three Points end has no target-road geometry, no dip windows and no crossing windows: Sandario south, Garcia Ranch south and everything near the gauge.
  - Brawley L1 to L3 still covers the mainstem there.
- **Terrain and rain coverage.** The domain reaches south to lat 31.937, past the existing 10 m context raster (lat ≥ 32.170) and the frozen rain crop (lat ≥ 32.16). Context, 1 m terrain and the rain template must cover x 460200–496000 and y 3533400–3581600.
- **Forcing.** 15876941 is not in `.sfincs-runs/nwm-frozen-13z/crosswalk.json`, so the frozen NWM series still has to be fetched.
- **Bare-earth heights.** Road heights from bare-earth lidar are not surveyed bridge decks. Missing readings are never treated as dry.
