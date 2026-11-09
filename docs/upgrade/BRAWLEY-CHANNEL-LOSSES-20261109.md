# Brawley channel transmission losses (2026-11-09)

SENSITIVITY only. Not for live registration, not calibrated, and nothing here is tuned to the gauge.

**Question.** Can the pinned SFINCS (commit f3647fc) model channel transmission losses without a solver change? Transmission loss is flood water soaking into the sandy wash bed as it flows. Desert washes lose a lot of water this way.

**Answer: yes.** No infiltration type (`inftype`) can do it next to the Curve Number. But the solver's **urban-drainage `injection_well` zones** remove water from wet cells inside a polygon, limited to the water the cell holds. This runs alongside any `inftype`. One SENSITIVITY variant was built on the cnb case, packaged, run and scored (run 42622897426).

## 1. What the pinned source does

Source: `source/src/sfincs_infiltration.f90`, `sfincs_continuity.f90`, `sfincs_urban_drainage.f90`, `sfincs_discharges.f90`, `sfincs_src_structures.f90` and `utils/sfincs_polygons.f90` at f3647fc. They were fetched read-only from GitHub Deltares/SFINCS; no local checkout exists.

### 1.1 Infiltration types: rain only, or standing water too?

`update_infiltration_map` turns every type into one rate field `qinfmap` (m/s). It then does `qsrc(nm) -= qinfmap(nm) * cell_area` for every cell.

| `inftype` | Acts on | Evidence in `sfincs_infiltration.f90` |
|---|---|---|
| `con` (uniform `qinf`) / `c2d` (`qinffile` / `qinf` in `inffile`) | **Standing and routed water.** The rate is constant whenever the cell holds water (`z_volume > 0` subgrid, `zs > zb` regular), rain or not. | `compute_infiltration_constant`: `qinfmap = qinffield`, set to 0 only if there is no water. The rate is **not capped by the water present**: one step can remove more than the cell holds (negative-depth risk). |
| `cna` (CN, no recovery) | Rain only | `compute_infiltration_cna` uses only `cumprcp`/`prcp`; `qinfmap ≤ prcp`. |
| `cnb` (CN with recovery) | Rain only | `compute_infiltration_cnb`: works only when `prcp > 0`; `qinfmap` is set from the SCS event formula, and a dry step sets it to 0. |
| `gai` (Green-Ampt) | Rain only | `compute_infiltration_gai`: `qinfmap = min(..., prcp)`. When dry, `qinfmap` is not reset, so the last rain-step value carries on (side finding, as noted in BRAWLEY-RUNOFF-ROUTING). |
| `hor` (modified Horton) | **Standing and routed water** | `compute_infiltration_hor`: active when `hh_local > 0 .or. prcp > 0`, scaled down so it never exceeds `prcp*dt + hh_local`. |
| `bkt` (bucket) | Rain only | `compute_bucket_drainage` uses `prcp` only. |
| `r2d` (runoff coefficient) | Rain only | `qinfmap = qinffield * max(prcp, 0)`. |

### 1.2 Can one run mix infiltration types per face?

**No.**
- `inftype` is one character variable for the whole run. `update_infiltration_map` is an `if/elseif` chain that calls one routine.
- `qinffield` is one array, and its meaning depends on the type.
- The header says "infiltration methods not designed to be stacked".
- The closest partial trick: `c2d` with `qinf = 0` on hillslopes and K on channel faces gives bed loss. But then the hillslopes lose the CN, which is the base model's whole runoff rule. Also, `c2d` is not limited by the water present.

### 1.3 Sinks that remove routed water

| Option | Removes routed water in channels? | Notes |
|---|---|---|
| Negative river discharge (`srcfile`/`disfile`, `netsrcdisfile`) | Only as a fixed time series at a point | `update_discharges` adds `qtsrc` to `qsrc` with **no check on the water present**. Not depth-limited, so it can drive a dry cell negative. A rate fixed in advance from the hydrograph would be tuning. |
| Drainage structures (`drnfile`: pump, culverts, gate, dike breach) | No | They move water between two cells; nothing leaves the model. |
| `qinf` / `c2d` on wet cells | Yes | See 1.1, but it replaces the CN everywhere. |
| `hor` | Yes | Replaces the CN everywhere; needs Horton f0/fc/kd with a soils source. |
| `qext` | Yes | BMI coupling only; the saved engine runs stand-alone. |
| **Urban drainage `injection_well`** (`urbfile`, TOML) | **Yes, depth-limited, alongside any `inftype`** | See 1.4. |

### 1.4 The route used: urban-drainage injection wells

From `sfincs_urban_drainage.f90` (`initialize_urban_drainage`, `update_urban_drainage`). The docs (`docs/input_urban_drainage.rst`) call it "prototype status… field-tested" and "available from v2026.02".

- Each zone is a named polygon in a tek file. Cells are stamped by **cell centre** (`z_xz`, `z_yz`, real*4) with `points_in_polygon_omp`, which uses a bounding-box prefilter. On overlap, the **last zone wins**.
- **Per-cell capacity:** `qmax(nm) = injection_rate * A(nm) / A_zone`, where A_zone is the summed area of the zone's cells.
- **Each time step, for each zone cell:**
  - `h_cell = zs − subgrid_z_zmin` (subgrid). If `h_cell ≤ 0`, nothing happens.
  - `qd = min(ramp·qmax, z_volume/dt)`, with ramp = 1 when `h_threshold = 0`.
  - `qsrc -= qd`. The water **leaves the model**: an injection well has no outfall.
- It is called from `update_continuity` as step 5, after infiltration (step 4). `cnb` still takes its rain-only share first.
- Pumping stops when the zone's cumulative volume reaches `maximum_capacity`. Here that is set to 10¹² m³, so it never binds.
- Outputs:
  - `store_cumulative_urban_drainage = 1`: `urban_drainage_cumulative_depth` per face (map, timemax).
  - `store_urban_drainage_discharge = 1`: `urban_drainage_discharge` and `cumulative_injection_volume` per zone (his).

So an injection-well zone over a channel is a constant-K bed loss. It acts on any water in the cell (routed flow, ponding, or rain the CN did not take), and it can never take more than the cell holds at the start of the step. **No solver change is needed.**

Limits of this route, from the code:
- The rate is constant while the cell is wet. Lane's (1983) decline of the loss rate as the bed fills is not modelled.
- In subgrid mode a cell is wet as soon as its lowest subgrid level holds water. The whole per-cell `qmax` then applies, even when only the thalweg is wet.
- The urban-drainage packaging route is new to this repo. `tools/sfincs/package_current_case.py` now also archives `sfincs.urb` and `channel-loss.tek` when a case has them. Other cases are unaffected.

## 2. The variant: `v3l-obsrain-cnb-chl`

**Base:** the cnb case, `.sfincs-runs/brawley-avra-west-case-v3l-obsrain-cnb` (run 42584493432). That is base case B with CN-with-recovery infiltration. Nothing else changes:
- `sfincs.inp` gains three lines: `urbfile = sfincs.urb`, `store_cumulative_urban_drainage = 1` and `store_urban_drainage_discharge = 1`.
- Two new files: `sfincs.urb` (810 `injection_well` zones) and `channel-loss.tek` (their polygons).
- `current-case.json` gets a `variantChange` record. Every other file is byte-identical, which the builder checks.

**Loss rate: one published value, not tuned.** K = **1.65 in/h = 41.91 mm/h**.
- Source: the "Average for Tucson area" effective hydraulic conductivity in NRCS NEH Part 630 Ch. 19 *Transmission Losses* (210-VI-NEH, Aug 2007), Table 19C-2. That table is from Wilson, DeCook & Neuman (1980), based on Matlock (1965) streamflow data. The value was read from the NEH PDF this time, not from the SWAT+ transcription.
- Reach ranges in the same table:
  - Santa Cruz: 1.5–3.4 and 3.2–3.7 in/h
  - Rillito: 0.5–3.3 and 2.2–5.5 in/h
  - Pantano Wash: 1.6–2.0 in/h
- Cross-checks:
  - Walnut Gulch: fitted K 1.03–1.55 in/h (Table 19C-1, Lane, Ferreira & Shirley 1980); 1.1–4.5 in/h (Keppel 1960) and 2.4 in/h (Peebles 1975) in Table 19C-2.
  - Table 19-1, bed group 3 ("sand and gravel mixture with low silt-clay content"): 1.0–3.0 in/h.
- Brawley and Black Wash have no measured value. This is the nearest published basin-scale number. Avra Valley and the Brawley Wash drain to the Santa Cruz below Tucson.

**Where.**
- The loss applies to faces with mask 1 whose cell centre lies inside the v2n lidar-centred sand-bed channel mask (`.sfincs-runs/brawley-avra-west-parameters-v2n/channel-mask.geojson`). That mask was built by `tools/sfincs/brawley/sensitivity/prepare_parameters_channel_n.py`: NHD order ≥ 3, buffered by the lidar half-depth width.
- 8,749 faces are selected (level 1: 42, level 2: 126, level 3: 701, level 4: 5,000, level 5: 2,880). Their area is 2.07 km².

**Loss area = bed area.**
- Each zone's `injection_rate` is K × (channel-mask area inside that zone's cells). That is 1.455 km² in all, against a mask area of 2.099 km². The other 0.64 km² of the mask sits in cells whose centre is outside it.
- SFINCS spreads this rate over the zone's cells, so a cell larger than the bed loses K × its bed fraction while it is wet.
- The maximum total loss rate, with every bed wet, is **16.94 m³/s**.

**Zones and checks.**
- The selected cell squares are dissolved. Holes are opened with vertical cuts 1.0 m right of a cell edge; no cell centre lies within 1 m of such a cut. This gives 810 zones with no interior rings, and one empty cut sliver was dropped.
- The builder replays the SFINCS stamping (float32 centres, last zone wins) and refuses unless it equals the selection exactly.
- The solver log of the run agrees zone by zone: "810 zone(s), 8749 cell(s) assigned", and the cells and area of each zone match `build-report.json`.

**Files.**
- Builder: `tools/sfincs/brawley/variants/build_channel_loss.py`. Report: `tools/sfincs/data/brawley-avra-west-v2/variants/channel-loss-build/build-report.json`.
- Labels: `tools/sfincs/brawley/variants/labels-v3l-obsrain-cnb-chl.json`. Packaged case: `tools/sfincs/data/all-route-ready-v3/brawley-avra-west-native-case-v3l-obsrain-cnb-chl/` (commit 6efb2be9).

**Prediction, written before the result.** The Black Wash band volume ratio at Mile Wide goes from 1.96 to about 1.7–1.9. The peak drops by a few m³/s, with the timing about the same.

## 3. Result: run 42622897426 (cap 10,800 s, finished in 4,535 s)

Files are in `tools/sfincs/data/brawley-avra-west-v2/variants/result-v3l-obsrain-cnb-chl-42622897426/`: `validation-full.json`, `summary-vs-cnb.json`, `summary-vs-B.json` and `score_chl.py`.
- Urban drainage took 87 s, 1.9% of the solver time.
- Average time step 0.981 s (cnb: 0.980 s).

### 3.1 How much water the beds took

| | Value |
|---|---|
| Channel loss, whole run (map `urban_drainage_cumulative_depth` × cell area) | **940,860 m³** |
| Same, from the his zone rates, 17Z Nov 1 – 18Z Nov 2 | 926,323 m³ |
| Loss-rate peak | 14.29 m³/s at 07:45Z Nov 2 (84% of the all-wet maximum) |
| Loss rate at 18Z Nov 2 | 12.4 m³/s (ponded channel cells are still draining) |
| Loss upstream of Mile Wide: Black Wash 15876815 area / both bands | 289,231 / 533,395 m³ |
| Mass-balance residual (`validate_extended`, which does not know about this sink) | 967,395 m³ (cnb: −114,264 m³) |

- The residual left after taking the channel loss out is 26.5k m³ (0.05% of inputs). The water budget closes.
- The his file in this build has no `cumulative_injection_volume`, unlike the docs; the volume comes from integrating the rates.
- Generated rain minus CN infiltration minus channel loss, whole run:

| Area | cnb | chl | B (`cna`) |
|---|---|---|---|
| Black Wash 15876815 | 5.65M m³, C 0.180 | 5.36M m³, C 0.171 | 10.81M m³, C 0.345 |
| Both bands (Mile Wide) | 6.42M m³, C 0.175 | 5.89M m³, C 0.161 | 12.83M m³, C 0.351 |
| Whole mesh | 7.94M m³, C 0.138 | 6.99M m³, C 0.121 | 18.11M m³, C 0.314 |

### 3.2 ALERT 6443 Mile Wide, primary county series (`gauges.json`)

The observed peak is 64.73 m³/s at 18:20Z Nov 1; 03Z Nov 2 has 21.97 m³/s. The method is the same as in `score_cnb.py`, with model hourly restart flux from 18Z Nov 1. The plateau at 08:45–16:20Z Nov 2 is a suspect rating step: the true flow then is unknown, not zero, so the no-plateau ratios are brackets.

| Black Wash band | B | cnb | **chl** |
|---|---|---|---|
| Peak m³/s (time) | 122.90 (06Z) | 64.74 (08Z) | **62.19 (02Z)** |
| Peak / observed peak | 1.90 | 1.00 | 0.96 |
| Peak lag after observed 18:20Z | 11.7 h | 13.7 h | 7.7 h |
| Q at 03Z / observed | 4.81 | 2.56 | 2.51 |
| Volume 18Z–18Z, M m³ | 7.56 | 3.50 | **3.26** |
| Ratio to observed 18Z start (no-plateau bracket) | 4.24 (5.20) | 1.96 (2.41) | **1.83 (2.24)** |
| Hourly NSE / RMSE, 24 h | −37.1 / 78.1 | −7.37 / 36.6 | −6.27 / 34.1 |
| Mean model / mean observed | 4.05 | 1.87 | 1.74 |

| Both bands | B | cnb | chl |
|---|---|---|---|
| Peak m³/s | 139.24 (07Z) | 71.35 (08Z) | 63.06 (08Z) |
| Volume ratio 18Z start | 4.64 | 2.12 | 1.91 |

- **The prediction held.** The volume ratio went from 1.96 to 1.83, a 6.9% cut (240k m³ less at the gauge).
- The peak shift from 08Z to 02Z is not a faster wave. The model hydrograph had two humps (63.3 at 02Z and 64.7 at 08Z in cnb). The loss cut the late hump more (08Z: 64.7 → 59.1), so the earlier hump is now the higher one.
- The rising limb is unchanged. The model still reaches 21.97 m³/s at 22:43Z (cnb 22:38Z), about 4.4 h after the observed peak, and it never reaches the observed peak before then.
- **The timing misfit (model water arrives about 4–14 h late, with too much in the recession) is untouched by bed losses.**

### 3.3 Elsewhere

- **Sections** (peak m³/s, cnb → chl):
  - Donaldson Ranch: 25.1 → 22.9
  - Manville: 80.2 → 71.5
  - Tucker: 79.8 → 68.2
  - Outlet 720060498: 32.9 → 23.9, volume 1.29M → 0.92M m³
  - All outflow cells: volume 3.54M → 2.75M m³
- **Roads** (cell zs against road height, wet frames only; a dry frame is never dry evidence):
  - 13 of 17 tracked crossings and dips change, all downward by 0.001–0.06 m. Examples: West Tucker Road 0.955 → 0.927 m over; West Manville Road dip 1.384 → 1.359 m.
  - Stations ever over the road: 5,277 → 5,163 (B: 7,677).
- **Stability:**
  - No wet NaN and no spikes.
  - Minimum vol/area −0.43 mm, on the same face and frame as cnb, so it is not caused by the sink.
  - No cell below −1 mm (B had one).
  - The depth-limited sink produced no negative depth.

## 4. What this means and what it does not

- **Channel losses are real but second-order here.** At the published Tucson-area K on the measured order ≥ 3 bed, about 0.94M m³ leaves the beds. Only 0.24M of it is missing at Mile Wide. That closes about 14% of the cnb excess at Mile Wide (3.50M against 1.78M observed). This matches the BRAWLEY-RUNOFF-ROUTING bracket (0.35–1.06M m³ for the bed network).
- **What is left:** a 1.83× volume excess (2.24× without the plateau) and the late, two-hump shape. These point to runoff generation (CN choices, run-on infiltration on hillslopes) and routing, not to bed loss.
- **Probably a low-side loss in some ways, high-side in others:**
  - *Low:* the mask covers only order ≥ 3 channels (83.5 km). Order 1–2 beds (about 310 km in the Black Wash area alone) are not included. Bed area in cells whose centre falls outside the mask (0.64 km²) is dropped.
  - *High:* constant K with no decline as the bed fills (Lane's decay factor is ignored). In subgrid mode, a cell counts as wet as soon as its thalweg is wet.
- **Not tuned.** One K, from one table. No second value was run, and none should be picked to fit the gauge.

## 5. Notes for the owner

- **No solver change is needed for bed loss.** The pinned f3647fc urban-drainage `injection_well` is a depth-limited, out-of-model sink that runs next to any `inftype`. It is a prototype feature in Deltares's docs. Here it was verified by matching the zone stamping exactly and by the mass-balance residual.
- **If a solver change is ever wanted**, these are the clean designs. All would be changes to `sfincs_infiltration.f90`, so none was made here:
  1. Allow a second, additive "bed loss" field (`qinf_bed`, m/s, per face) applied like `c2d` but capped at `z_volume/dt`, on top of any `inftype`.
  2. Cap `compute_infiltration_constant` at the water present, as `hor` already is.
  3. Lane's decay: make the bed rate fall with cumulative loss per face.
- **Run-on infiltration on hillslopes** (the larger lever in BRAWLEY-RUNOFF-ROUTING §3) has the same native route. An `injection_well` zone over hillslope faces at a published Ks would do it. But the rate would then compete with cnb's own Ks on the same soil, so it needs its own physical source and design. It is not done here.
- **Packaging:** `tools/sfincs/package_current_case.py` now also archives `sfincs.urb` and `channel-loss.tek` when a case has them. Existing cases are unaffected.

## Reproduce (cwd = repo root)

    python -I tools/sfincs/brawley/variants/build_channel_loss.py --base .sfincs-runs/brawley-avra-west-case-v3l-obsrain-cnb \
      --mask .sfincs-runs/brawley-avra-west-parameters-v2n/channel-mask.geojson \
      --output .sfincs-runs/brawley-avra-west-case-v3l-obsrain-cnb-chl --report build-report.json
    python tools/sfincs/package_route_case.py .sfincs-runs/brawley-avra-west-case-v3l-obsrain-cnb-chl \
      tools/sfincs/data/all-route-ready-v3/brawley-avra-west-native-case-v3l-obsrain-cnb-chl --labels tools/sfincs/brawley/variants/labels-v3l-obsrain-cnb-chl.json
    gh run download 42622897426 -n sfincs-verification -D .sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-chl-42622897426/artifact
    R=tools/sfincs/data/brawley-avra-west-v2/variants/result-v3l-obsrain-cnb-chl-42622897426
    RUN=.sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-chl-42622897426/artifact/runs/current
    python -I tools/sfincs/brawley/extend/validate_extended.py --wt . --run $RUN \
      --compare .sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-42584493432/artifact/runs/current \
      --baseline .sfincs-runs/brawley-avra-west-baseline-v2x-nwm42543054067/artifact/runs/current --output $R/validation-full.json
    python -I $R/score_chl.py --wt . --run $RUN --base-run .sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-42584493432/artifact/runs/current \
      --validation $R/validation-full.json --base-validation tools/sfincs/data/brawley-avra-west-v2/variants/result-v3l-obsrain-cnb-42584493432/validation-full.json \
      --base-tag cnb --output $R/summary-vs-cnb.json
    python -I $R/score_chl.py --wt . --run $RUN --base-run .sfincs-runs/brawley-avra-west-result-v3l-obsrain-42599666617/artifact/runs/current \
      --validation $R/validation-full.json --base-validation tools/sfincs/data/brawley-avra-west-v2/variants/result-v3l-obsrain-42599666617/validation-full.json \
      --base-tag B --output $R/summary-vs-B.json
