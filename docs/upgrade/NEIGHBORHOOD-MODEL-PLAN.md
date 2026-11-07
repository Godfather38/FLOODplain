# Neighborhood road-vs-water upgrade: scope, plan, costs and schedule

Status: **plan for review (Nov 7, 2026).** Nothing in this plan is built yet except the station-alert
diagnostics (see the end). Nothing here is merged, deployed or published. Branch:
`experimental/model-upgrade-diagnostics-20261107`.

Companion documents:

- `DOCSHEET.md` is the specification: data sources, datum, provenance, uncertainty, outputs,
  missing data, integration, performance, validation and acceptance criteria.
- `model-coverage-20261107.svg` maps today's live model coverage.
- `candidate-road-dips-20261107.csv` lists 366 road dips found in the 5 m road profiles.

## 1. Goal

Compare **road-surface elevation** with **predicted water-surface elevation** on the roads people
use in Avra Valley, not only on the eight rated routes. Priorities, in order: Brawley Wash, then
Silverbell/Nelson, then Green Acres, then the rest of the valley.

These keep working exactly as now: the 1–5 scoring, the map, live data, the model selector, the
other features, and the rule that the app and texts/pushes give the same answer. SFINCS keeps
counting in route ratings (`docs/SFINCS-ROUTE-PREDICTION.md`). Puerto Rico is out of scope until this
neighborhood model is working and validated.

## 2. What exists today (inventory of `main` fc31742 and its artifacts)

### Four things that are easy to mix up

| Layer | What it is today | Where |
|---|---|---|
| **Source terrain** | USGS 3DEP 1 m bare earth, NAVD88 metres. Projects: AZ_PimaCounty_2021_B21 (main), AZ_BrawleyRillito_2018_D19, AZ_Eastern_PimaCO_2015, AZ_NorthCentral_B23 | road package `manifest.json` |
| **Road-sample spacing** | One station every 5 m along each road centerline. Height = median of 5 bare-earth samples from -3 to +3 m across the road. Bridges use lidar deck points (class 17) where present | `public/simulation/data/road-heights/` |
| **Hydraulic cell size** | SFINCS quadtree, 5 levels: 100, 50, 25, 12.5 and **6.25 m**. 6.25 m cells only in a corridor about 150 m either side of the 8 routes | live-model branch `all-route/<case>/compact/geometry.bin.gz` |
| **Display resolution** | 5 m road stations drawn on the map; water drawn from the model cells (6.25–100 m) | `public/simulation/` |

A finer road layer or a sharper map **does not** make the water prediction finer. The water value at
a road station is the water in the model cell that holds it. A 5 m road station in a 100 m cell gets
that 100 m cell's water level.

### Road package (verified, not rebuilt)

| Tier | Lines | Stations | Missing heights | Lidar deck stations |
|---|---|---|---|---|
| Rated routes (8) | 35 | 30,506 | **0** | 413 |
| Freeway | 209 | 35,979 | 0 | 1,144 |
| Local roads: 26 area tiles | 31,955 | 551,122 | 1,365 (0.25%) | 1,909 |

- **Gates repair already in place.** `pr-gates` has heights at all 6,445 stations. Stations 5053 and 5054
  hold the repaired 734.59 m and 734.49 m. The routes tile hash `dc8dcf3e…` matches the live
  model's input. I didn't redo this work.
- **The 26 area tiles are recovered.** They are listed in the manifest but not on `main`. All 26 are in git
  history on `experiment/road-heights-integrity` (39b34af) and match the manifest SHA256s exactly. No
  earlier local checkout was needed; none was found under `E:\FloodPLAIN`. They are not yet copied
  onto any branch, because they are only needed when local roads are integrated (M5).
- **Structures:** 524 mapped bridges/structures. 332 have lidar deck points, 19 use a line between
  the approaches, and 173 are "terrain continuous": tagged as a structure, but the ground runs
  through, which usually means a culvert or low-water crossing. There is **no culvert inventory** yet.

### Live models (measured, from the `live-model` branch and Actions logs)

| Case | Owns routes | Cells | Cell sizes | Bounding box (lon, lat) |
|---|---|---|---|---|
| Northern | Trico, Avra, Silverbell N & S | 528,201 | 100 → 6.25 m | -111.399…-111.018, 32.273…32.600 |
| Picture Rocks | Ina, Twin Peaks, PR/Avra | 537,476 | 100 → 6.25 m | -111.343…-111.003, 32.271…32.600 |
| Gates | Gates | 384,716 | 100 → 6.25 m | -111.282…-110.923, 32.171…32.432 |
| Coarse fallback | all | 29,685 active | 100 m | (older `live` run) |

Forcing: HRRR hourly rain, plus National Water Model (NWM) flow at fixed inlets. **No Pima ALERT
gauge (including 6443) is used as model input.**

## 3. Coverage check, by priority area

Method: decode all three live grids. Find the model cell under every one of the 617,607 road
stations (routes, freeway and local), and record the finest cell size from any case. Script logic is
reproducible from the files above; numbers are as of the 20Z Nov 7 run geometry.

| Area | Road stations | Outside every model | In 100 m cells | In ≤12.5 m cells |
|---|---|---|---|---|
| **All 8 rated routes** | 30,506 | 0% | 0% | **100% (6.25 m)** |
| Local roads, Avra Valley west of -111.20 | 84,708 | **37%** | 45% | 16% |
| **Brawley corridor** box (-111.33…-111.22, 32.15…32.47) | 45,201 | **32%** | 48% | 18% |
| Nelson Quihuis Rd | 245 | **100%** | 0% | 0% |
| Mile Wide Rd | 903 | 34% | 49% | 13% |
| Manville Rd | 2,030 | **78%** | 19% | 3% |
| Anway Rd | 1,760 | **66%** | 34% | 0% |
| Snyder Hill Rd | 1,272 | **100%** | 0% | 0% |
| Silverbell Rd (all segments named Silverbell) | 6,077 | 28% | 44% | 25% |

**Brawley Wash itself.** The Northern model starts Brawley Wash at an NWM inlet near **32.365 N,
111.293 W** (reaches 15876707/15876711). That is about 13 km north of the Milewide sensor, ALERT 6443
at 32.249 N, 111.244 W. Between them, the wash and its neighborhood roads (Manville, Anway, Nelson
Quihuis, Mile Wide west of Sandario) are **not modeled at all**. The model also gets no information
from 6443's observed flow. (Reach 15876707 is assumed to be the Brawley main stem from its location; M2 confirms it.)

**Road dips.** I scanned the 5 m road profiles in the west valley and Brawley corridor for low points
at least 0.3 m below the road on both sides within 100 m. That found 366 dips. Of these, 149 are outside every
model, 149 are in 100 m cells, and only 62 are in cells of 12.5 m or finer. Of the 71 dips 1 m or deeper, 56 are
outside every model or in 100 m cells. These are terrain candidates, not confirmed flood spots
(`candidate-road-dips-20261107.csv`).

**Green Acres.** I couldn't place it from the repo, the road names, or public listings (only "Green
Valley Acres", which is in Green Valley). **Decision needed:** a nearby intersection or the
streets that bound it. The planned west-valley domain covers most of Avra Valley, so the build doesn't
wait for this. Only the validation set and the acceptance check for Green Acres do.

**Silverbell/Nelson.** I read this as Silverbell Rd plus the Nelson Quihuis Rd area beside Brawley
Wash (-111.287, 32.32–32.34). **Decision needed:** confirm, or name the spot.

**Conclusion: where new hydraulic coverage is needed**

1. **New case "Brawley / Avra West"** (or extend Northern): from Brawley Wash just upstream of Milewide,
   ideally at USGS 09487000 Three Points, north to where it now joins the Northern case. It also covers the
   west-valley neighborhoods south of about 32.40 and west of Sandario. This closes the biggest gap.
2. **Refine inside existing cases**, where neighborhood roads sit in 100 m cells (the 149 dips in 100 m cells).
3. **No change** for the 8 rated routes. They are already 6.25 m everywhere.

## 4. Resolution: chosen per feature, not one blanket number

| Feature | Hydraulic cell | Why |
|---|---|---|
| Road ∩ channel crossings, dips ≥0.3 m, culvert/low-water crossings, embankments that can be overtopped | **6.25 m**, in a window about 75 m around the feature | Close to a two-lane paved width (about 6–8 m). Matches the routes today, so the global time step does not shrink. A dip trough is usually 15–60 m long, so a 6.25 m cell plus subgrid terrain resolves its bottom. |
| Other priority neighborhood roads (Brawley corridor, Silverbell/Nelson, Green Acres) | **12.5 m**, about 50 m either side | The road is only flooded when the cells next to it are. 12.5 m keeps road-adjacent flow paths without 4× the cells. |
| Flow convergence: wash junctions, braided reaches, Brawley main channel | **12.5 m** channel, **25 m** banks | Conveyance needs channel width. Brawley's low-flow channel is wider than 12.5 m in most reaches. |
| Upland catchment, open desert | **50–100 m** | Only delivers runoff, and drives the cost |
| **3.125 m** (one level finer) | **Not planned.** Only at a named structure, and only if the benchmark (B3) shows it changes road water by more than the vertical uncertainty (about 0.1 m). | SFINCS uses one time step for the whole case. Halving the smallest cell roughly halves the time step, so it about doubles runtime for the **entire** case, not just the refined area (expected from the CFL limit, not yet measured here). |

Terrain and road sampling stay as they are: 1 m source terrain, 5 m road stations, 5-sample cross-road
median. Optional: 1 m centerline profiles at about 40 named crossings (from the same 1 m terrain), to
locate the true low point. This is a **road** improvement only. It does not change the water.

Reuse: the existing 6.25 m route corridors, road package, structures and existing case archives stay
as they are. New refinement is added as extra quadtree windows. Existing water outputs remain valid
for the routes. They are **not** valid for roads that the new case covers until it has run.

## 5. Compute costs

### Measured (existing)

| What | Value | Source |
|---|---|---|
| Live hourly workflow, wall time (30 runs, Nov 6–7) | 13.5–35.1 min, typically about 30 min when all three cases run | `gh run list` for live-all-route.yml |
| Northern solver, GitHub runner (ubuntu-24.04, 4 threads) | **16.6 min** for about 63 h simulated | run 42418369491 |
| Picture Rocks solver, same | **24.4 min** | run 42418369491 |
| Gates solver, same | **16.1 min** | run 42413589846 |
| Forcing preparation per case | 1.1–2.3 min | same runs |
| Same cases on the owner's PC (thread count not recorded) | Northern 55.9 min, Picture Rocks 60.2 min, Gates 33.1 min | `result-summary.json` total_runtime |
| Coarse 100 m model | 23 s | current-coarse result |
| Cost in money | **$0**: the repo is public, and GitHub-hosted standard runners are free for public repos | |

Measured per 100,000 cells on the GitHub runner: 3.1 (Northern), 4.5 (Picture Rocks), 4.2 (Gates) min.

### Estimated (untested until the benchmark)

| Item | Estimate | Basis |
|---|---|---|
| New Brawley/Avra West case | 0.4–0.7 million cells | about 400 km² active domain at 50–100 m, plus 6.25 m windows at about 360 dips (≤210k cells), plus 12.5 m priority-road corridors (about 100k) |
| Its solver time on a GitHub runner | **16–32 min** per hourly cycle | linear in cells at the measured 3.1–4.5 min per 100k, same smallest cell |
| Extra refinement inside existing cases | +5–15% cells each, about +1–4 min each | 149 dips in 100 m cells × about 580 cells per window |
| If 3.125 m were used anywhere in a case | about 2× that whole case | time-step halving; avoided by design |
| Repository storage | each prepared case is about 120 MB, each full result about 250–300 MB | measured from existing cases |

**Storage is a constraint.** The repository is already 3.75 GB. Large new archives should go to
GitHub Release assets (not counted in repo size), or results should be kept out of git. **Decision
needed** (§9).

### Benchmark plan (short: about one day of runner time, no owner time)

| ID | Test | Measures | Pass if |
|---|---|---|---|
| B1 | Re-run the frozen Nov 1 Northern case at 4 threads | Reproduces the measured runtime and output hashes | runtime within ±20% of 16.6 min |
| B2 | Same case at 2 and 4 threads | Scaling | Decides whether a bigger runner is worth trying |
| B3 | Northern + 6.25 m windows at about 50 dips now in 100 m cells (Nov 1 forcing) | Runtime and cell count change; road-water change at those dips; time step | runtime increase within the ±25% estimate; report water changes |
| B4 | Prototype Brawley/Avra West domain, 100 m only, then with refinement | Cells, runtime, inflow handoff to Northern | first estimate of the full new case |

Every result is labeled measured or estimated. Untested numbers in this plan are only replaced by
measured ones.

## 6. Milestones (relative to kickoff K = the day this plan is approved)

Owner time is kept to short, asynchronous reviews. No fixed working hours are assumed: past
activity shows evenings, nights and weekends, so each gate waits for an answer, and the schedule
moves by the time a gate stays open. Model runs go on GitHub runners and never need the owner's PC.

| Milestone | Target | Work (by me) | Owner touchpoint |
|---|---|---|---|
| **M0** Inventory, coverage, diagnostics | done (Nov 7) | this plan, specification, diagnostics on branch | review this plan (about 20 min) |
| **M1** Benchmarks B1–B3 | K+2 days | run on GitHub runners, report measured numbers | none |
| **M2** Domain and inflow design | K+5 days | catchment delineation; Three Points / Milewide inflow; handoff with Northern so water isn't counted twice; owning-area polygons | confirm Green Acres and Silverbell/Nelson (about 5 min, can be sent any time before) |
| **M3** Build + first bounded run (Nov 1 forcing) | K+8 days | case archive, B4, first results | none |
| **M4** Validation | K+12 days | all tests in `DOCSHEET.md` §9; report every failure | local-knowledge check of about 12 representative dips (about 20 min) |
| **M5** App/alert integration (experimental branch only) | K+15 days | road forecast for the new case, local-road comparison on the map, identical app/service selection, tests, browser suites | none |
| **M6** Acceptance review | K+17 days | acceptance checklist with evidence | decide whether to request deployment (a separate approval) |

If a review gate is open longer than about two days, everything after it moves by the same amount.
If M4 validation fails, the fallback is to keep the new case off the scores (map only, labeled), fix,
and re-run. That would add about 3–5 days.

## 7. What "done" means

Not done because tiles are restored, a map renders, or a run completes. Done means all of:

1. Every road station in the priority areas gets a water comparison from a cell no coarser than the
   §4 table, or is explicitly listed as uncovered.
2. Validation passes the acceptance criteria in `DOCSHEET.md` §10, including Brawley at Three Points
   and the representative dips.
3. The app and the alert service pick the same case and give the same answer for every route, with tests.
4. Existing scoring, map, live data, model selector and features pass their existing unit and browser suites unchanged.

## 8. Station-alert diagnostics (in this build, on the branch, not deployed)

Done and tested on this branch: see `docs/OWNER-INPUT-ALERTS.md`, "Failure diagnostics". A
readable list without the station, an empty list, a partly unreadable list, a list that isn't one,
an empty or non-JSON 200, an HTTP error and no answer each get their own reason. Each comes with
bounded, sanitized metadata. There is no new delay, and recovery behavior is unchanged.

**Still unknowable:** what happened on Nov 7 at 21:54 UTC. That response was never kept. The new
diagnostics only help from the next incident on.

## 9. Decisions needed from the owner

1. **Green Acres:** a nearby intersection or bounding streets.
2. **Silverbell/Nelson:** is it Nelson Quihuis Rd by Brawley Wash, or another spot?
3. **Storage for the new case archives and results:** GitHub Release assets (recommended), or keep committing to branches.
4. **Brawley inflow:** start the new case at USGS 09487000 Three Points (recommended: it has observed
   history for validation), or at Milewide (shorter domain, but 6443 has no kept history).
5. **ALERT history:** today the `data` branch keeps only the latest snapshot. Keep a small rolling
   history of 6443 and the configured rain stations (a few MB per month), so the next event can be validated.
6. **Local roads in the app:** show neighborhood road comparisons on the map only (recommended first
   step), or also add them to route scores where a route uses them. Route scores already include
   every station on the 8 routes.
7. **Your availability** for the four short reviews, so I can schedule around it.

## 10. Risks and known gaps

- No surveyed road, bridge or culvert elevations. Bare-earth height is not a surveyed pavement
  height or bridge deck, and 173 structures may be culverts with no opening size.
- No measured soil moisture or channel transmission loss. Brawley's loss between Three Points and the
  valley is not known (see `docs/BRAWLEY-UPSTREAM-EVIDENCE.md`).
- ALERT history isn't kept, so there's little observed data for the neighborhood washes.
- One global time step per case: refinement has to be targeted.
- Repository size (3.75 GB).
- The Nov 7 6443 incident cannot be classified after the fact.
