# brawley-avra-west validation, 2026-11-08 (pre-run) and 2026-11-09 (post-run)

> **Post-run update, 2026-11-09T01:00Z.** Frozen v1b results now exist for both inflow variants
> (GitHub `sfincs.yml` runs 42535214906 NWM and 42535217219 observed USGS 09487000, 408,207 cells,
> both success). §0 below is the historical pre-run state. The verdict table in §1 is **updated with
> post-run evidence**, and §11 holds every post-run number. Nothing was tuned. Scripts:
> `tools/sfincs/brawley/validate_postrun.py` and `validate_postrun_arrival.py`. Outputs:
> `docs/upgrade/validation-brawley-postrun-20261108.json` and `validation-brawley-postrun-arrival-20261108.json`.

Case `brawley-avra-west`, modelVersion `all-routes-brawley-avra-west-v1`. Branch
`experimental/brawley-avra-west-20261108` at f758883. Tests are V1–V9 and acceptance criteria 1–8
from `docs/upgrade/DOCSHEET.md` §9–10 on `origin/experimental/model-upgrade-diagnostics-20261107`.
Nothing here was tuned. Committed by the review step, which re-checked the claims and added §10
(reviewer addendum, 2026-11-08T22:35Z).

## 0. The main fact (pre-run, superseded by §11): there was no frozen result to validate

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

## 1. Verdicts (updated post-run, 2026-11-09)

"NWM" is run 42535214906 (NWM frozen inflow, peak 1.70 m³/s). "Obs" is run 42535217219 (observed
USGS 09487000 inflow, peak 48.42 m³/s). Both runs use the same rain, mesh and parameters. Every
road comparison uses cell zs (NAVD88) against roadZ (lidar bare earth, not a surveyed deck). The
numbers behind each row are in §11.

| Criterion / test | Verdict | Evidence (short) |
|---|---|---|
| AC1 Coverage: ≥ 95% of priority-road stations in a model | **FAIL** (unchanged) | 64.4% (live 40.4% + new 24.1%); 35.6% in no model (§2) |
| AC1 Every CSV dip/crossing in the new domain at 6.25 m | **PASS for owned points; FAIL for the Gates overlap** (unchanged) | 48/48 owned dips and 91/91 owned crossings at 6.25 m; 73 overlap dips not at 6.25 m (§2) |
| AC2 / V1 Three Points, NWM variant | **FAIL** (unchanged) | inflow peak 1.70 m³/s vs 49.27 observed, ratio 0.035, timing ≥ +9.5 h. The inflow is unvalidated, so the case stays map-only (§3) |
| AC2 / V1, observed variant | **NOT TESTABLE (by construction)** | the inflow is the gauge itself. The inlet cell's zs peaks at 22:00Z, the same hour as the hourly inflow peak (§11.3) |
| Mass balance (inflow + rain − infiltration − outflow − storage) | **PASS** | residual +3,439 m³ (+0.013% of inputs) for NWM, −11,949 m³ (−0.044%) for Obs. Limit 10% (§11.1) |
| Outflow at the downstream edge vs NWM 15876711 (37.77 m³/s, 03Z) | **FAIL** (vs NWM reference, not an observation) | Obs outflow is 1.61 m³/s at 03Z, ratio 0.04. Its window maximum is 20.34 m³/s at 07Z, the run end, still rising, and it comes from rain (NWM run 19.96). By 07Z the inflow wave has not reached the outlet (§11.2) |
| Brawley mainstem travel time vs NWM 15876941→15876811→15876711 | **FAIL** (vs NWM reference) | NWM: +3 h to 15876811, +4 h to 15876711. SFINCS Obs: the wave front (zs rise > 0.3 m over the NWM run) reaches Mile Wide at 06:45Z, 8.75 h after the 22:00Z inlet peak. It does not reach Manville or Tucker by 07Z (> 9 h) (§11.3) |
| V2 Mile Wide / ALERT 6443, wet/dry | **PASS (1 wet point only)** | at 03:04Z the lowest cell within 30 m of the gauge is wet: zs 673.02 m, 1.34 m above the cell bed, in both runs. The Oct 31 dry reading falls outside the map window (starts Nov 1 17Z), so it is NOT TESTABLE (§11.4) |
| V2 Mile Wide / ALERT 6443, flow and timing vs 817 cfs (23.1 m³/s) at ~03:04Z | **FAIL** (second-hand reading, ambiguous location) | model at 03Z: 12.05 m³/s across both candidate channels (ratio 0.52). Black Wash band 8.83 m³/s, Brawley 15877627 band 3.21 m³/s. All of it is local rain (NWM run equal within 0.05 m³/s). The inlet wave arrives 3.7 h after the reading (§11.4) |
| Stage-to-road at the Brawley crossings | **Reported** (no pass threshold defined) | over road in both runs: Tucker +0.88 m, Manville +0.47 m, Little Williams +0.39 m, Donaldson +0.05 m. Mile Wide stays below the road (−0.17 m Obs, −0.20 m NWM). All of it is rain-driven; the run ends before the routed flood reaches Manville and Tucker (§11.5) |
| V3 100-year vs BFE | **NOT TESTABLE** | no 100-year forcing or run |
| V4 Nov 1–2 closures | **NOT TESTABLE** | no closure record inside the owned area. The Avra Valley Rd W of Brawley "Proceed with Caution" (Nov 1) is in Northern. The KOLD Sep 17 2026 story is a different event and was not tested (§11.8) |
| V5 / AC4 Representative dips | **Reported; AC4 NOT TESTABLE** | 12 dips tabulated with max zs, over-road and first-over time (§11.5). There is no owner-confirmed spot in the owned area |
| Sanity: ridge / elevated stations stay dry | **FAIL (minor, explained, not tuned)** | of 154 roads with ≥ 50 stations, 147 keep their 5 highest stations dry. On 7 roads one or more of the top 5 are "over" by 0.002–0.29 m. On 2 of them (N Razorback, S Crazy Cat) the road's highest point lies inside the Brawley floodplain, so it is not a ridge. On the other 5, the over stations' roadZ is within 0.15 m of the cell's lowest bed level, or below it. That is sheet flow in coarse or flat cells (Bar X and Iowa are 100 m), not ridge overtopping (§11.6) |
| Sanity: channel crossings wet before flats | **MIXED** | first over-road: Donaldson 19:15Z and Little Williams 19:30Z (before the station median of 20:00–20:30Z in 6.25/12.5 m cells), Tucker 21:15Z, Manville 22:00Z (after it), Mile Wide never. The Brawley crossings wet from local rain, not from the inlet wave (§11.6) |
| Sanity: no water upstream of the inlet | **PASS** | the Obs−NWM zsmax difference south of the inlet covers 31 cells, max 0.38 m, all within 144 m south of and 437 m from the inlet face (local backwater). 34,399 domain cells lie south of the inlet (§11.6) |
| Sanity: no instability | **PASS** | 0 NaN zs in wet cells (all 559,308 NaN have vol/area < 2e-5 m, i.e. dry). 0 up-and-down spikes > 0.5 m. Max 15-min rise 1.67 m (wave fronts). Min volume −0.040 m³. Velocity proxy max 1.35 m/s (§11.7) |
| V6 Under-deck water not reported on deck | **PASS (4 flagged stations)** | 4 deck-lidar stations on W Mile Wide Rd: roadZ 675.26–675.28 m, max zs 673.88–673.97 m, i.e. 1.3–1.4 m below the deck. They are reported "below", never "over". Other structures are not flagged, so they are untested |
| V7 Resolution sensitivity | **NOT TESTABLE** | no 100 m run |
| V8 Regression (Python) | **PASS** | re-run 2026-11-09: tools/live 157 OK (22.3 s), tools/sfincs 14 OK (0.26 s). Node and browser suites not re-run here |
| V9 App/alert parity | **NOT TESTABLE** | not run against the case output |
| AC6 Performance (≤ 35 min solver) | **PASS** | frozen runs: 1836.7 s (30.6 min) and 1785.0 s (29.8 min), 63 h simulated. Live run 42540016157: solver 771 s, job about 14m45s, well inside the hourly cycle |
| AC7 Missing data never shown as dry | **PASS** | inputs as in §7. NaN zs only marks cells with essentially no water. The exporter counts frames with no reading as `unknown` (12 stations Obs, 10 NWM), never dry. 28 no-cell and 8 no-height stations are kept |
| Resolution honesty | **PASS** | over-road counts by cell size are reported (§11.5). 143–196 "over" stations are in 100 m cells |
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

## 9. To finish validation once results exist (both variants) — done 2026-11-09, see §11

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

## 11. Post-run validation (frozen v1b results, 2026-11-09)

**What was used.**
- Native output of both runs, read from the local copies at
  `.sfincs-runs/brawley-avra-west-result-<run>/artifact/runs/current/`:
  - `sfincs_map.nc`: 57 quarter-hour frames, 2026-11-01T17:00Z..11-02T07:00Z, holding zs, subgrid_volume, precipitation_rate, zsmax, cumprcp and cuminf.
  - Hourly restart files `sfincs.*.rst`: 14 of them, 18Z..07Z, holding zs and the face flux q at every u/v point.
  - The quadtree `sfincs.nc` and `sfincs.dis`.
- There is **no his file**, because the case has no observation points (`nobs` 0). There is also no cross-section file and no velocity output (`storevel` 0).
- **How discharge was measured.** Discharges come from the restart flux q, in m²/s, multiplied by the u/v-point width (the finer cell's size). The u/v points were indexed in the solver's own order (`sfincs_domain.f90` in H:\AI\Projects\sfincs-source, read only). The count is 827,160 u/v points, plus 24,903 refinement transition points and 1 dummy, which matches the restart record length of 852,064.
- **Sections.** A section is a stair-step line along a parallel, limited to a longitude band. Positive flow is northward (downstream).
- **Outflow.** Outflow is the flux over the 44 links into the 26 outflow-boundary cells (msk 3, 12.5/25 m) at −111.2929, 32.3646.
- **Method check.** The mass balance in §11.1 closes to 0.01–0.04%, which confirms this method.
- **Reproduce:** `python -I tools/sfincs/brawley/validate_postrun.py E:/FloodPLAIN/wt-model docs/upgrade/validation-brawley-postrun-20261108.json` (about 1 min), then `validate_postrun_arrival.py` the same way.

### 11.1 Volume balance (whole run, Oct 30 16Z – Nov 2 07Z; storage starts dry, zsini 0)

| m³ | NWM 42535214906 | Obs 42535217219 |
|---|---|---|
| Inflow (sfincs.dis, trapezoid) | 33,084 | 924,390 |
| Rain (Σ cumprcp·area; 31.00 mm over 838.99 km²) | 26,005,851 | 26,005,972 |
| Infiltration (Σ cuminf·area; 25.14 mm, 81.1% of rain) | 21,092,673 | 21,092,734 |
| Storage at 07Z (Σ subgrid_volume) | 4,729,968 | 5,629,281 |
| Outflow 18Z–07Z (hourly restart flux, trapezoid) | 212,855 | 220,296 |
| **Residual** (inflow + rain − infiltration − storage − outflow) | **+3,439 (+0.013%)** | **−11,949 (−0.044%)** |

- **Nothing above 10% is unexplained.** The residual also contains any outflow before 18Z, which can be at most about 3.4k m³: the measured outflow is 0.000 m³/s at 18Z, 19Z and 20Z.
- **Rain timing.** 13.96M m³ of the rain fell before the map window (before 17Z) and 12.05M m³ inside it, mostly 17–21Z, with a second burst of 0.06–0.29M m³/h at 03–07Z Nov 2.
- **Hourly check, Obs run.** Implied infiltration is inflow + rain − outflow − ΔS. For 23Z–03Z, when there is almost no rain, it is −0.8k to −1.1k m³/h, about 0. The CN infiltration (`cna`) acts on rainfall only, so **the inflow water never infiltrates**: the model has no channel transmission loss, as `knownLimits` already says.
- **Where the inflow went.** Storage at 07Z differs between the runs by 0.899M m³, against an inflow difference of 0.891M m³. Only 7.4k m³ more left through the outlet. So 99% of the observed inflow is still inside the domain at 07Z.
- **Negative volume.** The minimum cell volume is −0.040 m³ (NWM) and −0.034 m³ (Obs). The negative total at 07Z is −0.016 / −0.064 m³, which is negligible. The NWM result still has one cell at −0.0010285 m depth (frame 2026-11-02T01:00Z, cell 314897, 39.06 m²). That is just past the live verifier's 0.001 m limit, as the results report says.

### 11.2 Outflow at the downstream edge (node 720060498, −111.2930, 32.3647)

Hourly instantaneous outflow, m³/s (restart flux):

| Z | 18 | 19 | 20 | 21 | 22 | 23 | 00 | 01 | 02 | 03 | 04 | 05 | 06 | 07 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| NWM | 0 | 0 | 0 | 0.06 | 0.28 | 0.53 | 0.40 | 0.27 | 1.08 | 2.24 | 11.55 | 13.71 | 19.04 | 19.96 |
| Obs | 0 | 0 | 0 | 0 | 0.41 | 1.60 | 1.20 | 1.39 | 1.08 | 1.61 | 10.83 | 13.92 | 18.99 | 20.34 |
| NWM analysis 15876711 (reference) | 0.27 | 0.27 | 0.27 | 0.29 | 0.32 | 0.43 | 5.82 | 23.69 | 33.96 | **37.77** | 36.83 | 31.14 | 24.62 | 19.11 |

- **Obs variant against the NWM reference** (peak 37.77 m³/s at 03Z, 821,844 m³ over the whole window):
  - At 03Z SFINCS gives 1.61 m³/s.
  - The window maximum, 20.34 m³/s, comes at 07Z, the last frame. It is still rising and is not a peak.
  - Outflow volume 18Z–07Z is 220,296 m³.
  - The NWM run gives the same curve within 0.4 m³/s. So the outlet response is **rain on the lower domain** (04–07Z burst), not the Brawley inflow.
- **Water at the outlet.** The outlet channel cell (face 158782, 12.5 m, zb 617.56) has at most 0.076 m of water in both runs. The Obs−NWM zs difference at the outflow cells is at most 0.069 m (05:30Z) and 0.015 m at 07Z.
- **Verdict: FAIL against the NWM timing and peak.** The NWM analysis is a reference, not an observation. The likely cause (inference) is slow routing across the wide wash floodplain plus a window that ends at 07Z (§11.3).
- **Northern injection.** Northern's frozen injection here is 0.27 m³/s baseflow (§3). The SFINCS outflow is not coupled into Northern.

### 11.3 Brawley mainstem: wave arrival and travel time (Obs variant)

- **Method.** Both runs have identical rain, so the arrival of the inlet wave is taken from the Obs − NWM zs difference (dry cells set to bed level). "Front" is the northernmost cell where the difference exceeds 0.3 m.
- **Thresholds.** The literal rule "zs > 0.3 m above the dry level at the channel cell" is also given per site. A 0.05 m threshold proved to be noise level: it jumps around far from the wave, so it was not used for timing.
- **Inlet.** The inlet face 144751 (12.5 m, zb 754.28) peaks at zs 755.671 at 22:00Z, 1.39 m deep. That matches the hourly inflow peak, 48.42 m³/s at 22Z.
- **Front distance north of the inlet (0.3 m):**
  - 21:00Z 0.39 km
  - 23:00Z 2.26 km
  - 01:00Z 4.47 km
  - 03:00Z 8.27 km
  - 05:00Z 13.44 km
  - 06:30Z 15.18 km (Mile Wide)
  - 07:00Z 16.98 km (lat 32.2626)
  - That is a front speed of about 1.7 km/h (0.46 m/s).
  - An earlier small pulse (gauge rise 18–20Z) reached 2.85 km and faded.
- **Section discharges, Obs (NWM in brackets), m³/s:**
  - **Donaldson Ranch:** 3.85 (3.28) at 01Z, 17.81 (3.91) at 02Z, **21.52 (4.32) at 03Z, the peak**, 13.97 (3.89) at 07Z. The wave arrives between 01Z and 02Z and peaks about 5 h after the inlet. The peak drops from 48.4 to about 17.2 m³/s of inlet water.
  - **Mile Wide, both bands:** 13.64 (13.59) at 05Z, 19.77 (14.52) at 06Z, **35.17 (15.76) at 07Z**, still rising. Zs difference first > 0.3 m at 06:45Z. Literal rule at the cell with the largest difference (face 223827, 12.5 m, zb 672.97, −111.2438, 32.2479): first above zb + 0.3 at 05:15Z.
  - **Manville:** at 07Z, 29.78 (27.15). Zs difference at most 0.094 m. **Not reached by 07Z.**
  - **Tucker:** at 07Z, 34.53 (33.43). Zs difference at most 0.01 m. **Not reached.**
- **Travel time against NWM analysis.**
  - NWM: 15876941 peaks at 23Z (46.8), 15876811 at 02Z (39.13, +3 h), 15876711 at 03Z (37.77, +4 h).
  - SFINCS: inlet peak at 22Z, leading edge at Mile Wide (15876811) at 06:45Z (+8.75 h, peak not yet reached), and nothing at 15876711 by 07Z (> 9 h).
  - **SFINCS is at least 2.9× slower than NWM to Mile Wide. FAIL against the NWM reference.**
  - The 07Z window end cuts off the routed flood peak everywhere from Mile Wide downstream. A longer frozen window would be needed to see it. That is a test-design limit, not a tuning target.
- **Where the main flow runs at Mile Wide (finding).** In the model, the inlet water reaches Mile Wide in the **east band (−111.2475 to −111.236, the NHD 15876815 Black Wash reach where ALERT 6443 sits)**: 29.95 m³/s Obs vs 13.83 NWM at 07Z. The NHD 15877627 band (−111.262 to −111.2475) carries only 5.21 vs 1.94. So the modelled Brawley channel at Mile Wide follows the terrain near the gauge, not the NHD 15877627 line.

### 11.4 ALERT 6443 at 20:04 MST Nov 1 (03:04Z Nov 2) vs ~817 cfs (23.1 m³/s)

zs is linearly interpolated between 03:00Z and 03:15Z. Both runs agree to the millimetre at these cells.

| Candidate cell | Face, size | zb m | zs 03:04Z m | zs − zb m | vol/area m |
|---|---|---|---|---|---|
| Face containing the gauge point (on 15876815) | 223058, 12.5 | 673.75 | 673.76 | 0.01 | 0.002 (dry by the 0.0091 rule) |
| Lowest face within 30 m of the gauge | 223379, 12.5 | 671.68 | **673.02** | **1.34** | 0.60 |
| Confluence, start of 15876811 | 223847, 12.5 | 671.19 | 672.62 | 1.43 | 0.72 |
| Brawley 15877627 at Mile Wide Rd (lowest within 30 m) | 323609, 6.25 | 674.01 | 674.10 | 0.10 | 0.008 (dry by the rule) |

- **Section flow at 03Z** (Obs, NWM within 0.05):
  - Black Wash band: 8.83 m³/s
  - Brawley 15877627 band: 3.21 m³/s
  - Both bands: 12.05 m³/s, which is **0.52× the reported 23.1 m³/s**
  - All of it is local rain. NWM analysis 15876815 was 0.28 m³/s at 03Z, so SFINCS makes about 30× more runoff in that subtree than NWM does.
- **Verdict.**
  - Wet/dry: the gauge channel is wet at the reading, so wet/dry agrees (1 point).
  - Flow: 0.52×. The inlet wave reaches Mile Wide 3.7 h after the reading.
  - **V2 flow and timing: FAIL**, on one second-hand value with an uncertainty of about ±1 h. The location ambiguity stays unresolved, although the model's main channel runs past the gauge.
  - The Oct 31 14:00 MST dry reading is outside the map window: NOT TESTABLE.

### 11.5 Road crossings and representative dips (zs vs roadZ, both variants)

- **How these were computed.** Stations within 25 m of the point. Max WSE is the largest cell zs over frames where the cell is wet (vol/area ≥ 0.0091 m, the exporter's rule). Max over = max WSE − roadZ, taken at the station with the largest value.
- **First over** is the first frame in which any of those stations has zs > roadZ. "n over" is the number of stations ever over, out of 5.
- All points sit in 6.25 m cells. Times are Z.

| Point | roadZ min–max | NWM max WSE / over / first / n | Obs max WSE / over / first / n |
|---|---|---|---|
| W Mile Wide Rd × Brawley | 674.88–674.93 | 674.687 / **−0.203** / – / 0 | 674.716 / **−0.174** / – / 0 |
| W Manville Rd × Brawley | 652.59–652.94 | 653.058 / +0.468 / 22:00 / 5 | 653.059 / +0.469 / 22:15 / 5 |
| W Tucker Rd × Brawley | 631.67–632.55 | 632.553 / +0.883 / 21:15 / 4 | 632.554 / +0.884 / 21:15 / 4 |
| W Little Williams Dr × Brawley | 631.37–631.83 | 631.758 / +0.388 / 19:30 / 3 | 631.758 / +0.388 / 19:30 / 3 |
| W Donaldson Ranch Rd × Brawley | 710.69–710.77 | 710.742 / +0.052 / 19:15 / 4 | 710.747 / +0.057 / 19:15 / 5 |
| 1 W Snyder Hill Rd 1.73 m | 706.68–706.95 | 707.141 / +0.461 / 19:15 / 5 | same |
| 2 Garcia Ranch Rd 1.32 m | 726.50–727.24 | 726.819 / +0.319 / 17:00 / 2 | same |
| 3 W Manville Rd 1.24 m | 651.85–652.55 | 652.306 / +0.456 / 21:30 / 4 | 652.305 / +0.455 / 21:30 / 4 |
| 4 W Manville Rd 1.12 m | 652.10–652.87 | 653.020 / +0.920 / 21:45 / 5 | 653.021 / +0.921 / 21:45 / 5 |
| 5 Garcia Ranch Rd 1.01 m | 728.06–728.19 | 728.360 / +0.300 / 17:00 / 5 | same |
| 6 Garcia Ranch Rd 0.98 m | 726.68–727.66 | 726.674 / −0.006 / – / 0 | same |
| 7 N Mesquite Oasis Rd 0.96 m | 624.56–624.85 | 624.763 / +0.203 / 20:30 / 2 | same |
| 8 W Donaldson Ranch Rd 0.90 m | 707.83–708.28 | 707.921 / +0.091 / 23:45 / 2 | **708.237 / +0.407** / 23:45 / 5 |
| 9 W Tucker Rd 0.88 m | 631.67–632.55 | 632.553 / +0.883 / 21:15 / 4 | 632.554 / +0.884 / 21:15 / 4 |
| 10 W Orange Grove Rd 0.73 m | 637.79–638.05 | 638.021 / +0.231 / 19:30 / 4 | 638.020 / +0.230 / 19:30 / 4 |
| 11 W Little Williams Dr 0.72 m | 631.11–631.46 | 631.539 / +0.429 / 20:30 / 5 | same |
| 12 W Drillers Rd 0.65 m | 633.44–633.76 | 633.730 / +0.290 / 20:30 / 3 | 633.729 / +0.289 / 20:30 / 3 |

- **What drives the over-road values.** The two runs match within 0.03 m everywhere except dip 8, which the inlet wave raises by 0.32 m. So the over-road at the Brawley crossings in this window comes from **local rain**, not from the Brawley flood.
- **Mile Wide.** Using all frames, without the wet rule, the crossing cells reach 674.785 m at 07:00Z in Obs and are still rising: 0.095 m below the road at the window end. NWM peaks at 674.765 at 02:00Z.
- **Frames with no wet flag.** Garcia Ranch dips 2 and 5 are already over at the first frame (17:00Z), because 16.6 mm of rain fell before the window.
- **All 31,680 stations, over counts by cell size, NWM / Obs.** The totals equal the exporter samples: 2,114 / 2,581.
  - 6.25 m: 828 / 893 (> 0.3 m: 68 / 76)
  - 12.5 m: 643 / 709
  - 25 m: 236 / 284
  - 50 m: 264 / 499
  - 100 m: 143 / 196 (median over 0.09 / 0.10 m)

### 11.6 Sanity checks

- **Ridge stations: the 5 highest-roadZ stations on each of the 154 roads with ≥ 50 stations.** 147 roads stay dry at all 5. 7 roads have stations that go over:
  - **N Razorback:** the road's top, 632.38–632.54, is in the Tucker floodplain (zs 632.51–632.66, 6.25 m cells), over by 0.12–0.13 m.
  - **S Crazy Cat Ln:** top 714.69–714.84. Obs is over by 0.04–0.29 m and NWM by at most 0.002 m, so this is inlet water in the Brawley floodplain near Donaldson Ranch.
  - **S Marstellar Rd:** over by 0.18–0.28 m, 50/100 m cells, roadZ 713.79–713.99 vs cell bed 713.69–713.90.
  - **W Bar X St:** 811.08 and 811.18 over by 0.13 and 0.03 m, 100 m cell, bed 811.12, so roadZ is below the cell bed.
  - **W Iowa St:** 778.40 over by 0.03 m, 100 m cell, bed 778.35.
  - **Welcome Way:** over by 0.03 m.
  - **W Dusty Flat Pl:** over by 0.01–0.05 m, 6.25 m cells.
  - **Reading.** Where these stations are over, either the road is in the floodplain or roadZ ≤ cell bed + 0.15 m. The 1 m road-height lidar and the subgrid terrain also disagree by up to a few cm (bare earth is not a surveyed deck). Strictly this is FAIL; physically it is sheet flow. Not tuned.
- **Crossings before flats.** The station median of the first over-road frame is frame 12–13 (20:00–20:15Z) for 6.25/12.5 m cells in NWM, and frame 13–14 in Obs.
  - The Brawley crossings first go over at Donaldson 19:15Z, Little Williams 19:30Z, Tucker 21:15Z and Manville 22:00Z. Mile Wide never does.
  - **MIXED.** The crossings respond to local rain at the same time as the flats.
- **Upstream of the inlet.**
  - 34,399 domain cells lie south of the inlet face, which is at y 3,552,603. Only 31 of them have Obs − NWM zsmax > 0.05 m, with a maximum of 0.376 m. All are within 143.75 m south of and 437 m from the inlet, which is local backwater at the injection cell.
  - Nowhere does Obs − NWM fall below −0.026 m.
  - **PASS.**
- **Instability.**
  - zs is NaN in 559,308 values over 115,927 cells. All have vol/area < 1.9e-5 m, so NaN marks a dry cell. 0 of them are wet by the 0.0091 m rule.
  - 0 cells show an up-and-down spike (> +0.5 m then < −0.5 m in successive frames).
  - The maximum 15-min rise is 1.65 m (NWM) and 1.67 m (Obs). 124 / 113 cells rise > 1 m in 15 min, at wave fronts and filling cells.
  - zs is never below zb (minimum zs − zb is +6e-5 m).
  - The maximum depth is 3.29 m, in a 100 m cell at −111.2528, 32.1163 (zb 732.39), a depression.
  - Velocity proxy |q|/h at u/v points from the hourly restarts: at most 1.35 m/s, at 01Z, 6.25 m, −111.2702, 32.2481 (the Mile Wide deck site). |q| is at most 2.11 m²/s.
  - **PASS.**

### 11.7 V6 deck stations

The four `deckLidar` stations on W Mile Wide Rd at −111.2703, 32.2481 are all in 6.25 m cells.

| Station | roadZ | cell zb | max zs (Obs) |
|---|---|---|---|
| 1:0 | 675.28 | 673.32 | 673.97 |
| 6:900 | 675.26 | 672.37 | 673.88 |
| 6:1000 | 675.27 | 672.42 | 673.89 |
| 6:1064 | 675.28 | 673.32 | 673.97 |

The water under the deck stays 1.29–1.39 m below roadZ, and the exporter reports these stations "below", never "over". **PASS for these 4.** Other structures have no flag, so they cannot be checked.

### 11.8 Owner-observed facts

- **Nov 1 2026, county "Proceed with Caution" at Avra Valley Rd W of the Brawley Wash.** That crossing is in the **Northern** domain, not in brawley-avra-west, so it cannot test this case. Northern's frozen run injects only 0.27 m³/s here (§3), so Northern would not reproduce the Brawley flood either (inference).
- **KOLD, Sep 17 2026, "vehicles stuck in Pima County flooding"** (https://www.kold.com/2026/09/17/vehicles-stuck-pima-county-flooding/). This is a **different event**. No forcing for it exists, so it was **not tested**.

### 11.9 What this means

- **Usable now.** The model conserves mass and is stable.
- **Map-only.**
  - With the observed inlet, the inlet wave routes downstream much more slowly than NWM: it is at Mile Wide at 06:45Z and not yet at Manville by the 07Z window end.
  - Every Brawley-crossing over-road in the frozen window comes from local rain on the domain, which the CN method turns into 5.86 mm of runoff, 18.9% of the rain.
  - The NWM variant's inflow is unvalidated (V1 FAIL), so the case stays **map-only**.
- **Not done.** Not tested: 100-year/BFE (V3), closures (V4), resolution sensitivity (V7), app parity (V9). Owner review (AC8) is pending.
- **Next evidence that would help (not tuning).**
  - A frozen window running to at least Nov 2 15Z with the observed inflow, so the routed peak is seen at Manville, Tucker and the outlet.
  - Retained ALERT 6443 records.
  - Observation points (his output) at the crossings.

## 12. Extended-window validation run (v2x, observed inflow, to 2026-11-02T18Z) — 2026-11-09

**Validation only, not a live configuration and not tuned.**
- Run 42544624673, case `brawley-avra-west-native-case-v2x-observed-inflow`.
- It uses the v2 mesh, parameters and boundaries (643,056 cells, 47 outflow cells); nothing was rebuilt.
- The window is 2026-10-30T16Z to 2026-11-02T18Z (74 h). Map frames are every 15 min from Nov 1 17Z (101 frames).
- Solver time 5,680.8 s against the 7,200 s cap.
- Numbers: `tools/sfincs/data/brawley-avra-west-v2/extended/result-42544624673/summary.json`. Tools: `tools/sfincs/brawley/extend/`.

### 12.1 Forcing

- **Inflow.** Observed USGS 09487000 for all 75 hours, using the same top-of-hour rule as `build_brawley_inflow.py`. Peak 48.42 m³/s at 22Z. Applied volume 955,908 m³: the trapezoid over `sfincs.dis`, whose values are rounded to 0.01 m³/s (the solver interpolates linearly between them). Before rounding the series holds 955,922 m³.
  - Hourly-mean variant, reported only, not used as forcing. The centred mean gives a peak of 47.79 m³/s and 1,017,550 m³.
  - So top-of-hour sampling is 6.1% low in volume. Nearly all of the gap is the 21:15–21:30Z front: at 21Z the reading is 66 cfs, while the centred mean is 627 cfs.
  - A refetch of NWIS on Nov 9 matched all 480 readings.
- **Rain to 07Z.** The frozen v2 frames, unchanged. After 14Z Nov 1 these are the HRRR 14Z forecast, as in the frozen case.
- **Rain 07Z–18Z.** Observed Stage IV 01h from IEM, with the same checks, grid hash and cell mapping as the frozen analysis hours. 0 missing cells, so no MRMS replacement was needed and nothing was zero-filled. Domain mean 3.29 mm, mostly 07–10Z (1.20, 1.25, 0.55 mm/h).
  - Basis: 3.29 mm is mesh-area-weighted (the 1 km `precip_2d.nc` value at each face centre, weighted by face area), which is the rain the model receives. The same method over the whole run gives 33.72 mm against the solver's `cumprcp` 33.73 mm.
  - The same hours give 3.51 mm as an unweighted mean of the mapped Stage IV (HRAP) cells, and 3.26 mm as an unweighted mean of the 1 km grid's bounding box. Neither is the model's rain.
  - Integrating the map's 15-min `precipitation_rate` snapshots gives 3.10 mm; those are samples, not the applied total.
- **Side finding: the frozen HRRR misses most of the early rain.** Stage IV for the hours that the case forces with HRRR (reference only, not forcing):

  | Hours | Frozen HRRR, domain mean | Stage IV, domain mean |
  |---|---|---|
  | 14–17Z | 0.67 mm | 19.46 mm |
  | 17–07Z | 14.16 mm | 14.49 mm |

  - HRRR peaks at 19Z; Stage IV peaks at 15–17Z.
  - So the frozen case misses about 19 mm of early rain and has the rain burst about 2–3 h late. This matters for the rain-fed Black Wash flow at ALERT 6443.

### 12.2 Checks

- **Mass balance (corrected 2026-11-09).** Inflow, rain and infiltration cover the whole run, but outflow is counted only from the first hourly restart (18Z Nov 1). The run writes no his file and map frames start at 17Z Nov 1, so outflow before 18Z cannot be integrated from these outputs. The script block is now named `balanceInputsWholeRunOutflowFromFirstRestart` (it was `balanceWholeRun`).
  - Residual −112,122 m³, −0.26% of inputs. This is an estimate, not a hard bound (corrected 2026-11-09; it was called "the least negative value"). The outflow from 18Z on is a trapezoid over hourly snapshots of the instantaneous flux, not a time integral of the solver flux, so its error can have either sign. Any outflow before 18Z would make the residual more negative by that amount.
  - What bounds the missing outflow: the outflow flux is 0.000 m³/s on all 71 outflow links at 18, 19, 20 and 21Z, and every outflow cell is dry (vol/area 0.0000 m) in the map frames 17Z–22Z.
  - Before 18Z the domain received 16.3 mm of rain (20.2M m³) and 7,416 m³ of inflow, and held 1.45M m³ at 18Z. Taking infiltration as zero, the outflow before 18Z is at most 18.8M m³. That bound is loose because infiltration was not zero. So the residual lies between about −18.9M m³ and about −112,122 m³, and both ends carry the hourly-sampling error of the outflow term. It is not measured more tightly than that.
- **Storage.** At 18Z there is still 7.80M m³ in storage. 2.01M m³ left through all outflow cells from 18Z Nov 1 on (earlier outflow is not in the outputs; see the mass-balance item).
- **Same result as the 63-h v2 observed run up to 07Z.**
  - The 99th-percentile |Δzs| is 0.0002 m and the maximum is 0.074 m; 4,720 cells differ by more than 0.01 m.
  - The inputs are identical up to 07Z, so these differences likely come from the solver run itself (inference).
- **Negative depth.** The minimum vol/area is −0.67 mm (face 520909, 22:00Z). No cell goes below −1 mm, so this run is inside the live verifier's limit. The −1.03 mm cell is in the v1b NWM run, not here.
- **Stability.**
  - 0 wet NaN values and 0 spikes.
  - Maximum 15-min rise 1.60 m. Velocity proxy at most 1.47 m/s (09Z, at the Mile Wide deck).

### 12.3 Arrival and peaks (hourly restart flux, m³/s)

The inlet peaks at 22Z. The baseline column is the v2 NWM-inflow run at 07Z: the same rain with almost no inflow (peak 1.70 m³/s), so it shows the rain-only flow.

| Section | km N of inlet | Peak / time | h after inlet peak | Peak speed | Q 07Z (baseline) | Q 18Z |
|---|---|---|---|---|---|---|
| Donaldson Ranch | 7.4 | 21.29 / 03Z | +5 | 1.47 km/h | 13.98 (3.83) | 3.14 |
| Mile Wide, both bands | 15.4 | 47.54 / 09Z | +11 | 1.40 km/h | 34.63 (15.25) | 31.27 |
| ·· Black Wash band (ALERT 6443) | | 40.66 / 09Z | | | 29.53 (13.4) | 27.8 |
| ·· Brawley 15877627 band | | 7.00 / 10Z | | | 5.10 (1.9) | 3.5 |
| Manville | 20.3 | 62.79 / 11Z | +13 | 1.56 km/h | 29.36 (26.66) | 36.60 |
| Tucker | 25.1 | 64.34 / 13Z | +15 | 1.67 km/h | 32.42 (31.14) | 43.15 |
| Outlet 720060498 (26 outflow cells) | 28.4 | 26.32 / 14Z | +16 | 1.77 km/h | 17.31 (17.58) | 19.12 |

- **The wave front.** It is the same as in v1b: by 07Z it is 16.98 km north of the inlet (lat 32.2626). At the ALERT cell the difference from the baseline first exceeds 0.3 m at 07:00Z (06:45Z in v1b).
- **Peak timing against NWM analysis.**
  - NWM: 15876941 peaks at 23Z (46.80), 15876811 at 02Z (39.13, +3 h) and 15876711 at 03Z (37.77, +4 h).
  - SFINCS peaks at Mile Wide (15876811) at 09Z: +11 h from the inlet and 7 h after NWM.
  - SFINCS peaks at Tucker at 13Z and at the outlet at 14Z: +15/+16 h, 10–11 h after NWM.
  - The extended window shows the peaks, and the slow wave is confirmed: about 1.4–1.8 km/h, 3.7× NWM's travel time. **FAIL against the NWM reference.**
- **Peak size against NWM** (window maxima, which include the extra rain from 07–10Z):
  - Mile Wide 47.54 vs 39.13 (1.21×).
  - Tucker 64.34 vs 37.77 (1.70×).
  - Outlet 26.32 vs 37.77 (0.70×).
  - After 07Z there is no rain-only baseline, so the split between inlet water and the extension's rain is not measured.
- **Against the primary ALERT 6443 series** (`tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/gauges.json`; §13). Corrected 2026-11-09: this used to compare with a second-hand ~817 cfs at ~03:04Z.
  - The owner's ~817 cfs (23.1 m³/s) is confirmed in the primary data, but which report the owner saw is uncertain: 817 cfs at 02:45Z Nov 2, 776 cfs at 03:00Z, and 817 cfs also at 23:55Z Nov 1. So no single reading time is used.
  - At 03Z the primary report is 776 cfs = **21.97 m³/s**. The model gives 8.83 m³/s on the Black Wash band and 11.76 across both bands: **0.40× / 0.535×**.
  - The model first reaches 21.97 m³/s at about 06:20Z (Black Wash band) and 06:07Z (both bands), linear between hourly restarts: about 3.1–3.3 h after 03Z. For 23.1 m³/s it is 06:26Z / 06:12Z.
  - Its peak at Mile Wide is 40.66 (Black Wash band) / 47.54 (both bands) at 09Z. In the cell nearest the gauge, zs peaks at 673.631 at 09:15Z, 1.97 m above the cell bed.
  - **V2 flow and timing: still FAIL**, now against the primary series (all numbers in `alert6443` of the result's `validation-full.json`).
  - The missing early Stage IV rain (§12.1) may explain part of the 03Z shortfall (inference, not tested here; see §15).
- **Where the outlet water goes.**
  - The outlet cluster passes 959,158 m³ (peak 26.3 at 14Z). Its channel cell holds at most 0.072 m of water.
  - About 2 km east, at −111.2705, 32.3652 (a 100 m cell, zb 617.08), water ponds 5.62 m deep. It reaches zs 622.70 at 18Z and is still rising (622.53 at 17Z; corrected from 622.53, which was the 17Z value).
  - 1.24M m³ (1,241,787) is stored within 1.5 km of that cell at 18Z.
  - The flow from Tucker (64 m³/s) is therefore stored before it reaches the outflow cells. This could be a terrain barrier or a flaw in the 100 m-cell terrain (inference, not identified). **It should be checked before the outlet flow is trusted.**
  - The west-valley outflow cluster (12 cells, −111.337, 32.413) passes 956,810 m³ (peak 32.0 at 05Z).

### 12.4 Road over-topping at the Brawley crossings, full window

Over-topping is cell zs minus station roadZ, counted only in wet frames.

| Crossing | Max over, whole window | Time | Max over by 07Z | First over → last over | Stations over |
|---|---|---|---|---|---|
| W Mile Wide Rd | **−0.128** | 08:45Z | (−0.176 in v2 obs) | never | 0/5 |
| W Manville Rd | **+0.612** | 11:15Z | +0.446 | 22:30Z → still over at 18Z | 5/5 |
| W Tucker Rd | **+0.921** | 12:45Z | +0.869 | 21:45Z → still over at 18Z | 5/5 |
| W Little Williams Dr | +0.429 | 12:45Z | +0.376 | 19:30Z → still over at 18Z | 4/5 |
| W Donaldson Ranch Rd | +0.057 | 03:45Z | +0.057 | 19:00Z → still over at 18Z | 5/5 |

- **Mile Wide.** The crossing stays under the road. The 8 deck-lidar stations there stay 1.3–2.2 m below roadZ.
- **Dips.** Manville dip 4 (1.12 m) reaches +1.322 at 11:15Z (+0.944 by 07Z). Snyder Hill reaches +0.642 at 14:30Z.
- **All stations.** 4,859 of 57,465 stations (v2 list) go over at some point, against 4,279 by 07Z. That is 580 stations over only after 07Z.
  - By cell size, full window: 6.25 m 1,569 (206 > 0.3 m), 12.5 m 1,831, 25 m 373, 50 m 623, 100 m 463.
- **What changes after 07Z.** The routed flood raises Manville, Tucker and Little Williams by a further 0.05–0.17 m. These crossings are still over at the 18Z window end, so the recession is not complete.

### 12.5 What is left

- **No rain-only baseline after 07Z.** A rain-only sensitivity run (same v2x rain, NWM or no inflow, labelled as a sensitivity) would separate inlet water from extension rain at Mile Wide, Manville and Tucker.
- **An all-observed-rain sensitivity** (Stage IV from 14Z Nov 1) would test whether HRRR's missing 19 mm explains the 03Z ALERT 6443 shortfall.
- **The pond near the outlet** needs a terrain check.
- **The window still ends while the crossings are over** (Manville, Tucker, Little Williams). A window to Nov 3 00Z would show the recession.

## 13. Observed downstream timing (primary gauge data, 2026-11-09)

**Validation only; nothing was tuned.**
- Data, provenance and the build script: `tools/sfincs/data/brawley-avra-west-v2/observed-gauges-20261101/` (`gauges.json`, `README.md`, `raw/`).
- Times are UTC. The county ALERT pages are Arizona MST. That was checked against the co-located USGS 09487000, whose readings are stamped −07:00.

### 13.1 What exists

- **The `data` branch has no history.** The snapshot workflow force-pushes one commit every ~10 min, so the Nov 1–2 readings came from the county's own `showdata.php`. That page returns the last 1,000 reports per sensor, which covers the whole event.
- **Every stream sensor in or next to the domain was checked** (EPSG:32612 domain polygon). The only observed point downstream of the inlet on the Brawley system is **ALERT 6443** at Mile Wide Rd.
  - The county names it "Brawley Wash at Milewide Road". Its coordinates snap to NHD 15876815 (the Black Wash outlet, 604 km²) at 4.8 m; the Brawley 15877627 crossing is 0.8 km west.
  - These point to different comparisons. If the NHD position is right, the gauge sees the model's Black Wash band (and NWM 15876815). If the county name means the combined Brawley flow at the road, it sees both bands (and NWM 15876811). This is not settled, so both bands are always given.
- **The others cannot time the wave:**
  - AZGFD 1/2/3 are off-channel stage-only sensors, 270–870 m from any flowline.
  - Santa Cruz at Trico (USGS 09486520, ALERT 1345) is upstream of the Brawley/Los Robles confluence.
  - USGS 09487250 Los Robles nr Marana is historical, with no IV data.
- **There is no sensor at Manville, Tucker or the outlet.**

### 13.2 ALERT 6443, from primary data

- First rise 16:20Z Nov 1.
- Peaks:
  - **2,286 cfs (64.7 m³/s, 4.87 ft) at 18:20Z Nov 1**, the event maximum.
  - 1,482 cfs (42.0) at 21:45–22:00Z.
  - 906 cfs (25.7) at 02:10Z Nov 2.
- After that the flow is 14–16 m³/s at 04–08Z, then flat at 11.2–12.3 m³/s (2.64–2.72 ft) from 08:45Z to 16:20Z.
- **Low-stage rating caveat.** In the stage/flow pairs of all 1,000 reports on the county page, the rated flow is 0 cfs up to 2.49 ft, 16–17 cfs at 2.50 ft, 330–332 cfs at 2.59 ft and 383 cfs at 2.61 ft (no report at exactly 2.60 ft). The flow jumps from 0 to about 380 cfs over 0.1 ft, so a few hundredths of a foot of stage shift reads as hundreds of cfs. **The 08:45–16:20Z plateau sits on that step and may be a rating or stage-shift artifact.**
  - The 2.30 ft base is the pre-event reading (0 cfs), not the rating's zero-flow stage.
- **The 817 cfs claim: the value is confirmed; which report the owner saw is uncertain.** 817 cfs (3.37 ft) is reported at 02:45Z Nov 2 (19:45 MST, falling limb of the third peak) and also at 23:55Z Nov 1 (16:55 MST, first recession); the 03:00Z report is 776 cfs (21.97 m³/s). No single corrected time is given; the model is compared with the primary series at each hour. Neither report is the event peak. The owner's "1,160 cfs at Three Points" is USGS 09487000 at 02:00Z.
- **Rain** (tip times of the six nearby ALERT rain gauges).
  - The main burst was 14:45–17:05Z at all six.
  - Lighter rain followed after 17:05Z: 0.24 in at 6440 Mile Wide (to 20:20Z), 0.35 in at 6500 (to 20:32Z), 0.31 in at 6460 (to 20:30Z), 0.31 in at 6420 (to 21:02Z), 0.47 in at 6450 (to 21:27Z) and 0.04 in at 6480.
  - The last tips were 6420 at 21:02Z and 6450 at 21:27Z. There was no rain from about 21:30Z until 07:06Z Nov 2.
  - So peaks 1 and 2 are local rain runoff; peak 2 also comes too soon after the inlet front (21:15Z, 15 km away) to be inlet water. Peak 3 (rise from 00:20–01:00Z) is the only rise without rain.

### 13.3 Against the model and NWM

| Mile Wide (ALERT 6443) | Observed | v2x Black Wash band / both bands | NWM 15876811 |
|---|---|---|---|
| Peak | 64.7 at 18:20Z Nov 1 | 40.66 / 47.54 at **09Z Nov 2** | 39.13 at 02Z |
| 18Z Nov 1 | 52.4 | 0.003 / 0.003 | 0.30 |
| 22Z | 42.0 | 0.55 / 1.82 | 0.66 |
| 02Z Nov 2 | 24.1 | 5.66 / 8.65 | 39.13 |
| 09Z Nov 2 | 12.2 (falling, flat) | 40.66 / 47.54 | — |
| Volume 18Z–18Z | 1.78M m³ | 1.58M / 1.86M m³ | — |
| Volume 18Z–18Z, leaving out the 08:45–16:20Z plateau | 1.45M m³ | (1.58M / 1.86M, whole window) | — |
| Volume 16Z Nov 1–18Z Nov 2 | 1.88M m³ (1.56M without the plateau) | — | — |

- The plateau carries 0.33M m³. Leaving it out is a bracket, not a measurement: if it is an artifact, the true flow then is unknown, not zero. All observed totals bridge the 16:20–18:00Z report gap linearly (0.07M m³).
- So the model's 18Z–18Z volume is 0.88× / 1.04× (Black Wash band / both bands) of the observed total, or 1.08× / 1.28× of it without the plateau.

### 13.4 Verdict

- **Mile Wide: the model's slow wave is refuted.**
  - The gauge has no rise at 06–10Z Nov 2 (15.8 → 12.3 m³/s, falling). The model puts its window peak there, at 3.3–3.9× the observed flow.
  - The observed maximum came 14.7 h before the model's peak and was driven by rain that the frozen HRRR forcing lacks (§12.1).
  - The 18Z–18Z totals are of similar size (above), but the model's water is in the wrong hours, so the totals do not support the model.
  - The one rise not driven by rain peaks at 02:10Z. That is 4.7 h after the inlet peak (about 3.3 km/h over 15.4 km) and in the same hour as NWM's peak. It is 7 h before the model's.
  - That this pulse is inlet water is an inference: delayed Black Wash runoff cannot be ruled out. But no reading supports a 09Z peak in either case.
  - V2 stays **FAIL**, now against primary data. The NWM-agent value of 0.33 m³/s at 15876815 is also contradicted, if the gauge reads that reach.
- **Manville, Tucker, outlet: neither confirmed nor refuted.** There is no observation. The model's 11Z/13Z/14Z peaks there remain unverified.
- **Next.** The staged v2r all-observed-rain sensitivity case (8b1d2f0) should be scored against the same 6443 series. Its first test is whether it produces the 18:20Z peak.

## 14. v2 frozen runs (42543054067 NWM, 42543056194 observed) and the live no-publish cycle — 2026-11-09

This is numbered 14 because §13 was appended first. Every number below was read from the committed result files or the run's own logs.

### 14.1 The two frozen runs

Both use the v2 mesh (643,056 cells, mesh sha256 328042f02927…, up from 408,207 cells in v1b), the same parameters, boundaries and rain, and the same 63 h window (2026-10-30T16Z to 2026-11-02T07Z, 57 map frames from 17Z Nov 1). Only the inflow differs.

| | 42543054067 (NWM inflow) | 42543056194 (observed inflow, validation variant) |
|---|---|---|
| Inflow | frozen NWM: analysis to 14Z Nov 1, then short_range issued 13Z (peak 1.70 m³/s) | observed USGS 09487000 at every hour, top-of-hour reading |
| Solver time (`total_runtime`) | 3,349.9 s (55.8 min) | 2,934.0 s (48.9 min) |
| Execution cap | 5,400 s | 5,400 s |
| Lowest area-equivalent depth (vol/area) | −0.643 mm (21:00Z, a 39.06 m² cell) | −0.674 mm (22:00Z, a 39.06 m² cell) |
| Cells below −1 mm (the live verifier's limit) | 0 | 0 |
| Local-road stations over the road at some frame | 3,799 of 58,140 | 4,274 of 58,140 |

- Negative values are kept signed, not clamped (5,261 and 5,212 samples).
- Local roads: `tools/sfincs/data/brawley-avra-west-v2/sample-local-road-forecast-nwm.json` and `-observed.json`. The other states are below 8,657 / 8,765, dry 44,965 / 44,382, unknown 44 / 44, no road height 571 and no cell 104 in both. Unknown stations are never counted as dry.
- Road heights are bare-earth lidar estimates, not surveyed bridge decks.
- **Correction (2026-11-09).** Both sample files said `inflowSource.summary: "not recorded in this package"`, had no inlets, and had a timestamp (the NWM cycle) as the description. The exporter found no `inflowSource` in the compact manifest. Both files now name their real inflow, filled in by hand from the case labels. The NWM cycle is kept as `nwmCycle`. `tools/live/export_road_forecast.py` was not changed, so a re-export would write the old empty block again.
- **Correction (2026-11-09).** `brawley-avra-west-result-42543054067/result-summary.json` had an absolute Windows path in `nativeRunDirectory`. It is now relative, like the observed run's. No manifest or SHA256SUMS hashes that file, so no hash changed. The file was also converted from CRLF to LF line endings.

### 14.2 Live no-publish cycle on v2

- GitHub Actions run 42550902383 on `experimental/brawley-avra-west-20261108`: run id `all-routes-brawley-avra-west-v1-live-20261109-00z`, valid 2026-11-08T21Z to 2026-11-09T18Z.
- Solver 848.9 s (native `total_runtime`; 849 s wall), plus 83 s to prepare. The case job took 16 min 26 s (02:27:22Z to 02:43:48Z).
- Status complete. The "Publish to live-model" step was skipped. The output was kept only as the artifact `live-brawley-avra-west-unpublished-output` (7-day retention).

### 14.3 Open items

- **AC6 performance.** The frozen solver times (55.8 and 48.9 min) are over the 35 min AC6 budget. The §1 AC6 PASS row refers to the v1b runs (1,836.7 s and 1,785.0 s). The live cycle (848.9 s, 21 h window) fits inside the hourly cycle, but the frozen 63 h runs on v2 do not meet AC6.
- **modelVersion.** The v2 runs and the live registration still carry `modelVersion: all-routes-brawley-avra-west-v1`, although the mesh changed (408,207 to 643,056 cells, new mesh sha256). Whether v2 should get a new modelVersion is **a decision for the owner**; nothing was changed here.
- **Registry moved before wave timing was validated.** `tools/live/all-route-cases.json` (commit afa8fc4) already points at the v2 case and the 42543054067 face mapping and geometry. The wave timing still fails: §12.3 has it against NWM and §13.4 against ALERT 6443. The registry is on the experimental branch only; nothing was published.

## 15. v2r all-observed-rain sensitivity (run 42555458619) — 2026-11-09

**SENSITIVITY run. It is not tuned to observations, not a live configuration and not for live registration.**
- Case `brawley-avra-west-native-case-v2r-observed-inflow` (`sensitivityVariant: true`, commit 8b1d2f0).
- Numbers: `tools/sfincs/data/brawley-avra-west-v2/rain-sensitivity/result-42555458619/` (`summary.json`, `README.md`, hourly comparison files).
- Solver time 5,759.0 s against the 7,200 s cap (engine 42528021117; same dispatch inputs as v2x).

### 15.1 What changed

- **Only the rain**, in 17 hourly frames: interval starts 2026-11-01T14Z to 2026-11-02T06Z. These were the HRRR 14Z forecast in v2x and are now observed Stage IV 01h (IEM).
  - Same header checks, HRAP grid hash and nearest-cell mapping as the frozen analysis hours.
  - 0 missing cells, so no MRMS replacement was needed and nothing was zero-filled. The raw-file sha256 hashes equal the v2x fetch.
  - Labels (corrected 2026-11-09): the rain metadata `rain-v2r-stage4-metadata.json` had a `purpose` naming v2x; it now reads SENSITIVITY v2r. The packaged case's `forecastIssue: 2026-11-01T13:00:00Z` is stale (v2r uses no forecast); it is left as packaged because the case files are hashed, and recorded in the result README.
- **Unchanged.** The 46 frozen analysis frames to 13Z Nov 1 and the 11 v2x Stage IV frames 07–17Z Nov 2 are unchanged. sfincs.nc, the subgrid, infiltration, sfincs.inp, sfincs.dis (observed inflow) and sfincs.src are byte-identical to v2x.
- **Mesh-weighted rain:**
  - 14–18Z Nov 1: 19.44 mm (v2x 0.69).
  - 18Z–07Z: 8.25 mm (v2x 14.13).
  - Whole run: 46.60 mm (v2x 33.72), so +38%.

### 15.2 Results (hourly restart flux, m³/s; v2x in brackets)

| Section | Peak / time | Q 03Z | Q 07Z | Q 18Z |
|---|---|---|---|---|
| Donaldson Ranch | 33.85 / 04Z (21.29 / 03Z) | 32.55 (21.29) | 23.31 (13.98) | 4.93 (3.14) |
| Mile Wide, both bands | 139.24 / 07Z (47.54 / 09Z) | 111.61 (11.76) | 139.24 (34.63) | 64.03 (31.27) |
| ·· Black Wash band (ALERT 6443) | 122.90 / 06Z (40.66 / 09Z) | 105.75 (8.83) | 122.22 (29.53) | 58.87 (27.81) |
| ·· Brawley 15877627 band | 18.06 / 08Z (7.00 / 10Z) | 5.85 (2.92) | 17.02 (5.10) | 5.16 (3.46) |
| Manville | 157.97 / 01Z (62.79 / 11Z) | 140.09 (30.34) | 149.16 (29.36) | 84.41 (36.60) |
| Tucker | 159.14 / 10Z (64.34 / 13Z) | 157.52 (18.20) | 138.12 (32.42) | 97.27 (43.15) |
| Outlet 720060498 | 69.86 / 04Z (26.32 / 14Z) | 67.38 (0.95) | 59.23 (17.31) | 47.11 (19.12) |

**ALERT 6443, against the primary series in §13:**
- Hour by hour, observed / v2x both bands / v2r both bands:

  | Hour | Observed | v2x | v2r |
  |---|---|---|---|
  | 18Z | 52.4 | 0.003 | 1.30 |
  | 19Z | 52.6 | 0.04 | 14.3 |
  | 22Z | 42.0 | 1.82 | 87.1 |
  | 00Z | 21.7 | 5.95 | 125.5 |
  | 03Z | 22.0 | 11.76 | 111.6 |
  | 06Z | 15.8 | 20.3 | 136.1 |
  | 09Z | 12.2 | 47.5 | 127.5 |

- **Volume 18Z–18Z.** 8.27M m³ in v2r (Black Wash band 7.56M), against 1.78M observed (v2x 1.86M).
  - Against 1.78M m³ the ratios are 4.24× / 4.64× (Black Wash band / both bands; v2x 0.88× / 1.04×). Against 1.45M m³, leaving out the plateau that may be a rating artifact (§13.2), they are 5.20× / 5.69× (v2x 1.08× / 1.28×).
- **At 03Z, against the primary report** (776 cfs = 21.97 m³/s; the ~817 cfs value is confirmed but the report the owner saw is uncertain, §13.2): v2r is 105.75 (Black Wash band) / 111.61 (both bands), **4.81× / 5.08×**. v2x was 8.83 / 11.76, 0.40× / 0.535×.
- **First time the model reaches 21.97 m³/s:** about 20:03Z Nov 1 (Black Wash band) and 20:01Z (both bands); v2x 06:20Z / 06:07Z Nov 2. For 23.1 m³/s it is about 20:05Z / 20:03Z (v2x 06:26Z / 06:12Z). (Corrected: the single "20:03Z" given earlier was the both-bands time for 23.1.)
- **The observed 18:20Z peak (64.7) is still not reproduced.** The Black Wash band peaks at 122.90 at 06Z (1.90× the observed peak); both bands peak at 139.24 at 07Z (139.2 / 64.7 = 2.15×). In the gauge cell, zs peaks at 674.147 at 06:15Z (2.49 m deep).

**Road over-topping** (cell zs − roadZ, wet frames only):

| Crossing | v2r max over / time | v2x max over / time | v2r first over (v2x) |
|---|---|---|---|
| W Mile Wide Rd | −0.107 / 08:00Z (never over) | −0.128 / 08:45Z | never (never) |
| W Manville Rd | +0.811 / 08:30Z | +0.612 / 11:15Z | 20:00Z (22:30Z) |
| W Tucker Rd | +1.068 / 02:30Z | +0.921 / 12:45Z | 23:15Z (21:45Z) |
| W Little Williams Dr | +0.569 / 02:30Z | +0.429 / 12:45Z | 23:30Z (19:30Z) |
| W Donaldson Ranch Rd | +0.083 / 04:30Z | +0.057 / 03:45Z | 17:00Z, the first map frame (19:00Z) |

- **Tucker and Little Williams go over later in v2r.** In v2x they went over early, by only 0.04–0.22 m, from the heavier HRRR local rain at 18–21Z. In v2r the routed flood arrives at 00Z, about 10 h before v2x's main rise.
- All crossings except Mile Wide are still over at 18Z.
- 7,678 of 57,465 stations go over at some point (v2x: 4,859).

### 15.3 Checks

- **Mass balance.** Residual −13,374 m³ (−0.02%), counted from the first restart at 18Z Nov 1. As in §12.2 it is an estimate, not a bound (hourly-sampled outflow). Outflow before 18Z is not measured; 35 mm of rain falls before then.
- **Negative depth.** The minimum is −1.46 mm (face 478144, 02:30Z). 1 cell is below −1 mm, in 4 frames, which is **outside the live verifier limit** (v2x: −0.67 mm).
- **Stability.** 0 wet NaN values and 0 spikes; maximum 15-min rise 2.12 m. The velocity proxy reaches **8.22 m/s at the outlet outflow cells** (04Z), against 1.47 in v2x. This has not been checked further.
- **Outlet pond.** zs 626.19, 9.11 m deep and still rising at 18Z; 5.00M m³ stored within 1.5 km (v2x: 1.24M).
- **Not meaningful here.** The baseline-difference fields (`waveAttributionTo07Z`, `frontVsBaseline0p3`): the v2 NWM baseline has the HRRR rain.

### 15.4 Reading (inference)

- **The hypothesis holds only partly.**
  - Observed rain removes the 03Z shortfall and the late arrival of 22–23 m³/s, but it overshoots: 4.8–5.1× at 03Z and 4.2–4.6× in 18Z–18Z volume (more against the volume without the plateau).
  - The model still responds at Mile Wide 5–12 h after the observed main burst (14:45–17:05Z; lighter rain to 21:27Z) and misses the 18:20Z peak.
  - So the HRRR rain timing alone does not explain the V2 misfit. The CN runoff assumption (no transmission loss) and the slow overland/channel routing look like larger factors. This run does not separate them, and nothing was adjusted.
- **V2 stays FAIL** in this sensitivity run as well.
