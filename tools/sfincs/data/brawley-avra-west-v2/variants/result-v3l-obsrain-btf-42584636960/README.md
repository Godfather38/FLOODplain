# v3l-obsrain-btf boundary SENSITIVITY, run 42584636960

SENSITIVITY only. Not for live registration, not tuned to observations.

**Case:** `brawley-avra-west-native-case-v3l-obsrain-btf` (commit 805c5107). This is base case B (`v3l-obsrain`, run
42583445548) with one change: `sfincs.inp` `btfilter = 60.0` becomes `btfilter = -1`. `make_variant.py` checked that every
other case file is byte-identical to B. The packaged archive's `sfincs.inp` says `btfilter = -1`, and the run's own copy
does too (base run: `60.0`).

**Both runs hit the 7,200 s execution cap** (exit 124). Each was at 95% after about 6,650 s. Both stopped at the same
model time: the last map frame is 2026-11-02 16:45Z (96 of 101 frames) and the last hourly restart is 16Z Nov 2 (23
restarts). SFINCS writes `zsmax`, `cumprcp`, `cuminf` and the runtime only at the end, so those are missing in both runs.
Because of that, `validate_extended.py` cannot run on either output, and base B has no `validation-full.json`. So this
result compares btf with base B directly, frame by frame and restart by restart, over the window both runs reached. It does
not fall back to v2r. Script: `tools/sfincs/brawley/variants/compare_btf.py`. Output: `compare-btf-vs-base.json`.

## What btfilter = -1 does (pinned SFINCS f3647fc)

- `sfincs_boundaries.f90` `update_boundary_fluxes` computes `q = ub*h + uvmean` (line 1119) on every boundary link
  (`kcuv = 2`). Here `ub = dir*(2*ui - sqrt(g/h)*(zs_inside - zsb0))` and `ui = 0` at an msk 3 cell.
- Lines 1178-1190: if `btfilter >= -1e-6`, then `uvmean = factime*q + facrel*(1 - factime)*uvmean`. Otherwise
  `uvmean = 0`. `factime = min(dt/btfilter, 1)` is only used inside that first branch.
- `uvmean` starts at 0 (`sfincs_domain.f90:1999`). No case here has an `rstfile`, so with btfilter = -1 `uvmean` stays 0 at
  every step. The flux is then only the head term.
- `btfilter` is read once (`sfincs_input.f90:149`, default 60). It is used nowhere else in `source/src` (I searched all 54
  .f90/.F90 files), apart from a NetCDF attribute (`sfincs_ncoutput.F90:1967`). The wavemaker has its own
  `wavemaker_uvmean` and is not affected.
- **Scope in this mesh:** mask 1 has 643,004 faces and mask 3 has 52. There is no msk 2 or msk 5 cell, and no `bndfile`,
  `bzsfile`, `bdrfile` or wavemaker. So the change acts only on the 76 msk1-msk3 outflow links.
- **Confirmed in the run:** the restart `uvmean` record is exactly 0 in all 23 btf restarts. Base B's maximum |uvmean| is
  1.25 m²/s.

## Results (btf vs base B, 18Z Nov 1 to 16Z Nov 2)

**Boundary outflow vs head term.** Stored flux is compared with `sqrt(g*huv)*(zs_inside - z_zmin)*width` at hourly
restarts. "Ratio" is stored ÷ head, over hours where the head term is above 0.5 m³/s.

| cluster | cells | base stored / head volume (m³) | base ratio | btf stored / head volume (m³) | btf ratio |
|---|---|---|---|---|---|
| 5, Outlet 720060498 (-111.293 32.365) | 26 | 3,382,996 / 473,890 | 0.19-11.2 | 3,387,868 / 3,355,983 | 0.96-1.05 |
| 4, lobe tip (-111.268 32.370) | 5 | 4,277,588 / 1,648,055 | 0-5.2 | 4,425,566 / 4,435,065 | 0-1.34 |
| 3 (-111.337 32.413) | 12 | 1,553,267 / 1,140,025 | 0-3.0 | 1,490,616 / 1,566,292 | 0-1.7 |
| 2 (-111.340 32.440) | 4 | 39,564 / 15,941 | stored 0 (clamped) | 31,666 / 125,737 | stored 0 (clamped) |
| 1 (-111.346 32.471) | 5 | 25,902 / 22,055 | stored 0 (clamped) | 22,055 / 25,830 | stored 0 (clamped) |
| all | 52 | 9,279,302 / 3,299,963 | 2.81 overall | 9,357,770 / 9,508,898 | 0.98 overall |

The memory term goes away, and stored outflow then matches the head term. **Total outflow hardly changes (+0.85%)**,
because outflow is limited by the water that reaches the outlet. Without `uvmean`, the water level inside the boundary
rises until the head term carries the same flux. The ratio range of 0 in clusters 1 and 2 (and partly 3 and 4) is the
`z_volume <= 0` drain-and-clamp seen in hourly snapshots, in both runs.

**zs at the outlet clusters.** zs at the outflow cells is pinned to their bed (`zsb0 = z_zmin`) in both runs. The
inside (msk 1) cell of each boundary link, btf minus base, at the same frame:

- Cluster 5, the outlet: +0.51 m at most, -0.004 m at least. The maximum depth above z_zmin is 0.636 m in btf and
  0.524 m in base. This is a level difference, not a flow depth.
- Cluster 4, the lobe tip: +0.016 to +0.12 m. The inside cells are wet in 67 frames in btf and 50 in base.
- Cluster 3: 0.000 m.
- Clusters 1 and 2: never wet in either run.

How far the change reaches. These are the largest |zs btf - base| values by distance from the nearest outflow cell. The
first two rows use frames where the cell is wet in **both** runs. The next two use frames where it is wet in **either** run
and both runs wrote a zs (no value is filled). Near the outlet the either-run numbers are larger, because the biggest rise
is in cells that btf wets and base leaves almost dry:

| band | 0-100 m | 100-250 m | 250-600 m | 600-1000 m | 1-2 km | 2-5 km | >5 km |
|---|---|---|---|---|---|---|---|
| max m, wet in both | 0.508 | 0.120 | 0.034 | 0.005 | 0.012 | 0.021 | 0.025 |
| cells > 1 cm, wet in both | 92 | 28 | 2 | 0 | 1 | 4 | 9 |
| max m, wet in either | **0.601** | **0.171** | 0.034 | 0.005 | 0.012 | 0.021 | 0.025 |
| cells > 1 cm, wet in either | 97 | 29 | 2 | 0 | 1 | 4 | 9 |

Within 250 m the largest either-run difference is a rise (btf higher): +0.601 m at 0-100 m and +0.171 m at 100-250 m
(`compare-btf-vs-base.json` `zsChangeReach`, `maxRiseBtfMinusBaseWetEitherM`).

The differences beyond 1 km are not propagation from the boundary:

- They are scattered single cells.
- Their sign alternates.
- They first appear at frame 36, while the outlet difference starts at frame 8.
- They sit in actively sloshing cells, for example the Mile Wide reach near -111.271 32.247.

This matches the global time-step coupling: `dt = alfa*min` over all u/v points (`sfincs_momentum.f90:773-775`,
`sfincs_lib.f90:337`). A local change shifts every time step slightly.

**Run-to-run check.** These differences are caused by btfilter, not by solver noise. Base B was run again as 42599666617;
that rerun finished, in 8,136 s. Over the 96 common map frames, its zs and subgrid_volume are bit-identical to
42583445548 (max |difference| 0). All 23 common restart files are byte-identical. The solver is deterministic on this
case, so every btf-base difference above comes from the btfilter change, the scattered far-field cells included.

**Road stations within 600 m of an outflow cell** (v2 local station file): there are 420 stations, on clusters 2, 3 and 5.

- 417 are rated. North Puma Road at 131 m, from cluster 2, and 2 unnamed stations at 443-448 m have no mesh cell, so they
  are unrated in both runs.
- W Peccary Lane, 187 m from cluster 3, is never wet in either run.
- Every rated station: the largest |dzs| in frames wet in both runs is **0.2 mm**. No station changes its wet or over-road
  status. Ever wet: 152 in both runs. Over the road: 75 in both runs.

| road | stations | nearest m | over (btf / base) | max abs dzs m |
|---|---|---|---|---|
| W White Eagle Rd | 59 | 161.7 | 0 / 0 | 0.0001 |
| W Peccary Ln | 7 | 187.1 | 0 / 0 (never wet) | 0 |
| W El Camino Rd | 111 | 287.5 | 21 / 21 | 0.0001 |
| N Star Cluster Rd | 58 | 361.5 | 3 / 3 | 0.0001 |
| W Whitewing Way | 88 | 375.5 | 45 / 45 | 0.0002 |
| Garvey Rd (nearest to the outlet) | 29 | 391.7 | 5 / 5 | 0.0001 |
| N Cocio Rd | 27 | 572.0 | 1 / 1 | 0.0001 |

Clusters 1 and 4 (the lobe tip) have no road station within 600 m.

All 57,465 rated stations in the domain: the change in max zs is at most **0.7 mm**. No station changes over-road status
(7,676 over in both runs).

**Speeds at boundary links** (|q|/huv, with huv being the subgrid flux depth; these are not real speeds):

| | btf | base |
|---|---|---|
| maximum | 81.5 m/s, huv 1.1 mm, face 159197, 04Z | 450 m/s, huv 1.9 mm, face 298165, 10Z |
| cluster 3 | 60 m/s | 95 m/s |
| cluster 4 | 36 m/s | 339 m/s |
| cluster 5 | 81 m/s | 450 m/s |

btf lowers the speed proxy but does not remove it. The head term alone is `sqrt(g/h)*(zs_inside - bed)`, and it still
gives a large speed over a millimetre-deep flux depth.

**Negative depth:** btf and base fail the same way.

| | btf | base |
|---|---|---|
| face | 478144 | 478144 |
| minimum | -1.461 mm | -1.458 mm |
| frames below -1 mm | 3 | 4 |
| cells below -1 mm | 1 | 1 |

This is the perched-lip cell family described in BRAWLEY-STABILITY section 2, 1.1 km from the nearest outflow cell. No
NaN in any wet cell in either run.

**Upstream sections:** hourly restart flux, stair-step sections of `validate_extended.py`.

| section | peak btf | peak base | largest hourly difference |
|---|---|---|---|
| Mile Wide Black Wash band (ALERT 6443) | 122.901 m³/s, 06Z | 122.901, 06Z | 0.075 m³/s |
| Mile Wide both bands | 139.237, 07Z | 139.237, 07Z | 0.075 |
| Manville | 157.965, 01Z | 157.965, 01Z | 0.009 |
| Tucker | 159.143, 10Z | 159.144, 10Z | 0.006 |
| Donaldson Ranch | 33.854, 04Z | 33.854, 04Z | 0.006 |

**Mass balance.** Rain, inflow and `cna` infiltration are identical inputs in the two runs. The final `qinf` is identical
too (max |difference| 0).

- Storage is identical at 17Z and 18Z Nov 1 (difference 0 m³).
- At 16Z Nov 2, btf storage is +1,128 m³ higher.
- btf outflow (hourly-snapshot trapezoid) is +78,468 m³ higher, or 0.85%.

The two differences should add to 0. They add to +79,596 m³, about as large as the outflow difference itself, so **this
difference balance is not closed** (`massBalance.closed: false`). The hourly trapezoid cannot tell whether btf really
passes 78k m³ more or the gap is sampling error: hour-to-hour boundary outflow differs by up to 22.8 m³/s between the runs,
for example at 15Z, 149.6 vs 126.9 m³/s. Only a time-integrated outflow (a his file or a cumulative boundary flux) could
close it. An absolute whole-run balance is not possible either, because the cap stopped both runs before `cumprcp` and
`cuminf` were written.

**Solver time:** no measurable difference. Elapsed seconds at each 5% mark:

| | 50% | 70% | 90% | 95% |
|---|---|---|---|---|
| btf | 873 | 2,361 | 5,823 | 6,653 |
| base | 867 | 2,353 | 5,809 | 6,643 |

Both stopped at 7,200 s. For comparison, v2r reached 100% in 5,759 s on an earlier runner. Its 0-5% step took 61 s
against 78-79 s here, so these runners were about 1.3 times slower. That slowdown, not btfilter, explains the cap.

**ALERT 6443, primary county series** (`gauges.json`), scored to the common 16Z Nov 2 end. With the 16Z start the ratio
is a lower bound. The plateau is cut at 16:00Z.

| Black Wash band | btf | base |
|---|---|---|
| peak | 122.9 m³/s, 06Z | 122.9 m³/s, 06Z |
| observed peak | 64.7 m³/s, 18:20Z | same |
| q at 03Z | 105.8 m³/s | 105.8 m³/s |
| q at 03Z / observed 22.0 | 4.81 | 4.81 |
| volume, 18Z start | 7.107 Mm³ vs 1.702 observed, 4.175 | same |
| volume, 18Z start, no plateau | 5.121 | 5.121 |
| volume, 16Z start | 3.94 | 3.94 |
| volume, 16Z start, no plateau | 4.77 | 4.77 |
| NSE, hourly 18Z Nov 1 to 16Z Nov 2 (23 reports) | -37.61 | -37.61 |
| NSE, same window, no plateau hours (15 reports) | -37.17 | -37.17 |

The hourly fit ends at 16Z Nov 2, the last common restart; `compare-btf-vs-base.json` now names it `hourlyFit18Zto16Z`
(round 7 called it `hourlyFit18Zto18Z`, which it never was).

Both bands: volume ratio 4.567 (18Z start) and 4.309 (16Z start), and NSE -46.92 in both runs. btfilter changes nothing at
the gauge. The large over-prediction belongs to base B (the runoff volume, see BRAWLEY-RUNOFF-ROUTING), not to the
boundary.

## Evidence for the owner's decision: btfilter = -1 in live cases

Live SFINCS cases (every one has `btfilter = 60.0` in its own `sfincs.inp`):

| live case | run by | sfincs.inp keys the runner rewrites | outflow (msk 3) cells |
|---|---|---|---|
| northern v3, picture-rocks v2, gates-full v3, brawley-avra-west v2 (`tools/live/all-route-cases.json`) | `live-all-route.yml`, `run_live_all_route.py` | `tref`, `tstart`, `tstop`, `t0out`, `dtout`, `dtrstout` (`run_live_all_route.py:130-131`) | 12, 18, 41 and 47 |
| stress-storm-v1 hourly live case (`tools/sfincs/data/stress-storm-v1/case.tar.gz`, regular 100 m grid) | `live-sfincs.yml`, `run_live_sfincs.py prepare` | `tref`, `tstart`, `tstop`, `dtrstout` (`run_live_sfincs.py:231`) | 7 |

Round 7 said the all-route runner rewrote only the time keys and `dtrstout`; it also rewrites the output timing `t0out` and
`dtout`. None of the rewrites touches `btfilter`. Every live mesh has mask 1 and 3 only, and none has an rstfile or a
water-level or river boundary (stress-storm-v1: `sfincs.msk` holds 29,678 ones and 7 threes, no `bndfile`). So
`btfilter = -1` would act on every live case exactly as it does here: only on msk 3 outflow links.

For adoption:

- It removes a term with no physical counterpart at a dry open outfall. Stored outflow becomes the head-driven flux (ratio
  0.98 overall, against 2.81).
- It costs nothing in solver time.
- In this event it changes no road station (at most 0.2 mm within 600 m and 0.7 mm in the whole domain), no upstream
  section (at most 0.075 m³/s) and no ALERT 6443 score.

Against, or not settled:

- It raises water near the outlet by up to 0.60 m within 100 m and 0.17 m at 100-250 m in cells wet in either run (0.51 m
  and 0.12 m counting only cells wet in both runs), and changes it by up to 3.4 cm at 250-600 m. Here no
  station sits that close to a wet outflow cluster. A live case with a road station within about 250 m of an active
  outflow cluster could see a real rating change. One example is the v3 boundaries, which put 10 stations inside outflow
  cells. Whether the higher level is more realistic than the base level is not tested: there is no water-level
  observation at an outflow.
- It does not fix the boundary speed proxy (still 81 m/s) or the negative-depth cell (-1.46 mm, which still trips the
  live -1 mm rule).
- This is one event, one domain, and a window cut at 16:45Z by the cap. The other live domains have different outflow
  geometry and were not run.

The decision is the owner's. Running a btfilter = -1 variant of each live case before any change would test the
near-outlet rise against that case's road stations.
