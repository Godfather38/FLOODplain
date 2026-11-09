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
- `outflow_roads.py` (added 2026-11-09, round 7) covers **every** outflow cluster: road stations by
  distance, wet and over-road counts, and the stored vs head-driven boundary flux at each hourly
  restart. Output: `out-v2r-20261109/outflow-roads.json`.
- The `--stations` default of these scripts is now found from the script's own location, so they
  give the same answer from any working directory (it was a cwd-relative path before).

**Revised 2026-11-09 (round-7 checker).**
- The road check now covers all 6 outflow clusters, not only the outlet one. It finds stations much
  closer than first reported (§1.5).
- The "no oscillation" claims were dropped: hourly snapshots cannot show what happens between them
  (§1.2).
- Added or corrected: interior subgrid speeds (§1.1), the 71 vs 93 boundary links (§1.3), theta and
  advection (§1.7), the trip count on the published window (§2.3) and the cost on the live window
  (§2.5).

SFINCS source quoted below is the pinned commit f3647fc
(https://github.com/Deltares/SFINCS/tree/f3647fc0289bb15cb2512d60686cef74cb853c78/source/src), the
same one cited in `tools/live/verify_all_route_package.py`.

## Short answers

- **Velocity (1):** This is a **boundary-condition artifact**, not real flow and not a numerical
  blow-up.
  - On the velocity proxy, every link above 3 m/s, in every hour of v2r, touches one of the 47
    outflow (msk 3) cells. The fastest interior link on the proxy is 2.42 m/s (Froude 0.5) at the
    Mile Wide deck, which is physical.
  - On the subgrid estimate (flux ÷ subgrid flux depth), interior links reach **3.65 m/s**. That is
    at 08Z, on a 12.5 m link near Mile Wide with 0.025 m of flux depth over a 1.44 m bed step: thin
    flow over a step, not a measured speed. Up to 2 interior links per hour are above 3 m/s on this
    estimate (§1.1).
  - The SFINCS outflow boundary keeps a running mean of past outflow (`uvmean`) and adds it to each
    new boundary flux. That mean can carry up to about 61 times the head-driven flux and takes about
    an hour to decay.
  - So the boundary keeps drawing water after the head that drove it has gone. In v2r the
    boundary outflow is about 3 times what the boundary's own head term gives.
- **Road ratings: not shown to be unaffected (corrected).** The first check looked only at the six
  fastest outlet faces, where the nearest station is 586.5 m away. Across all 6 outflow clusters
  (§1.5):
  - stations sit as close as **131 m** (North Puma Road) and **187 m** (W Peccary Lane) to outflow
    cells. Both are never wet in v2r.
  - stations that go over the road sit 291–436 m from four of the clusters: W El Camino Road at
    291 m and 382 m, W Whitewing Way at 376 m and Garvey Road at 436 m.
  - within 500 m of the cluster at −111.335, 32.404 (5 cells), 45 stations go over the road.
  - Over-draining (stored outflow above the head-driven part) is measured at only two clusters: the
    outlet (up to 15×) and −111.335, 32.404 (up to 3.0×). At the other four, the stored flux is at
    most the head-driven part in every snapshot.
  - Over-draining can only bias ratings toward **less** water. Whether it changes any rating is not
    known. A SENSITIVITY run (`btfilter = −1`, §1.6) would settle it.
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

v2r hourly maximum (all restarts 18Z Nov 1 to 18Z Nov 2). "Subgrid" divides the flux by the SFINCS
subgrid flux depth huv, where huv > 0.01 m:

| | proxy max | at an outflow link? | interior max (proxy) | links > 3 m/s (proxy) | interior max (subgrid) | interior links > 3 m/s (subgrid) |
|---|---|---|---|---|---|---|
| 18Z–00Z | 1.27–2.40 | no | same | 0 | 2.48–3.40 | 0–2 (2 at 18Z) |
| 01Z–02Z | 2.35–2.48 | 02Z yes | 2.30–2.35 | 0 | 2.50–2.86 | 0 |
| 03Z | 3.24 | yes | 2.29 | 1 (boundary) | 2.99 | 0 |
| **04Z** | **8.22** | yes | 2.33 | 2 (both boundary) | 3.02 | 1 |
| 05Z–09Z | 2.86–7.54 | yes | 2.31–2.42 | 0–1 (boundary) | 2.99–**3.65** | 0–1 |
| 10Z–13Z | 3.13–3.69 | yes | 2.05–2.23 | 1 (boundary) | 3.00–3.32 | 1–2 |
| 14Z–18Z | 2.34–2.90 | yes | 1.74–2.00 | 0 | 2.82–2.98 | 0 |

- **Where the subgrid interior maximum is.** 3.648 m/s at 08Z, on link 745862 between faces 363680
  and 363681. These are 12.5 m cells at −111.24715, 32.24996, about 300 m from ALERT 6443.
- **What it is.** q is 0.091 m²/s over a flux depth of 0.025 m, and the two cell beds differ by
  1.44 m (673.54 → 672.10 m). It is thin flow dropping over a step. The figure is a ratio of model
  quantities, not a measured speed.

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

In the hourly snapshots the flux is 0.64–0.89 m²/s from 02Z to 18Z. In the same snapshots the water
above the interior cell's bed is between 0.02 and 0.11 m, and the flux does not follow it.

Friction-limited (Manning) flow at that depth gives a very different number. With h = 0.01 m,
n = 0.04 and slope 0.11 m / 12.5 m, q ≈ h^(5/3)·S^(1/2)/n ≈ 0.001 m²/s. That is nearly 1000 times
smaller.

There are no NaN values and no growth from one snapshot to the next.

*Corrected 2026-11-09:* an earlier version also said the flux "is not oscillating" and called it
"steady". Hourly restarts are instantaneous snapshots, about 3,800 solver steps apart at the 0.95 s
mean step. They cannot show what the flux does between them, so neither claim is supported.

What the snapshots do show is **drain and clamp** (`outflow_roads.py`):

- **Flux zeroed while the head is positive.** In 53 of 1,775 link-hours on the 71 boundary links,
  the stored flux is exactly 0 while the head-driven part is positive. That is the
  `z_volume(inside) <= 0` stop (line 1131) having just fired: the previous step drained the interior
  cell, so the flux was set to zero. The outlet cluster has 31 of its 1,100 link-hours like this, and
  the cluster at −111.339, 32.421 has 11 of 150.
- **On/off from one snapshot to the next.** At the smaller clusters, the whole cluster's outflow
  switches between 0 and a few m³/s. In v2x, face 37645 reads 6.29, 0, 0, 4.92 m³/s at 07Z–10Z
  Nov 2.
- **The interior cells stay at about zero.** Interior cells next to outflow cells stay at or above
  −0.07 mm in the 15-min map frames (below). The stop holds their volume at about zero, but it does
  so by switching the flux off and on.

So the boundary flux is history-driven (uvmean) **and** cut off whenever the interior cell runs dry.
What it does between snapshots is not known.

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
outflow.

- **71 vs 93 links.** 93 links touch an msk 3 cell; `velocity_hotspots.py` reports this as
  `boundaryLinks`. Only the 71 between an msk 1 and an msk 3 cell carry boundary flux (`kcuv = 2`).
  The other 22 lie between two msk 3 cells, and their stored q is 0 at every v2r and v2x restart.
  The script now reports both counts. The 102.1 m³/s total at 04Z is the same either way.
- **Per cluster** (`outflow_roads.py`, v2r, snapshots where the head-driven part is above
  0.5 m³/s):
  - the outlet cluster: stored flux 0.19–15.1× the head-driven part;
  - the cluster at −111.335, 32.404: 0–3.0×;
  - the other four clusters: 0–0.25×. There the stored flux was 0 (clamped) in most of those
    snapshots.

Over all 71 links:

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
| Numerical instability | No growth between snapshots, no NaN, 0 spikes. Interior proxy speeds ≤ 2.42 m/s (Froude ≤ 0.5); interior subgrid estimates up to 3.65 m/s, on thin flow over a step. Hourly snapshots cannot rule out oscillation between them, and they do show drain-and-clamp switching at the boundary (§1.2). | **not seen in the snapshots**; not ruled out |
| Boundary-condition artifact | The level is pinned at the outflow cell's bed. The `uvmean` running mean (gain up to about 61×, 1 h memory) is added to the flux. Outflow is 2.6–4.4 × the head-driven part. | **yes** |

The velocity proxy is also misleading at these links. It divides by the bed-to-surface difference
(0.109 m), not by the subgrid flux depth (0.010 m). Either way, the large number means
"boundary-set flux over almost no depth", not a real speed.

### 1.5 Could it corrupt road ratings?

*Corrected 2026-11-09 (round 7).* The first version of this section looked only at the six fastest
faces: 159196/7, 297752/3 and 298164/5 at the Brawley Wash outlet.
- Measured from those six faces, the nearest station is 586.5 m away (Garvey Road). The "587 m"
  given earlier was that value rounded. 890 stations are within 2 km of them.
- The same boundary formula acts at every msk 3 cell, so all 6 outflow clusters are checked here
  (`outflow_roads.py`, v2r, wet frames only). Each msk 3 cell is assigned to its nearest HydroMT
  outflow point, and distances are from the nearest cell centre in the cluster.

| Cluster (cells, links) | Nearest station | Nearest station that goes over | Within 500 m: stations / ever wet / over | Within 2 km: stations / over | Stored ÷ head-driven |
|---|---|---|---|---|---|
| Outlet −111.293, 32.365 (26, 44) | 391.7 m Garvey Rd (wet, −0.11 m) | 435.9 m Garvey Rd (+0.053 m) | 16 / 12 / 5 | 897 / 233 | 0.19–15.1 |
| −111.335, 32.404 (5, 7) | **187.1 m W Peccary Ln** (never wet) | 376.2 m W Whitewing Way (+0.143 m) | 92 / 56 / **45** | 1,015 / 140 | 0–3.0 |
| −111.338, 32.417 (3, 4) | 377.6 m W El Camino Rd (never wet) | 381.5 m W El Camino Rd (+0.023 m) | 66 / 31 / 3 | 596 / 71 | 0 (clamped) |
| −111.346, 32.471 (5, 5) | 1,144 m W Silverbell Rd (+0.223 m) | same | 0 / 0 / 0 | 104 / 3 | 0 (clamped) |
| −111.339, 32.421 (4, 6) | 287.5 m W El Camino Rd (wet, −0.045 m) | 290.6 m W El Camino Rd (+0.048 m) | 130 / 57 / 22 | 613 / 28 | 0–0.25 |
| −111.340, 32.440 (4, 5) | **131.0 m North Puma Rd** (never wet) | 578.1 m N Cocio Rd (+0.031 m) | 50 / 0 / 0 | 493 / 13 | 0 (clamped) |

The 2 km counts overlap between neighbouring clusters. "Never wet" means no wet frame at that
station's cell; it is not dry evidence.

- North Puma Road (131 m) and W Peccary Lane (187 m) are never wet in v2r, so they have no
  over-road result that over-draining could have lowered. Whether they would be wet without it is
  not known.
- Stations that do go over the road are within 291–436 m of four clusters. 45 of them are within
  500 m of the −111.335, 32.404 cluster, where the stored flux reaches 3× the head-driven part.
- **Height and depth near the six outlet faces:** their bed is 617.96 m, and the Garvey Road
  stations 609–626 m from them are about 2.9 m higher. Cells within 600 m of those faces have zb
  617.56–621.68 m and a maximum depth of 0.67 m.
- **How far the extra drawdown could reach:** the outflow lowers water near the outflow cells, so it
  would bias ratings toward **less** water, not more. At the outlet faces the first estimate was
  depth ÷ bed slope ≈ 0.67 m ÷ (2.9 m / 610 m) ≈ 140 m. That estimate does not carry over to stations
  131–436 m from the other clusters, whose depth and slope were not measured.

Assessment (corrected): **not known.** The earlier "unlikely" rested on a 587 m distance that holds
only for the six outlet faces. Stations that go over the road lie within 291–436 m of four clusters,
and over-draining is measured at two of them. Until the `btfilter = −1` SENSITIVITY run (§1.6) has
been compared station by station, ratings near outflow cells should not be relied on to the
centimetre.

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
   - Compare against v2r: the boundary outflow, and the levels at every station within 2 km of any
     of the 6 clusters (§1.5), including North Puma Road, W Peccary Lane, W Whitewing Way, W El
     Camino Road and Garvey Road. If the station levels match to a few mm, the road-rating question
     is closed.
2. **msk 5 river outflow with a `bdrfile`.** The boundary level would follow the inside level minus
   slope × distance (`sfincs_boundaries.f90:969-977`), using a slope measured from lidar along
   Brawley Wash past the domain edge. This is closer to a normal-depth outfall. The flux still goes
   through the same `uvmean` formula, so option 1 may still be needed.
3. **Keep as is and label it.** The artifact is local to the outflow cells. In live output,
   velocities at msk 3 links should not be read as speeds.

### 1.7 theta and advection against the SFINCS docs

Both settings act on the momentum flux, so both were checked. Neither reaches the boundary flux.

- **`theta = 1.0`** (`sfincs.inp`).
  - The SFINCS docs (sfincs.readthedocs.io, input parameters) say: "Numerical smoothing factor in
    momentum equation. Default of 1.0 means no smoothing." The range is 0.8–1.0.
  - In f3647fc, `sfincs_input.f90:119` defaults it to 1.0, and line 531 turns smoothing on only when
    theta < 0.9999. `sfincs_momentum.f90:678` calls the smoothing "not recommended anymore!". It is
    applied only at regular points whose two neighbours are also `kcuv = 1`.
  - So this run has no theta smoothing. Lowering theta would not touch the `kcuv = 2` boundary
    links, whose flux comes from `update_boundary_fluxes`.
- **`advection = 1`**.
  - The docs: "1 for advection scheme on (default, SFINCS-SSWE)".
  - In the source, it is on by default (`sfincs_input.f90:138`), with the 'upw1' scheme and `advlim`
    1.0 m/s² as defaults. Advection is turned off next to open boundaries (`sfincs_momentum.f90:457`,
    `mask_adv`).
  - So the boundary flux is not an advection effect, and turning advection off would not change it.
- Both are the documented defaults, and neither is a lever for the boundary artifact. Changing
  either would be a SENSITIVITY with its own physical reason, which this check does not supply.

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
- **What the live verifier actually checks** (`tools/live/verify_all_route_package.py:227-255`):
  only the published frames. These are every 30 min (`DTOUT` 1800 s) from 3 h before the cycle to
  18 h after it (`SHOW_BACK` 3 in `run_live_all_route.py`; `AHEAD` 18 in `run_live_sfincs.py`), 43
  frames. Recounted on that basis:
  - Each frozen run starts at 2026-10-30T16Z, 45 h (`SPIN`) before a 2026-11-01T13Z cycle. That
    cycle publishes 10Z Nov 1 to 07Z Nov 2. The maps start at 17Z, so 10:00–16:30Z is not checked
    here.
  - Inside that window the failing half-hour frames are v1b NWM 01:00Z (1 frame) and v2r 01:30,
    02:30 and 03:00Z (3 frames). The v2r 02:15Z frame is not a published frame. The other four runs
    have none. So the count is unchanged: **2 of 6 would trip**.
  - v2x and v2r also cover later cycles. Five cycles (20Z Nov 1 to 00Z Nov 2) have their whole
    published window inside the 25 h map. All 5 contain the v2r failing frames (5 of 5 trip); v2x
    trips 0 of 5.
  - A real live cycle cold-starts 45 h before its own cycle hour and uses HRRR after it, so its
    state at a given time is not the frozen run's. The later-cycle counts are indicative only.
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
  - *Cost against the live budget.* Corrected 2026-11-09: the earlier figure (about 8,700 s
    against 7,200 s) used this run's 74 h window and the 7,200 s validation cap.
    - Live runs simulate SPIN 45 h + AHEAD 18 h = 63 h (`tools/live/run_live_sfincs.py:19`) and
      publish from SHOW_BACK 3 h before the cycle (`run_live_all_route.py:25`). The solver is
      capped at **5,400 s** (the `solver_cap_seconds` default in
      `.github/workflows/live-all-route.yml`, passed to `timeout`).
    - The time step scales with alpha, so going from 0.5 to 0.343 multiplies solver time by about
      1.46.
    - The frozen v2 runs are exactly 63 h long: 3,350 s (NWM) and 2,934 s (observed) at alpha 0.5.
      That gives about 4,280–4,890 s at alpha 0.343, inside the cap with 10–21% margin.
    - The heavy-rain case is the one that trips. v2r took 5,759 s for 74 h. At an even 77.8 s per
      simulated hour, 63 h would take about 4,900 s at alpha 0.5 and about 7,150 s at 0.343, over
      the 5,400 s cap. The cost is not even across the hours (deep-water hours are slower), so
      this is an estimate, not a measurement.
    - So a lower alpha would probably time out on exactly the heavy-rain cycles it is meant to fix.
  - A local terrain or mesh change at the lip (for example coarsening the lip cell) is case-specific
    and would have to be repeated for every new lip cell. Not recommended for live.

## Status

- Read-only.
- No dispatch. The roughness SENSITIVITY v2n (run 42565074684) was not touched.
- No change to `tools/live/`, the case, the mesh or the parameters.
- The validation doc was not edited.
- Round-7 revision (2026-11-09): docs and scripts only. `outflow_roads.py` was added, and the
  `--stations` defaults and the link counts in `velocity_hotspots.py` were fixed. No run.
