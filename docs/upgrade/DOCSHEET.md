# Docsheet: neighborhood road elevation vs predicted water-surface elevation

Specification for the Avra Valley neighborhood upgrade. Plan, costs and schedule are in
`NEIGHBORHOOD-MODEL-PLAN.md`. Status: **for review (Nov 7, 2026), not built, not deployed.**

Plain-language terms used throughout:

- **Water-surface elevation (WSE):** the height of the water's top surface above the NAVD88 datum, in metres.
  This is the number SFINCS predicts for each model cell.
- **Road elevation:** the height of the road surface above the same datum, estimated from lidar.
- **Water over the road:** WSE minus road elevation, where both are known for the same place and time.
- **Cell:** one square of the flood model. Its water level applies to the whole square.

## 1. Geographic scope

| Priority | Area | Today | Target |
|---|---|---|---|
| 1 | **Brawley Wash**: Three Points (USGS 09487000) or Milewide (ALERT 6443) north to the Los Robles bridge, with the neighborhood roads that cross or parallel it (Mile Wide, Manville, Anway, Nelson Quihuis, Sandario south, Snyder Hill) | modeled only north of about 32.365 N; 32–100% of these roads outside any model | covered by a new Brawley/Avra West case |
| 2 | **Silverbell/Nelson** (to be confirmed) | Silverbell route 6.25 m; other Silverbell segments 28% uncovered; Nelson Quihuis 100% uncovered | 6.25 m at dips/crossings, 12.5 m along roads |
| 3 | **Green Acres** (location to be confirmed) | unknown | same rule as priority 2 |
| 4 | Rest of Avra Valley local roads | 37% uncovered, 45% in 100 m cells | covered where the new case reaches, 100 m elsewhere (flagged coarse) |
| — | The 8 rated routes | 100% at 6.25 m | unchanged |
| later | Puerto Rico | — | not before this model passes acceptance |

## 2. Data sources and licensing

| Data | Source | License / terms | Used for |
|---|---|---|---|
| Terrain, road heights, bridge decks | USGS 3DEP 1 m (AZ_PimaCounty_2021_B21, AZ_BrawleyRillito_2018_D19, AZ_Eastern_PimaCO_2015, AZ_NorthCentral_B23), 2021 lidar class-17 deck points | Public domain (US government) | Model subgrid, road stations, decks |
| Road lines and names | Overture Maps 2026-10-21.0 (OpenStreetMap) | ODbL 1.0: attribution, share-alike for derived databases | Road centerlines, structure tags |
| Rain forecast | NOAA HRRR (AWS open data) | Public domain | Model forcing |
| Inflow | NOAA National Water Model analysis + short range (AWS NODD) | Public domain | Model inlets |
| Soil / infiltration | GCN10 curve numbers | ODbL (derived infiltration file; notice kept in each result) | Infiltration |
| Land cover roughness | ESA WorldCover 2021 | CC BY 4.0 | Manning roughness |
| Observed flow | USGS 09487000 Brawley Wash near Three Points (OGC API) | Public domain; provisional data marked | Validation, optional inflow |
| Observed flow and rain | Pima County ALERT (6443 and rain sites) | Public county data via an undocumented endpoint; no license stated; attribute Pima County RFCD | Validation, alert inputs |
| Floodplain studies | Pima County RFCD FE-102-2019 cross-sections and BFE contours; FEMA NFHL | Public agency data; attribute source | 100-year validation (offline only) |
| Culverts / structures | Pima County RFCD FloodControl2 structures layer (not yet fetched) | Public agency data | Structure inventory (M2) |
| Model | Deltares SFINCS (pinned `f3647fc`), HydroMT-SFINCS 1.2.2 | GPL-3.0 (SFINCS), MIT (HydroMT) | Solver and setup |

Every new artifact records its source URL, retrieval time and SHA256, like the existing packages.

## 3. Vertical datum

- Road heights, deck heights, model terrain and WSE are all **NAVD88 metres**. Display converts to
  feet only at the end (`public/display-units.js`).
- No mixing of datums. A source in another datum (NGVD29, ellipsoid heights, a local survey datum)
  must be converted with NOAA VDatum (or the agency's stated transform) **before** use, with the
  transform recorded. Otherwise it is excluded.
- USGS 09487000 reports discharge, not elevation, so no datum applies. Its gage-height datum is used
  only if needed and stated.

## 4. Road, bridge and culvert provenance and uncertainty

| Item | How it is derived | Flag | Vertical uncertainty to carry |
|---|---|---|---|
| Road station (paved/dirt) | median of 5 bare-earth samples, -3…+3 m across, every 5 m | none | ±0.10–0.15 m (lidar non-vegetated accuracy plus cross-slope; the `lateralDm` range is kept per station) |
| Bridge deck, lidar | median class-17 points within 4 m | `deck_lidar` | ±0.10 m on the deck; **not** a surveyed deck and **not** the opening's low chord |
| Bridge deck, approach line | straight line between approaches | `deck_approach` | unknown; shown as estimated |
| Structure, terrain continuous (173) | tagged structure, ground continuous | `structure_untagged` / continuous | treat as culvert or low-water crossing; **opening size unknown**; the road can overtop or the pipe can block |
| Missing height | no valid terrain | `no_terrain` | **stays missing.** Never replaced by a cell's mean ground, never 0, never dry |

Rules:

- **Bare-earth elevation is not a surveyed bridge deck.** Bridge clearance, freeboard and opening
  capacity are not inferred. Water under a bridge is not reported as water on the bridge.
- Culverts are not modeled as pipes (SFINCS has no culvert structures in this setup). A culvert
  crossing is treated as road-on-fill: water over the road happens only when WSE exceeds the road.
  Wording says this. If the county structures layer gives size and invert, it is recorded for later
  use, not guessed.
- Local knowledge from the owner overrides terrain where they differ, and the difference is recorded.

## 5. Water-surface output and timestamps

- Native output per cell: **WSE (NAVD88 m)** and **volume (m³)**. Depth shown to people = WSE minus
  road elevation at a road station. It is never computed from cell-average depth (volume ÷ cell
  area), which can say "1 cm" in a cell where a channel is 1 m deep.
- **Never infer an exact water level from averaged depth.** Where only an average exists (the coarse
  100 m fallback), the existing rule stays: `min(WSE − road, WSE − cell ground)`, labeled coarse,
  with its cap shown separately.
- Each value carries: model run ID, case, cell size (m), frame time (UTC, ISO 8601 with Z), run issue
  time, HRRR cycle, and the station's road flags.
- Frames are 30 minutes in live runs (15 minutes in saved runs). The app shows the frame time it
  used, never "now" for a frame that isn't now.
- Freshness is unchanged: only a completed live run issued within 3 hours whose window contains now
  can rate current conditions. Issue times more than 5 minutes in the future are rejected.

## 6. Missing data

| Situation | What the app and alerts do |
|---|---|
| Road station outside every model | "No model coverage here." No model water, not dry. The rating rests on the other sources |
| Station in a 100 m cell only | Value shown, labeled "coarse (100 m)". It can raise a rating, but can't make an unknown road dry |
| Missing road height | unknown; listed in coverage counts |
| Model value undefined (native NaN) | missing, not dry |
| Run stale, partial, failed, or not covering now | one line saying so; other sources rate the route (unchanged) |
| A gauge or ALERT reading missing, stale or future-stamped | not used in ratings; owner alert with the new diagnostics (§8); **never treated as zero flow or dry** |
| Disagreement between cases where domains overlap | the owning case for that area wins; values are never averaged (unchanged rule) |

## 7. App and alert integration

- **Unchanged:** 1–5 scoring rules and thresholds (`public/simulation/route-prediction.js`,
  `public/road-forecast.js`), "raises only", map, live data, model selector, other features. SFINCS
  stays in route ratings.
- **New case:** publishes `all-route/<case>/compact/road-forecast.json` on `live-model` with the same
  schema, and is added to `ALL_ROUTE_CASES` and the owning-area table, so the app and the Apps Script
  service select it with the same shared code (`mergeRoadForecasts`). A test asserts identical
  results between the browser and the service on every route.
- **Local roads:** shown on the map's road comparison (road height, WSE, difference, cell size, frame
  time). Route scores change only if the owner chooses (Decision 6 in the plan).
- **Road-cells table** (`public/data/road-cells.json`, used by the service) is rebuilt for the new grid.
  It stays small: one row per (route, cell).
- **Texts and pushes:** same wording rules. No new message types without the owner's request.

## 8. Station-alert diagnostics (implemented on the branch)

See `docs/OWNER-INPUT-ALERTS.md`, "Failure diagnostics". These are told apart: source unavailable
(no answer or HTTP error), malformed response (HTTP 200 empty or not JSON), malformed station list,
empty list, absent with unreadable entries, absent from a readable list, stale, and future /
unreadable / missing times. Kept per problem: check time, HTTP status, size, JSON or not, key-name
shape, station counts by ID type, checked station. Never kept: body text, values, URLs, keys,
headers, contact details. No delay is added before a genuine missing input is reported. Recovery
needs a validated reading after a delivered problem, as before.

## 9. Validation tests

Results are reported pass/fail with numbers, including failures.

| ID | Test | Data | Measure |
|---|---|---|---|
| V1 | Brawley flow at Three Points | USGS 09487000 observed vs model inflow/flow, Nov 1 2026 and any 2025–2026 monsoon events with data | peak timing (h), peak flow ratio |
| V2 | Milewide 6443 | ALERT flow, only for events captured from now on (history wasn't kept) | wet/dry agreement, timing |
| V3 | 100-year check | RFCD FE-102-2019 BFE and cross-sections, FEMA NFHL | model 100-year WSE − BFE at sections (m), within the study's reach |
| V4 | Historical closures | County closure records and September 2026 news reports (vehicles stuck in Pima County flooding, Sep 17; Marana reported Sandario closed from Twin Peaks to Avra Valley Rd) | does the model wet the closed roads in a replay of that rain? |
| V5 | Representative dips | about 12 dips from `candidate-road-dips-20261107.csv`, chosen across Brawley, Silverbell/Nelson and Green Acres, plus the owner's known spots (Brawley dip, Picture Rocks Wash, Yuma Mine, Ina flat dip, Silverbell) | owner's local knowledge vs model: dry when the owner says it stays passable; wet first where they say it floods |
| V6 | Crossings and embankments | Los Robles bridge, Sanders, Avra Valley Rd river bridges; 10 terrain-continuous structures | no water reported "on" a deck from water under it; overtopping only when WSE exceeds the road |
| V7 | Resolution sensitivity | B3 benchmark: 100 m vs 6.25 m at the same dips | water-over-road change; must exceed about 0.1 m to justify refinement |
| V8 | Regression | existing unit suite (440 now) and both browser suites | all pass unchanged |
| V9 | App/alert parity | shared selector on every route, every case missing/stale in turn | identical results |

## 10. Acceptance criteria

1. **Coverage.** In the priority areas, at least 95% of road stations are in a live model, and every dip
   and crossing in the CSV inside the domain sits in a 6.25 m cell. Anything else is listed by name.
2. **V1.** Modeled peak at Three Points within ±2 h of observed, and the peak-flow ratio within 0.5–2×,
   for each event with data. Otherwise the inflow is reported as unvalidated and the case stays
   map-only (labeled).
3. **V3.** Median |model 100-year WSE − BFE| ≤ 0.5 m at study sections, with no section worse than 1.5 m
   unexplained.
4. **V5.** No owner-confirmed "stays passable" spot predicted above caution on a normal storm, and every
   owner-confirmed flood spot is wet in a replay of an event the owner says flooded it.
5. **V6.** Zero cases of under-bridge water reported as water on the road.
6. **Performance.** New case solver ≤ 35 min per run on the GitHub runner (measured), and the hourly
   workflow still finishes before the next cycle.
7. **No regressions.** V8 and V9 pass. Missing data is never shown as dry.
8. **Owner review** of the evidence. Deployment is a separate approval.

These thresholds are proposals for the owner to accept or change. They are not taken from a standard.

## 11. Performance and size

- Apps Script fetch per check: one more `road-forecast.json` of about 10–30 KB. The road-cells table grows by
  a few KB. The service's per-minute budget is unaffected.
- App: local-road comparisons load per area tile on demand (26 tiles, 1.9 MB total), not at startup.
- Live workflow: one more parallel job. Measured wall time is today's longest case, about 25–35 min.
- Storage: see the plan, §5 (release assets recommended).
