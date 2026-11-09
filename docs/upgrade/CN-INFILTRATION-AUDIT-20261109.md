# Curve-number infiltration audit of the live cases (2026-11-09)

Read-only audit. No model input changed, nothing dispatched, nothing deployed or published. Nothing here is tuned to
a gauge: the alternative runoff values are **brackets** (each with a physical source) to show the size of the
uncertainty, not proposed settings.

The question: the brawley-avra-west diagnosis (`BRAWLEY-RUNOFF-ROUTING-20261109.md`) found that the model's
curve-number (CN) rule turns about 47% of the Nov 1 rain into runoff, while ALERT 6443 (Mile Wide) saw about 7–8.5%.
Do the three **live production cases** (northern, picture-rocks, gates) use the same setup, and does it reach users?

## 1. Short answer

1. **Yes, all three live cases use exactly the same infiltration setup as brawley.**
   - `inftype = cna` (SCS curve number, **no recovery**), `inffile = infiltration.nc`, no `sfacinf` (Ia = 0.2 S).
     The three `sfincs.inp` files are identical (`diff` shows no difference).
   - CN source: GCN10 `cn_rasters_undrained/cn_f_ii_2281.tif`, **fair** hydrologic condition, **ARC II** (average
     antecedent wetness), **undrained** reading of dual soil groups (from each case's `GCN10-NOTICE.txt`:
     "Fair-cover, ARCII-average, undrained scenario; not measured initial soil moisture").
   - The coarse live model (`tools/sfincs/data/stress-storm-v1/case.tar.gz`, run by `run_live_sfincs.py`) uses the same
     GCN10 tile through the older `scsfile = sfincs.scs` input, with no `inftype` line. The SFINCS docs describe
     `scsfile` as the legacy curve-number input; that it runs as CN without recovery was not re-checked against the
     pinned solver log here.
2. **The live runner carries 45 h of rain into the CN total.** `run_live_all_route.py` keeps the case's infiltration
   and sets `tref = tstart = cycle − 45 h` (`SPIN = 45`). `cna` adds up all rain from `tstart`, so any rain in the
   previous 45 h is treated as the start of the same storm. For a Nov 1 13Z cycle that start is 30 Oct 16Z, the same
   start as the frozen cases and as brawley.
3. **The CN arithmetic gives the same over-prediction in every live domain.** With observed Stage IV rain for Nov 1
   (14Z to 2 Nov 18Z), the setup as run turns **49–54%** of the event rain into runoff (table in §3). The only
   observed runoff coefficient in or next to these domains, ALERT 6443's 603 km² Black Wash basin, is **0.068–0.085**.
   Inside the gates domain, the 95 km² of that same basin has a model C of **0.46**.
4. **It can reach users, but the live product now shows nothing from it.** The app raises a route's rating from the
   high-resolution forecast (more than 0.05 m over the road: caution; 0.3 m or more: danger) and never lowers it.
   - The published run now on `live-model` (HRRR 04Z Nov 9) has 10 wet road stations, all on northern/avra at the
     Brawley Wash dip on Avra Valley Rd, a constant 0.041 m in every frame (below the caution line). Every other route
     has none. That is a standing pond at the dip, not rain runoff; the CN setup is not what it shows.
   - The Nov 1 storm ran before the live high-resolution product existed. The frozen Nov 1 runs of the same cases had
     29 northern, 14 picture-rocks and 2 gates route points with 0.30 m or more of **cell-average** water (volume
     divided by cell area: not road depth). With 5–7 times too much runoff, a storm like Nov 1 would very likely raise
     ratings that the real runoff would not support.

## 2. What each live case runs with

Read with `git show origin/experiment/all-route-models` (97f9291); the case archives were reassembled from their parts
in a scratch directory and their sha256 checked against `tools/live/all-route-cases.json`.

| | northern | picture-rocks | gates |
|---|---|---|---|
| Model version | all-routes-northern-v3 | all-routes-picture-rocks-v2 | all-routes-gates-full-v3 |
| Archive sha256 (first 16) | 48b184778f955b1f | 626c29c306a32256 | 67ee11150eeaf08c |
| `inftype` | cna | cna | cna |
| CN source | GCN10 undrained `cn_f_ii_2281` | same | same |
| Condition | fair, ARC II, undrained | same | same |
| Model area (km²) | 423.9 | 499.7 | 341.9 |
| Area-mean CN (ARC II) | 81.7 | 82.3 | 83.2 |
| Area-mean S (mm) / Ia = 0.2 S (mm) | 57.8 / 11.6 | 55.7 / 11.1 | 52.3 / 10.5 |
| Area share with CN 80–85 / 85–90 / ≥90 | 55% / 15% / 7% | 61% / 12% / 11% | 63% / 15% / 14% |
| Area-mean CN if ARC I (NEH-4 conversion) | 65.7 | 66.6 | 68.1 |
| Frozen-case start (rain counted from) | 30 Oct 16Z | 30 Oct 16Z | 30 Oct 16Z |
| Live start | HRRR cycle − 45 h | same | same |
| Live rain | HRRR first hour of each past cycle, then the cycle's 18 h forecast | same | same |

- The brawley domain had area-mean CN 82.2 and S 55.6 mm, so the live domains are the same soil-and-cover answer.
- Brawley's ARC I conversion (CN_I = 4.2·CN_II / (10 − 0.058·CN_II)) is used for the ARC I brackets below.

## 3. Runoff coefficient bracket for Nov 1

**Method** (scratch script, not committed: this task commits only this note).
- Each mesh face gets the hourly rain of its nearest Stage IV HRAP cell, from the cached IEM files in
  `.sfincs-runs/brawley-avra-west-rainfall-v2r/raw-stage4/` (30 Oct 16Z to 2 Nov 18Z, interval starts).
- The hour 1 Nov 12–13Z has missing Stage IV cells in all three domains. It was not set to zero: it was replaced
  explicitly by NOAA MRMS MultiSensor QPE 01H Pass2 (the cached file the brawley package used for the same hour).
  The result was checked: no NaN anywhere.
- Runoff per face is the SFINCS `cna` formula, Q = (P − 0.2S)² / (P + 0.8S) for P > 0.2S, with S from the case's
  `infiltration.nc` (inches × 25.4). Brawley confirmed that this formula matches the solver's `cuminf` to within 0.04 mm.
  The domain values are area-weighted over the faces.
- The case's own antecedent rain (Stage IV + the same MRMS hour) reproduces this Stage IV antecedent total to within
  0.2 mm in every domain, which checks the mapping.
- "As run": rain counted from 30 Oct 16Z, event runoff = Q(antecedent + event) − Q(antecedent). "Event only": rain counted
  from 1 Nov 14Z, the fully recovered limit of `cnb`.

**Event 1 Nov 14Z to 2 Nov 18Z, Stage IV:**

| Domain | Antecedent rain mm (30 Oct 16Z–1 Nov 14Z) | Event rain mm | Area already past Ia at 14Z | C as run (ARC II, from 30 Oct) | C event only (ARC II) | C as run, ARC I | C event only, ARC I |
|---|---|---|---|---|---|---|---|
| northern (424 km²) | 16.2 | 35.9 | 79% | **0.49** | 0.26 | 0.18 | 0.07 |
| picture-rocks (500 km²) | 17.0 | 40.7 | 88% | **0.54** | 0.30 | 0.21 | 0.09 |
| gates (342 km²) | 14.4 | 36.3 | 77% | **0.49** | 0.27 | 0.17 | 0.06 |
| gates, Black Wash basin part (95 km²) | 14.2 | 39.5 | 74% | **0.46** | 0.25 | 0.13 | 0.04 |
| *brawley, Black Wash 603 km² (diagnosis)* | *15.4* | *36.6* | *91%* | *0.47* | *0.23* | *0.14* | *0.04* |

The brawley row is from `BRAWLEY-RUNOFF-ROUTING-20261109.md` §1.3 and §2.3 (event-only 5.14M m³, ARC I 3.00M and
0.84M m³ over 603 km² and 36.6 mm).

Same thing to the end of the frozen cases (2 Nov 07Z): northern 0.47 / 0.22 / 0.16 / 0.05, picture-rocks
0.51 / 0.26 / 0.19 / 0.07, gates 0.46 / 0.21 / 0.14 / 0.04 (same column order).

**What the frozen Nov 1 cases actually got.** Their rain after 14Z was the HRRR forecast, not Stage IV, and HRRR had
roughly half the observed event rain: 20.0 mm northern, 20.4 picture-rocks, 16.2 gates (17.1 on the Black Wash part)
by 07Z. On that rain the CN rule as run gives C 0.38, 0.41, 0.34 and 0.30. So on Nov 1 a low rain forecast partly hid
the high runoff fraction. A forecast that gets the rain right would show it in full.

**Observed comparison.**
- **ALERT 6443, Brawley Wash at Milewide Rd** is inside the gates mesh (39 m from a 100 m face). Its basin (Black
  Wash, 603 km²) is mostly outside gates; 95 km² is inside. Observed C for the whole basin is 0.085 (whole event) or
  0.068 (suspect plateau excluded), and 0.075 / 0.059 for the 692 km² union (brawley §1.5). Gates gives the
  in-domain part C 0.46: the same 5–7× excess as brawley.
- No other gauge in these domains measures local runoff on its own. Every other stream gauge inside a mesh is on a
  main channel whose flow comes mostly from outside the domain (through the NWM inlets), so its volume cannot be
  split into "inlet" and "local CN runoff" without a routed model run:

  | Domain | Stream sensors inside the mesh (within 300 m of a face) | Nov 1 14Z – Nov 2 18Z, USGS provisional |
  |---|---|---|
  | northern | USGS 09486520 / ALERT 1345 Santa Cruz at Trico Rd | 9.50M m³, peak 216 m³/s at 11:45Z Nov 2 (still on the recession at 18Z) |
  | picture-rocks | USGS 09486520 Trico; USGS 09486500 Santa Cruz at Cortaro; USGS 09486350 Cañada del Oro blw Ina Rd; ALERT 6023 Santa Cruz at Ina Rd; ALERT 6013 Santa Cruz below CDO; ALERT 1213 Massingale Detention (basin, not a stream) | Cortaro 12.79M m³, peak 274 m³/s at 23:45Z; CDO 2.11M m³, peak 152 m³/s at 00:45Z Nov 2 |
  | gates | ALERT 6443 Brawley at Milewide (used above); ALERT 6033 Santa Cruz above Grant Rd; USGS 09482500 Santa Cruz at Tucson | Tucson 3.00M m³, peak 55.8 m³/s at 19:15Z |

  - Values are linear between 15-min reports, all USGS-provisional ("P", some "e"). Fetched from NWIS IV on 2026-11-09;
    not committed.
  - Trico passed **less** water in the window than Cortaro upstream (9.5 vs 12.8M m³), even though the northern and
    picture-rocks domains drain into the reach between them. Part of that is the late Trico tail, still flowing at
    18Z, so it is not a loss estimate. It agrees in direction with brawley: on Nov 1 the channels lost water rather
    than gained it. `cna` cannot represent that.
  - ALERT sensor list: county feed `alert_currentstream_20261109.json.gz` (committed with the brawley gauges); USGS
    sites: the mirrored entries in that feed plus the repo's NWIS fixtures.

## 4. What it means for the published ratings

- **How the app uses the forecast.** `public/road-forecast.js` (main) reads `live-model/all-route/<case>/compact/road-forecast.json`.
  A route gets caution above 0.05 m of modeled water over the road and danger at 0.3 m or more. The forecast can
  only **raise** a route's rating (`withRoadForecast`).
- **Now (HRRR 04Z Nov 9, issued 06:16–06:29Z, a scheduled refresh rather than a rain trigger):**

  | Case / route | Stations | Most wet stations in a frame | Peak modeled water over road |
  |---|---|---|---|
  | northern / trico, silverbell-north, silverbell-south | 2,232 / 3,294 / 4,029 | 0 | 0 |
  | northern / avra | 4,222 | 10 (every frame) | 0.041 m at 32.3932, −111.2946 (Brawley Wash dip), unchanged all 43 frames |
  | picture-rocks / pr-ina, pr-twinpeaks, pr-avra | 3,626 / 3,341 / 3,317 | 0 | 0 |
  | gates / pr-gates | 6,445 | 0 | 0 |

  - The 0.041 m is below the caution line, so no rating is raised. The app's text still says "0.13 ft of modeled
    water over the road" for avra.
  - Because it is the same value in all frames, it is standing water at the dip, not storm runoff.
- **In a storm like Nov 1:** every domain's CN arithmetic gives 0.46–0.54 of the rain as runoff against about
  0.07–0.085 observed. Road crossings fed by local washes (Picture Rocks Wash, Twin Peaks, Kinney/Gates Pass,
  Javelina) would get several times the real runoff volume. Those are exactly the places where the forecast raises a
  rating. So the over-prediction would reach users as **too many or too early caution/danger ratings**; a dry route
  would never be shown as dry because of it. The size of the effect on depth is not computed here: it needs a run.
- **When the problem is worst:** a storm that follows lighter rain within 45 h (Ia already used up: 77–88% of each
  domain on Nov 1) and long, late, light rain (the share that runs off climbs through the event). Rain more than 45 h
  before the cycle is forgotten by the cold start, which is a crude form of recovery.

## 5. What the owner would need to decide

1. **Whether to keep showing the high-resolution forecast as a rating input while this stands.** Options: keep it as
   is; keep it but label the runoff as "likely high" in the text; or show it as information only and not let it raise
   a rating until the CN fix is tested. (Changing the app or `tools/live/` is outside this experimental branch.)
2. **Which physical CN change to test first**, each a SENSITIVITY run on brawley-avra-west before any live case, with
   its source:
   - recovery between storms (`cnb`, SFINCS docs), or counting rain only from a storm-start rule;
   - GCN10 **drained** rasters (deep Avra/Tucson basin water table; check ADWR GWSI wells);
   - ARC I (NEH-4 5-day rule: about 0.6 in in the 5 days before is AMC I in the growing season and borderline II in
     the dormant season).

   The brackets above show that no single choice reaches the observed 0.07–0.085 on its own, except ARC I combined
   with event-only counting (0.04–0.09).
3. **Whether channel/run-on losses must be modelled.** `cna` never infiltrates routed water (brawley §3), and the
   Cortaro → Trico volumes point the same way. SFINCS cannot stack CN with a ponded-water loss method natively.
4. **Whether to rebuild the three live cases after the brawley test.** The live cases share the CN file, the method
   and the 45 h start, so a fix proven on brawley carries over by rebuilding `infiltration.nc` / `inftype` for each
   case and re-pinning `all-route-cases.json` hashes. That re-registration is the owner's call, not this branch's.

## 6. Limits

- Arithmetic only: no model was run. Runoff is generated volume, before routing. It says nothing on its own about
  depth at a road.
- Stage IV nearest-cell mapping (about 4.7 km cells) instead of the solver's bilinear mapping of the 1 km case grid.
  On the case's own grid the antecedent totals agree within 0.2 mm, so the domain means are not sensitive to this.
- Observed C exists only for the Black Wash basin (and only 95 km² of it lies in a live domain). The other domains
  are compared by CN arithmetic alone.
- USGS values are provisional. ALERT values between reports are not measured.
- The coarse live model's `scsfile` behaviour was taken from the SFINCS docs, not re-read from the pinned solver log.
