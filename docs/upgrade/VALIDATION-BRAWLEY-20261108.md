# brawley-avra-west validation, 2026-11-08 (pre-run)

Case `brawley-avra-west`, modelVersion `all-routes-brawley-avra-west-v1`. Branch
`experimental/brawley-avra-west-20261108` at f758883. Tests are V1–V9 and acceptance criteria 1–8
from `docs/upgrade/DOCSHEET.md` §9–10 on `origin/experimental/model-upgrade-diagnostics-20261107`.
Nothing here was tuned. Committed by the review step, which re-checked the claims and added §10
(reviewer addendum, 2026-11-08T22:35Z).

## 0. The main fact: there is no frozen result to validate

**Verified at 2026-11-08T22:20Z:**
- The subgrid parameter build (`prepare_route_case_parameters.py`) is **not running**. No process
  has `prepare_route_case` in its command line.
- `.sfincs-runs/brawley-avra-west-parameters-v1/` is **empty**.
- `.sfincs-runs/brawley-avra-west-parameters-v1.log` was last written at 15:19:56 MST (22:19:56Z). At that point it was on "Processing level 2 of 5 … block 1 of 4 … Getting bathy/topo".
- The job stopped when the build agent returned (inferred: the agent owned the background job).
- So nothing downstream of it exists: boundaries, stage, finish, package, solver runs, result packaging and the local forecast.
- **To restart:** use a new output folder, for example `brawley-avra-west-parameters-v1b`, because the scripts refuse to write over existing output. Run it in a session that stays alive for about 15–25 min.

Every test that needs model water levels (zs) is therefore **NOT TESTABLE**: mass balance,
outflow hydrograph, flow and stage at Mile Wide, road dips (max water-surface elevation, over-road
depth, wet timing), ridge stations staying dry, and channel crossings wetting first. This applies to
**both** inflow variants. I did not run the solver, and I did not substitute any estimate for it.

What follows is everything the data that does exist allows: inputs, mesh, stations, reference
hydrographs and observed evidence.

**Commands.** All run with cwd `E:\FloodPLAIN\wt-model`, the H venv and `NUMBA_CACHE_DIR` set.
- `python tools/sfincs/brawley/validate_prerun.py <out.json>`: 2.8 s. The output was copied to `docs/upgrade/validation-brawley-prerun-20261108.json` (sha256 55a03352…7759).
- `python -m unittest discover -s tools/live -p "test_*.py"`: 114 tests, OK, 20 s.
- `python -m unittest discover -s tools/sfincs -p "test_*.py"`: reported as 3 tests, OK, 4 s. The reviewer's re-run of the same command (H venv) found **14 tests, OK, 0.27 s** (2.9 s wall); see §10.
- `npm test`: 56 tests, 55 pass and 1 fails, 1 s (see V8).
- An ad-hoc input-completeness check (rain, context): about 10 s.

## 1. Verdicts

| Criterion / test | Verdict | Evidence (short) |
|---|---|---|
| AC1 Coverage: ≥ 95% of priority-road stations in a model | **FAIL** | 64.4% (live 40.4% + new 24.1%); 35.6% in no model (§2) |
| AC1 Every CSV dip/crossing in the new domain at 6.25 m | **PASS for owned points; FAIL for the Gates overlap** | 48/48 owned dips and 91/91 owned crossings at 6.25 m; 73 CSV dips in the Gates overlap are not at 6.25 m in the new mesh (§2) |
| AC2 / V1 Three Points peak timing ±2 h, ratio 0.5–2×, NWM variant | **FAIL** | inflow peak 1.70 m³/s at the window end vs 49.27 observed: ratio 0.035, timing ≥ +9.5 h and still rising (§3) |
| AC2 / V1 observed-inflow variant | **NOT TESTABLE (by construction)** | inflow *is* the gauge (hourly, peak 48.42 m³/s, −1.7%); no independent modelled flow at Three Points |
| Mass balance (inflow + rain − outflow − storage) | **NOT TESTABLE** | no result |
| Outflow at the downstream edge vs NWM 15876711+15876707, and vs Northern injection | **NOT TESTABLE** (references computed, §3) | NWM analysis peak 37.77 m³/s at 03Z Nov 2; Northern frozen injection peak 0.27 m³/s |
| V2 Mile Wide / ALERT 6443 flow and timing | **NOT TESTABLE** | no result; only 2 ALERT values exist, one of them second-hand; gauge-to-reach mapping is ambiguous (§4) |
| Stage-to-road at the Mile Wide, Manville, Tucker and Donaldson Ranch Brawley crossings | **NOT TESTABLE** (road heights and cell sizes ready, §5) | no zs |
| V3 100-year vs BFE | **NOT TESTABLE** | no 100-year forcing or run; BFE sections not loaded |
| V4 Nov 1–2 closures (Sandario, Mile Wide, Manville, Snyder Hill) | **NOT TESTABLE** | no Nov 1–2 closure record for these roads in repo history (§6) |
| V5 Representative dips | **NOT TESTABLE** (12 dips tabulated, §5) | no zs; no owner-confirmed spot inside the new owned area |
| Sanity: ridge stays dry, channel crossings wet first | **NOT TESTABLE** | no result |
| V6 Under-deck water not reported on deck | **NOT TESTABLE** | no result; 4 deck-lidar stations identified (§7) |
| V7 Resolution sensitivity | **NOT TESTABLE** | no runs at either resolution |
| V8 Regression | **PARTIAL PASS** | Python 114/114 + 3/3 pass; node 55/56, and `bundle.test.js` fails with ERR_MODULE_NOT_FOUND because wt-model has no `node_modules` (environment, inferred). The "440" figure belongs to a different branch's suite. Browser suites not run |
| V9 App/alert parity | **NOT TESTABLE** | no case output. The app side is now wired on `experimental/brawley-app-20261108` (7cb8639, map only); its parser accepts exporter output (§10), but there is no real case output to compare |
| AC6 Performance (≤ 35 min solver) | **NOT TESTABLE** | no solver run |
| AC7 Missing data never shown as dry: inputs | **PASS** | rain, context and inflow have 0 missing or non-finite values; the Stage IV gap is filled from MRMS (not zero); gauges with no data are kept as `no_data` (§7) |
| AC7 Missing data: stations | **PASS (pre-run)** | 8 no-height and 28 no-cell stations are kept and counted; the exporter test "missing readings never dry" passes |
| Resolution honesty | **PASS (pre-run)** | per-station cell size computed; the exporter emits `cellSizeM` per station; 54.5% of owned stations are in 100 m cells (§8) |
| AC8 Owner review | pending | |

## 2. Coverage (AC1)

**Station coverage.** Priority-road stations from the area tiles of `origin/experiment/road-heights-integrity` @39b34afd (sha256-checked against the manifest). Box: lon ≤ −111.15, lat 31.9–32.45. "live" means covered by northern, picture-rocks-ina-twinpeaks or gates; "new" means only in brawley-avra-west.

| Road | stations | live | new only | none |
|---|---|---|---|---|
| Sandario | 2915 | 2462 | 453 | 0 |
| Avra Valley | 2718 | 1705 | 0 | **1013** |
| Manville | 2030 | 449 | 491 | **1090** |
| Anway | 1760 | 602 | 0 | **1158** |
| Snyder Hill | 1008 | 0 | 1008 | 0 |
| Mile Wide | 903 | 591 | 312 | 0 |
| Garcia Ranch | 873 | 0 | 723 | 150 |
| Cocorague Ranch | 839 | 0 | 225 | **614** |
| Tucker | 703 | 97 | 68 | **538** |
| Agua Dulce Ranch | 639 | 0 | 0 | **639** |
| Nelson Quihuis | 245 | 0 | 245 | 0 |
| **Total** | 14633 | 5906 (40.4%) | 3525 (24.1%) | **5202 (35.6%)** |

The 95% target is missed even when the new case is counted. The gaps are as the hydro agent reported:
those catchments drain to Northern's inlet reaches (15876639/15876633) or to 15876671/15876805,
not to 15876711/15876707. The deepest west-valley dips are among them: Cocorague Ranch 5.26 m (CSV row 1),
Agua Dulce 3.69 m and Tucker 2.04 m. All three are outside every model.

**Cell size at CSV dips and L4 points** (mesh face lookup on `active-refinement-mesh.nc`, 408,207 faces):
- The CSV has 366 dips; 121 lie inside the new domain.
- **48 are outside the live domains: all 48 at 6.25 m.** The L4 list has 48 dips and 91 crossings, all 139 at 6.25 m.
- **73 lie in the Gates overlap and are not at 6.25 m in the new mesh:** 26 at 100 m, 11 at 50 m, 1 at 25 m, 35 at 12.5 m.
  - The CSV's `finest_live_model_cell_m` for these is mostly 100 m in Gates.
  - By design Gates owns them, so they stay at Gates resolution.
  - Named examples:
    - Hohokam Rd 2.74 m (100 m)
    - N Kinney Rd 2.74 m (100 m here, 6.25 m in Gates)
    - Golden Gate Rd 2.56 m (100 m)
    - Signal Hill Rd 2.24 m (100 m)
    - N Camino Del Sapo, 3 dips of 1.62–1.65 m (100 m)
    - W Mile Wide Rd at −111.24238, 32.24812, 1.45 m (12.5 m here, 100 m in Gates)
    - W Ranchito Verde 1.39 m (100 m)
    - many Sandario and Sanders Rd dips at 12.5–100 m
  - The full list is in the json, under `csvDips.overlapRows`.
  - Strictly against AC1 wording ("every dip … inside the domain sits in a 6.25 m cell"), this is a FAIL.

## 3. Inflow and reference outflow (V1, outflow tests)

Hourly series 2026-10-30T16Z..2026-11-02T07Z, 64 points. Volume = Σq·3600 (rectangle rule), so it
differs slightly from the NWM agent's figures.

| Series | Peak m³/s | Peak time (Z) | Volume m³ |
|---|---|---|---|
| USGS 09487000 observed, 15-min (agent) | 49.27 | Nov 1 21:30 | 986,508 |
| Case inflow 15876941, **NWM variant** | 1.70 | Nov 2 07:00 (last step) | 36,324 |
| Case inflow 15876941, **observed variant** | 48.42 | Nov 1 22:00 | 931,825 |
| NWM analysis_assim hindcast 15876941 | 46.80 | Nov 1 23:00 | 927,036 |
| NWM analysis 15876811 (Brawley at the 15876815 confluence) | 39.13 | Nov 2 02:00 | 936,828 |
| NWM analysis 15876815 (San Joaquin/Black Wash, 604 km²) | 0.33 | Nov 2 00:00 | 41,292 |
| **Reference for the domain outflow: NWM analysis 15876711 + 15876707** | **37.77** | **Nov 2 03:00** | **821,844** |
| NWM frozen (analysis to 14Z, then 13Z forecast) 15876711 + 15876707 | 0.27 | Oct 30 16:00 (baseflow) | 62,208 |
| **What Northern injects** (northern-history/forecast 15876711 + 15876707) | **0.27** | Oct 30 16:00 | **62,208** |

- **V1, NWM variant: FAIL.**
  - Peak ratio 1.70 / 49.27 = 0.035, outside 0.5–2×.
  - Modelled peak ≥ 9.5 h after the observed peak, and still rising at the window end.
  - Volume 3.7% of observed.
  - Per AC2, this variant's inflow is **unvalidated** and the case stays map-only (labelled).
- **V1, observed variant:** the inflow equals the gauge reading at the top of each hour (`kind` observed_gauge, 0 nulls). The hourly sampling reduces the peak by 1.7% and moves it 0.5 h later. This is not a test of the model.
- 15876707 is 0 in every series (headwater). 15876711's frozen history equals the analysis exactly for the history hours (verified).
- **Northern's injection, verified:** Northern's frozen forcing at the outlet node is baseflow only (peak 0.27 m³/s). So the Northern frozen case also does not carry the Nov 1 Brawley flood.
- **Outflow tests need a model result.** When one exists, compare the model's outflow at the downstream edge (node 720060498) with the 37.77 m³/s / 03Z / 821,844 m³ reference. The NWM run is expected to fall far short of it, because its inflow is 1.7 m³/s; that shortfall is inference.
- **Attenuation in the NWM hindcast (inference):** the peak drops 46.8 → 39.1 → 37.8 m³/s and arrives about 4 h later from the gauge to the outlet. The observed-variant SFINCS outflow can be checked against this shape. It is not an observation.

## 4. Mile Wide / ALERT 6443 (V2)

**Observations available**
- Oct 31 14:00 MST: 0 cfs, 2.30 ft (verified raw fixture).
- Nov 1 about 20:04 MST: 817 cfs (23.1 m³/s). This comes from a sentence in `docs/BRAWLEY-UPSTREAM-EVIDENCE.md`, not a raw record. Its time is uncertain by about 1 h (NWM agent).
- No other ALERT history was kept. V2 therefore has at most one "wet" point and one "dry" point.

**Location finding (verified geometry, new).** ALERT 6443 is at −111.244446, 32.248611.
- It lies **4.8 m from NHD reach 15876815**, the San Joaquin/Black Wash outlet (604 km²).
- The NHD Brawley mainstem crossing of Mile Wide Rd is reach **15877627**, at −111.2527, about 0.8 km west.
- The site is also inside the Gates domain overlap.
- **Inferred:** the NWM agent's mapping to 15876811 is not established.
  - If the gauge does sit on 15876815, NWM's analysis peak there (0.33 m³/s) is inconsistent with the reported 817 cfs.
  - The gauge may instead read the combined flow at the confluence.
- When results exist, compare model flow and wet timing in the 15876815, 15877627 and 15876811 cells separately. Do not pick one to make the comparison pass.

**NWM analysis at 15876811:** 39.1 m³/s at 02Z Nov 2, which is 19:00 MST Nov 1. That is about 1 h before the 817 cfs report. This is NWM against a second-hand reading, not model validation.

## 5. Crossings and representative dips (V5 inputs; zs pending)

- Road heights: the lowest and highest `roadZ` among owned stations within 25 m (NAVD88 m, lidar bare-earth road estimate, not a surveyed deck).
- Cell size: the mesh face that contains the point.
- Max WSE, max over-road and wet timing are **NOT TESTABLE** until a result exists.

**Brawley Wash crossings** (from the L4 list, comid and order from NHD):

| Road | lon, lat | comid | Cell m | roadZ min–max | Max WSE / over-road / first wet |
|---|---|---|---|---|---|
| W Mile Wide Rd | −111.25265, 32.24820 | 15877627 | 6.25 | 674.88–674.93 | n/a |
| W Manville Rd | −111.26846, 32.29177 | 15876771 | 6.25 | 652.59–652.94 | n/a |
| W Tucker Rd | −111.28323, 32.33536 | 15876711 | 6.25 | 631.67–632.55 | n/a |
| W Little Williams Dr | −111.28380, 32.33710 | 15876711 | 6.25 | 631.37–631.83 | n/a |
| W Donaldson Ranch Rd | −111.26008, 32.17568 | 15877627 | 6.25 | 710.69–710.77 | n/a |

**Representative dips** (the 6 deepest owned dips, then the deepest dip on each other road):

| # | Road | depth m | lon, lat | Cell m | roadZ min–max |
|---|---|---|---|---|---|
| 1 | W Snyder Hill Rd | 1.73 | −111.20929, 32.16177 | 6.25 | 706.68–706.95 |
| 2 | Garcia Ranch Rd | 1.32 | −111.29175, 32.15817 | 6.25 | 726.50–727.24 |
| 3 | W Manville Rd | 1.24 | −111.28702, 32.29176 | 6.25 | 651.85–652.55 |
| 4 | W Manville Rd | 1.12 | −111.26719, 32.29176 | 6.25 | 652.10–652.87 |
| 5 | Garcia Ranch Rd | 1.01 | −111.29102, 32.15309 | 6.25 | 728.06–728.19 |
| 6 | Garcia Ranch Rd | 0.98 | −111.29124, 32.15942 | 6.25 | 726.68–727.66 |
| 7 | N Mesquite Oasis Rd | 0.96 | −111.29733, 32.34985 | 6.25 | 624.56–624.85 |
| 8 | W Donaldson Ranch Rd | 0.90 | −111.23993, 32.17565 | 6.25 | 707.83–708.28 |
| 9 | W Tucker Rd | 0.88 | −111.28348, 32.33535 | 6.25 | 631.67–632.55 |
| 10 | W Orange Grove Rd | 0.73 | −111.30533, 32.32051 | 6.25 | 637.79–638.05 |
| 11 | W Little Williams Dr | 0.72 | −111.28537, 32.33711 | 6.25 | 631.11–631.46 |
| 12 | W Drillers Rd | 0.65 | −111.29201, 32.32985 | 6.25 | 633.44–633.76 |

- Owned dips are shallow: the deepest is 1.73 m. The deep dips are either outside every model (§2) or Gates-owned.
- No owner-confirmed spot from V5 is inside the owned area. The owner's "Brawley dip" is on Avra Valley Rd, north of the domain at lat 32.371.
- Max WSE, max over-road and first-wet time for each row must come from `export_road_forecast.py local` on each frozen compact package, using `zs` and `roadZ`. Never use averaged depth.

## 6. Observed Nov 1–2 2026 road evidence (V4)

Searched `git log --all` from Oct 31 to Nov 4, and fixtures and docs on `origin/ccr-ae06b197-a01a6o` and `origin/main`.
- **No Nov 1–2 closure snapshot exists in the repo for Sandario, Mile Wide, Manville or Snyder Hill.**
- The only closure fixture is `test/fixtures/closures-2026-10-31.json` (commit 6d6978b), from before the event. All 17 matching points are **Open**: Sandario ×6, Manville ×8, Kinney north of Mile Wide, Avra Valley Rd west of Brawley, and Reservation Rd south of Manville.
- On Nov 1 the county set "Avra Valley Rd west of the Brawley Wash" to **Proceed with Caution, eastbound, updated 11:48 AM** (BRAWLEY-UPSTREAM-EVIDENCE.md). That crossing is outside this domain; it is in the Northern domain.
- So no observed road state exists inside the new owned area to compare with. **V4: NOT TESTABLE.** The September 2026 Sandario closure (Twin Peaks to Avra Valley Rd) falls in the Northern and Picture Rocks domains, not here.

## 7. Missing data and no zero-fill (AC7)

**Verified on the files:**
- **Rain.** The resolved analysis is 46×52×55, transition 3×52×55, forecast 14×52×55, covering 2026-10-30T16Z..2026-11-02T06Z (63 hourly frames). There are **0 non-finite values** and the range is 0–16.08 mm/h.
  - The one Stage IV hour missing over the whole crop (Nov 1 12–13Z) is filled from MRMS Pass2 (0–0.8 mm), with metadata recorded. It is not zero-filled.
- **Context rasters.**
  - `missing-terrain-mask.tif` sums to 0.
  - terrain, lulc and cn each have **0 nodata cells** over the whole rectangle, and no 0 values (CN 0 or terrain 0 would mean a fill).
  - 1/3 arc-second fallback covers 9,821 cells inside the domain (0.98 km² near −111.388, 32.178), labelled in source-mask.
- **1 m terrain windows:** 0 missing pixels in the L3/L4 windows, per the terrain agent's manifest. I did not re-read the 162 tifs.
- **Inflow.** Both variants have 64 values, 0 nulls and `missingReachIds` [] in both files. USGS 09487100 and 09487140 are stored as `no_data`, not as 0.
- **Stations.**
  - 31,680 owned stations. 8 have no road height (`roadZ` null, flag 4).
    - They all sit at lat 32.1762–32.1763, a tile edge (inference): Garcia Ranch, Donaldson Ranch ×4, Marstellar, Sandario ×2.
    - **28 stations lie inside the domain polygon but in no mesh face** (the mesh edge). The exporter will report them as `noCell`.
    - All 36 are kept and counted, not dropped.
  - The exporter adds an `unknown` state for frames with no valid reading. The test `test_local_road_forecast` checks that missing readings are never dry, and it passes.

## 8. Resolution honesty

Cell size per owned station (31,680), from the mesh face containing it:

| Cell size | Stations | Share |
|---|---|---|
| 100 m | 17,260 | 54.5% |
| 50 m | 4,312 | 13.6% |
| 25 m | 2,024 | 6.4% |
| 12.5 m | 4,161 | 13.1% |
| 6.25 m | 3,895 | 12.3% |
| none | 28 | 0.1% |

- Every owned priority-road station is in a 12.5 or 6.25 m cell:
  - Snyder Hill 271 at 6.25 / 1,001 at 12.5
  - Garcia Ranch 252 / 471
  - Sandario 38 / 415
  - Manville 87 / 404
  - Mile Wide 43 / 269
  - Tucker 37 / 31
  - Cocorague 42 / 183
  - Nelson Quihuis 0 / 245
- `export_road_forecast.py` emits `cellSizeM` for every station (line 380).
- The mesh builder also wrote faces to the 8.33 m subgrid level 2 pixels, and level-5 pixels are finer. Subgrid pixels describe terrain inside a cell. They are not a finer water surface, and zs is one value per cell.
- Claims must stay at 6.25 m (L4 windows) or 12.5 m (L3 corridors) at best, and 100 m for over half of the owned local stations.
- **Elevation caveat:** road heights are bare-earth estimates, not surveyed decks. Four W Mile Wide Rd stations at −111.2703, 32.2481 (roadZ 675.26–675.28) are flagged `deckLidar`. V6 (no under-deck water reported on the road) must be checked there.

## 9. To finish validation once results exist (both variants)

1. Restart the parameter build into a new folder. Then run boundaries (check for a second outflow at 15902533), stage ×2, finish ×2, package ×2, and dispatch `sfincs.yml` ×2 (build agent).
2. **Mass balance:** from SFINCS output, compute Σ inflow (dis) + Σ rain·area − Σ outflow − Δstorage, and report the residual as % of input.
3. **Outflow:** extract boundary or edge flux at node 720060498 each hour. Compare with the §3 reference (peak 37.77 m³/s, 03Z, 821,844 m³) and with Northern's injection (0.27 m³/s).
4. **Mile Wide:** report zs and flux in the 15876815, 15877627 and 15876811 cells. Compare wet or dry at Oct 31 21Z (expect dry) and about Nov 2 03Z ±1 h (817 cfs).
5. Run `export_road_forecast.py local` on each compact. Fill §5: max WSE, maxOver = maxWse − roadZ, firstOverTime and cellSizeM. Check that ridge stations (highest roadZ per road) stay dry and that the Brawley crossings wet before the upland dips.

## 10. Reviewer addendum (2026-11-08T22:35Z)

Adversarial re-check of the build reports. "Verified" means re-run or re-read by the reviewer;
"inference" is marked. Status of the build is in `docs/upgrade/BRAWLEY-BUILD-STATUS-20261108.md`.

**State re-checked.**
- The parameter build is still dead at 22:33Z: no `prepare_route_case` process,
  `.sfincs-runs/brawley-avra-west-parameters-v1/` empty, log last written 22:19:56Z. §0 stands.
- No result, no compact package and no `sample-local-road-forecast.json` exist for this case, so
  every zs-based verdict in §1 stays NOT TESTABLE.

**Tests re-run by the reviewer** (H venv, `NUMBA_CACHE_DIR` set):

| Branch @ commit | Suite | Result | Wall |
|---|---|---|---|
| experimental/brawley-avra-west-20261108 @ f758883 (+ uncommitted docs) | `unittest discover -s tools/live` | 114 OK | 20.4 s |
| same | `unittest discover -s tools/sfincs` | 14 OK | 2.9 s |
| experimental/brawley-live-sfincs-20261108 @ cc8a21a | `unittest discover -s tools/live` | 87 OK | 17.2 s |
| experimental/brawley-app-20261108 @ 7cb8639 | `npm test` | 450/450 pass | 2.8 s |

Browser e2e (`npm run test:browser`) was not re-run by the reviewer; GitHub run 42528566512
(push, 7cb8639) shows test=success, browser=success, deploy=skipped. Run 42528148409 (push, cc8a21a)
shows test=success, deploy=skipped.

**Contract check, exporter to app parser (verified on a surrogate, not on this case).** No real
brawley output exists, so the reviewer ran the real exporter on a real frozen compact package:
- Command: `export_road_forecast.py local gates <copy of gates-full-result-41750298470/compact> out.json <brawley station file relabelled case=gates> <sha>`.
  The copy's manifest got a placeholder `modelVersion`, because frozen packages carry none. 1.4 s.
- Output: 31,680 stations, **7,159,526 bytes**. over 7, below 5, dry 73, noRoadHeight 8,
  noCell 31,587, unknown 0. Almost all are no-cell because these stations lie outside Gates.
- Then `parseLocalRoadForecast` from `wt-app/public/simulation/local-road-forecast.js` ran with
  `case`/`modelVersion` set to the brawley values and `now = forecastStart`. Result: status ok,
  31,680 readable, 0 unreadable. All five contract states and every station field are accepted.
- One hour later the same file is `stale`. issuedAt (HRRR 14Z) is 3 h before the first frame (17Z),
  so a frozen file is only "current" at one instant. That does not matter for live files, which
  follow the route-summary rule.

**Contract defects found (not fixed: code, not docs).**
1. **`unknown` state.** The app does not know the exporter's 6th state. `readStation` returns null
   for it, so such stations are counted as unreadable and dropped. The file is still accepted,
   because the summary check ignores `unknown`. They are not shown as dry, which is correct, but
   they are not shown as unknown either.
   Fix (app): add `unknown` to `LOCAL_ROAD_STATES` and `SUMMARY_KEYS`, wording "Model: no reliable reading here in this run."
2. **Top-level `status: partial`** (solver not complete) is ignored by the app, so a partial run is
   displayed as an ordinary run. Fix (app): show "partial run" or reject.
3. **Rounding edge.** The exporter sets `over` from unrounded `wse > roadZ`, but writes
   `maxOver = round(wse - roadZ, 3)`. When the water is less than 0.5 mm over the road, `maxOver` is
   0.0 and the app's `over` rule (`maxOver > 0`) drops the station. Verified with a mutated station.
   Fix (exporter): decide over/below from the rounded `maxOver`, and write `firstOverTime` only for `over`.
4. **Size.** 7.2 MB per file (31,680 stations), fetched every 2 min with no-store by every map
   viewer. That is heavy on phone data. The Apps Script/alert path does not read it (verified: the
   module is not imported by road-forecast.js or the GAS bundle). Fix: publish only over/below
   stations plus counts, or a gzip/tiled variant. This is an owner/app decision.

**Coverage numbers re-derived from the dips CSV** (366 rows,
`origin/experimental/model-upgrade-diagnostics-20261107:docs/upgrade/candidate-road-dips-20261107.csv`):
- `finest_live_model_cell_m`: blank (no live model) 149, 100 m 149, 50 m 4, 25 m 2, 12.5 m 22,
  6.25 m 40.
- The new case's 48 L4 dips (matched by coordinates to within 1e-4°) include 47 of the 149 blank
  rows. The 48th has a live-model cell value in the CSV although it lies outside the live domain
  polygons (inference: inside a live mesh edge). **102 CSV dips remain in no model at all.** Of
  these, 71 are at least 0.5 m deep and 27 are at least 1 m deep, among them Cocorague 5.26 m,
  Agua Dulce 3.69 m and Tucker 2.04 m.
- **149 dips sit in 100 m cells of existing live cases** (85 of them at least 0.5 m deep, 24 at
  least 1 m). Refining them is **not done**; it needs mesh rebuilds of the existing cases.
- The orchestrator's figure of "81" is not reproduced by this CSV. The reviewer's count is 149
  (100 m only) or 155 (≥ 25 m).

**Doc claims checked.** These match the measured files: mesh 408,207 active cells and levelCounts;
domain 839.02 km²; Gates overlap 139.42 km²; 139 L4 points; station file 31,680 / 308,468 bytes; the
inflow peaks; the rain grid covering the official domain bounds (rain edges −111.525..−110.975,
31.915..32.435; domain −111.422..−111.043, 31.937..32.371). Corrections made:
- §0 tests line: tools/sfincs is 14 tests, not 3.
- V9 row: the app is wired.
- Components README: the "Cells at level" column is the formula estimate (e.g. L4 118,630), not
  the builder count (L4 = level 5: 132,287); the header now says so.
- Rain agent's area statistics (30.60 mm areal mean, 771 cells) use the 802 km² NLDI proxy polygon,
  not the 839 km² official domain (inference: within a few percent; recompute after `finish_route_case`).
- Inflow volumes differ by method: NWM agent 33,084 m³ vs §3 36,324 m³ for the same series. §3
  uses the rectangle rule, and the agent probably used the trapezoid rule (inference).
