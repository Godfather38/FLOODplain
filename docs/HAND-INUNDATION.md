# Estimated flood extent from NOAA HAND data

Experimental, on the branch `experiment/hand-inundation`. Not on `main` and not published.

HAND means Height Above Nearest Drainage: how far each piece of land sits above the stream it drains to. NOAA has already computed this, along with catchments (the land draining to each stretch of stream) and rating curves (the water level expected at a given flow). This layer reuses those files. It takes a flow, looks up the water level, and marks land lower than that level as estimated to be wet.

It does not say whether a road can be used. It reports no value for the road or the crossing point. The crossing is only a location marker on the map.

## Supported junctions

Supported means the junction passed every check below and has a data file in `public/simulation/data/hand/`.

| Junction | NOAA reach | Distance to reach | Gauge | Rating curve | Files |
|---|---|---|---|---|---|
| West Trico Marana Road at the Santa Cruz River | 15890430, Santa Cruz River, basin 15050303, branch 1588000002 | 20.8 m | SCTA3, 3.01 km downstream | Not calibrated | `trico-marana-santa-cruz.json` |
| North Sanders Road at the Santa Cruz River | 15890430, same branch | 49.2 m | SCTA3, 9.02 km downstream | Not calibrated | `sanders-santa-cruz.json` |

Trico Marana was the first junction. Sanders was then built with the same command, to test that the workflow repeats. Sanders has the weaker link, because the gauge is three times farther away.

## Every other crossing is not supported

`tools/hand/hand_tool.py survey` checked all 52 distinct crossing points in `public/data/crossings.geojson` against the real rasters and reaches. The full point-by-point evidence is in `public/simulation/data/hand/coverage.json`, and the app links to it.

| Result | Points | Meaning |
|---|---|---|
| `forecast_linked` | 4 | Within 100 m of a reach the app has a forecast for, and the water name agrees. Sanders and Trico Marana are 2 of these. |
| `needs_review` | 2 | On the forecast reach, but the map data has no water name to confirm it. |
| `hand_reach_no_forecast` | 18 | Within 100 m of a HAND reach, but that reach has no forecast in the provider. |
| `not_on_modeled_reach` | 28 | Inside a catchment, but over 100 m from its stream, so that catchment's rating curve doesn't describe the water at this point. |

Some crossings the owner may look for first:

- **West Avra Valley Road at the Santa Cruz River** (`-111.14566` and `-111.14614`): `forecast_linked` but not built. Both are on reach 15890430, which is 26.5 km long, and are far upstream of the gauge. Assuming the gauge's flow applies there is too much of a stretch without evidence.
- **Los Robles Wash at North Trico Road** and **Brawley Wash at West Avra Valley Road**: HAND exists (`hand_reach_no_forecast`), but no forecast does. The BWTA3 gauge is on a different reach.
- **Picture Rocks Wash** and **Twin Peaks Road**: `not_on_modeled_reach`.
- **Yuma Mine Wash on Ina**: `hand_reach_no_forecast`. The nearest reach is named Santa Cruz River by NOAA, so it may not describe the wash at all.
- **Cortaro (CSCA3) and Brawley (BWTA3) gauges**: no crossing falls on either gauge's reach.

Some reach names from NOAA's service look wrong. Reaches near Kinney Road come back as "Central Arizona Project Aqueduct". A name in `coverage.json` is NOAA's label, not a confirmed description of the water. The owner's local knowledge overrides all of this.

## What was checked

A junction gets a file only if all of these pass. Otherwise the build stops with `REFUSED` and writes nothing.

1. The crossing is within 100 m of a HAND reach, measured against NOAA's reach lines.
2. That reach is the one the forecast gauge reports. NOAA's NWPS gauge record and the HAND gauge table both give reach 15890430 for SCTA3.
3. The water name in our map data matches NOAA's reach name.
4. No catchment on the reach is flagged as a lake.
5. Each rating curve rises steadily and has no invalid values.
6. At least 95% of the reach's cells in the map square have HAND values. Trico Marana has 100%; Sanders has 99.95%.

The clipped grid was also compared with the same calculation on NOAA's original 10 m grid, at five flows from 10 to 770 m³/s. The area agrees within 0.26% at Trico Marana and 0.44% at Sanders. This shows the clipping is faithful. It does not show the estimate matches real floods.

## Uncertainty

No ± figure is given, because nothing here measures one.

**Cross-check against NOAA's gauge.** This compares NOAA's published stage for each flow at SCTA3 with the HAND rating curve for the gauge's own catchment (HydroID 27390012). The two use different zero points, so only the rises can be compared.

| Flow (cfs) | NOAA stage (ft) | HAND stage (ft) |
|---|---:|---:|
| 843 | 7.06 | 4.04 |
| 3,000 | 12.25 | 6.83 |
| 5,000 | 14.00 | 8.13 |
| 8,600 | 15.50 | 9.84 |
| 15,000 | 17.00 | 11.99 |

From 843 to 3,000 cfs NOAA's stage rises 5.19 ft and HAND's rises 2.79 ft. From 3,000 to 15,000 cfs NOAA's rises 4.75 ft and HAND's rises 5.16 ft. So the rating curve runs noticeably different from the gauge at lower flows. This is one comparison at one place. It isn't an error range, and it doesn't carry over to the other catchments.

**Known limits, also shown on screen:**

- The rating curves are not calibrated to gauge readings (`calb_applied` is `False` for every row used).
- The gauge's flow is assumed unchanged along the channel. NWM shows no tributary joining reach 15890430 along the way, but real flows here can change along the channel, for example by soaking into the bed.
- Bridges, culverts and berms aren't modeled.
- Estimates stop sharply at catchment edges and at the edge of the 3 km square. The page says so when the area reaches the square's edge.
- Side washes and local runoff are not included.
- The half and double flow shading shows sensitivity only. It isn't a confidence range.

**Not verified:**

- The estimate has not been compared with any observed flood extent, photos, or FEMA maps.
- East of the Trico Marana crossing, the estimated area and OpenStreetMap's river line appear to take different paths. The cause is unknown. The owner's knowledge of that stretch would settle which is right.

## Source and age

- Files: `https://ciroh-owp-hand-fim.s3.amazonaws.com/15050303/branches/1588000002/`, a public copy of NOAA OWP HAND FIM hosted by CIROH. NOAA's own bucket (`noaa-nws-owp-fim`) charges the requester and refuses anonymous reads, so it could not be compared directly.
- Age: uploaded 2024-08-17. The bucket states no FIM version, so the app shows the upload date and its age rather than a version. Each junction file records the size, date and ETag of the source files, plus a hash of the clipped grid.
- NOAA's public FIM service (`reference/static_public_fim_domain`) returned nothing at the Trico Marana point, and the SCTA3 gauge record has inundation turned off. That is why these are local estimates and not NOAA's published maps.

## In the app

Open `/simulation/inundation.html`, linked from the main page's experimental links and from the river forecasts page. Choose a junction, then one of:

- **Live forecast.** Tick the box first; requests are off by default. Checked in a browser and it worked against NOAA's service.
- **Recorded forecast.** A saved NOAA response, labeled as recorded.
- **NOAA reference flow.** The action, minor, moderate and major category flows, labeled as not a forecast.

Code goes through the existing provider:

```js
import {createForecastEngine} from './simulation/forecast-engine.js';
const engine = createForecastEngine({enabled: config.experimentalForecasts === true});
const estimate = await engine.inundation({junctionId: 'trico-marana-santa-cruz'});
```

`engine.inundation()` calls `engine.predict()` for the junction's gauge and uses the forecast peak, or a specific forecast `time`. Results use the provider's status words, plus `beyond_rating` when the flow is above the top of the curve. Only `ok` and `stale` carry an extent. A `stale` result says it uses an old forecast. An expired forecast or failed refresh gives no extent, even when older data is cached. Every result carries `labels` with `estimatedExtent`, `sourceAge`, `missingCoverage` and `uncertainty`.

This layer is separate from the SFINCS boundary. `acceptInundationRun()` and `experiment/sfincs-engine` are unchanged, and HAND estimates aren't passed off as solver output.

The main route map and the alert service don't use this layer, and nothing in it changes route ratings or texts.

## Adding a junction

```bash
python -m pip install -r tools/hand/requirements.txt
```

```bash
python tools/hand/hand_tool.py survey
```

Find the crossing in `coverage.json`. If it's `forecast_linked`, add it to `tools/hand/junctions.json` with its coordinates, gauge, water name and square size. A crossing on a reach with no forecast needs that reach added to the provider first, and `STATIONS` in the tool has to match `forecast-stations.js`.

```bash
python tools/hand/hand_tool.py build your-junction-id
```

Then add the junction to the table above and run the tests:

```bash
npm test
```

```bash
python -m unittest discover -s tools/hand
```

Set `HAND_CACHE` to a short path on Windows if the default cache folder causes path errors. The check flows in `build` default to round figures for the Santa Cruz at Trico, so pass `--check-flows` for smaller washes.
