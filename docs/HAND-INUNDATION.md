# Estimated flood extent from NOAA HAND data

Experimental, on the branch `feature/hand-inundation`, which starts from `main`.

HAND means Height Above Nearest Drainage: how far each piece of land sits above the stream it drains to. NOAA has already computed this, along with catchments (the land draining to each stretch of stream) and rating curves (the water level expected at a given flow). This layer reuses those files. It takes a flow, looks up the water level, and marks land lower than that level as estimated to be wet.

It does not say whether a road can be used. It reports no value for the road or the crossing point. The crossing is only a location marker on the map.

## Results for every crossing

`python tools/hand/hand_tool.py` checked all 52 distinct crossing points in `public/data/crossings.geojson` against the real NOAA files. **19 are supported. 33 are not**, and the app lists those as missing coverage with the reason. No data was filled in to raise the count.

| Result | Points | Meaning |
|---|---|---|
| `supported` | 19 | Passed every check below. |
| `not_on_modeled_reach` | 28 | Inside a catchment, but over 100 m from its stream, so that catchment's rating curve doesn't describe the water at this point. |
| `needs_review` | 3 | Close to a reach, but its name conflicts with our map data or is a canal name. |
| `build_refused` | 2 | The reach's rating curve in this square has discharge falling as water rises, so it can't be used. |

The full evidence for each point is in `public/inundation/data/coverage.json`, and the table at the end lists every one.

Supported means the NOAA data covers the point and passed these checks. It doesn't mean the estimate has been shown to be accurate there.

**Check these first.** Local knowledge overrides all of this.

- Picture Rocks Wash on Picture Rocks Road and nearly all of Twin Peaks Road are not on a modeled stream.
- Yuma Mine Wash on Ina is `needs_review`: NOAA calls the nearest reach the Santa Cruz River, so it may not describe the wash.
- 12 supported points lack a water name from our map data or from NOAA, so they are matched by location only. The page says so. Some could be small side channels, or a road running alongside a stream instead of crossing it. Points on Speedway Boulevard deserve the closest look. One near -111.06 is on a reach NOAA names Santa Cruz River, well west of the actual river.
- NOAA's reach names can look wrong, such as "Central Arizona Project Aqueduct" near Kinney Road. A canal name sends a point to `needs_review`.

## What was checked

A crossing is supported only if all of these pass.

1. The crossing is within 100 m of a HAND reach, measured against NOAA's reach lines.
2. The reach's name doesn't conflict with our map data and isn't a canal name.
3. No catchment on the reach is flagged as a lake.
4. Each rating curve in the map square rises steadily and has no invalid values.
5. At least 95% of the reach's cells in the map square have HAND values.
6. A forecast exists for that reach. A gauge is used only when it's linked along the channel and within 10 km. Otherwise it's NOAA's National Water Model (NWM) forecast for the reach, and the answer was fetched and checked when the file was built.

The clipped grid was also compared with the same calculation on NOAA's original 10 m grid at 5, 50 and 500 m³/s, and a test requires them to agree within 2% or 0.5 hectares. This shows the clipping is faithful. It does not show the estimate matches real floods.

## Uncertainty

No ± figure is given, because nothing here measures one.

**Cross-check against NOAA's gauge.** This compares NOAA's published stage for each flow at the Trico gauge (SCTA3) with the HAND rating curve for the gauge's own catchment (HydroID 27390012). The two use different zero points, so only the rises can be compared.

| Flow (cfs) | NOAA stage (ft) | HAND stage (ft) |
|---|---:|---:|
| 843 | 7.06 | 4.04 |
| 3,000 | 12.25 | 6.83 |
| 5,000 | 14.00 | 8.13 |
| 8,600 | 15.50 | 9.84 |
| 15,000 | 17.00 | 11.99 |

From 843 to 3,000 cfs NOAA's stage rises 5.19 ft and HAND's rises 2.79 ft. From 3,000 to 15,000 cfs NOAA's rises 4.75 ft and HAND's rises 5.16 ft. This is one comparison at one place. It isn't an error range, and it doesn't carry over to other reaches.

**Known limits, also shown on screen:**

- The rating curves are not calibrated to gauge readings.
- Most supported points use NWM flow, which is a model result for a whole reach and not a reading. Its accuracy on these desert washes hasn't been checked. NWM often reports zero here, and then no water is estimated. Zero model flow does not mean the wash is dry.
- A gauge's flow is assumed unchanged along the channel.
- Bridges, culverts and berms aren't modeled.
- Estimates stop at catchment edges and at the edge of the map square. The page says so when the area reaches the square's edge.
- Side washes and local runoff are not included. Local storms are the main flood source on small washes, so this limit matters most there.
- The half and double flow shading shows sensitivity only. It isn't a confidence range.

**Not verified:**

- No estimate has been compared with an observed flood extent, photos, or FEMA maps.
- East of the Trico Marana crossing, the estimated area and OpenStreetMap's river line appear to take different paths. The cause is unknown.
- All 52 points were opened in a browser, the 19 supported ones with a recorded forecast and a chosen flow. The live forecast was tried at only one or two of them, and no flood was happening at the time, so every forecast flow seen was small.

## Source and age

- Files: `https://ciroh-owp-hand-fim.s3.amazonaws.com/`, a public copy of NOAA OWP HAND FIM hosted by CIROH. NOAA's own bucket (`noaa-nws-owp-fim`) charges the requester and refuses anonymous reads, so it could not be compared directly.
- Age: uploaded in August 2024. The bucket states no FIM version, so the app shows the upload date and its age. Each file records the size, date and ETag of its sources, plus a hash of the clipped grid.
- NOAA's public FIM service returned nothing at the Trico Marana point, and the SCTA3 gauge record has inundation turned off. That is why these are local estimates and not NOAA's published maps.

## In the app

Open `/inundation/index.html`, linked from the main page. Choose a crossing, then one of:

- **Live forecast.** Tick the box first; requests are off by default.
- **Recorded forecast.** A saved NOAA response, labeled as recorded.
- **A chosen flow.** Labeled as not a forecast.

Choosing a crossing under "Missing coverage" shows its location and the reason, and no extent.

```js
import {createInundationLayer} from './inundation/hand-inundation.js';
const layer = createInundationLayer({enabled: true});
const estimate = await layer.inundation({junctionId: 'west-trico-marana-road-32-45369-111-27985'});
```

The forecast provider, `forecast-provider.js`, has the same result shape as the one on `experiment/avra-radar-runoff`, reduced to what this layer needs, plus NWM reach forecasts. Nothing was merged from that branch or from `experiment/sfincs-engine`. Merging those later would bring a second copy of the gauge code, in `public/simulation/`, which would need tidying.

Only `ok` and `stale` results carry an extent, and `stale` says it uses an old forecast. An expired forecast or failed request gives no extent. Every result carries `labels` with `estimatedExtent`, `sourceAge`, `missingCoverage` and `uncertainty`.

The main route map and the alert service don't use this layer, and nothing in it changes route ratings or texts.

## Running it again

```bash
python -m pip install -r tools/hand/requirements.txt
```

```bash
python tools/hand/hand_tool.py
```

This rechecks every crossing, including new ones in `crossings.geojson`, and rewrites `coverage.json`. Recorded forecasts in `data/nwm/` are kept; delete them to record fresh ones. Then update the counts and table in this file and run the tests:

```bash
npm test
```

```bash
python -m unittest discover -s tools/hand
```

Set `HAND_CACHE` to a short path on Windows if the default cache folder causes path errors.

## Every crossing

| Crossing | Id | Result | Flow source or reason |
|---|---|---|---|
| North Kinney Road (32.2568, -111.2038) | north-kinney-road-32-25678-111-20377 | supported | NWM reach 15876809 |
| North Kinney Road (32.2415, -111.1608) | north-kinney-road-32-24151-111-16081 | supported | NWM reach 15876825 |
| North Kinney Road (32.2314, -111.1454) | north-kinney-road-32-23141-111-14537 | supported | NWM reach 15877617 |
| North Sanders Road (32.4348, -111.2339) | north-sanders-road-32-43484-111-23395 | supported | Gauge SCTA3 |
| North Sanders Road at Santa Cruz River | north-sanders-road-32-43488-111-23395 | supported | Gauge SCTA3 |
| North Trico Road at Los Robles Wash | north-trico-road-32-43882-111-30426 | supported | NWM reach 945050482 |
| West Avra Valley Road at Brawley Wash | west-avra-valley-road-32-39322-111-29459 | supported | NWM reach 945050510 |
| West Avra Valley Road at Santa Cruz River | west-avra-valley-road-32-40271-111-14566 | supported | NWM reach 15890430 |
| West Gates Pass Road (32.2297, -111.0719) | west-gates-pass-road-32-22970-111-07192 | supported | NWM reach 15902505 |
| West Ina Road at Santa Cruz River | west-ina-road-32-33759-111-08151 | supported | NWM reach 15902439 |
| West Speedway Boulevard (32.2361, -111.0604) | west-speedway-boulevard-32-23606-111-06040 | supported | NWM reach 15903149 |
| West Speedway Boulevard (32.2360, -111.0575) | west-speedway-boulevard-32-23604-111-05747 | supported | NWM reach 15903143 |
| West Speedway Boulevard (32.2377, -111.0520) | west-speedway-boulevard-32-23766-111-05195 | supported | NWM reach 15903143 |
| West Speedway Boulevard (32.2390, -111.0462) | west-speedway-boulevard-32-23899-111-04624 | supported | NWM reach 15903143 |
| West Speedway Boulevard (32.2390, -111.0450) | west-speedway-boulevard-32-23899-111-04501 | supported | NWM reach 15903143 |
| West Speedway Boulevard at Greasewood Wash | west-speedway-boulevard-32-23597-111-02886 | supported | NWM reach 15903151 |
| West Speedway Boulevard at Silvercroft Wash | west-speedway-boulevard-32-23568-111-00225 | supported | NWM reach 15903147 |
| West Speedway Boulevard at Santa Cruz River | west-speedway-boulevard-32-23567-110-98614 | supported | NWM reach 15904697 |
| West Trico Marana Road at Santa Cruz River | west-trico-marana-road-32-45369-111-27985 | supported | Gauge SCTA3 |
| North Kinney Road at Javelina Wash | north-kinney-road-32-25426-111-19875 | needs_review | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so it may not be this water. |
| North Kinney Road (32.2516, -111.1865) | north-kinney-road-32-25158-111-18652 | not_on_modeled_reach | The nearest HAND stream is 577 m away, so its rating curve does not describe the water here. |
| North Kinney Road (32.2477, -111.1835) | north-kinney-road-32-24767-111-18349 | not_on_modeled_reach | The nearest HAND stream is 520 m away, so its rating curve does not describe the water here. |
| North Kinney Road (32.2471, -111.1676) | north-kinney-road-32-24705-111-16760 | not_on_modeled_reach | The nearest HAND stream is 163 m away, so its rating curve does not describe the water here. |
| North Kinney Road (32.2440, -111.1634) | north-kinney-road-32-24402-111-16343 | not_on_modeled_reach | The nearest HAND stream is 347 m away, so its rating curve does not describe the water here. |
| North Kinney Road (32.2292, -111.1437) | north-kinney-road-32-22917-111-14371 | not_on_modeled_reach | The nearest HAND stream is 204 m away, so its rating curve does not describe the water here. |
| North Kinney Road (32.2272, -111.1408) | north-kinney-road-32-22722-111-14078 | not_on_modeled_reach | The nearest HAND stream is 449 m away, so its rating curve does not describe the water here. |
| North Kinney Road (32.2246, -111.1360) | north-kinney-road-32-22457-111-13596 | not_on_modeled_reach | The nearest HAND stream is 960 m away, so its rating curve does not describe the water here. |
| North Kinney Road (32.2223, -111.1326) | north-kinney-road-32-22235-111-13260 | not_on_modeled_reach | The nearest HAND stream is 784 m away, so its rating curve does not describe the water here. |
| North Sandario Road (32.2743, -111.2185) | north-sandario-road-32-27434-111-21849 | not_on_modeled_reach | The nearest HAND stream is 434 m away, so its rating curve does not describe the water here. |
| North Sandario Road (32.2753, -111.2182) | north-sandario-road-32-27528-111-21817 | not_on_modeled_reach | The nearest HAND stream is 535 m away, so its rating curve does not describe the water here. |
| West Avra Valley Road (32.3933, -111.2766) | west-avra-valley-road-32-39329-111-27659 | not_on_modeled_reach | The nearest HAND stream is 1610 m away, so its rating curve does not describe the water here. |
| West Avra Valley Road (32.3951, -111.2609) | west-avra-valley-road-32-39514-111-26095 | not_on_modeled_reach | The nearest HAND stream is 1157 m away, so its rating curve does not describe the water here. |
| West Avra Valley Road (32.4013, -111.2450) | west-avra-valley-road-32-40131-111-24501 | not_on_modeled_reach | The nearest HAND stream is 304 m away, so its rating curve does not describe the water here. |
| West Avra Valley Road (32.4022, -111.1471) | west-avra-valley-road-32-40224-111-14714 | build_refused | Rating curve for HydroID 27370003, in this map square: discharge falls as stage rises. |
| West Avra Valley Road at Santa Cruz River | west-avra-valley-road-32-40256-111-14614 | build_refused | Rating curve for HydroID 27370003, in this map square: discharge falls as stage rises. |
| West Gates Pass Road (32.2213, -111.1228) | west-gates-pass-road-32-22131-111-12278 | needs_review | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so it may not be this water. |
| West Ina Road (32.3376, -111.1053) | west-ina-road-32-33758-111-10526 | not_on_modeled_reach | The nearest HAND stream is 353 m away, so its rating curve does not describe the water here. |
| West Ina Road at Yuma Mine Wash | west-ina-road-32-33759-111-09519 | needs_review | Our map data says Yuma Mine Wash; NOAA calls the nearest reach Santa Cruz River. |
| West Ina Road (32.3376, -111.0890) | west-ina-road-32-33763-111-08896 | not_on_modeled_reach | The nearest HAND stream is 470 m away, so its rating curve does not describe the water here. |
| West Ina Road (32.3376, -111.0820) | west-ina-road-32-33759-111-08202 | not_on_modeled_reach | The nearest HAND stream is 119 m away, so its rating curve does not describe the water here. |
| West Picture Rocks Road at Picture Rocks Wash Trail | west-picture-rocks-road-32-32598-111-12082 | not_on_modeled_reach | The nearest HAND stream is 775 m away, so its rating curve does not describe the water here. |
| West Speedway Boulevard (32.2369, -111.0387) | west-speedway-boulevard-32-23689-111-03874 | not_on_modeled_reach | The nearest HAND stream is 402 m away, so its rating curve does not describe the water here. |
| West Speedway Boulevard (32.2360, -111.0261) | west-speedway-boulevard-32-23597-111-02611 | not_on_modeled_reach | The nearest HAND stream is 199 m away, so its rating curve does not describe the water here. |
| West Speedway Boulevard at Anklam Wash | west-speedway-boulevard-32-23595-111-02250 | not_on_modeled_reach | The nearest HAND stream is 461 m away, so its rating curve does not describe the water here. |
| West Speedway Boulevard (32.2359, -111.0154) | west-speedway-boulevard-32-23594-111-01540 | not_on_modeled_reach | The nearest HAND stream is 896 m away, so its rating curve does not describe the water here. |
| West Twin Peaks Road (32.3809, -111.1768) | west-twin-peaks-road-32-38086-111-17680 | not_on_modeled_reach | The nearest HAND stream is 1473 m away, so its rating curve does not describe the water here. |
| West Twin Peaks Road (32.3783, -111.1487) | west-twin-peaks-road-32-37825-111-14869 | not_on_modeled_reach | The nearest HAND stream is 3330 m away, so its rating curve does not describe the water here. |
| West Twin Peaks Road (32.3754, -111.1305) | west-twin-peaks-road-32-37543-111-13049 | not_on_modeled_reach | The nearest HAND stream is 1191 m away, so its rating curve does not describe the water here. |
| West Twin Peaks Road (32.3750, -111.1272) | west-twin-peaks-road-32-37504-111-12718 | not_on_modeled_reach | The nearest HAND stream is 950 m away, so its rating curve does not describe the water here. |
| West Twin Peaks Road (32.3746, -111.1236) | west-twin-peaks-road-32-37462-111-12358 | not_on_modeled_reach | The nearest HAND stream is 726 m away, so its rating curve does not describe the water here. |
| West Twin Peaks Road at Santa Cruz River | west-twin-peaks-road-32-37581-111-11538 | not_on_modeled_reach | The nearest HAND stream is 280 m away, so its rating curve does not describe the water here. |
| West Twin Peaks Road (32.3766, -111.1138) | west-twin-peaks-road-32-37655-111-11379 | not_on_modeled_reach | The nearest HAND stream is 155 m away, so its rating curve does not describe the water here. |
