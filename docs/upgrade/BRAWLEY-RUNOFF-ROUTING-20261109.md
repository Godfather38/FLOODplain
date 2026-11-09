# Brawley v2r at Mile Wide: runoff volume vs routing speed (2026-11-09)

This note diagnoses the **SENSITIVITY** run v2r (GitHub run 42555458619, all-observed Stage IV rain, observed inflow). At Mile Wide (ALERT 6443) that run has two problems:
- too much water: 8.27M m³ from 18Z to 18Z against about 1.78M observed, and a 139 m³/s peak against 64.7;
- the water is late: the model's maximum comes about 12 h after the observed one.

**This is diagnosis only.**
- No model input was changed and nothing was dispatched.
- Nothing is tuned to the gauge. Where this note works out an alternative runoff, it is labelled a *bracket*: it brackets the uncertainty and is not a proposed value.

Files:
- Scripts: `tools/sfincs/brawley/diagnose/` (`runoff_volume.py`, `loss_brackets.py`, `wave_tracking.py`, `flux_transects.py`).
- Outputs: `tools/sfincs/brawley/diagnose/out-v2r-20261109/`.
- Inputs are the v2r native output in `.sfincs-runs/brawley-avra-west-result-v2r-42555458619/` and the committed ALERT 6443 series. The working-tree copies of `gauges.json` and the v2r `validation-full.json` had uncommitted edits by another agent. Their ALERT 6443 series and section fluxes were checked and are identical to HEAD.

## 0. Short answer

1. **Volume is the bigger error, and it comes from runoff generation, not routing.**
   - Over the Black Wash area that drains to the gauge (603 km²), 36.6 mm of Stage IV rain fell in the event. The model's curve-number (CN) rule turns 17.1 mm of that into runoff: 10.3M m³, a runoff coefficient (C) of 0.47.
   - The gauge passed 1.88M m³ (C 0.085). Leaving out the suspect low-flow plateau, it passed 1.49M m³ (C 0.068).
   - So the model makes **5.5–7×** too much runoff before any routing happens.
   - The Stage IV rain agrees with the Mile Wide rain gauge (ALERT 6440: 23.9 mm from 14–18Z; Stage IV areal mean 24.6 mm). Rain volume is therefore not the cause.
2. **There is no unit bug.**
   - The code writes S (potential retention) in inches. SFINCS multiplies it by 0.0254, and its map shows exactly that.
   - The SFINCS `cna` formula reproduces the solver's cumulative infiltration to within 0.04 mm on every cell.
   - The problem is the method choices (§2.3):
     - **No recovery:** rain is accumulated from 30 Oct 16Z, so the earlier showers count as part of the same storm.
     - **Wet-average soil class on top:** the CN map is GCN10 ARC II "undrained", and it is applied *on top of* that carried-over rain.
     - **Losses on the ground not modelled:** routed or ponded water never infiltrates, so there are no transmission losses and no run-on infiltration.
3. **Most of the "12 h late" is a plateau, not a slow wave.**
   - The model's Black Wash band passes 82 m³/s at 22Z. It stays at 106–123 m³/s from 23Z to 09Z, and its 06–07Z maximum comes from the Stage IV rain at 07–09Z Nov 2 falling on that plateau.
   - The real timing errors are smaller:

     | Measure | Observed | Model | Model is late by |
     |---|---|---|---|
     | Flow first reaches 23.1 m³/s | 17:34Z | 20:03Z | 2.5 h |
     | Hydrograph centroid | 23:07Z (plateau excluded) or 02:05Z (all) | 06:39Z | 4.6–7.5 h |
4. **The routing delay builds up on the hillslopes and small tributaries, not in the main channel.**
   - 556 of the 603 km² are 100 m cells. There, sheet flow spreads over the whole cell and channels narrower than the 16.7 m subgrid pixel are not resolved.
   - The upper 20 km of the Black Wash mainstem carries only 1–6 m³/s.
   - Downstream of the tributaries (km 30 → km 43), the hydrograph centroid moves only about 2 h over 13 km.
   - On the Brawley mainstem the inlet wave spreads into floodplain storage between km 4 and km 14. About 2.2M m³ is held back there, and the peak moves at about 1.5 km/h.
5. **Ranked fixes (§5).** One SENSITIVITY run tests each; a 74 h run costs about 5,700–5,800 s of solver time.
   1. CN handling: recovery between storms (`cnb`), GCN10 "drained" instead of "undrained", and/or ARC I. Each has a physical source.
   2. Infiltration of routed water: transmission losses and run-on.
   3. Finer cells on the Black Wash tributary network.
   4. The running v2n roughness test. Prediction: little effect on Black Wash.

## 1. Contributing area and volumes (`runoff_volume.py`)

### 1.1 Areas

The areas come from the NHDPlus V2 network and catchments of domain v2. The upstream trace follows tonode → fromnode links, so it includes divergences. Model faces are assigned by face centre.

| Area | Reaches | Catchment km² | Model face km² | Of which 100 m cells (L1) |
|---|---|---|---|---|
| Black Wash 15876815 (the gauge reach, 4.8 m from the sensor) | 63 | 603.33 | 603.27 | 555.79 |
| Brawley 15877627, local part only (the county name; the area above inlet reach 15876941 comes in as the observed USGS 09487000 inflow) | 14 | 88.83 | 88.94 | 64.27 |
| Union (combined flow at Mile Wide) | 77 | 692.16 | 692.21 | 620.06 |

### 1.2 Rain the solver actually used

- **How SFINCS maps the rain grid.** Bilinear interpolation of `precip_2d.nc`, treating the grid coordinates as the lower-left corner of each 1.04 km cell (a +0.5 cell shift), with a hourly block in time.
  - This was found by trial against the map's `precipitation_rate`: the largest error is 0.016 mm/h over 25 frames.
  - The whole-run total matches the solver's `cumprcp` within ±0.08 mm on every face.
  - Nearest-cell and unshifted bilinear mappings miss by 3–10 mm/h.

### 1.3 Model water budget (SCS `cna`, checked against `cuminf`: −0.038 to +0.027 mm on all faces)

Black Wash area, 603 km²:

| Window (UTC) | Rain mm | Model runoff mm | Runoff M m³ | C |
|---|---|---|---|---|
| Antecedent, 10-30T16Z to 11-01T14Z | 15.38 | 0.79 | 0.48 | 0.05 |
| Burst, 11-01T14–18Z | 24.60 | 9.68 | 5.84 | 0.39 |
| 18Z to 11-02T07Z | 7.94 | 4.81 | 2.90 | 0.61 |
| 11-02T07–18Z | 4.02 | 2.65 | 1.60 | 0.66 |
| **Event, 11-01T14Z to 11-02T18Z** | **36.56** | **17.13** | **10.34** | **0.47** |

- **Mean retention:** S 55.6 mm (2.19 in), equivalent to CN 82.2. The initial abstraction Ia = 0.2S is 11.1 mm.
  - CN by share of the domain area: 73–80 on 4%, 80–85 on 76%, 85–90 on 16%, ≥90 on 2%.
- **Already past Ia when the burst started.** At 14Z, **91% of the area** had already received more than Ia. The cause is the 15.4 mm from the earlier showers, which `cna` counts as the same storm (§2.3).
- **The runoff fraction rises through the event,** from 0.39 to 0.66. Late, light rain therefore runs off almost entirely.
  - The 07–09Z Nov 2 rain (3.9 mm) makes 1.53M m³ of runoff. That is the bump that sets the model's 06–07Z "peak".
- **Timing of generation.** 56.5% of the event runoff is generated before 18Z. The centroid of generation is 20:23Z Nov 1.

### 1.4 Observed volume at ALERT 6443

Volumes are computed linearly between reports. Reports are event-driven plus hourly, so values between reports are not measured.

| Window | M m³ |
|---|---|
| 11-01T16:20Z to 11-02T18Z (whole observed event) | 1.884 |
| 11-01T18Z to 11-02T18Z (as in VALIDATION §13) | 1.783 |
| 16:20Z to 08:45Z (suspect plateau excluded) | 1.489 |
| Plateau 08:45–16:20Z alone | 0.328 |

### 1.5 Implied runoff coefficients (event rain over the area)

| Reading of the gauge | Model C | Observed C, whole event | Observed C, plateau excluded |
|---|---|---|---|
| Black Wash 603 km² | 0.469 | **0.085** | **0.068** |
| Union 692 km² | 0.481 | 0.075 | 0.059 |
| Brawley local 89 km², if the gauge saw only Brawley water | 0.572 | 0.31 (= (1.88 − 0.96 inlet) / 3.00) | 0.18 |

- **The model's section volume.** The Black Wash band passed 7.56M m³ from 18Z to 18Z and was still at 58.9 m³/s at 18Z. Both bands together passed 8.27M m³.
  - Generated runoff in the Black Wash area was 10.34M m³ (the event row in §1.3). Routing therefore did not lose the water: it is all on its way to the gauge.
- **The Brawley-only reading** would need the 7.56M m³ of the Black Wash band to pass somewhere the gauge does not see, and nothing observed shows that.
  - The coordinates put the sensor in the Black Wash band. Under that reading the model's Brawley band (0.71M m³) is *below* what the gauge read.
  - This note uses the Black Wash reading, but the Brawley reading is not ruled out (VALIDATION §13).
- **The observed series itself points to a small area.** The gauge rose at 16:20Z, about 1.5 h after the rain began, and peaked at 18:20Z. A whole 603 km² sand-bed basin is not expected to respond like that. That hydrograph comes from a near-gauge area; most of the upper basin's water did not arrive.

## 2. Infiltration setup against SFINCS (what is written, what is read)

### 2.1 What the code writes

- `tools/sfincs/brawley/prepare_context.py` takes GCN10 `cn_rasters_undrained/cn_f_ii_2281.tif` and `_2280.tif`: fair hydrologic condition, ARC II, undrained.
- The route parameter step converts CN to S with HydroMT `workflows.cn_to_s`: S = max(1000/CN − 10, 0), rounded to 0.001. Nodata becomes CN 100, so S = 0.
- `infiltration.nc` variable `scs`, float32 per face, `units: inches`. The range is 0–3.699 in (CN 73–100). `parameter-report.json` says "retention inches".
- `sfincs.inp` has `inffile = infiltration.nc` and `inftype = cna`. There is no `sfacinf`, so the default 0.2 applies.

### 2.2 What SFINCS reads

- **Docs.** The SFINCS documentation (sfincs.readthedocs.io, input parameters) describes `cna` as **Curve Number without recovery**. It defines S as the "maximum soil moisture storage capacity in inches" and sets the initial abstraction with `sfacinf`, default 0.2. `cnb` is the variant **with** recovery and takes `smax`, `seff` (m) and `ks` (mm/h).
- **Source.** In Deltares SFINCS `sfincs_infiltration.f90`:
  - `initialize_infiltration_cna` multiplies the field by 0.0254 ("inches to m").
  - `compute_infiltration_cna` uses cumulative rain since tstart. If cumprcp > sfacinf·S, then Qq = (cumprcp − sfacinf·S)² / (cumprcp − sfacinf·S + S); otherwise the infiltration rate equals the rain rate. The rate is (cumprcp − Qq − cuminf)/dt.
  - Nothing in it depends on water depth (`zs`, `z_volume`).
- **Verified on this run.**
  - The map variable `qinf` (long name "moisture storage (S) capacity - Curve number", units m) equals `scs × 0.0254` on every face; the ratio is 0.0254 ± 1e-9.
  - Recomputing the formula with Ia = 0.2S on the reconstructed rain matches `cuminf` to within 0.04 mm.
  - **There is no unit error.**
- **The solver log** says "turning on infiltration (via Curve Number method - A)". `cna` does not support restart.

### 2.3 Where the method is wrong for this event (physical, not unit)

1. **No recovery, and accumulation from 30 Oct 16Z.**
   - The 15.4 mm that fell up to 46 h before the burst is treated as the start of one long storm. Ia is used up before the burst, on 91% of the area.
   - **Bracket.** Accumulating only from 11-01T14Z, which is the fully recovered limit of `cnb`, halves the event runoff: 5.14M m³, C 0.23.
2. **The ARC II class on top of carried-over rain counts the antecedent wetness twice.**
   - ARC II already stands for average antecedent wetness. Accumulating the earlier rain on top of it adds that wetness a second time.
   - NEH-4 (1972) classic 5-day rule: 0.6 in of rain in the 5 days before the storm is AMC I in the growing season (below 1.4 in) and AMC II in the dormant season (0.5–1.1 in).
   - For desert shrub on 1 Nov after a dry season, ARC I is defensible.
   - **Brackets.** ARC I with CN_I = 4.2·CN_II/(10 − 0.058·CN_II) gives an area mean CN of 66.1.
     - Cumulative from 30 Oct: 3.00M m³ (C 0.136).
     - Event-only: 0.84M m³ (C 0.038).
3. **"Undrained" is probably the wrong GCN10 branch here.**
   - GCN10 "undrained" gives dual soil groups (A/D, B/D, C/D) their D value. The D value applies where a high water table limits drainage.
   - The Avra Valley water table is deep (tens to hundreds of metres; check against ADWR GWSI well data). So the "drained" rasters (`cn_rasters_drained/cn_f_ii_*`) are the physical choice.
   - The size of the effect is not computed here, because it needs the drained rasters, which were not fetched.
4. **The initial abstraction ratio is not the lever.**
   - Ia = 0.05S with S₀.₀₅ = 1.33·S₀.₂^1.15 (Hawkins et al. 2002; Woodward et al. 2003) gives 9.92M m³, almost the same as the 10.34M m³ as run.
5. **The "fair" hydrologic condition** follows NEH 630 Ch. 9 Table 9-1 for desert shrub, which gives CN 77/72/68 (B soils, poor/fair/good) and 85/81/79 (C soils). It is not the main problem: the area mean CN of 82 implies mostly C/D soils, which "undrained" makes worse.
6. **Scale effect (literature).**
   - At USDA-ARS Walnut Gulch, the CN and runoff per unit area that fit small plots fall as the drainage area grows (Simanton et al. 1996, *Trans. ASAE* 39(4)). Goodrich et al. (1997, *WRR* 33(12)) show basin response becoming non-linear above roughly tens of km². The causes are partial storm coverage and channel losses.
   - A CN taken from a soil and cover map is a plot-scale value applied here to 603 km².

## 3. Transmission losses (`loss_brackets.py`)

- **The model has none.**
  - `cna` infiltrates only the rain falling on a cell, so routed or ponded water never infiltrates. This was checked in the source and empirically: `cuminf` equals the rain-only formula on every face, channel faces included.
  - The channel-mask faces in the Black Wash area (v2n lidar-centred mask, 1,584 faces, 0.563 km²) infiltrate only 10,726 m³ in the whole event, and all of it is the rain that fell on them.
  - Water that flows over a dry hillslope downstream (run-on) also infiltrates nothing.
- **The SFINCS options differ** (from the source):

  | Method | Infiltrates ponded / run-on water? | Notes |
  |---|---|---|
  | `con` / `c2d` | Yes, whenever the cell holds water (`z_volume > 0`) | Not limited by the water available. That is a risk for negative depth (v2r already has one −1.46 mm cell). |
  | `hor` (Horton) | Yes | Limited by the water available |
  | `cna`, `cnb`, `gai`, `bkt` | No | Rain only |

  - The docs say the methods are not designed to be stacked. So CN on the hillslopes plus losses in the channels is not available as a native combination.
  - Side finding in `gai`: when there is no rain, the routine never sets `qinfmap`, so the previous value is reused. This is not used here, but would matter if Green-Ampt were tried.
- **Size of the losses.**
  - **Bed-group values.** Lane (1983; NEH 630 Ch. 19) gives the effective hydraulic conductivity of the bed by group. The table below is as transcribed in the SWAT+ docs, not read from the NEH PDF.

    | Bed group | mm/h |
    |---|---|
    | Very clean gravel / large sand | > 127 |
    | Clean sand and gravel | 51–127 |
    | Sand and gravel with little silt and clay | 25–76 |
    | Sand and gravel with high silt and clay | 6–25 |

  - **Channel beds only.**
    - In the model, the channel-mask faces are wet (cell mean depth ≥ 0.05 m) for 6.55 km²·h from 17Z to 18Z, which would lose 0.16–0.50M m³ at K = 25–76 mm/h.
    - The whole Black Wash bed network is larger than the mask: 255 km of order 1, 55 km of order 2, 21.6 km of order 3 and 4.6 km of order 4.
      - With the measured median widths (order 3: 10 m, order 4: 25 m) and assumed widths of 3 m and 5 m for orders 1–2, the bed area is about 1.4 km².
      - Wet for about 10 h, that is about **0.35–1.06M m³** at 25–76 mm/h, and 1.8M m³ at 127 mm/h. That is 3–17% of the 10.34M m³ generated.
  - **All wet cells.**
    - Wet area-time is 391 km²·h at ≥ 0.05 m and 179 km²·h at ≥ 0.10 m. At the same K that would allow 4.5–30M m³.
    - Most of that wet area is sheet flow on 100 m hillslope cells, so this is the run-on infiltration that `cna` ignores, not bed loss. It is an exposure, not a loss estimate.
- **Conclusion.**
  - Bed losses alone are a second-order fix: at most about 1–2M m³ of the 8.5M m³ excess.
  - Run-on infiltration on hillslopes could be large.
  - Together with the CN choices in §2.3, these are the plausible physical routes from C 0.47 towards the observed 0.07–0.085.

## 4. Routing (`flux_transects.py`, `wave_tracking.py`)

- **Method.** Discharge transects are drawn perpendicular to the NHD line every 2 km, with a half-length of 600 m (300 m within 1.5 km of the confluence). Discharge comes from the hourly restart fluxes, as in `validate_extended.py`. Water levels are tracked every 1 km (the lowest face within 75 m) from the 15-min map frames, which start at 17Z.

### 4.1 Black Wash (NHD level path 720016019, 43.0 km to the gauge)

| km | Cell | Peak m³/s / hour | Centroid (h after 18Z) | Volume 18Z–18Z M m³ |
|---|---|---|---|---|
| 2–18 | 100 m | 1.0–4.6 / 18–22Z | 5.5–9.6 | 0.03–0.12 |
| 20–24 | 100 m | 6.2–13.3 / 21–22Z | 10.6–11.5 | 0.3–0.8 |
| 26–30 | 100 m (L5 at km 29–31) | 19.5–44.8 / 20–21Z | 10.6–11.0 | 1.25–2.06 |
| 34 | 100 m | 88.6 / 22Z | 11.0 | 4.59 |
| 38–40 | 100 m | 117.5–122.2 / 23Z | 11.5–11.9 | 6.37–7.05 |
| 42–43 (gauge) | 50 m to 12.5 m | 122.6–135.8 / 05–07Z (on a plateau of 106–125 from 00Z) | 12.4–12.8 | 7.39–8.20 |

- **The upper mainstem is not a channel in the model.**
  - Peak depths are 0.05–0.4 m on 100 m cells, and the flow is 1–6 m³/s through km 18.
  - The subgrid pixel on L1 cells is 100/6 = 16.7 m, sampled mostly from the 10 m context terrain. The measured order-3 channel is about 10 m wide (median), so it is not resolved, and flow spreads as a sheet.
- **The flood is built by the tributaries that join from km 26 to 38.**
  - These are the 89 km² joining at about 26.6 km, the 149 km² at about 33.3 km, the 74 km² at about 35.2 km and the 129 km² at about 38.5 km.
  - Every reach end upstream of km 40 peaks by 19–23:15Z.
  - The exceptions are three tributaries that peak at 00:30–04Z: 15876939 (51 km²), 15876931 (72 km²) and 15877621 (99 km²).
- **The channel itself is not where the delay builds up.**
  - The centroid moves from 10.7 h (km 30) to 12.8 h (km 43), about 2.1 h over 13 km, or about 6 km/h.
  - The hydrograph at km 40 already peaks at 23Z.
  - The jump in water-level peak time from km 40 (23:15Z) to the gauge (06:15–07Z) is the plateau again, not a slow wave: from 23Z to 09Z the flow stays within 14% of its maximum (105.8–122.9 m³/s).
- **Kinematic check, km 30–43.** Slope 0.0035; median peak depth 0.6–2.9 m in the channel face, 0.2–1.2 m as the cell mean.
  - Expected celerity c = 5/3·h^(2/3)·S^(1/2)/n with n = 0.043: about 6–17 km/h using the channel depth, about 3–9 km/h using the cell mean depth.
  - The model's rise moves through this reach at roughly that speed. Flow at 22Z is 107 m³/s at km 38 and 84 m³/s at km 43.
- **Where the delay is.** Upstream of the tributary outlets, on 100 m cells.
  - Model runoff generation has its centroid at 20:23Z. The gauge flow centroid is 06:39Z (cut at 18Z with 59 m³/s still flowing, so the true lag is longer). That is a lag of **10.3 h**, of which only about 2 h is in the channel below km 30.
  - A sheet 1–3 cm deep on 1–2% slopes with the WorldCover shrub n of 0.05 moves at about 0.1–0.25 m/s (0.4–0.9 km/h). Over 2–5 km of overland and small-tributary path that adds several hours.
  - On real desert hillslopes the flow gathers into rills and small channels within tens of metres. That is faster than the 100 m sheet in the model.
  - Some of the lag is also late runoff generation: runoff keeps rising as rain accumulates, and the late rain runs off at C 0.6–0.66 (§1.3).

### 4.2 Brawley mainstem (inlet reach 15876923 → Tucker 15876711)

- **The inlet wave fades in the first 14 km.** The inlet peaks at 48.4 m³/s at 22Z (sfincs.dis). With 1,500 m half-length transects, so that the water is not missed off the NHD line:
  - km 2–4: 75 m³/s at 23–00Z, 3.2M m³;
  - km 6–8: 47–55 at 01Z;
  - km 10–12: 34–40 at 04Z, 1.4–1.75M m³;
  - km 14–16: 23–26 at 06–08Z, about 1.0M m³.
  - The 600 m transects miss most of the flow at km 6–18: the water runs more than 600 m from the NHD line.
- **Storage and speed.** About **2.2M m³ is held in the km 4–14 floodplain** at 18Z. The peak moves at about 12 km in 8 h, **about 1.5 km/h**.
  - Section 13 suggests the observed third peak at 6443 (25.7 m³/s at 02:10Z) is inlet water. That is about 4.2 h after the inlet peak, or about 3.3–4.5 km/h. The model's Brawley band peaks at 08Z (18.1 m³/s).
  - These cells are already 12.5 m, so resolution is not the cause here.
  - **Candidate causes (not checked here):**
    - the terrain source (1 m lidar against 10 m context or 1/3 arc-second);
    - a broad, shallow overbank plain (the "Mile Wide" plain);
    - roughness: shrub n 0.05 on the floodplain, mainstem mean 0.043.
- **Below Mile Wide.** The combined flow is 125–139 m³/s from 00Z to 08Z, and tributaries add to it towards Tucker: 145–159 m³/s at km 24–30.

## 5. Proposed changes (not implemented), ranked by expected effect

- Each change would be a separate **SENSITIVITY** run on the v2r base: same window, rain and inflow, one change at a time.
- Measured cost of a 74 h run of this type: 5,681–5,759 s of solver time against the 7,200 s cap.
- The brackets are offline SCS arithmetic. They show what a change can do, not what the model will do.

| # | Change | Physical source | What it isolates | Bracket / expectation at Mile Wide | Cost |
|---|---|---|---|---|---|
| 1 | `inftype cnb` (CN with recovery) from GCN10 + soil Ks. HydroMT `setup_cn_infiltration_with_ks` writes smax, seff and ks; Ks from gNATSGO/SSURGO or POLARIS. | SFINCS docs (cnb); NRCS recovery after a dry period; SWMM-style kr = √(Ks/25.4)/75 in the source | Whether the earlier showers should still count when the burst starts | Event runoff ≤ 5.14M m³ (C ≤ 0.23; the fully recovered limit), down from 10.34M | Parameter build locally (minutes); one 74 h run, about 5,700–5,800 s. `cnb` supports restart, so later tests could restart from 14Z. |
| 2 | GCN10 **drained** rasters instead of undrained (same fair, ARC II) | GCN10 docs: undrained gives dual groups their D value for high water tables; Avra Valley water table is deep (check ADWR GWSI) | The soil-group choice | Not computed. Offline bracket first: fetch `cn_rasters_drained/cn_f_ii_2280/2281`, recompute S and rerun `loss_brackets.py` (minutes), then run only if it matters | Minutes offline; one run if it matters |
| 3 | ARC I (GCN10 publishes `cn_f_i_*`), without the in-run accumulation that double counts | NEH-4 (1972) 5-day rule: 0.6 in < 1.4 in, growing season → AMC I; NEH 630 Ch. 10 ARC | Antecedent wetness | 3.00M m³ (C 0.14) with accumulation from 30 Oct; 0.84M m³ (C 0.04) event-only. The observed 1.5–1.9M lies between, so this is a bracket, not a fit. | One run |
| 4 | Infiltration of routed water: Horton (`hor`) as the whole-domain method, which infiltrates ponded and run-on water; or a SFINCS change to allow `c2d` bed loss on channel faces alongside CN | Lane 1983 / NEH 630 Ch. 19 bed groups (25–76 mm/h for sand-gravel with little fines); Walnut Gulch transmission-loss studies (Renard 1970, ARS 41-162) | Transmission losses and run-on | Bed only: about 0.35–1.06M m³ (3–10% of the generated runoff), up to 1.8M at 127 mm/h. Run-on on hillslopes: possibly several M m³ (exposure 179–391 km²·h). `c2d` is not limited by the available water: check negative depths. | One run each; Horton parameters need a soils source |
| 5 | Refine the Black Wash order ≥ 2 tributary network (km 20–43 and the 4 tributaries) to L3–L4 (25–12.5 m), with 1 m lidar where it exists | Measured channel widths (order 3: median 10 m, order 4: 25 m) against 16.7 m subgrid pixels on L1 | Hillslope and small-channel concentration, i.e. routing speed | Earlier and sharper rise (now 2.5 h late at 23 m³/s) and a shorter recession. Volume about unchanged unless #4 is also on. | Mesh and subgrid build locally (tens of minutes). More cells and maybe a smaller dt: expect more than 5,759 s; measure before dispatching. |
| 6 | Brawley inlet-only run (rain off, observed inflow) | — (a diagnostic, not a model change) | Inlet wave celerity and floodplain storage from km 4 to 14, without local runoff | Should show whether the 1.5 km/h and the 2.2M m³ storage come from terrain or roughness, against the 3.3–4.5 km/h implied by 6443 | One run, about 5,700 s for 74 h (a 30 h window would be about 2,300 s if it scales with window length; not measured) |
| 7 | v2n channel n 0.030 (already running, 42565074684; not touched) | Chow 1959 | Channel roughness inside the lidar mask | **Prediction made before the result:** small effect at Mile Wide (the mask covers 0.56 km² of the 603 km² Black Wash area), no effect on volume; perhaps some speed-up on the Brawley km 4–18 reach | Running |

**Expected effect on the volume:** #1–#3 (CN handling, together a factor of about 2–12) are larger than #4 (losses), which is larger than #5–#7.

**Expected effect on the timing at Mile Wide:**
- Fixing the volume (#1–#4) removes most of the 23Z–10Z plateau and the 07Z late-rain bump, so the apparent 12 h lag shrinks to the real 2.5 h (rise) to about 5–7 h (centroid).
- #5 is then the main lever for the remaining rise lag.

## 6. Caveats

- **Provisional data.** ALERT 6443 is provisional county data with a county rating. The 08:45–16:20Z plateau sits on a low-stage rating step (VALIDATION §13), so the volumes are given with and without it.
- **The gauge reading.** Which channel the gauge sees (the Black Wash band or the combined flow) is not settled. Under the Brawley-only reading the model is short of water in the Brawley band rather than over.
- **Map frames start at 17Z,** so peaks and wetting before 17Z are not seen. The restart fluxes start at 18Z.
- **Section volumes are cut at 18Z** while the model still flows at 59–64 m³/s.
- **Point gauge vs areal rain.** The rain check against ALERT 6440 compares one point gauge with an areal mean. It shows agreement in size, not proof.
- **Bracket assumptions.** The widths of order 1–2 channels in the bed-loss bracket are assumptions; only orders 3–4 are measured.
- **Nothing here is a calibration.** Every alternative is labelled a bracket or SENSITIVITY with its physical source.
