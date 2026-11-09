# Brawley-avra-west stability check for heavy-rain live runs — 2026-11-09

Two problems from the v2r all-observed-rain run (GitHub run 42555458619, section 15 of
`VALIDATION-BRAWLEY-20261108.md`) could matter when a live cycle gets heavy observed rain:

1. A velocity proxy of 8.22 m/s at the outlet outflow cells (v2x: 1.47 m/s).
2. One cell below −1 mm depth (−1.46 mm), which the live verifier rejects.

This is a read-only check. No run was dispatched and nothing in `tools/live/` was changed. The
section-15 numbers are reproduced exactly (8.224 m/s at 04Z; −1.458 mm at face 478144, 02:30Z).

Scripts (in `tools/sfincs/brawley/diagnose/`):

- `stability_common.py` reads the mesh, u/v links, subgrid tables and restarts. It follows the same
  rules as `extend/validate_extended.py`.
- `velocity_hotspots.py` finds the fastest links in each hourly restart. It reports the depth, flux
  and mask of each cell and the road stations within 2 km.
- `negative_depth.py` covers every cell below −1 mm and counts which frames fail under the current
  rule and under alternatives.

SFINCS source quoted below is the pinned commit f3647fc
(https://github.com/Deltares/SFINCS/tree/f3647fc0289bb15cb2512d60686cef74cb853c78/source/src), the
same one cited in `tools/live/verify_all_route_package.py`.

## Short answers

- **Velocity (1):** This is a **boundary-condition artifact**, not real flow and not a numerical
  blow-up.
  - Every link above 3 m/s, in every hour of v2r, touches one of the 47 outflow (msk 3) cells. The
    fastest interior link is 2.42 m/s (Froude 0.5) at the Mile Wide deck, which is physical.
  - The SFINCS outflow boundary keeps a running mean of past outflow (`uvmean`) and adds it to each
    new boundary flux. That mean can carry up to about 61 times the head-driven flux and takes about
    an hour to decay.
  - So the boundary keeps drawing water after the head that drove it has gone. In v2r the
    boundary outflow is about 3 times what the boundary's own head term gives.
- **Road ratings:** No road station is closer than 587 m to the affected cells. The nearest stations
  that go over the road (Garvey Road, 609–626 m away) sit about 2.9 m above the outlet bed.
  - A rough drawdown reach is depth ÷ slope ≈ 0.67 m ÷ 0.0047 ≈ 140 m. On that estimate, ratings are
    unlikely to be affected.
  - This has not been proven. A SENSITIVITY run would settle it (see 1.6).
- **Negative depth (2):** This is the same family as the v1b −1.03 mm cell.
  - Both are 6.25 m cells (39.06 m²) on a small high lip right next to a much deeper channel cell.
    Both happen during peak local rain, far from any boundary.
  - The cause is that one explicit time step drains more water than the cell holds. It is **not**
    float32 rounding.
  - Under the current −1 mm rule, 2 of the 6 runs checked would fail to publish, including the
    heavy-rain one.
  - A −5 mm limit (about half the 9.1 mm wet threshold), together with a cell-count guard, passes
    all 6 with margin. No solver setting fixes it without costing runtime the live budget doesn't
    have. **The owner decides** (section 2.5).

## 1. Velocity at the outlet outflow cells

### 1.1 Where and when

The 8.22 m/s value is on link 613873, a north–south link 12.5 m wide, at the 2026-11-02T04:00Z
restart.

| | interior side | outflow side |
|---|---|---|
| face | 298164 (msk 1) | 298165 (msk 3) |
| cell size | 12.5 m | 12.5 m |
| lon, lat | −111.29317, 32.36443 | −111.29317, 32.36454 |
| bed (subgrid zmin) | 617.960 m | 617.959 m |
| zs at 04Z | 618.069 m | 617.959 m (= its bed, all run) |

At this link, at 04Z:

- **Flux:** q = 0.894 m²/s, so 11.17 m³/s through this one link. Total boundary outflow at 04Z is
  102.1 m³/s.
- **Depth used by the proxy:** max(zs) − max(zb) = 0.109 m. This is only just above the proxy's
  0.1 m cut-off, which is why the proxy reads 8.22 m/s.
- **SFINCS subgrid flux depth:** huv at this level is only 0.0102 m. This is the uv_havg table
  interpolated at zsuv = 618.069 between uv_zmin 617.970 and uv_zmax 618.386. Dividing by it gives
  **87 m/s**, which is physically impossible.
- **Froude number (proxy):** 7.97.

Other links above 3 m/s (proxy) are all outflow links in the same cluster:

- link 613006 (faces 297752 / 297753): 3.73 m/s at 04Z;
- link 327749 (faces 159196 / 159197, 25 m cells): 3.13 m/s at 13Z.

v2r hourly maximum (all restarts 18Z Nov 1 to 18Z Nov 2):

| | proxy max | at an outflow link? | interior max (proxy) | links > 3 m/s (proxy) |
|---|---|---|---|---|
| 18Z–00Z | 1.27–2.40 | no | same | 0 |
| 01Z–02Z | 2.35–2.48 | 02Z yes | 2.30–2.35 | 0 |
| 03Z | 3.24 | yes | 2.29 | 1 (boundary) |
| **04Z** | **8.22** | yes | 2.33 | 2 (both boundary) |
| 05Z–09Z | 2.86–7.54 | yes | 2.31–2.42 | 0–1 (boundary) |
| 10Z–13Z | 3.13–3.69 | yes | 2.05–2.23 | 1 (boundary) |
| 14Z–18Z | 2.34–2.90 | yes | 1.74–2.00 | 0 |

The fastest interior links are at the Mile Wide deck (faces 533724–533729, 6.25 m cells): 2.42 m/s
at 06Z, with 2.29 m depth and Froude 0.51. These are ordinary subcritical channel speeds.

v2x shows the same pattern on a smaller scale: proxy max 1.47 m/s (interior, Mile Wide). The
subgrid estimate at outflow links reaches 4.7–6.4 m/s at 11Z, 14Z, 15Z and 18Z, while boundary
outflow is 30–56 m³/s.

### 1.2 Time history at the worst link

| hour (Nov 2) | q (m²/s) | proxy depth (m) | subgrid huv (m) | interior zs |
|---|---|---|---|---|
| 00Z | 0.000 | 0.010 | 0.0006 | 617.970 |
| 01Z | 0.153 | 0.105 | 0.0092 | 618.065 |
| 02Z | 0.713 | 0.069 | 0.0047 | 618.029 |
| 04Z | 0.894 | 0.109 | 0.0102 | 618.069 |
| 06Z | 0.798 | 0.037 | 0.0020 | 617.996 |
| 09Z | 0.829 | 0.044 | 0.0024 | 618.004 |
| 12Z | 0.856 | 0.032 | 0.0017 | 617.991 |
| 16Z | 0.725 | 0.027 | 0.0015 | 617.987 |
| 18Z | 0.635 | 0.023 | 0.0013 | 617.983 |

The flux holds at 0.64–0.89 m²/s for 17 hours. Over the same time the water above the interior
cell's bed swings between 0.02 and 0.11 m, and the flux does not follow it.

Friction-limited (Manning) flow at that depth gives a very different number. With h = 0.01 m,
n = 0.04 and slope 0.11 m / 12.5 m, q ≈ h^(5/3)·S^(1/2)/n ≈ 0.001 m²/s. That is nearly 1000 times
smaller.

The flux is not growing or oscillating, and there are no NaN values. It is a steady, history-driven
boundary flux.

### 1.3 Why: what SFINCS does at an msk 3 outflow cell

**Water level at the boundary.** `sfincs_domain.f90:2041-2050` sets the outflow cell's boundary
level once, at start-up, to its own lowest subgrid elevation (`zsb0 = zsb = subgrid_z_zmin`). It never
changes after that (`sfincs_boundaries.f90:886`). This is why face 298165 shows zs = 617.959 m (its
bed) all run: the outflow cell acts as an always-empty sink.

**Flux across the boundary link.** This is not computed by the momentum equation. Links between an
msk 1 and an msk 3 cell get `kcuv = 2` (`sfincs_domain.f90:1961-1966`), and
`update_boundary_fluxes` sets their flux (`sfincs_boundaries.f90:1065-1192`, `bndtype = 1`, the only
type in this version):

- `ui = sqrt(g/h)·(zsb − zsb0) = 0`, because zsb equals zsb0.
- `ub = dir·(2·ui − sqrt(g/h)·(zs_inside − zsb0))`.
- `q = ub·h + uvmean`.
- Then `uvmean ← (dt/btfilter)·q + (1 − dt/btrelax)·(1 − dt/btfilter)·uvmean`, with btfilter = 60 s
  (in `sfincs.inp`) and btrelax = 3600 s (the default, `sfincs_input.f90:202`).

So the head-driven part is about sqrt(g·h)·(zs_inside − bed of the outflow cell). On top of it sits
`uvmean`, a filtered running mean of past q that is fed back into each new q. Solving that update at
steady state:

- uvmean ≈ (btrelax/btfilter)·(head-driven part) ≈ **61 ×**;
- uvmean decays with a time constant of about **btrelax = 1 h**.

The code comment at line 1180 says the relaxation was added "to avoid persistent jets shooting into
the model". That is this same mechanism, here pulling water out.

**What stops the outflow, and what doesn't.**

- The only stop is `z_volume(inside) <= 0` (line 1131). There is no friction limit.
- `huthresh = 0.01` in `sfincs.inp` has no effect. The NetCDF subgrid reader sets `huthresh = 0.0`
  (`sfincs_subgrid.F90:99`), so the "too shallow" cut at line 1106 only acts below 1e-6 m.
- The velocity clip at line 1175 (±4 m/s) changes only `uv`, not `q`. The code says so: "this does
  not change fluxes".

**Check against the run.** At each hourly restart I computed the head-driven part,
Σ sqrt(g·huv)·(zs_inside − zsb0)·width, over all 71 outflow links, and compared it with the stored
outflow:

| | v2r 01Z–18Z | v2x 04Z–18Z |
|---|---|---|
| stored boundary outflow | 33–106 m³/s | 18–56 m³/s |
| head-driven part | 10.7–37.1 m³/s | 5.7–34.7 m³/s |
| ratio | **2.6–4.4** | 0.9–5.3 (mostly 1.5–3) |
| worst link (v2r) | 0.894 vs 0.035 m²/s at 04Z (25×); 0.798 vs 0.005 at 06Z (about 150×, uvmean still decaying from earlier hours) | |

The interior cells next to the outflow cells never go meaningfully negative (minimum −0.07 mm in
v2r, −0.09 mm in v2x). The `z_volume <= 0` stop does hold.

### 1.4 Verdict

| Possibility | Evidence | Verdict |
|---|---|---|
| Real fast flow (steep drop at the boundary) | The bed is flat across the link (617.960 → 617.959 m). The flux doesn't follow the depth. The implied 87 m/s is impossible. | **no** |
| Numerical instability | No growth, no oscillation, no NaN, 0 spikes. Interior speeds are normal (≤ 2.42 m/s, Froude ≤ 0.5). | **no** |
| Boundary-condition artifact | The level is pinned at the outflow cell's bed. The `uvmean` running mean (gain up to about 61×, 1 h memory) is added to the flux. Outflow is 2.6–4.4 × the head-driven part. | **yes** |

The velocity proxy is also misleading at these links. It divides by the bed-to-surface difference
(0.109 m), not by the subgrid flux depth (0.010 m). Either way, the large number means
"boundary-set flux over almost no depth", not a real speed.

### 1.5 Could it corrupt road ratings?

The affected faces are 159196/7, 297752/3 and 298164/5, at the Brawley Wash outlet (cluster
"Outlet 720060498", about −111.293, 32.364).

- **Road stations within 2 km:** 890 stations (v2 local station file) on 10 roads, including Garvey
  Road, N Trico Road and W Magee Road. 320 of them are ever wet in v2r, and 233 go over the road.
- **By distance from the affected cells:**

  | within | stations | over road |
  |---|---|---|
  | 500 m | 0 | 0 |
  | 800 m | 74 | 21 |
  | 1000 m | 257 | 70 |
  | 2000 m | 890 | 233 |

  The nearest station is 587 m away (Garvey Road). The nearest stations that go over the road are on
  Garvey Road, 609–626 m away, with road Z 620.8–620.9 m, over by 0.01–0.05 m.
- **Height and depth near the outlet:** the outlet bed is 617.96 m, so those stations are about
  2.9 m higher. Cells within 600 m of the affected faces have zb 617.56–621.68 m and a maximum depth
  of 0.67 m.
- **How far the extra drawdown could reach:** the outflow lowers water near the outlet, so it would
  bias ratings toward **less** water, not more. Its upstream reach in subcritical flow is about
  depth ÷ bed slope ≈ 0.67 m ÷ (2.9 m / 610 m) ≈ 140 m. That is well short of 587 m. The flow over
  the outflow lip is also supercritical (Froude far above 1), which cuts the upstream link further.

Assessment: an effect on any road station's rating is **unlikely**, but this is an estimate, not a
measurement.

Two further points:

- The Mile Wide overshoot in section 15 (139 m³/s, 12 h late) is 15 km upstream and is **not**
  caused by this.
- The outlet-pond fix in `BRAWLEY-OUTLET-POND-20261108.md` adds 6 more msk 3 cells. Those cells would
  get the same boundary formula, so the same over-draining is expected there. Garvey Road and Avra
  Valley Rd stations are closer to that lobe, so check it there before relying on the fix.

### 1.6 Options (for the owner; nothing changed)

1. **SENSITIVITY `btfilter = -1`.** This turns `uvmean` off (`sfincs_boundaries.f90:1178-1190`
   sets it to 0 when btfilter < 0). The boundary flux is then only the head-driven part.
   - Only msk 3 links are affected: this mesh has msk 1 and 3 only (643,009 / 47 cells), so there
     are no water-level boundaries for it to change.
   - Physical source: the head-driven term is the boundary's own long-wave outflow speed
     sqrt(g·h). With nothing downstream to sustain a jet, the memory term has no physical basis.
   - Compare against v2r: boundary outflow, levels at the 233 over-road stations within 2 km,
     Garvey Road and N Trico Road. If the station levels match to a few mm, the road-rating question
     is closed.
2. **msk 5 river outflow with a `bdrfile`.** The boundary level would follow the inside level minus
   slope × distance (`sfincs_boundaries.f90:969-977`), using a slope measured from lidar along
   Brawley Wash past the domain edge. This is closer to a normal-depth outfall. The flux still goes
   through the same `uvmean` formula, so option 1 may still be needed.
3. **Keep as is and label it.** The artifact is local to the outflow cells. In live output,
   velocities at msk 3 links should not be read as speeds.

## 2. Negative depth below −1 mm

### 2.1 The v2r cell

| | v2r 42555458619 | v1b NWM 42535214906 |
|---|---|---|
| face | 478144 | 314897 |
| cell size, area | 6.25 m, 39.0625 m² | 6.25 m, 39.0625 m² |
| lon, lat | −111.33729, 32.39383 | −111.26972, 32.26308 |
| subgrid zmin / zmax, full volume | 603.679 / 603.967 m, 5.69 m³ | 666.801 / 667.901 m, 15.29 m³ |
| minimum | −1.458 mm (−0.0570 m³) at 2026-11-02T02:30Z | −1.028 mm (−0.0402 m³) at 2026-11-02T01:00Z |
| frames below −1 mm | 01:30, 02:15, 02:30, 03:00Z (4 of 101) | 01:00Z (1 of 57) |
| depth in nearby frames (mm) | +0.28, −0.97, −1.31, −1.46, +0.21, −1.07, +0.10 (01:45–03:15Z) | +1.52, +1.52, −0.27, −1.03, −0.30, +0.08, +0.12 (00:15–01:45Z) |
| neighbours (bed zmin, depth at the minimum) | 478145: 601.279 m, 0.838 m deep (**2.40 m lower**); 478092: 602.435 m, 0.116 m (1.24 m lower); 478143: 603.876, 1.6 mm; 478196: 603.705, 15.8 mm | 314829: 665.845 m, 0.808 m deep (**0.96 m lower**); 314965: 666.694, 39 mm; 314896: 666.816, 9.6 mm; 314898: 666.859, 1.3 mm |
| nearest outflow cell | 1,123 m | 11,376 m |
| nearest road station | 61 m (W Lambert Lane) | 43 m (W Fort Lowell Road) |

**Same family.** Both are 6.25 m cells on a shallow perched lip. Each has a full volume of only
6–15 m³ and drains into a neighbour 1–2.4 m lower that holds 0.8 m of water. Both minima come during
peak local rain, when rain refills the lip and the steep drop empties it again.

They are not linked to the outflow boundary or to problem (1). Neither cell holds a road station.

### 2.2 What causes it (and what doesn't)

SFINCS updates cell volume explicitly, `z_volume += dt·Σ(fluxes)`, with no positivity limiter
(`sfincs_continuity.f90:666`). Outflow is stopped only on the **next** step, once the volume is
already negative (`sfincs_momentum.f90:735-745`). So the worst overshoot is about one step's net
outflow:

- volume ≈ q·w·dt;
- depth equivalent ≈ q·dt / cell size, which is 16 times larger on a 6.25 m cell than on a 100 m
  cell for the same flux.

For v2r, −0.057 m³ over a 6.25 m face and a 0.95 s average step means an excess outflow of only
about 0.01 m²/s for one step. That is ordinary sheet flow over a 2.4 m drop.

**Float32 precision does not explain it.** The spacing between float32 numbers near 0.057 m³ is
about 4e-9 m³, which is 7 orders of magnitude smaller than the residual. Option (b) as first worded
("float32 volume on small cells") is not supported by the evidence. A tolerance tied to cell **size**
does follow from the mechanism, though.

### 2.3 How often the current rule trips

Using all map frames, plus the :00/:30 frames only (the live cadence is half-hourly):

| run | frames | cells ever < 0 | min depth | min volume | fails at −1 mm (15-min / half-hour frames) | publishes? |
|---|---|---|---|---|---|---|
| v1b NWM 42535214906 | 57 | 1,398 | −1.028 mm | −0.040 m³ | 1 / 1 | **no** |
| v1b obs 42535217219 | 57 | 1,420 | −0.655 mm | −0.034 m³ | 0 / 0 | yes |
| v2 NWM 42543054067 | 57 | 2,242 | −0.643 mm | −0.031 m³ | 0 / 0 | yes |
| v2 obs 42543056194 | 57 | 2,257 | −0.674 mm | −0.031 m³ | 0 / 0 | yes |
| v2x 42544624673 (HRRR rain) | 101 | 2,440 | −0.674 mm | −0.031 m³ | 0 / 0 | yes |
| **v2r 42555458619 (observed Stage IV)** | 101 | 558 | **−1.458 mm** | −0.057 m³ | **4 / 3** | **no** |

- **2 of 6 runs fail** on a single cell each.
- Going from HRRR rain (v2x) to observed rain (v2r) more than doubles the deepest residual, from
  −0.67 to −1.46 mm.
- In v2r, 324 of the 558 negative cells are 6.25 m cells, 202 are 12.5 m cells, and none are 100 m
  cells. The median negative is −0.004 mm and the 1st percentile is −0.32 mm.
- The total negative volume across the domain is at most −0.16 m³ (v2r) and −2.8 m³ (v2). That is
  negligible for mass balance.
- The road exporter already treats every negative sample as UNKNOWN (`export_road_forecast.py:174`;
  comment in `verify_all_route_package.py:28`). A residual like this cannot make a road read dry.

### 2.4 Alternative rules on the same 6 runs

| rule (fail the run if any frame…) | v1b NWM | v1b obs | v2 NWM | v2 obs | v2x | v2r |
|---|---|---|---|---|---|---|
| depth < −1 mm (current) | fail | pass | pass | pass | pass | **fail** |
| depth < −2 mm | pass | pass | pass | pass | pass | pass (0.54 mm margin) |
| depth < −5 mm | pass | pass | pass | pass | pass | pass (3.5 mm margin) |
| volume < −0.01 m³ | fail (21 frames) | fail | fail | fail | fail | fail |
| volume < −0.05 m³ | pass | pass | pass | pass | pass | fail |
| depth < −1 mm, only on cells ≥ 12.5 m | pass | pass | pass | pass | pass | pass |
| domain negative total < −1 m³ | fail (3) | fail (3) | fail (3) | fail (3) | fail (3) | pass |

A volume-only limit fits worse than a depth limit: −0.01 m³ fails every run. A domain-total limit
fails the quiet runs and passes the heavy one. Neither should be used.

### 2.5 Proposal (owner decides; `tools/live/` not changed)

- **(a) Keep the strict −1 mm check.**
  - Simplest, and it never hides a residual.
  - Cost: on this case's evidence, a heavy observed-rain cycle, the kind that matters most, would
    fail to publish because of one 39 m² lip cell. v1b NWM fails on one frame, and v2r, the only
    all-observed-rain run, fails on 4.
- **(b) Recommended: a materiality limit sized by the mechanism, not by float precision.**
  - Fail a frame if any cell is below **−5 mm**. That is about half of the exporter's 9.1 mm wet
    threshold, so a residual can never come close to the wet/dry decision.
  - **Or** fail it if more than **25 cells** are below −1 mm in one frame. The worst seen is 1 cell,
    and a real instability spreads over many cells.
  - Keep the NaN and spike checks as they are, and keep every negative sample UNKNOWN.
  - Optionally use −1 mm on cells ≥ 12.5 m and −5 mm on 6.25 m cells. That matches the q·dt/size
    scaling, but it is more rule to explain.
  - All 6 runs pass with 3.5 mm or more of margin.
  - The −5 mm and 25-cell numbers are judgement calls tied to the wet threshold and to this
    evidence. They are not solver guarantees. The verifier's own comment says the 0.001 m figure is
    likewise a "publication materiality limit, NOT a solver accuracy or positivity guarantee".
- **(c) Fix it in the solver settings: not available at a cost live can afford.**
  - f3647fc has no positivity limiter in the continuity update.
  - The only lever is a smaller time step: lower `alpha` (now 0.5). The overshoot scales with dt, so
    reaching about −1 mm from −1.46 mm needs about alpha 0.33.
  - v2r already took 5,759 s against the 7,200 s execution cap. Lower alpha would push it to about
    8,700 s, over the cap.
  - A local terrain or mesh change at the lip (for example coarsening the lip cell) is case-specific
    and would have to be repeated for every new lip cell. Not recommended for live.

## Status

- Read-only.
- No dispatch. The roughness SENSITIVITY v2n (run 42565074684) was not touched.
- No change to `tools/live/`, the case, the mesh or the parameters.
- The validation doc was not edited.
