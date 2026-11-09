# Brawley at Mile Wide: why the model peak is 12-14 h late (2026-11-09)

SENSITIVITY diagnosis only. Nothing here is tuned to the gauge, nothing is for live registration, and no model input was changed. No run was dispatched, because no input bug was found (section 5).

**The problem.** ALERT 6443 ("Brawley Wash at Milewide Road", snapped to NHD Black Wash 15876815) rose at 16:20Z on Nov 1 and peaked at 64.7 m³/s at 18:20Z. Every model run peaks 06-08Z on Nov 2, 12-14 h later. That includes v2r, base case B (v3l-obsrain, run 42599666617) and cnb (run 42584493432), all with observed Stage IV rain.

One correction to how the task was stated. At 18-19Z, cnb has under 0.5 m³/s at the gauge. B does not: it has 1.3 m³/s at 18Z and 13.2 m³/s at 19Z (`validation-full.json` of 42599666617). Both are still far below the observed 52 m³/s.

Scripts:
- `tools/sfincs/brawley/timing/timing_diagnose.py`
- `tools/sfincs/brawley/timing/alert_rain.py`
- `tools/sfincs/brawley/timing/lower_reach_flux.py`

Outputs, in `tools/sfincs/data/brawley-avra-west-v2/timing-20261109/`:
- `timing-diagnosis.json`
- `lower-reach-flux-cnb.json`
- `lower-reach-flux-B.json`
- `raw/` holds 7 county ALERT rain pages fetched 2026-11-09 about 13:00Z (sites 5040, 6430, 6470, 6490, 6410, 6140, 6520). The other 6 rain gauges come from the existing `observed-gauges-20261101/raw`.

## 1. Short answer

1. **The rain is on the right clock.** At all 13 county rain gauges in and around the basin, the best match between the gauge and the model's rain frames is at **0 h shift**. The burst centroids agree to within 0.3 h. There is no hour-ending vs hour-beginning error, no UTC vs local (7 h) error and no tref/window offset. Basin rain fell 14:45-17:05Z Nov 1, and the model gets it in the 14Z-17Z frames.
2. **The 18:20Z peak does not need a tiny local area. It needs roughly the nearest 100-300 km² of Black Wash to deliver water within about 1-3 h.**
   - The first pulse (16:20-20:25Z) carried 0.50M m³.
   - The area within 5 km of the gauge (24 km²) would need 86% of its rain to run off, which is not plausible.
   - The area within 10 km (99 km²) would need 20%, and within 15 km (204 km²) about 10%. Both are ordinary desert values.
   - So the peak is "the near half of the basin, responding fast". It is not a separate small catchment.
   - The gauge-identity question (Black Wash vs Brawley band) is still open, but it does not change the timing conclusion: under either reading the model has at most 1.3 m³/s at 18Z.
3. **Observed in the model: water accumulates on the land, and the delay builds up above km 10, not in the main channel or in spin-up.** *Why* it accumulates is not separated yet.
   - By 18Z, base B already holds 6.5M m³ of water on the land of the 603 km² Black Wash area.
   - Within 10 km of the gauge (straight line), the stored water *grows* from 1.14M m³ at 18Z to 2.48M m³ at 23Z and keeps growing to 2.84M m³ at 05Z Nov 2 in B (cnb: 0.59M at 18Z to 1.80M m³ at 06Z Nov 2), instead of draining (`timing-diagnosis.json` → `storageOnLandByRingMm3`, `straight 0-10 km`).
   - Once flow reaches the lower channel, the rising limb passes from km 10 to the gauge within the same 1-2 hourly restart steps. That bounds the last-10-km travel at roughly 0-2 h; it is not a measured speed.
   - In B, flow 10 km above the gauge first passes 23 m³/s only at 19-20Z. That is already after the observed peak. In cnb it is 21-22Z.
   - Three causes fit this and are **not separated** by these runs: (i) slow hillslope and small-tributary routing on 100 m cells, (ii) the curve-number initial abstraction (Ia) delaying onset, which cnb (about 2 h later than B) points to, and (iii) too much volume. One-change SENSITIVITY tests of Ia (`ia`) and of land roughness (`landn`) are running; their results are not in this note.
4. **There is no spin-up artefact.** The solver starts at 2026-10-30T16Z, 46 h before the burst. `t0out` (17Z Nov 1) only delays the map output, and the first restart file (18Z) comes one `dtrstout` after that. The scored window starts at 18Z. That leaves out the observed 16:20-18Z part (about 0.1M m³), but the model has no flow then either.

## 2. (a) Rain time axis

**Case files.**
- `precip_2d.nc` in `.sfincs-runs/brawley-avra-west-case-v3l-obsrain` has 74 hourly frames, 2026-10-30T16Z to 2026-11-02T17Z, with attributes `interval_label: start` and `interval_seconds: 3600`.
- `sfincs.inp` has `tref = tstart = 20261030 160000`, `tstop = 20261102 180000`, `t0out = 176400` s (= 17Z Nov 1), `dtwnd = 1800` and no `amprblock`.

**Source labelling.** `tools/sfincs/brawley/extend/fetch_stage4_extension.py` fetches IEM `ST4.<YYYYMMDDHH>.01h.grib`. That name is hour-ending, so the script stores it as the interval start HH-1. It refuses any file whose GRIB validity time is not the interval end, and any file whose start/end steps do not match the requested interval.

**How the pinned solver reads the frames (SFINCS f3647fc, `sfincs_meteo.f90`, `update_ampr_data`).**
- `amprblock` defaults to `.true.` (`sfincs_input.f90`). The field for time t is the frame with the latest time ≤ t, which is interval-start semantics and correct.
- Between meteo updates (`dtwnd` = 30 min) the solver blends linearly from one update to the next. The second half of each hour therefore ramps toward the next frame.
- This moves rain about 15 min **earlier** on average, never later. It is too small to matter here and goes the wrong way to explain a late peak, so it is not treated as a bug.

**Gauges against the frames** (`timing-diagnosis.json` → `rainGauges`). Gauge tips are binned by the UTC hour that contains the report, with page time MST + 7 h. An hour with no report on either side is unknown, not zero. The model value is the B frame starting that hour, sampled with the solver's grid rule.

| ALERT | Where | In basin | Gauge mm, 12Z-00Z | Stage IV mm, same known hours | Best shift | Centroid, model minus gauge |
|---|---|---|---|---|---|---|
| 5040 | San Xavier-Black Mtn West | yes | 19.8 | 25.5 | 0 h | +0.23 h |
| 6430 | Valhalla Park, Black Wash | yes | 23.1 | 26.3 | 0 h | +0.20 h |
| 6470 | Tucson Water plant | yes | ≥ 33.0 (3 unknown hours; lower bound) | 33.4 | 0 h | +0.17 h |
| 6490 | Old Tucson | yes | 33.0 | 34.8 | 0 h | -0.23 h |
| 6500 | Desert Museum | yes | 38.1 | 38.8 | 0 h | -0.20 h |
| 6440 | Mile Wide Rd (gauge site) | yes | 29.0 | 26.1 | 0 h | 0.00 h |
| 6450 | Hilltop Rd | 146 m out | 36.8 | 36.8 | 0 h | +0.23 h |
| 6410, 6420, 6460, 6480, 6140, 6520 | nearby | no | 12-43 | 14-40 | 0 h | -0.04 to +0.27 h |

Both totals are summed over the same hours: the hours with a known gauge value (`gaugeMm_11-01T12Z_to_02T00Z`, `stageIVcellMm_same`). Only 6470 has unknown hours in this window (3; `gaugeTotal12Zto00ZIsLowerBound`), so its gauge total is a lower bound on its full-window rain; Stage IV over all 12 hours is also 33.4 mm there (`stageIVcellMm_12Zto00Z_allHours`). In the hourly mean below, unknown gauge hours are left out and not counted in `gaugesKnown`; nothing is filled with zero.

Hourly means over the basin, in mm (interval-start hours, 11-01):

| | 14Z | 15Z | 16Z | 17Z | 18Z | 19Z | 20Z |
|---|---|---|---|---|---|---|---|
| Stage IV areal mean | 1.3 | 2.2 | 10.1 | 10.9 | 2.5 | 1.3 | 2.3 |
| Mean of the in-basin gauges with a known value that hour (6 in each of these hours) | 0.6 | 2.2 | 13.3 | 7.9 | 1.5 | 1.0 | 2.2 |

- The south-east gauges (5040, 6430, 6470) get their heaviest hour at 17Z in both the gauges and Stage IV. The west/north gauges get theirs at 16Z.
- The earlier Nov 1 00-12Z rain also matches: 5-13 mm at the gauges against 6-13 mm in the frames.
- **Ruled out:** a rain time shift of any whole hour, including the 7 h local-time error.

## 3. (b) Where the 18:20Z peak can come from

**The observed hydrograph** (ALERT 6443, provisional county rating, linear between reports):
- first rise 16:20Z;
- first flow 16:35Z;
- peak 64.7 m³/s at 18:20Z;
- trough 24.1 m³/s at 20:25Z;
- second peak 42.0 m³/s at 21:45-22:00Z;
- third peak 25.7 m³/s at 02:10Z.

Volumes: 0.50M m³ from 16:20 to 20:25Z, 0.59M m³ from 20:25 to 02Z, and 0.79M m³ from 02 to 18Z.

**Timing.**
- The rise came about 1.5 h after the burst began (14:45Z).
- The peak came 1.25 h after the last heavy tips (17:05Z) and about 2 h after the centroid of the heavy rain (about 16:30Z).
- Through ephemeral channels at 2-4 m/s, that is water from roughly the nearest 15-25 km of flow path.
- The second peak (21:45Z) fits the farther Black Wash water (30-44 km) arriving about 5 h later. This is an inference, not measured.

**Area and rain** (`ringsStraightLine` and `impliedRunoffCoefficientStraightLine`):
- Distances are straight-line from the gauge, a lower bound on flow distance.
- Rain 14-18Z is 24-26 mm in every ring, so rain was not concentrated near the gauge.

| Area within | km² | Rain 14-18Z, M m³ | Runoff coefficient C needed for pulse 1 alone |
|---|---|---|---|
| 5 km | 24 | 0.58 | 0.86 |
| 10 km | 99 | 2.51 | 0.20 |
| 15 km | 204 | 5.14 | 0.10 |
| 20 km | 337 | 8.27 | 0.06 |
| whole 603 km² | 603 | 14.82 | 0.034 |

- NHD flow-distance rings (`rings`) give the same picture. They put two large catchments (15876881, 147 km², and much of 15876863, 128 km²) "near" because their flowlines are short, so the straight-line table is used here.
- Tributaries joining Black Wash within about 10 km of the gauge (`tributariesJoiningBlackWash`): 15876831 (28.2 km², joins at km 3.55), 15876863 (128.5 km², km 4.36), 15876847 (67.1 km², km 7.62), 15876881 (147.3 km², km 9.6) and 945050109 (32.5 km², km 10.38). Each received 24.6-28.9 mm in 14-18Z (basin-lattice mean per tributary).

**What the model routes from the near area.**
- Water stored on the land within 10 km (`storageOnLandByRingMm3`, `straight 0-10 km`):
  - B: 0.85 (17Z), 1.14 (18Z), 1.79 (20Z), 2.40 (22Z) and 2.48M m³ (23Z).
  - cnb: 0.41, 0.59, 0.88, 1.22 and 1.37M m³ at the same times.
  - Later frames: B 2.46 (00Z), 2.72 (03Z), 2.84 (05Z, the largest), 2.76M m³ (06Z); cnb 1.46 (00Z), 1.74 (05Z), 1.80 (06Z, the largest), 1.79M m³ (07Z).
- In both runs the near area keeps filling until about 05-06Z Nov 2 (B levels off at 23Z-01Z, then rises again). In the real basin, the near area had already emptied 0.5M m³ through the gauge by 20:25Z.
- The 10-20 km ring shows the same pattern: B holds 1.86M m³ at 17Z, 3.15M m³ at 18Z and still 3.8M m³ at 00Z.

**Gauge identity.**
- Not settled, and this note does not settle it. The sensor coordinates are 4.8 m from Black Wash 15876815, and the Brawley 15877627 crossing is 0.8 km west.
- Under the Brawley reading the model is even later: the cnb Brawley band is 0 m³/s until 20Z, and the inlet front only reaches USGS 09487000 at 21:15Z.
- **Ruled out:** that the timing error comes only from comparing against the wrong band.

## 4. (c) Model routing speed and spin-up

**Flow along the lower Black Wash** (`lower-reach-flux-*.json`): hourly restart flux on transects above the gauge, the same transect rule as `diagnose/flux_transects.py`.

| km above gauge | B first ≥ 23.1 m³/s | B peak | cnb first ≥ 23.1 m³/s | cnb peak |
|---|---|---|---|---|
| 20 | never (max 10.3) | 22Z | never (max 2.8) | 00Z |
| 12 | 19-20Z | 35.5 at 21Z | never (max 18.7) | 22Z |
| 10 | 19-20Z | 63.5 at 22Z | 21-22Z | 35.1 at 23Z |
| 5 | 19-20Z | 116.7 at 23Z | 21-22Z | 61.2 at 00Z |
| 1 | 19-20Z | 124.2 at 05Z | 22-23Z | 63.8 at 01Z |
| 0.05 (gauge) | 20-21Z | 120.8 at 06Z | 22-23Z | 63.4 at 08Z |

What the table shows:
- **The last 10 km are not the bottleneck.** In both runs the rising limb reaches the gauge within 1-2 hourly restart steps of km 10. With hourly snapshots that bounds the travel at roughly 0-2 h (at least about 1.4 m/s); the "about 3 m/s" this note gave before is not measured.
- **The first useful flow reaches km 10 only at 19-20Z (B) or 21-22Z (cnb).** The observed gauge had already peaked at 18:20Z. So the delay builds up above km 10: on hillslopes and small tributaries.
  - 556 of the 603 km² are 100 m cells, where sheet flow spreads over the whole cell (`BRAWLEY-RUNOFF-ROUTING-20261109.md` §0.4).
  - Even inside 10 km, water accumulates on the land instead of draining (§3).
- **Water level along the channel** (`channelArrival`, from the 15-min maps).
  - On the near tributaries and the lower Black Wash, the water level first rises 5-20 cm at 17:15-18:30Z.
  - It then keeps rising slowly and peaks at 22Z-05Z. The level rises at about the right time; what is missing is fast drainage of the volume.
- **cnb is about 2 h later than B.**
  - With recovery (`cnb` in the pinned source), each new wet spell after a dry step restarts the cumulative rain at zero. At the start of the burst every face must therefore take up Ia = 0.2 S_e again before any runoff. S_e is partly recovered after the mostly dry 10Z-14Z gap; area-mean S is about 56 mm, so Ia is up to about 11 mm.
  - The observed rise at 16:20Z came after about 3-10 mm of burst rain at the in-basin gauges. So the curve-number Ia structure also delays the onset. This is an inference from the two runs, not separated by its own run.
- **Spin-up: ruled out.**
  - `tstart` is 2026-10-30T16Z, so the solver has run 46 h before the 14Z burst.
  - `t0out` = 176400 s puts the first map frame at 17Z Nov 1. Restarts (hourly flux) start one `dtrstout` later, at 18Z.
  - The missing record before 17Z is an output setting, not a cold model. At 17Z the B model already holds 3.8M m³ on the Black Wash land, and the gauge cell is wet but not flowing (standing depth 0.45 m in cnb and 0.67 m in B; `timing-diagnosis.json` → `channelArrival`, Black Wash level path, last point, `depthAt17Z`). That is a model depth above the cell's lowest bed level, not an observed water level.
  - Starting the scored window at 18Z leaves out about 0.1M m³ of observed flow from 16:20-18Z. It does not create the lag.

## 5. Input bug?

None found.
- The rain frames, their labels, the solver's reading of them and `tref`/`tstart`/`t0out` are all consistent with the county gauges to within a quarter hour.
- The `dtwnd` blend moves rain slightly *earlier*, not later.

Following the one-change rule, nothing was rebuilt and nothing was dispatched.

## 6. What is ruled out, and what is not

**Ruled out:**
- a rain time shift (hour-ending/beginning, UTC/local, tref offset);
- spin-up or a cold start;
- slow main-channel travel in the last 10 km;
- the gauge-band choice as the cause of the lag;
- a tiny (< 25 km²) local source for the 18:20Z peak.

**Not ruled out (the open causes, in order of the evidence):**
1. **Hillslope and small-tributary routing on 100 m cells is too slow.** Water stays on the land for hours. Of the open causes, this is the one the flux and storage evidence above supports most directly.
2. **The curve-number Ia structure delays runoff onset at the start of the burst** (strong in cnb, weaker in B, where 91% of the area was already past Ia at 14Z).
3. **The model makes too much volume** (`BRAWLEY-RUNOFF-ROUTING-20261109.md`). A smaller, faster volume would also move the peak earlier, but it cannot do so alone: cnb halves runoff and is later, not earlier.
4. **Gauge identity and the provisional low-stage rating.** These affect volume more than timing.

**Tests that would separate these** (each a one-change SENSITIVITY run; none dispatched by this note). Since this note was written, one-change tests of the Ia ratio (`ia`) and of land roughness (`landn`) have been dispatched; their results are pending and not used here.
- refine the near-gauge tributary network (15876831, 15876847, 15876863 and 15876881, within 10-15 km) to channel-resolving cells;
- a rain-only-near-gauge (within 10 km) run, to time that area's water directly;
- an Ia ratio of 0.05 instead of 0.2 (Hawkins et al. 2002, a published alternative, not a fit to the gauge) on the cnb case, to test the onset delay.
