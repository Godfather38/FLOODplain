# Estimated flood extent from NOAA HAND data

On the branch `feature/hand-inundation`, which starts from `main`. PR #7 is open and not merged.

HAND means Height Above Nearest Drainage: how far each piece of land sits above the stream it drains to. NOAA has already computed this, along with catchments (the land draining to each stretch of stream) and rating curves (the water level expected at a given flow). This layer reuses those files. It takes a forecast flow, looks up the water level, and marks land lower than that level as estimated to be wet.

It does not say whether a road can be used. The level it reports is above the modeled stream bed, not depth on a road.

## Is it safe to merge?

Yes, with the limits below. All tests pass, and the PR changes no service code.

**What a merge into `main` brings in:** this PR's own commits only, listed here. It brings in nothing from `experiment/avra-radar-runoff` or `experiment/sfincs-engine`.

- `public/inundation/`: the extent map page, forecast code and clipped NOAA data, about 6.5 MB.
- `public/hand-model.js` and small changes to `public/app.js`, `public/index.html` and `public/style.css`.
- `tools/hand/`, this doc, two test files, and one line each in `.gitignore` and `.gitattributes`.

**Don't merge `experiment/hand-inundation`.** That was the first version, built on `experiment/avra-radar-runoff`, so merging it would bring in the radar and forecast experiments too. This branch replaces it.

**What a merge triggers:**

- `deploy-service.yml` does not run. The PR touches none of its paths (`public/config.js`, `public/logic.js`, `public/engine.js`, `apps-script/**`, `tools/build_gas.mjs`).
- `pages.yml` runs tests on `main`, but it only publishes from the default branch. The site changes when `main` is pushed to `ccr-ae06b197-a01a6o`.

**What changes for app users once published:** route numbers can rise, because modeled water can raise a crossing's level. That can change which route the app recommends. Texts and push alerts come from the alert service, which doesn't use HAND, so **a text and the app can show different numbers**.

## Results for every crossing

`python tools/hand/hand_tool.py` checked all 52 distinct crossing points in `public/data/crossings.geojson` against the real NOAA files. **25 are supported. 27 are not**, and the app lists those as missing coverage with the reason. No data was filled in to raise the count.

| Result | Points | Meaning |
|---|---|---|
| `supported` | 25 | Has an estimate and a match rating. |
| `too_far` | 17 | The modeled stream is more than 310 m away, or more than 100 m away with no name. |
| `wrong_water` | 10 | NOAA's reach has a canal name, or NOAA and our map name different water. |

The rule, set by the owner: too-far points are left out, not scored low. Points within 100 m are matched. Between 100 and 310 m a point is matched only if its stream has a name. The 310 m limit comes from West Avra Valley Road at -111.24501, 304 m from Los Robles Wash, which the owner accepted as likely. Beyond the owner's named points, this limit also lets in Ina Road at 119 m and Twin Peaks Road at 155 and 280 m.

**Reaches named "Central Arizona Project Aqueduct".** All of them are left out. I did not confirm whether each is really the canal or a wrong name. If any is really a wash, it could be added after a local check.

**Local knowledge overrides all of this.** In particular:

- Yuma Mine Wash and Picture Rocks Wash have no estimate.
- Some matched points have no water name from either source, including several on Speedway Boulevard. They may be side channels or a stretch running alongside a road.
- One Speedway point near -111.06 is on a reach NOAA names Santa Cruz River, well west of the actual river. The name may be wrong.

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

Each crossing the app rates, where it matches a supported point, now lists **HAND flood model** first among its sources. The row gives the modeled level and flow, with the match rating and factors, flow source, source age and uncertainty behind it, and a link to the extent map.

How it weighs against other sources, in `public/hand-model.js`:

| Modeled level at the forecast peak | Effect |
|---|---|
| 2 m or more, Likely match | Raises the crossing to Caution if it's lower |
| 1 m or more | Raises the crossing to Watch if it's lower. A Possible match goes no higher than this. |
| Under 1 m, or zero | Changes nothing. Says low model flow doesn't mean dry. |

- HAND is named on the card when it's at or above the crossing's level, so it outranks a calm rainfall outlook.
- **HAND never lowers a level.** It leaves out local runoff, and most reaches here forecast about zero, so a zero isn't evidence of dry. Rain-driven cautions stay as they are, and both show.
- HAND alone never reaches the top level, Danger.
- An old or failed forecast raises nothing.
- 1 m and 2 m are display steps I chose. NOAA's action-stage flow at Trico (3,000 cfs) models at about 2 m on this curve, and they have only been checked against that one spot.

On a crossing HAND has raised, the app's usual "Usually passable" line is replaced, so that wording isn't attached to a HAND result. The app's general legend still uses that phrase for level 2, because it was there before this work.

The app calls NOAA for each matched reach on every refresh, about 10 reaches in all.

## What was checked

- The reach, rating curves and terrain come from the real files, and each file records the size, date and ETag of its sources.
- A catchment with a broken rating curve shows no estimate, and the rest of the square still works. A crossing whose own catchment has a broken curve would be refused. None were.
- All 23 reaches returned a National Water Model (NWM) short-range forecast, 18 hourly points, recorded in `data/nwm/`.
- A gauge is used only when it's linked along the channel and within 10 km, which applies to 3 points near Trico. The rest use NWM.
- The clipped grid was compared with the same calculation on NOAA's original 10 m grid, and a test requires agreement within 2% or 0.5 hectares. This shows the clipping is faithful, not that the estimate matches real floods.
- The page and the main app were opened in a browser at desktop and phone size, with live NOAA forecasts.

## Uncertainty

**Modeled flow compared with measured flow, one moment only** (Nov 1, 2026, about 1 AM Arizona, NWM 06:00 UTC run):

| Gauge | NWM first hour (cfs) | USGS measured (cfs) |
|---|---:|---:|
| Santa Cruz at Trico | 173 | 71 |
| Santa Cruz at Cortaro | 361 | 384 |
| Brawley Wash near Three Points | 3.9 | 0 |

This is one snapshot during a modest flow. It isn't an error range. No forecast has been compared with what later happened.

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

- No estimate has been compared with an observed flood extent, photos, or FEMA maps.
- East of the Trico Marana crossing, the estimated area and OpenStreetMap's river line appear to take different paths. The cause is unknown.
- Medium and long-range NWM forecasts are not used. Only the 18-hour short range is.
- There was no flood during testing, so the Caution step was only exercised in tests.

## Source and age

- Files: `https://ciroh-owp-hand-fim.s3.amazonaws.com/`, a public copy of NOAA OWP HAND FIM hosted by CIROH. NOAA's own bucket charges the requester and refuses anonymous reads, so it could not be compared directly.
- Age: uploaded in August 2024. The bucket states no FIM version, so the app shows the upload date and its age.

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

| Crossing | Id | Result | Rating | Flow source or reason |
|---|---|---|---:|---|
| West Trico Marana Road at Santa Cruz River | `west-trico-marana-road-32-45369-111-27985` | supported | 88, Likely match | Gauge SCTA3 |
| North Sanders Road at Santa Cruz River | `north-sanders-road-32-43488-111-23395` | supported | 84, Likely match | Gauge SCTA3 |
| North Trico Road at Los Robles Wash | `north-trico-road-32-43882-111-30426` | supported | 73, Likely match | NWM reach 945050482 |
| West Avra Valley Road at Brawley Wash | `west-avra-valley-road-32-39322-111-29459` | supported | 73, Likely match | NWM reach 945050510 |
| West Avra Valley Road at Santa Cruz River | `west-avra-valley-road-32-40256-111-14614` | supported | 73, Likely match | NWM reach 15890430 |
| West Speedway Boulevard at Santa Cruz River | `west-speedway-boulevard-32-23567-110-98614` | supported | 73, Likely match | NWM reach 15904697 |
| West Avra Valley Road at Santa Cruz River | `west-avra-valley-road-32-40271-111-14566` | supported | 72, Likely match | NWM reach 15890430 |
| West Ina Road at Santa Cruz River | `west-ina-road-32-33759-111-08151` | supported | 72, Likely match | NWM reach 15902439 |
| North Sanders Road at Santa Cruz River (NOAA name) | `north-sanders-road-32-43484-111-23395` | supported | 69, Likely match | Gauge SCTA3 |
| West Twin Peaks Road at Santa Cruz River | `west-twin-peaks-road-32-37581-111-11538` | supported | 67, Likely match | NWM reach 15902363 |
| North Kinney Road at Brawley Wash (NOAA name) | `north-kinney-road-32-25678-111-20377` | supported | 58, Possible match | NWM reach 15876809 |
| West Avra Valley Road at Santa Cruz River (NOAA name) | `west-avra-valley-road-32-40224-111-14714` | supported | 58, Possible match | NWM reach 15890430 |
| West Speedway Boulevard at Santa Cruz River (NOAA name) | `west-speedway-boulevard-32-23606-111-06040` | supported | 58, Possible match | NWM reach 15903149 |
| West Speedway Boulevard at Greasewood Wash | `west-speedway-boulevard-32-23597-111-02886` | supported | 58, Possible match | NWM reach 15903151 |
| West Speedway Boulevard at Silvercroft Wash | `west-speedway-boulevard-32-23568-111-00225` | supported | 58, Possible match | NWM reach 15903147 |
| West Ina Road at Santa Cruz River (NOAA name) | `west-ina-road-32-33759-111-08202` | supported | 56, Possible match | NWM reach 15902439 |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37655-111-11379` | supported | 55, Possible match | NWM reach 15902363 |
| North Kinney Road (32.2415, -111.1608) | `north-kinney-road-32-24151-111-16081` | supported | 53, Possible match | NWM reach 15876825 |
| North Kinney Road (32.2314, -111.1454) | `north-kinney-road-32-23141-111-14537` | supported | 53, Possible match | NWM reach 15877617 |
| West Gates Pass Road (32.2297, -111.0719) | `west-gates-pass-road-32-22970-111-07192` | supported | 53, Possible match | NWM reach 15902505 |
| West Speedway Boulevard (32.2360, -111.0575) | `west-speedway-boulevard-32-23604-111-05747` | supported | 53, Possible match | NWM reach 15903143 |
| West Speedway Boulevard (32.2377, -111.0520) | `west-speedway-boulevard-32-23766-111-05195` | supported | 53, Possible match | NWM reach 15903143 |
| West Speedway Boulevard (32.2390, -111.0462) | `west-speedway-boulevard-32-23899-111-04624` | supported | 53, Possible match | NWM reach 15903143 |
| West Speedway Boulevard (32.2390, -111.0450) | `west-speedway-boulevard-32-23899-111-04501` | supported | 53, Possible match | NWM reach 15903143 |
| West Avra Valley Road at Los Robles Wash (NOAA name) | `west-avra-valley-road-32-40131-111-24501` | supported | 51, Possible match | NWM reach 15877577 |
| North Kinney Road at Javelina Wash | `north-kinney-road-32-25426-111-19875` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| North Kinney Road (32.2516, -111.1865) | `north-kinney-road-32-25158-111-18652` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| North Kinney Road (32.2477, -111.1835) | `north-kinney-road-32-24767-111-18349` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| North Kinney Road (32.2471, -111.1676) | `north-kinney-road-32-24705-111-16760` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| North Kinney Road (32.2440, -111.1634) | `north-kinney-road-32-24402-111-16343` | too_far | none | The nearest HAND stream is 347 m away, over the 310 m limit. |
| North Kinney Road (32.2292, -111.1437) | `north-kinney-road-32-22917-111-14371` | too_far | none | The nearest HAND stream is 204 m away and has no name, so it can't be matched past 100 m. |
| North Kinney Road (32.2272, -111.1408) | `north-kinney-road-32-22722-111-14078` | too_far | none | The nearest HAND stream is 449 m away, over the 310 m limit. |
| North Kinney Road (32.2246, -111.1360) | `north-kinney-road-32-22457-111-13596` | too_far | none | The nearest HAND stream is 960 m away, over the 310 m limit. |
| North Kinney Road (32.2223, -111.1326) | `north-kinney-road-32-22235-111-13260` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| North Sandario Road (32.2743, -111.2185) | `north-sandario-road-32-27434-111-21849` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| North Sandario Road (32.2753, -111.2182) | `north-sandario-road-32-27528-111-21817` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| West Avra Valley Road at Brawley Wash (NOAA name) | `west-avra-valley-road-32-39329-111-27659` | too_far | none | The nearest HAND stream is 1610 m away, over the 310 m limit. |
| West Avra Valley Road at Los Robles Wash (NOAA name) | `west-avra-valley-road-32-39514-111-26095` | too_far | none | The nearest HAND stream is 1157 m away, over the 310 m limit. |
| West Gates Pass Road (32.2213, -111.1228) | `west-gates-pass-road-32-22131-111-12278` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| West Ina Road (32.3376, -111.1053) | `west-ina-road-32-33758-111-10526` | too_far | none | The nearest HAND stream is 353 m away, over the 310 m limit. |
| West Ina Road at Yuma Mine Wash | `west-ina-road-32-33759-111-09519` | wrong_water | none | Our map data and NOAA name different water here; NOAA says Santa Cruz River. |
| West Ina Road at Santa Cruz River (NOAA name) | `west-ina-road-32-33763-111-08896` | too_far | none | The nearest HAND stream is 470 m away, over the 310 m limit. |
| West Picture Rocks Road at Picture Rocks Wash Trail | `west-picture-rocks-road-32-32598-111-12082` | too_far | none | The nearest HAND stream is 775 m away, over the 310 m limit. |
| West Speedway Boulevard (32.2369, -111.0387) | `west-speedway-boulevard-32-23689-111-03874` | too_far | none | The nearest HAND stream is 402 m away, over the 310 m limit. |
| West Speedway Boulevard (32.2360, -111.0261) | `west-speedway-boulevard-32-23597-111-02611` | too_far | none | The nearest HAND stream is 199 m away and has no name, so it can't be matched past 100 m. |
| West Speedway Boulevard at Anklam Wash | `west-speedway-boulevard-32-23595-111-02250` | too_far | none | The nearest HAND stream is 461 m away, over the 310 m limit. |
| West Speedway Boulevard (32.2359, -111.0154) | `west-speedway-boulevard-32-23594-111-01540` | too_far | none | The nearest HAND stream is 896 m away, over the 310 m limit. |
| West Twin Peaks Road (32.3809, -111.1768) | `west-twin-peaks-road-32-38086-111-17680` | wrong_water | none | NOAA calls the nearest reach Central Arizona Project Aqueduct, a canal name, so its flow may not describe the water here. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37825-111-14869` | too_far | none | The nearest HAND stream is 3330 m away, over the 310 m limit. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37543-111-13049` | too_far | none | The nearest HAND stream is 1191 m away, over the 310 m limit. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37504-111-12718` | too_far | none | The nearest HAND stream is 950 m away, over the 310 m limit. |
| West Twin Peaks Road at Santa Cruz River (NOAA name) | `west-twin-peaks-road-32-37462-111-12358` | too_far | none | The nearest HAND stream is 726 m away, over the 310 m limit. |
