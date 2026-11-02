# Road heights

Data only. The map and the rest of the frontend do not read it yet. `public/simulation/road-heights.js` is an opt-in reader that nothing imports.

## What it is

Heights along every route and the freeway every 5 m, and along other public roads every 10 m. Driveways, parking aisles and dirt tracks are left out. Heights are metres NAVD88, the same vertical reference as model water surface, so the two subtract directly.

Package: `public/simulation/data/road-heights/` (about 2 MB). `manifest.json` lists `routes.bin.gz` (routes and freeway) and `area_*.bin.gz` (other roads in 0.1 degree squares, for lazy loading), with checksums.

## Where the numbers come from

All free, with no key or account.

| Part | Source | Note |
|---|---|---|
| Road lines | Overture Maps 2026-10-21.0 (OpenStreetMap data) and `public/data/routes.geojson` | Attribution required, recorded in the manifest |
| Ground height | USGS 3DEP 1 m bare-earth DEM tiles | Newest survey wins: Pima 2021, then Brawley-Rillito 2018, then Eastern Pima 2015 |
| Bridge decks | USGS 3DEP lidar, public EPT archive, project `AZ_PimaCo_2_2021` | Points classified as bridge deck (class 17) |

A road height is the median of five samples across the centreline, -3 to +3 m. Bare-earth terrain has bridges removed, so each bridge goes through `tools/road_heights/bridges.py`:

1. `lidar`: at least 40% of the span has deck points near a plausible height. This replaces the older approach-line estimate wherever it succeeds.
2. `terrain_continuous`: no deck points, and the ground follows the approaches. The road is in the terrain (culvert or fill), so the terrain stays.
3. `approach`: no deck points and a gap in the terrain. Falls back to a straight line between approaches and is flagged `deck_approach`.

Spans come from map tags. On routes and freeway, dips in the terrain are also checked for deck points, which finds bridges the map does not tag. A dip with no deck points stays as a real low spot. Stations only take a deck when travelling along it, so a road passing under a bridge keeps its own height. Results for every structure are in `structures.json`.

## Checks

- USGS elevation service (EPQS), 40 random stations: median difference 4 mm, 90% within 6.4 cm, largest 1.7 m.
- Project terrain minima on West Silverbell reproduce to 1 cm.
- Lidar deck against the existing approach estimates: Trico-Marana 590.85 m both ways; Avra Valley over the Santa Cruz 635.05 m against 634.35 m, about 2.3 ft higher.
- `npm test` covers decoding, those bridge values, the Brawley dip and missing-value handling.

## Simulation overlay

`tools/road_heights/flood_overlay.py` compares stations with one model run. Output is in `road-heights/flood/<runId>/`:

- `stretches.geojson`: each stretch with road, position, peak height above road, first, peak and last times, `onStructure`, and `faceSupport`. Ready for a 2D line layer.
- `frames.bin.gz`: height above road per frame for stations ever above it, plus each station's model face, so a map can animate or use a newer frame.
- `summary.json`: counts and the checksums binding this to its inputs.

A station counts when its model face holds at least 1 cm of water and the surface is at least 3 cm above the road.

What this does and does not show:

- It is modeled water level above estimated road height, not an observation, closure or measured road depth. Existing bridge scores and closures are unchanged.
- `faceSupport` matters. `fine` is a face of 12.5 m or less, which can resolve a road. `coarse` only says water is at about that height somewhere in a larger face, up to 100 m. Most stretches away from the refined corridors are coarse.
- The model's terrain is coarser than these heights, so a narrow embankment may not hold water back in the model as it does on the ground.
- Stations outside the model have no result. They are not dry. For this run, 21,310 of 30,506 route stations and 11,519 of 35,979 freeway stations are inside.
- Heights reflect the survey date, not later roadwork.

## Using it on the map later

- 3D: station elevation is the road's height in the same units and datum as model water, so a ribbon at that height meets the water surface directly. Decks stay above the channel.
- 2D: draw `stretches.geojson`, or colour stations per frame from `frames.bin.gz`. Show `coarse` differently from `fine`. Show unknown as unknown.
- Display in feet, per the readable-feet work.

## Rebuild

```bash
python -m venv .venv
.venv/Scripts/python -m pip install numpy rasterio pyproj shapely pyarrow fsspec aiohttp requests "laspy[lazrs]" matplotlib
.venv/Scripts/python tools/fetch_overture.py 2026-10-21.0 transportation segment -111.42 32.16 -110.93 32.52 data/overture/segments.parquet
.venv/Scripts/python tools/road_heights/build_road_heights.py
.venv/Scripts/python tools/road_heights/flood_overlay.py
```

Downloads cache in git-ignored `data/`: about 11 GB of terrain tiles and 380 MB of lidar. A full run from an empty cache takes under an hour on a home connection. Rerun the overlay for each new model run.
