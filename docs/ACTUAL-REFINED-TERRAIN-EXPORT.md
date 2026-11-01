# Actual partial-run terrain display export

This export supplies terrain for the existing `refined-partial-41339621278` package. It changes no native result, time axis, quantity, model coverage or solver-completion claim. The package remains partial: 21 frames from 2026-11-01 17:00–22:00 UTC (10 AM–3 PM MST). No solver execution or terrain download was performed.

## Source binding and bed audit

The exporter reads the retained `road-native-case-v2/sfincs.nc`, whose SHA256 is `91ce69c66c8fc5c667254f3cf279fc3d12449223c19d4c8b547f7a7e81ef4ffb`, and asserts exact native face-ID order against the published geometry. The published compressed geometry hash is `a2953dcc1cc8866bfda52a1dd576de02e6075de4ed34368342ab06a42290ed7c`. All 398,613 native polygons, including their hanging-edge nodes, remain the terrain support. There is no fixed-origin row/column reconstruction or reuse of the old 100 m baseline arrays.

Terrain comes from the same retained hierarchy used by `prepare_road_parameters.py`: the actual 1 m road windows in `road-terrain-1m-v1`, followed by the retained 10 m context DEM in `road-context-rasters-v1`. Both are metres NAVD88 in EPSG:32612. Fine-window hashes are checked; the index records every source raster and its hash plus both source-manifest hashes. Sources include 2021/2023 road terrain and 2019 peripheral context as identified by the retained metadata, not a current road survey.

The parameter preparation calls the official quadtree subgrid builder with `nr_subgrid_pixels=6`, `depth_factor=1.0`, and `zfill=None`; no channel burning or additional bed adjustment appears in that path. Its generated subgrid file hash `a5478d90db35af662ce96897caa285434985541c4dc4e9f89053e34f5072ea67` matches the retained native-case input. The audit independently samples the same 6×6 positions for known faces and compares their min/max with the native subgrid table. Differences are below 0.00005 m (float32 precision), providing a direct check that display terrain is tied to the native bed preparation. Bilinear interpolation uses available retained raster samples; entirely missing terrain would omit its native face and be reported, never zero-filled. This export found no missing faces.

## Tiles and continuous LOD

There are 2,255 geographic tiles based on 500 m projected windows, with two levels each:

- L0: each native polygon's original boundary nodes plus its centre form a fan of terrain triangles. DEM elevations are sampled at those points.
- L1: each L0 triangle is split into four. New interior points sample the retained DEM. New points on native boundaries interpolate the **same L0 edge position and elevation**, so adjacent faces and tiles remain continuous even at mixed LOD. These constrained edge points are not advertised as independent fine-terrain samples.

Each tile declares the native run, geometry SHA256, vertical datum, exact string face ID for every triangle, geographic vertices, and source-terrain resolution range. Source sampling of 1–10 m is distinct from the variable mesh triangle spacing; the export does not claim uniform 1 m geometry or new hydraulic resolution.

The full published asset set is 114,282,726 compressed tile bytes, intended for bounded lazy streaming, never a global eager download. L0 has 1,605,049 triangles in total; L1 has 6,420,196. The largest L0 tile is 217,138 bytes / 16,062 triangles. The largest L1 tile is 895,489 bytes / 64,248 triangles. These per-tile limits allow the runtime to select L0 when a fine tile does not fit its budget.

`terrain-index.json.gz` is 302,369 bytes, SHA256 `1dcaf6060f95c7809c290418fe7915cba4c7eccec30cf1d5d99be1fba6b4d124`. It contains tile bounds, levels, artifact sizes/hashes, source provenance and exact coverage counts. `terrain-display.json` is the descriptor to bind as `manifest.terrainDisplay`; the parent/UI owner must then update the publication manifest checksum. The exporter deliberately does not alter the original manifest or publication pointer.

All new files have the `terrain-` prefix inside `public/simulation/data/refined-partial-41339621278/`. Existing geometry/frame files are unchanged. Runtime tile loading must use the same checksum-verifying package reader and preserve flat-default/lazy-3D behavior.

## Actual native-value evidence

Face `387171`, area 39.0625 m², is in tile `971-7169` at approximately longitude −111.1502329666, latitude 32.4015256902. Its L0 terrain centre is 627.942359 m NAVD88; its L1 vertex elevations range from 627.838054 to 628.719620 m. Independent retained NetCDF comparisons match the published endpoint values exactly:

| Native time | Mean depth | Raw volume | Native water surface |
| --- | ---: | ---: | ---: |
| 10 AM MST | 0.052069427490234375 m | 2.0339620113372803 m³ | 627.9871826171875 m NAVD88 |
| 3 PM MST | 2.2035794921875 m | 86.07732391357422 m³ | 630.1849975585938 m NAVD88 |

The same audit verifies faces `266577` and `283056`. Surface-minus-local-terrain is a display intersection and is not substituted for native volume / full-face-area mean depth. The terrain mesh is not the complete subgrid hypsometry and does not establish surveyed road depth or bridge clearance.

## Reproduction and checks

Run `tools/simulation/export-refined-terrain.py` with the retained workspace available. It reads sources only and writes the prefixed display assets. `test/refined-terrain-export.test.py` verifies all 4,510 tile hashes, finite geometry, exact native IDs, full 398,613-face coverage with no duplicates between tiles, and all 1,605,049 mixed-LOD boundary midpoint constraints. It also verifies native NetCDF hash, exact endpoint volume/surface/depth equality, and the retained DEM versus native subgrid terrain checks. `terrain-verification.json` and `terrain-export-summary.json` retain the detailed evidence.

The runtime/browser performance and screenshot checks are separate integration evidence. No claim about actual display performance follows from the export audit alone.
