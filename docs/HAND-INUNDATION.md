# Estimated flood extent from NOAA HAND data

On the branch `feature/hand-inundation`, which starts from `main`. PR #7 is open and not merged.

HAND means Height Above Nearest Drainage: how far each piece of land sits above the stream it drains to. NOAA has already computed this, along with catchments (the land draining to each stretch of stream) and rating curves (the water level expected at a given flow). This layer reuses those files. It takes a forecast flow, looks up the water level, and marks land lower than that level as estimated to be wet.

It does not say whether a road can be used. The level it reports is above the modeled stream bed, not depth on a road.

## Is it safe to merge?

Yes, with the limits below. All tests pass, and the PR changes no service code.

**What a merge into `main` brings in:** this PR's own commits only, listed here. It brings in nothing from `experiment/avra-radar-runoff` or `experiment/sfincs-engine`.

- `public/inundation/`: the extent map page, forecast code, clipped NOAA data and check results, about 6.5 MB.
- `public/hand-model.js` and small changes to `public/app.js`, `public/index.html` and `public/style.css`.
- `tools/hand/`, this doc, two test files, and one line each in `.gitignore` and `.gitattributes`.

**Don't merge `experiment/hand-inundation`.** That was the first version, built on `experiment/avra-radar-runoff`, so merging it would bring in the radar and forecast experiments too. This branch replaces it.

**What a merge triggers:**

- `deploy-service.yml` does not run. The PR touches none of its paths (`public/config.js`, `public/logic.js`, `public/engine.js`, `apps-script/**`, `tools/build_gas.mjs`).
- `pages.yml` runs tests on `main`, but it only publishes from the default branch. The site changes when `main` is pushed to `ccr-ae06b197-a01a6o`.

**What changes for app users once published:**

- Route numbers can rise where HAND raises a crossing, and that can change the recommended route.
- Texts and push alerts come from the alert service, which doesn't use HAND, so **a text and the app can show different numbers**.
- The phrase "usually passable" is gone from the app's level 2 wording, on every crossing, because HAND can appear on any of them. It's now "Some water around. Look as you go." The owner may want to review this, since it was the owner's existing copy.

## Results for every crossing

`python tools/hand/hand_tool.py` checked all 52 distinct crossing points in `public/data/crossings.geojson` against the real NOAA files. **25 are supported. 27 are not**, and the app lists those as missing coverage with the reason. No data was filled in to raise the count.

| Result | Points | Meaning |
|---|---|---|
| `supported` | 25 | Has an estimate and a match rating. |
| `too_far` | 25 | The modeled stream is more than 310 m away, or more than 100 m away with no name. |
| `build_refused` | 2 | The rating curve is unusable: a sliver of a big river at Twin Peaks -111.11379, and a flat curve at Silvercroft Wash on Speedway. |

The rule, set by the owner: too-far points are left out, not scored low. Points within 100 m are matched. Between 100 and 310 m a point is matched only if its stream has a name. The 310 m limit comes from West Avra Valley Road at -111.24501, 304 m from Los Robles Wash, which the owner accepted as likely. Beyond that point, the limit also lets in Twin Peaks Road at 280 m. Crossings named in the owner's notes: N Sanders (32.43484) and W Avra Valley -111.14714 are Santa Cruz River, and -111.24501 is Los Robles Wash. All three are supported. W Avra Valley -111.26095 and -111.27659 are `too_far`.

**Only 3 points have a gauge forecast.** They are Trico Marana and the two Sanders Road points. The other 22 use model flow.

## What the back-test found

`tools/hand/backtest.py` compared National Water Model (NWM) v3.0 historical flow with USGS daily flow, 2008 to 2022, 5,479 days at 3 gauges. Results are in `data/backtest.json`.

This is a **best case for the model**: the history was run on observed weather, and real forecasts use predicted weather. It tests flow only, not the extent. USGS daily means understate flash peaks, so the table counts a modeled event as backed by the gauge if the gauge's daily mean reached half the threshold within a day. That favors the model.

| Gauge | Threshold (cfs) | Real events | Model saw within a day | Model events | Backed by gauge |
|---|---:|---:|---:|---:|---:|
| Santa Cruz at Trico | 300 | 55 | 46 | 66 | 40 |
| | 650 | 22 | 18 | 41 | 28 |
| | 1,000 | 17 | 11 | 27 | 16 |
| | 3,000 | 2 | 2 | 8 | 6 |
| | 5,000 | 1 | 0 | 2 | 0 |
| Santa Cruz at Cortaro | 300 | 62 | 53 | 78 | 48 |
| | 650 | 35 | 25 | 49 | 35 |
| | 1,000 | 22 | 12 | 31 | 19 |
| | 3,000 | 5 | 4 | 9 | 7 |
| | 5,000 | 1 | 0 | 6 | 4 |
| Brawley Wash | 300 | 11 | 0 | 6 | 0 |
| | 650 | 2 | 0 | 4 | 0 |
| | 1,000 | 1 | 0 | 3 | 0 |

Other results:

- **It reads too high on ordinary days.** At Trico the daily mean was at least 100 cfs on 5,201 modeled days against 209 real ones. The average was 215 cfs modeled against 39 real.
- **Big events are often the wrong size.** On Jul 25, 2021, Trico's daily mean was 6,020 cfs, and the model's hourly peak within a day was 3,031. On Aug 21, 2022, the gauge's daily mean was 2,330 and the model peaked at 4,730.
- **Brawley Wash had no useful signal.** On Aug 17, 2021, the gauge's daily mean was 1,670 cfs and the model's hourly peak within a day was 24.

**What I changed because of this:**

- Model flow can't raise a crossing above Watch, and can raise one only on the Santa Cruz main stem. On washes it's shown but changes nothing.
- The 1 m and 2 m steps stay. On the Trico curve they fall at about 650 and 3,000 cfs. The back-test doesn't contradict that, but it has only 2 real events at 3,000 cfs at Trico, which is too few to tune on.
- The rating weights stay. Model flow already scores low at 8 of 25 points. The rating is about the match, and I found no evidence for a better number.

**Not tested:** NOAA's official gauge forecasts have no archive I could reach, so they have not been back-tested. They are trusted more than model flow only because they come from a forecaster using gauge readings, and no number supports that here. Small washes other than Brawley have no gauge to test against.

## A false alarm found and fixed

On live data tonight, the app showed Avra Valley Rd bridge at 3 Moderate with "8.0 ft at 593 cfs", while the river was running about 384 cfs at Cortaro and 71 at Trico.

The cause was a bad curve choice. NOAA's data has two catchments on that reach at the bridge. My tool picked the nearer one, a sliver 0.84 sq km with a channel 7.5 m wide, instead of the river's own, at 13.9 sq km and 96 m wide. The tool now prefers the river's own branch and refuses slivers on big rivers. The same bridge now reads 3.0 ft at 593 cfs, under the Watch step, and stays at 2 Minor from the real Cortaro reading.

The Santa Cruz at Trico gauge forecast still shows a peak of 955 cfs for Nov 2, with the gauge at 71 cfs tonight and Cortaro upstream at 384. Whether that verifies is worth checking on Nov 2.

## FEMA flood zones

`tools/hand/check_points.py` compared each supported crossing with FEMA's National Flood Hazard Layer, using the estimated area at 3,000 cfs. Results are in `data/checks.json`. 3,000 cfs is a reference flow and not FEMA's 1% flood, so the estimate should sit inside the zone and cover only part of it.

**Where they agree:**

- At all 9 Santa Cruz and Los Robles or Brawley points with a FEMA zone, the crossing is in Zone AE. The estimate is 95 to 100% inside FEMA's zones, except Twin Peaks at 51%.
- The estimate covers 11 to 54% of the FEMA zone in the square on the Santa Cruz, as expected for a smaller flow.
- Yuma Mine Wash is in Zone A, 85% inside. W Avra Valley -111.24501 is in Zone AO, 100% inside.

**Where they don't:**

- **Twin Peaks at the Santa Cruz (-111.11538):** only 51% inside, which fits its 280 m distance. Treat it with more care.
- **Small washes on Kinney, Gates Pass and Speedway:** most are in Zone X or D, with little or no FEMA hazard zone in the square. FEMA hasn't mapped a floodway on them, so this neither confirms nor contradicts the estimate. Zone D means undetermined.
- **Greasewood Wash on Speedway:** the crossing is in Zone X, and 47% of the estimate is inside FEMA's zones.

## Names and map checks

**Canal-named reaches.** OpenStreetMap's Central Arizona Project canal line is at least 1.5 km from every crossing, so NOAA's "Central Arizona Project Aqueduct" name on those reaches is wrong. They now follow the normal rules. That added back Javelina Wash on Kinney and -111.12278 on Gates Pass. The other 8 stayed out as too far.

**"Santa Cruz River" on tiny reaches.** NOAA also uses this name on small reaches far from the river. The tool ignores it on reaches below stream order 5. That brought in Yuma Mine Wash, which OpenStreetMap also names at that spot, and removed Ina Road -111.08202, 119 m from an unnamed stream.

**The location-only matches.** I removed none as clearly not real crossings. Each has a mapped stream within a few metres in OpenStreetMap, but none has a name from both sources.

| Point | Status | For the owner to check |
|---|---|---|
| Sanders Rd 32.43484 | Same bridge as 32.43488, 4 m away | Duplicate of a named point, harmless |
| Avra Valley Rd -111.14714, -111.14566 | Same bridge as -111.14614 | Duplicates, harmless |
| Kinney Rd -111.20377 | NOAA says Brawley Wash; FEMA Zone D | Is there a dip here? |
| Kinney Rd -111.16081, -111.14537 | Unnamed; FEMA Zone X | Your notes call these unconfirmed |
| Gates Pass -111.12278, -111.07192 | Unnamed; FEMA Zone X | Your notes call these unconfirmed |
| Speedway -111.0604 | Unnamed, FEMA Zone AE, 94% inside | Probably a real drainage |
| Speedway -111.05747, -111.05195, -111.04624, -111.04501 | Unnamed; FEMA Zone X | May be side channels. Your notes call Speedway washes unconfirmed |
| Avra Valley Rd -111.24501 | 304 m from Los Robles Wash, FEMA Zone AO | Accepted by the owner |

## The match rating

Each supported crossing shows a rating out of 100 and its factors. **It rates how well the stream data matches the crossing. It is not a measured probability.** No ± figure is given, because nothing here measures one.

| Factor | Points | How |
|---|---:|---|
| Distance to modeled stream | 40 | Full within 50 m, falling to zero at 1,500 m |
| Water name | 25 | Both agree 25, one source names it 10, neither names it 5 |
| Flow source | 25 | Gauge forecast 25, less 1 point per 1.6 km along the channel; model flow 8 |
| Rating curve | 10 | Calibrated to gauge readings 10, otherwise 0. None here are calibrated, so the highest possible today is 90. |

65 or more is a Likely match, below that a Possible match. The weights and cutoffs are my judgment, not fitted to any data.

## In the main app

Each crossing the app rates, where it matches a point in the list, now shows **HAND flood model** first among its sources. The row gives the modeled level and flow, with the match rating and factors, flow source, source age and uncertainty behind it, and a link to the extent map. Crossings with no estimate show the reason.

How it weighs against other sources, in `public/hand-model.js`:

| Flow source | Modeled level at the forecast peak | Effect |
|---|---|---|
| Official gauge forecast, Likely match | 2 m or more | Raises the crossing to Caution if it's lower |
| Official gauge forecast | 1 m or more | Raises the crossing to Watch if it's lower |
| Model flow, Santa Cruz, Likely match | 1 m or more | Raises the crossing to Watch if it's lower |
| Model flow elsewhere | Any | Shown, changes nothing |
| Any | Under 1 m or zero | Changes nothing. Says low flow doesn't mean dry. |

- HAND is named on the card when it's at or above the crossing's level, so it outranks a calm rainfall outlook.
- **HAND never lowers a level.** It leaves out local runoff, and most reaches here forecast about zero, so a zero isn't evidence of dry. Rain-driven cautions stay as they are, and both show.
- HAND alone never reaches the top level, Danger.
- An old or failed forecast raises nothing.

This is less weight than the owner asked for on washes, because the back-test doesn't support more there. That choice is the owner's to overrule.

The app calls NOAA for each matched reach on every refresh, about a dozen reaches in all.

## What was checked

- The reach, rating curves and terrain come from the real files, and each file records the size, date and ETag of its sources.
- A catchment with a broken rating curve shows no estimate, and the rest of the square still works.
- The clipped grid was compared with the same calculation on NOAA's original 10 m grid, and a test requires agreement within 2% or 0.5 hectares. This shows the clipping is faithful, not that the estimate matches real floods.
- The app and map page were opened in a browser at desktop and phone size, with live NOAA forecasts.
- The Caution step was tested in a browser by injecting a simulated 5,000 cfs gauge forecast into that session only, and it showed 3 Moderate. A simulated zero flow at Avra Valley bridge left its river-driven level 2 in place. Neither is shipped.

## Uncertainty

**Rating curve compared with NOAA's gauge at Trico.** The two use different zero points, so only the rises can be compared.

| Flow (cfs) | NOAA stage (ft) | HAND stage (ft) |
|---|---:|---:|
| 843 | 7.06 | 4.04 |
| 3,000 | 12.25 | 6.83 |
| 5,000 | 14.00 | 8.13 |
| 8,600 | 15.50 | 9.84 |
| 15,000 | 17.00 | 11.99 |

From 843 to 3,000 cfs NOAA's stage rises 5.19 ft and HAND's rises 2.79 ft. From 3,000 to 15,000 cfs NOAA's rises 4.75 ft and HAND's rises 5.16 ft.

**Known limits, also shown on screen:**

- Rating curves are not calibrated to gauge readings.
- Most points use modeled flow for a whole reach, not a reading.
- Bridges, culverts and berms aren't modeled.
- Side washes and local runoff are not included. Local storms are the main flood source on small washes, so this matters most there.
- The half and double flow shading on the map shows sensitivity only.

**Not done:**

- No estimate has been compared with an observed flood extent or photos.
- East of the Trico Marana crossing, the estimated area and OpenStreetMap's river line appear to take different paths. The cause is unknown.
- Medium and long-range forecasts are not used. NOAA's reach endpoint returned a medium-range series once tonight, then empty results in two checks of 4 reaches, so it isn't reliable enough to build on. Only the 18-hour short range is used.

## Source and age

- Files: `https://ciroh-owp-hand-fim.s3.amazonaws.com/`, a public copy of NOAA OWP HAND FIM hosted by CIROH. NOAA's own bucket charges the requester and refuses anonymous reads, so it could not be compared directly.
- Age: uploaded in August 2024. The bucket states no FIM version, so the app shows the upload date and its age.

## Running it again

```bash
python -m pip install -r tools/hand/requirements.txt
```

```bash
python tools/hand/check_points.py
```

```bash
python tools/hand/hand_tool.py
```

`hand_tool.py` rechecks every crossing, including new ones in `crossings.geojson`, and rewrites `coverage.json`. It reads the canal distances from `checks.json`, and `check_points.py` needs `coverage.json` to exist, so run `hand_tool.py` first on a clean checkout, then both again. Recorded forecasts in `data/nwm/` are kept; delete them to record fresh ones. `tools/hand/backtest.py` needs `zarr`, `s3fs` and `xarray` too. Then update the counts and table in this file and run the tests:

```bash
npm test
```

```bash
python -m unittest discover -s tools/hand
```

Set `HAND_CACHE` to a short path on Windows if the default cache folder causes path errors.

## Every crossing

| Crossing | Id | Result | Rating | Flow source or reason |
|---|---|---|---:|---|
| West Trico Marana Road at Santa Cruz River | `west-trico-marana-road-32-45369-111-27985` | supported | 88, Likely match | Gauge SCTA3 |
| North Sanders Road at Santa Cruz River | `north-sanders-road-32-43488-111-23395` | supported | 84, Likely match | Gauge SCTA3 |
| North Trico Road at Los Robles Wash | `north-trico-road-32-43882-111-30426` | supported | 73, Likely match | NWM reach 945050482 |
| West Avra Valley Road at Brawley Wash | `west-avra-valley-road-32-39322-111-29459` | supported | 73, Likely match | NWM reach 945050510 |
| West Avra Valley Road at Santa Cruz River | `west-avra-valley-road-32-40256-111-14614` | supported | 73, Likely match | NWM reach 15890430 |
| West Speedway Boulevard at Santa Cruz River | `west-speedway-boulevard-32-23567-110-98614` | supported | 73, Likely match | NWM reach 15904697 |
| West Avra Valley Road at Santa Cruz River | `west-avra-valley-road-32-40271-111-14566` | supported | 72, Likely match | NWM reach 15890430 |
| West Ina Road at Santa Cruz River | `west-ina-road-32-33759-111-08151` | supported | 72, Likely match | NWM reach 15902409 |
| North Sanders Road at Santa Cruz River (NOAA name) | `north-sanders-road-32-43484-111-23395` | supported | 69, Likely match | Gauge SCTA3 |
| West Twin Peaks Road at Santa Cruz River | `west-twin-peaks-road-32-37581-111-11538` | supported | 67, Likely match | NWM reach 15902363 |
| North Kinney Road at Brawley Wash (NOAA name) | `north-kinney-road-32-25678-111-20377` | supported | 58, Possible match | NWM reach 15876809 |
| North Kinney Road at Javelina Wash | `north-kinney-road-32-25426-111-19875` | supported | 58, Possible match | NWM reach 15877613 |
| West Avra Valley Road at Santa Cruz River (NOAA name) | `west-avra-valley-road-32-40224-111-14714` | supported | 58, Possible match | NWM reach 15890430 |
| West Ina Road at Yuma Mine Wash | `west-ina-road-32-33759-111-09519` | supported | 58, Possible match | NWM reach 15902411 |
| West Speedway Boulevard at Greasewood Wash | `west-speedway-boulevard-32-23597-111-02886` | supported | 58, Possible match | NWM reach 15903151 |
| North Kinney Road (32.2415, -111.1608) | `north-kinney-road-32-24151-111-16081` | supported | 53, Possible match | NWM reach 15876825 |
| North Kinney Road (32.2314, -111.1454) | `north-kinney-road-32-23141-111-14537` | supported | 53, Possible match | NWM reach 15877617 |
| West Gates Pass Road (32.2213, -111.1228) | `west-gates-pass-road-32-22131-111-12278` | supported | 53, Possible match | NWM reach 15876845 |
| West Gates Pass Road (32.2297, -111.0719) | `west-gates-pass-road-32-22970-111-07192` | supported | 53, Possible match | NWM reach 15902505 |
| West Speedway Boulevard (32.2361, -111.0604) | `west-speedway-boulevard-32-23606-111-06040` | supported | 53, Possible match | NWM reach 15903149 |
| West Speedway Boulevard (32.2360, -111.0575) | `west-speedway-boulevard-32-23604-111-05747` | supported | 53, Possible match | NWM reach 15903143 |
| West Speedway Boulevard (32.2377, -111.0520) | `west-speedway-boulevard-32-23766-111-05195` | supported | 53, Possible match | NWM reach 15903143 |
| West Speedway Boulevard (32.2390, -111.0462) | `west-speedway-boulevard-32-23899-111-04624` | supported | 53, Possible match | NWM reach 15903143 |
| West Speedway Boulevard (32.2390, -111.0450) | `west-speedway-boulevard-32-23899-111-04501` | supported | 53, Possible match | NWM reach 15903143 |
| West Avra Valley Road at Los Robles Wash (NOAA name) | `west-avra-valley-road-32-40131-111-24501` | supported | 51, Possible match | NWM reach 15877577 |
| North Kinney Road (32.2516, -111.1865) | `north-kinney-road-32-25158-111-18652` | too_far | none | The nearest HAND stream is 577 m away, over the 310 m limit. |
| North Kinney Road (32.2477, -111.1835) | `north-kinney-road-32-24767-111-18349` | too_far | none | The nearest HAND stream is 520 m away, over the 310 m limit. |
| North Kinney Road (32.2471, -111.1676) | `north-kinney-road-32-24705-111-16760` | too_far | none | The nearest HAND stream is 163 m away and has no name, so it can't be matched past 100 m. |
| North Kinney Road (32.2440, -111.1634) | `north-kinney-road-32-24402-111-16343` | too_far | none | The nearest HAND stream is 347 m away, over the 310 m limit. |
| North Kinney Road (32.2292, -111.1437) | `north-kinney-road-32-22917-111-14371` | too_far | none | The nearest HAND stream is 204 m away and has no name, so it can't be matched past 100 m. |
| North Kinney Road (32.2272, -111.1408) | `north-kinney-road-32-22722-111-14078` | too_far | none | The nearest HAND stream is 449 m away, over the 310 m limit. |
| North Kinney Road (32.2246, -111.1360) | `north-kinney-road-32-22457-111-13596` | too_far | none | The nearest HAND stream is 960 m away, over the 310 m limit. |
| North Kinney Road (32.2223, -111.1326) | `north-kinney-road-32-22235-111-13260` | too_far | none | The nearest HAND stream is 784 m away, over the 310 m limit. |
| North Sandario Road (32.2743, -111.2185) | `north-sandario-road-32-27434-111-21849` | too_far | none | The nearest HAND stream is 434 m away, over the 310 m limit. |
| North Sandario Road (32.2753, -111.2182) | `north-sandario-road-32-27528-111-21817` | too_far | none | The nearest HAND stream is 535 m away, over the 310 m limit. |
| West Avra Valley Road at Brawley Wash (NOAA name) | `west-avra-valley-road-32-39329-111-27659` | too_far | none | The nearest HAND stream is 1610 m away, over the 310 m limit. |
| West Avra Valley Road at Los Robles Wash (NOAA name) | `west-avra-valley-road-32-39514-111-26095` | too_far | none | The nearest HAND stream is 1157 m away, over the 310 m limit. |
| West Ina Road (32.3376, -111.1053) | `west-ina-road-32-33758-111-10526` | too_far | none | The nearest HAND stream is 353 m away, over the 310 m limit. |
| West Ina Road (32.3376, -111.0890) | `west-ina-road-32-33763-111-08896` | too_far | none | The nearest HAND stream is 470 m away, over the 310 m limit. |
| West Ina Road (32.3376, -111.0820) | `west-ina-road-32-33759-111-08202` | too_far | none | The nearest HAND stream is 119 m away and has no name, so it can't be matched past 100 m. |
| West Picture Rocks Road at Picture Rocks Wash Trail | `west-picture-rocks-road-32-32598-111-12082` | too_far | none | The nearest HAND stream is 775 m away, over the 310 m limit. |
| West Speedway Boulevard (32.2369, -111.0387) | `west-speedway-boulevard-32-23689-111-03874` | too_far | none | The nearest HAND stream is 402 m away, over the 310 m limit. |
| West Speedway Boulevard (32.2360, -111.0261) | `west-speedway-boulevard-32-23597-111-02611` | too_far | none | The nearest HAND stream is 199 m away and has no name, so it can't be matched past 100 m. |
| West Speedway Boulevard at Anklam Wash | `west-speedway-boulevard-32-23595-111-02250` | too_far | none | The nearest HAND stream is 461 m away, over the 310 m limit. |
| West Speedway Boulevard (32.2359, -111.0154) | `west-speedway-boulevard-32-23594-111-01540` | too_far | none | The nearest HAND stream is 896 m away, over the 310 m limit. |
| West Speedway Boulevard at Silvercroft Wash | `west-speedway-boulevard-32-23568-111-00225` | build_refused | none | Its rating curve gives only 0.1 ft at 3,000 cfs, too flat to be believable. |
| West Twin Peaks Road (32.3809, -111.1768) | `west-twin-peaks-road-32-38086-111-17680` | too_far | none | The nearest HAND stream is 1473 m away, over the 310 m limit. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37825-111-14869` | too_far | none | The nearest HAND stream is 3330 m away, over the 310 m limit. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37543-111-13049` | too_far | none | The nearest HAND stream is 1191 m away, over the 310 m limit. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37504-111-12718` | too_far | none | The nearest HAND stream is 950 m away, over the 310 m limit. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37462-111-12358` | too_far | none | The nearest HAND stream is 726 m away, over the 310 m limit. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37655-111-11379` | build_refused | none | This catchment models a stream-order 6 river as a channel 8 m wide on 1.3 sq km, so its rating curve runs too high. |
