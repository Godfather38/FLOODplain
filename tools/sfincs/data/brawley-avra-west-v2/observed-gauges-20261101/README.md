# Observed stream gauges, brawley-avra-west, Nov 1–2 2026

Validation data only. Not forcing, not used to tune anything. Built by `build_gauges.py` (run it from the worktree
root with the project venv and `-I`). It reads the raw downloads in `raw/` (gzipped, exact bytes as served; the
sha256 of each uncompressed file is in `gauges.json`), the committed v2x result
(`../extended/result-42544624673/`, read from the pinned commit 8b1d2f02cdc0) and the NWM analysis already in the repo
(`../../brawley-avra-west-v1/nwm-validation-reaches.json`).

All times below are UTC unless marked MST. The county ALERT pages use Arizona MST (UTC−7, no daylight saving).
That was checked two ways: the newest report matches the feed time the snapshot script treats as UTC−7, and the
ALERT 6423 jump at 14:00 MST lines up with the co-located USGS 09487000 jump at 14:00–14:15 −07:00.

**2026-11-09 corrections, now written by the builder.** Some fields of `gauges.json` were first corrected by hand
(listed in its `postBuildEdits`): the 817 cfs wording, the gauge name and NHD snap, the plateau volumes and caveat, the
base reading and rating notes, and the rain window. `build_gauges.py` now writes them itself (`post_build_edits()`),
computing every number from `raw/` and asserting it. It reads the model side from the pinned commit `8b1d2f02cdc0`
(the file's `modelCommit`, option `--model-commit`), not from HEAD, so a re-run on any later commit gives the same file.
Checked 2026-11-09: two consecutive re-runs are byte-identical to the committed `gauges.json`. Against the hand-edited
version, only two strings changed: the `postBuildEdits` note, and the 16:20–18:00Z gap volume in `plateauNote`,
66,601 → 66,603 m³. The builder uses the rounded m³/s values that all the other totals use.

## Where the data came from

- **`data` branch: no history.** The snapshot workflow force-pushes a single commit every ~10 min (now 14cb2a7,
  02:51Z Nov 9). It holds no Nov 1–2 readings.
- **Pima ALERT `showdata.php`**: the county's "last N reports" page per sensor. It returns up to 1,000 reports,
  which reach back to late September to mid October. So Nov 1–2 is fully covered for every sensor. The page table
  gives stage (ft) and, for rated gauges, flow (cfs). The page's embedded JSON has 0 in its flow slot for every row;
  the table column is the rated flow, and that is what is used.
- **USGS NWIS**: the site service for all stream sites in the box −111.55, 31.90 to −110.95, 32.60, and the IV
  service for each site that has IV data.
- The domain is `../components/active-domain.geojson`. Its CRS is EPSG:32612 (UTM 12N), declared in the file.
  Sensor lon/lat were transformed with pyproj.

## Every stream sensor in or next to the domain

| Sensor | Where | Nearest model reach / section | Use |
|---|---|---|---|
| **ALERT 6443** Brawley Wash at Milewide Rd (PT stage + county rating) | in domain | 4.8 m from NHD 15876815 (Black Wash outlet, 604 km²). Section: Mile Wide Black Wash band; both bands as an upper bound | **the only observed point downstream of the inlet** |
| USGS 09487000 Brawley Wash nr Three Points (15-min Q and gage height) | 790 m outside, upstream | inlet face 276978, reach 15876941 | inlet (this is the forcing) |
| ALERT 6423 Brawley Wash at Three Points (PT + rating) | 750 m outside, same site as 09487000 | inlet | inlet cross-check |
| ALERT 5033 / 4103 / 5023 AZGFD 3 / 1 / 2 (PT stage only, no rating) | in domain | 271 / 832 / 865 m from the nearest NHD flowline (3–6 km² headwaters) | off-channel; stage changes ≤0.6 ft; not wave-timing points |
| USGS 09486520 and ALERT 1345, Santa Cruz River at Trico Rd | 4.0 km outside | Santa Cruz 15890430, **upstream** of the Brawley/Los Robles confluence (−111.3987, 32.5372) | cannot see Brawley water |
| USGS 09486500 Santa Cruz at Cortaro | 10 km outside | Santa Cruz | context only |
| ALERT 782 Sasco Rd, ALERT 739 McClellan Wash (Pinal) | 11 / 22 km outside | not on the Brawley path | excluded |
| USGS 09487250 Los Robles Wash nr Marana | outside, on Brawley 945050510 below the outlet | — | historical site, **no IV data** |
| USGS 321452111143601 (misc, Brawley at Mile Wide Rd), 09487100 Little Brawley, 09486515, 09486510 | — | — | no IV data for the window |

There is **no stream sensor at Manville, Tucker or the outlet**, and none on Brawley/Los Robles below Mile Wide.
Gaps are listed in `gauges.json` as unknown, never as zero or dry. ALERT reports on change plus hourly, so a value
between reports is not measured. AZGFD 3 sent two 201.8 ft reports at 22:37Z Nov 1. They are kept, flagged
`suspect`, and left out of its summary.

Six ALERT rain gauges (6440 Mile Wide, 6420 Three Points, 6450 Hilltop, 6460 Picture Rocks, 6480 Trico/Manville and
6500 Desert Museum) are included as context only. From their tip times (0.04 in per tip):
- All six had their main burst at 14:45–17:05Z Nov 1.
- Lighter rain followed after 17:05Z: 6440 Mile Wide 0.24 in (to 20:20Z), 6500 0.35 in (to 20:32Z), 6460 0.31 in
  (to 20:30Z), 6420 0.31 in (to 21:02Z), 6450 0.47 in (to 21:27Z) and 6480 0.04 in (one tip, 19:16Z).
- The last tips were ALERT 6420 at 21:02Z and 6450 at 21:27Z. So **no rain from about 21:30Z Nov 1 until 07:06Z
  Nov 2** (the first tip after, at 6460).

## ALERT 6443, Nov 1–2 (primary data)

- **Name and network.** The county names the gauge "Brawley Wash at Milewide Road". Its coordinates snap to NHD
  15876815, the Black Wash outlet (604 km²), at 4.8 m; the Brawley 15877627 crossing is 0.8 km west. These point to
  different comparisons. If the NHD position is right, the gauge sees the model's Black Wash band (and NWM 15876815,
  peak 0.33 m³/s). If the county name means the combined Brawley flow at the road, it sees both bands (and NWM
  15876811, peak 39.13 m³/s). That is not settled, so both bands are always reported.
- Base reading 2.30–2.31 ft, with 0 cfs. This is the pre-event reading, **not the rating's zero-flow stage**: the
  rated flow stays 0 cfs at every report up to 2.49 ft.
- First rise at 16:20Z (2.39 ft). First rated flow at 16:35Z (160 cfs).
- Three peaks:

  | Peak | UTC | MST | Stage | Flow |
  |---|---|---|---|---|
  | 1 | 18:20Z Nov 1 | 11:20 | 4.87 ft | **2,286 cfs = 64.7 m³/s** (event maximum) |
  | 2 | 21:45–22:00Z | 14:45–15:00 | 4.17 ft | 1,482 cfs = 42.0 m³/s |
  | 3 | 02:10Z Nov 2 | 19:10 | 3.50 ft | 906 cfs = 25.7 m³/s |

- After peak 3 the flow eases to 484–572 cfs (13.7–16.2 m³/s) at 04–08Z Nov 2. It then sits flat at 2.64–2.72 ft,
  397–434 cfs (11.2–12.3 m³/s), from 08:45Z to 16:20Z, and reads 387 cfs at 18Z. It is still 236 cfs (2.56 ft) at
  23Z Nov 2.
- One gap over 65 min in the task window: 16:20–18:00Z Nov 2.

**Low-stage rating caveat.** The stage/flow pairs of all 1,000 reports on the page show the county rating at low
stage: 0 cfs up to 2.49 ft, 16–17 cfs at 2.50 ft, 330–332 cfs at 2.59 ft and 383 cfs at 2.61 ft (there is no report
at exactly 2.60 ft). So the flow jumps from 0 to about 380 cfs over 0.1 ft of stage. On that step, a few hundredths
of a foot of stage shift (sediment at the sensor, a moved low-flow control) reads as hundreds of cfs. The 08:45–16:20Z
Nov 2 plateau (2.64–2.72 ft, 11.2–12.3 m³/s) sits on this step and **may be a rating or stage-shift artifact**. The slow
tail is the same kind of reading: 2.55 ft and 190 cfs at 06Z Nov 3, against 2.30 ft and 0 cfs on Nov 8.

**The 817 cfs claim: the value is confirmed; which report the owner saw is uncertain.** 817 cfs (3.37 ft) appears
twice: at 02:45Z Nov 2 (19:45 MST, on the falling limb of the third and smallest peak) and at 23:55Z Nov 1 (16:55 MST,
on the first recession). The 03:00Z Nov 2 report is 776 cfs (21.97 m³/s). No single corrected time is given. The
model is compared with the primary series at each hour instead; at 03Z that is 21.97 m³/s. Neither 817 cfs report is
the event peak, which was 2,286 cfs at 18:20Z.
The owner's "1,160 cfs at Three Points" is exactly USGS 09487000 at 02:00Z (19:00 MST).

## Against the v2x model and NWM

| | Observed | v2x model | NWM analysis |
|---|---|---|---|
| Inlet (USGS 09487000) | front 21:15Z, peak 1,740 cfs (49.3 m³/s) at 21:30Z, ≥1,300 cfs until 01:45Z | forcing: 48.42 at 22Z (top of hour) | 15876941: 46.8 at 23Z |
| Mile Wide, peak | **18:20Z Nov 1**, 64.7 m³/s (rain) | **09Z Nov 2**: Black Wash band 40.66, both bands 47.54 | 15876811: 39.13 at 02Z. 15876815: 0.33 |
| Mile Wide, post-rain pulse | 02:10Z Nov 2, 25.7 m³/s (no rain at any gauge from about 21:30Z to 07:06Z) | 5.66 at 02Z (both bands 8.65) | 15876811: 39.13 at 02Z |
| Mile Wide at 09Z Nov 2 | 430 cfs = 12.2 m³/s, flat | 40.66 / 47.54, its window maximum | — (analysis ends 07Z) |
| Manville, Tucker, outlet | **no sensor** | 11Z, 13Z, 14Z | 15876711: 37.77 at 03Z |

- **Volume** (trapezoid; the observed figure is linear across report gaps, which is an assumption):

  | Observed at 6443 | m³ |
  |---|---|
  | 18Z Nov 1 – 18Z Nov 2 | 1,782,749 |
  | the same, leaving out the 08:45–16:20Z plateau | 1,454,356 |
  | 16Z Nov 1 – 18Z Nov 2 (from before the first rise) | 1,884,452 |
  | the same, leaving out the plateau | 1,556,059 |

  - The plateau carries 328,393 m³. Leaving it out is a bracket, not a measurement: if it is an artifact, the true
    flow then is unknown, not zero.
  - The v2x model, 18Z–18Z, carries 1,575,913 m³ on the Black Wash band and 1,856,320 m³ across both bands: 0.88× /
    1.04× of the 18Z–18Z observed total, and 1.08× / 1.28× of it without the plateau. The model's flow is in the wrong
    hours (see the verdict), so a similar total does not mean the model is right.
- **Stage rise.** Observed stage peaks 0.78 m above the 2.30 ft base reading; at 09Z Nov 2 (the 09:00 report, the
  last before 09:15Z) it is 0.12 m above it.
  The model gauge-cell zs peaks at 09:15Z, 1.97 m above the cell bed. The datums differ, so only the size of the
  rise is roughly comparable.

## Verdict

**At Mile Wide the model's slow wave is refuted by observation.**
- The gauge shows no rise at 06–10Z Nov 2 (hourly 15.8, 14.9, 13.0, 12.2, 12.3 m³/s). It falls onto a flat
  ~12 m³/s plateau while the model has its window peak
  of 40.7 m³/s (Black Wash band) to 47.5 m³/s (both bands) in that channel.
- The observed maximum came 14.7 h earlier (18:20Z Nov 1) and was driven by local rain. The frozen HRRR forcing
  misses that rain (see §12.1 of the validation doc).
- Rain fell at five of the six gauges until 20:20–21:27Z, so the second peak (21:45–22:00Z) can also be local rain.
- The only rise not driven by rain began between 00:20Z and 01:00Z and peaked at 02:10Z Nov 2 (the last rain tip anywhere was 21:27Z). The peak is 4.7 h after the inlet peak, the same hour as
  NWM's 15876811 peak, and 7 h before the model's. That this pulse is inlet water is an inference: it could also be
  delayed Black Wash runoff.

**Manville, Tucker and the outlet: not testable.** No sensor exists there, and the Santa Cruz gauges at Trico are
upstream of the Brawley confluence.

The pending v2r all-observed-rain sensitivity case (commit 8b1d2f0) can be judged against the same 6443 series.
