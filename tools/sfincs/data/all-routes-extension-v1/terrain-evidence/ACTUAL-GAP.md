# Confirmed Gates terrain gap

> I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.

Read the running intake outputs without modifying them. The two completed windows contain 463,400 missing required 1 m pixels:

| Native window (EPSG:32612) | Required pixels | Missing pixels |
|---|---:|---:|
| terrain-1m-479000-3568000 | 35 | 1 |
| terrain-1m-479000-3569000 | 474,336 | 463,399 |

The exact gap is 0.4634 km² and intersects 338.17 m of the actual Gates route centerline. Bounds in longitude/latitude: [-111.22114806, 32.25750902, -111.21239935, 32.26648531]. This updates the earlier catalog-only estimate: the actual required mask uses a 525 m buffer with all-touched rasterization, while the earlier area used a 500 m vector buffer.

Exact missing pixel polygons are preserved in `actual-missing-pixels-32612.geojson` and `actual-missing-pixels-4326.geojson`. They were generated from the actual nodata pixels intersected with the same required mask as the intake script. No interpolation or filling occurred.

A fresh official TNM 1 m DEM query for these precise bounds returned seven products. The only 2021-or-newer products were the same adjacent AZ_PimaCounty_2021_B21 tiles x47y358, x48y357 and x48y358. All four other results belong to AZ_Eastern_PimaCO_2015 and were excluded. No replacement 2021-or-newer standard 1 m source was found in the queried TNM catalog. The raw response and exact request URL are retained in `actual-gap-tnm-catalog.json`.

The 2021 prepared terrain uses EPSG:26912, NAVD88/GEOID18 metres before the existing standard horizontal reprojection to EPSG:32612. The source acquisition window remains September 27–November 17, 2021, not its publication date.

This is a localized Gates road terrain input gap, not a reason to stop the other routes. Keep it explicitly uncovered until another suitable professional source is obtained. A route mask, a broader coarse DEM, or an older product would not satisfy the requested 2021-or-newer 1 m replacement and must not be silently substituted. No terrain acquisition, solver run, H-worktree edit, outreach or paid action was performed.
