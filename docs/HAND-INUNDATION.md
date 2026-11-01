# Estimated flood extent from NOAA HAND data

On the branch `feature/hand-inundation`, which starts from `main`. PR #7 is open and not merged.

HAND means Height Above Nearest Drainage: how far each piece of land sits above the stream it drains to. NOAA has already computed this, along with catchments (the land draining to each stretch of stream) and rating curves (the water level expected at a given flow). This layer reuses those files. It takes a forecast flow, looks up the water level, and marks land lower than that level as estimated to be wet.

It does not say whether a road can be used. The level it reports is above the modeled stream bed, not depth on a road.

## Is it safe to merge?

Yes, with the limits below. All tests pass, and the PR changes no service code.

**What a merge into `main` brings in:** this PR's own commits only, listed here. It brings in nothing from `experiment/avra-radar-runoff` or `experiment/sfincs-engine`.

- `public/inundation/`: the extent map page, forecast code, clipped NOAA data and check results, about 6.8 MB.
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

## For the owner: one page

**Approve or restore.** The app's level 2 line used to say "Some water around. Usually passable; look as you go." It now says "Some water around. Look as you go." everywhere. To restore it, put the old wording back in `LEVEL_SENTENCE.watch` near the top of `public/app.js`, and in the level 2 line of the legend in `howScreen()`. HAND-raised crossings already use their own line, so restoring it wouldn't attach "passable" to a HAND result on the crossing screen, but the legend would say it.

**Approve or overrule.** HAND raises a level with an official gauge forecast, or on the Santa Cruz only with model flow. On washes it's shown and changes nothing, because the back-test found no useful signal at Brawley Wash.

**Questions only local knowledge can answer. Avra Valley first.**

*Avra Valley*

1. Avra Valley Rd, -111.24501 (Clayton Rd dip): the model's stream, which NOAA calls Los Robles Wash, is 304 m away. Does that wash really feed this dip?
2. Avra Valley Rd, -111.27659 (El Paso Gas Rd dip) and -111.26095: these have no estimate because the nearest modeled stream is 1.2 to 1.6 km away. Is that right, or is a stream missing from NOAA's map?
3. Trico Marana Rd, east of the bridge: NOAA's stream line and OpenStreetMap's river line run up to 175 m apart around 700 m east of the bridge. Where does the channel actually run?
4. Trico Rd south of the gauge: NOAA says overbank flow begins here at 12.25 ft, about 3,000 cfs. Have you seen water on the road at about that flow, and where does it start?
5. Los Robles Wash at Trico Rd: the model flow is near zero on most days. When this wash runs, how fast does it come up compared with the Santa Cruz?

*Picture Rocks and west of Tucson*

6. Yuma Mine Wash on Ina: the model has an estimate here, using a reach NOAA mislabels as Santa Cruz River. Does the estimate look like the real dip?
7. Picture Rocks Wash at Picture Rocks Rd: no estimate, 775 m from a modeled stream. You've called this a dip, so the app relies on rain and other sources here. Is that enough?
8. Kinney Rd at -111.20377 and at Javelina Wash, plus -111.16081 and -111.14537: are these real wash crossings?
9. Gates Pass Rd at -111.12278 and -111.07192: same question.
10. Speedway at -111.0604, -111.05747, -111.05195, -111.04624 and -111.04501: are these real crossings or side channels? Your notes call the Speedway washes unconfirmed.

**Check the Nov 2 Trico forecast.** Recorded early on Nov 1, NOAA's forecast for SCTA3 peaked at 955 cfs on Nov 2 at 15:00 UTC, which is 8 AM Arizona. It may be reissued before then, and the gauge was at 71 cfs when recorded.

1. Open [USGS 09486520](https://waterdata.usgs.gov/monitoring-location/09486520/) and read the discharge around 8 AM Arizona on Nov 2.
2. Compare the peak with 955 cfs, and note how far off the timing is.
3. Check [NOAA's page for SCTA3](https://water.noaa.gov/gauges/SCTA3) for the current forecast. One result doesn't prove the forecast right or wrong, but it's the first real check of a gauge forecast in this work.

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

The Trico gauge forecast still shows a peak of 955 cfs for Nov 2, more than 24 hours out when recorded, with the gauge at 71 cfs tonight and Cortaro upstream at 384. Whether that verifies is worth checking on Nov 2.

## Should the model's high bias be corrected?

No. `tools/hand/bias_test.py` fitted two simple corrections on 2008 to 2015 and checked them on 2016 to 2022, which weren't used for fitting. Brawley was left out, because there's no signal there to correct. Results are in `data/bias-test.json`. This table uses daily means, so its counts are lower than the back-test's hourly peaks.

| Santa Cruz at Trico, 2016 to 2022 | No correction | Subtract base flow | Match percentiles |
|---|---:|---:|---:|
| Average flow, cfs (gauge: 40) | 225 | 97 | 49 |
| Average daily error, cfs | 202 | 88 | 48 |
| Days at 100 cfs or more (gauge: 107) | 2,367 | 650 | 134 |
| Real events over 300 cfs seen, of 28 | 22 | 19 | 15 |
| Real events over 650 cfs seen, of 12 | 9 | 9 | 5 |
| Real events over 1,000 cfs seen, of 10 | 5 | 5 | 4 |
| Real events over 3,000 cfs seen, of 2 | 0 | 0 | 0 |

Cortaro shows the same pattern: average daily error fell from 171 to 92 and 44 cfs, while real events over 650 cfs seen, of 24, went from 12 to 11 and 5.

Percentile matching fixes ordinary days but loses about half the real events, which are the days that matter. Subtracting base flow gives no gain at the flows that can raise a level, around 650 cfs and up. Neither clearly improves what the app uses this flow for, so neither is adopted. The app shows the model's flow as is, with a label saying it reads high.

## Observed flood evidence

**I found no mapped observed flood extent near a supported crossing that could be compared directly.** Where I looked:

- **USGS high-water marks (STN):** the old data service now redirects to a web app, and the addresses I tried for its data either redirected or returned 404. I couldn't query it, so I can't say whether it has Arizona marks.
- **Pima County open GIS:** I searched the layer names on `gisdata.pima.gov`. It has FEMA floodplains, sheet-flooding areas and erosion hazard layers, which are regulatory or modeled, with no observed event extent by name.
- **Web search:** USGS map I-846-B (1974) shows flood hazards for the Marana quadrangle, but predates the 1983 flood and isn't observed extent. The county describes the 1983 flood but publishes no extent layer I could find. USGS has a 1983 inundation report for the Gila River, and I didn't confirm one for the Santa Cruz at Marana.

The county or Town of Marana may hold archived 1983 mapping that isn't public.

**One real comparison was possible: NOAA's written impact statements at the Trico gauge.** These describe what happens, though not as a map. I sampled the estimate along Trico Rd every 20 m, for 2.5 km south of the gauge. 92 of the 125 points south of it have no estimate, so this covers only the stretch near the river.

| Flow (cfs) | NOAA's statement at that level | Estimated wet points on Trico Rd south of the gauge |
|---|---|---|
| 843 | none | 3, within 114 m of the gauge's river crossing |
| 3,000 | "Overbank flow begins on Trico Road just south of bridge" | 3, the same ones |
| 5,000 | "Extensive flooding south of Trico Rd Bridge" | 20, reaching about 480 m or more |
| 8,600 | The Trico and Marana Rd bridges overtopped | 33 |

**What agrees:** the estimate spreads south along Trico Rd as flow rises, which is the direction and order NOAA describes, and most of the growth is between 3,000 and 5,000 cfs. **What doesn't:** NOAA has overbank flow starting at 3,000 cfs, and the estimate doesn't change until somewhere between 3,000 and 5,000. Bridges aren't modeled, so overtopping can't be compared. This comparison stays in this doc; the app doesn't report a value for the road.

## The path mismatch at Trico Marana

Explained, as far as the data can. In the 3 km square, NOAA's HAND stream line follows the National Water Model reach very closely, a median of 2 m apart and at most 7 m. OpenStreetMap's river line is a median of 35 m from HAND's, and at most about 175 m, around 700 m east of the bridge. Along OpenStreetMap's line the HAND value is low, a median of 0.24 m, so that line is in low ground the model treats as near the channel.

So these are two tracings of the same corridor, not different rivers. OpenStreetMap appears to follow a mapped channel, and NOAA follows its own stream network on elevation data. I can't tell from this data which matches today's channel, and the channel may have moved. The difference is too small to matter for a 3 km view, but it could matter for a detail near that bend.

## FEMA flood zones

`tools/hand/check_points.py` compared each supported crossing with FEMA's National Flood Hazard Layer, using the estimated area at 3,000 cfs. Results are in `data/checks.json`. 3,000 cfs is a reference flow and not FEMA's 1% flood, so the estimate should sit inside the zone and cover only part of it.

**Where they agree:**

- All 11 points named Santa Cruz, Los Robles or Brawley on the river or main wash are in Zone AE. The estimate is 95 to 100% inside FEMA's zones, except Twin Peaks at 51%.
- The estimate covers 11 to 54% of the FEMA zone in the square on the Santa Cruz, as expected for a smaller flow.
- Yuma Mine Wash is in Zone A, 85% inside. W Avra Valley -111.24501 is in Zone AO, 100% inside.

**Where they don't:**

- **Twin Peaks at the Santa Cruz (-111.11538):** only 51% inside, which fits its 280 m distance. Treat it with more care.
- **Small washes on Kinney, Gates Pass and Speedway:** most are in Zone X or D, with little or no FEMA hazard zone in the square. FEMA hasn't mapped a floodway on them, so this neither confirms nor contradicts the estimate. Zone D means undetermined.
- **Greasewood Wash on Speedway:** the crossing is in Zone X, and 47% of the estimate is inside FEMA's zones.

## Names and map checks

**Canal-named reaches.** OpenStreetMap's Central Arizona Project canal line is at least 1.5 km from every crossing, so NOAA's "Central Arizona Project Aqueduct" name on those reaches is wrong. They now follow the normal rules. That added back Javelina Wash on Kinney and -111.12278 on Gates Pass. The other 7 stayed out as too far.

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

| Flow source | Modeled level at the highest flow in the next 24 hours | Effect |
|---|---|---|
| Official gauge forecast, Likely match | 2 m or more | Raises the crossing to Caution if it's lower |
| Official gauge forecast | 1 m or more | Raises the crossing to Watch if it's lower |
| Model flow, Santa Cruz, Likely match | 1 m or more | Raises the crossing to Watch if it's lower |
| Model flow elsewhere | Any | Shown, changes nothing |
| Any | Under 1 m or zero | Changes nothing. Says low flow doesn't mean dry. |

- HAND is named on the card when it's at or above the crossing's level, so it outranks a calm rainfall outlook.
- **HAND never lowers a level.** It leaves out local runoff, and most reaches here forecast about zero, so a zero isn't evidence of dry. Rain-driven cautions stay as they are, and both show.
- HAND alone never reaches the top level, Danger.
- An old or failed forecast raises nothing. A peak more than 24 hours away raises nothing either, and the row says when its flow is expected.
- The alerts screen's Test button sends the app's current numbers, so it can include a HAND raise. Scheduled texts and pushes don't.

This is less weight than the owner asked for on washes, because the back-test doesn't support more there. That choice is the owner's to overrule.

## Failure behavior and download size

HAND loads after the first screen, so it can't hold that screen up. Tested in a browser by intercepting requests:

| Situation | What the page did |
|---|---|
| NOAA hanging | Main screen updated in about 1 second; HAND calls time out by 10 seconds |
| NOAA down | Rating unchanged; HAND row says it has no forecast flow |
| Junk replies | Same as down |
| Half the calls failing | Crossings with a working source are unaffected; others say no forecast flow |
| Corrupt `coverage.json` | Rating unchanged; page says HAND isn't responding |
| Back to normal | HAND returned without a reload |

Until a new result arrives, the last HAND result is kept, so a crossing's number doesn't flicker on each refresh. A failure inside HAND can't take down the ratings, and a redraw never happens over a form someone is filling in.

**Download:** HAND adds 16 requests on the main page each load, at about 147 KB before compression and about 25 KB after, since GitHub Pages compresses these files. 5 are local files and 11 are small NOAA calls, finished about 0.9 seconds after they started on this connection. **I did not test on a real phone or a slow connection.** None of the 6.2 MB of crossing grids load on the main page. The map page loads one crossing's grid, 150 to 400 KB, only when that crossing is chosen.

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

- No estimate has been compared with a mapped flood extent or photos. See "Observed flood evidence".
- Medium and long-range forecasts are not used. NOAA's reach endpoint returned a medium-range series once tonight, then empty results in three later checks, while short range and analysis kept working. It isn't reliable enough to build on, so this is a dead end for now. Only the 18-hour short range is used.

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
