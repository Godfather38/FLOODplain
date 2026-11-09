# Observed stream gauges, brawley-avra-west, Nov 1–2 2026

Validation data only. Not forcing, not used to tune anything. Built by `build_gauges.py` (run it from the worktree
root with the project venv and `-I`). It reads the raw downloads in `raw/` (gzipped, exact bytes as served; the
sha256 of each uncompressed file is in `gauges.json`), the committed v2x result
(`../extended/result-42544624673/`, read from git HEAD) and the NWM analysis already in the repo
(`../../brawley-avra-west-v1/nwm-validation-reaches.json`).

All times below are UTC unless marked MST. The county ALERT pages use Arizona MST (UTC−7, no daylight saving).
That was checked two ways: the newest report matches the feed time the snapshot script treats as UTC−7, and the
ALERT 6423 jump at 14:00 MST lines up with the co-located USGS 09487000 jump at 14:00–14:15 −07:00.

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
6500 Desert Museum) are included as context only. All six had their main burst at 14:45–17:05Z, a last tip by
21Z Nov 1, then **no rain until 07Z Nov 2**.

## ALERT 6443, Nov 1–2 (primary data)

- Base stage 2.30–2.31 ft (zero flow).
- First rise at 16:20Z (2.39 ft). First rated flow at 16:35Z (160 cfs).
- Three peaks:

  | Peak | UTC | MST | Stage | Flow |
  |---|---|---|---|---|
  | 1 | 18:20Z Nov 1 | 11:20 | 4.87 ft | **2,286 cfs = 64.7 m³/s** (event maximum) |
  | 2 | 21:45–22:00Z | 14:45–15:00 | 4.17 ft | 1,482 cfs = 42.0 m³/s |
  | 3 | 02:10Z Nov 2 | 19:10 | 3.50 ft | 906 cfs = 25.7 m³/s |

- After peak 3 the flow eases to 484–572 cfs (13.7–16.2 m³/s) at 04–08Z Nov 2. It then sits flat at 2.64–2.71 ft,
  397–434 cfs (11.2–12.3 m³/s), from 08:45Z to 16:20Z, and reads 387 cfs at 18Z. It is still 236 cfs (2.56 ft) at
  23Z Nov 2.
- One gap over 65 min in the task window: 16:20–18:00Z Nov 2.

**The 817 cfs claim: the value is confirmed; the time and context are corrected.** 817 cfs (3.37 ft) is the report
at **02:45Z Nov 2 (19:45 MST)**, the last one before the owner's ~20:04 MST look. The next report was 776 cfs at 03:00Z.
It sits on the falling limb of the third and smallest peak. It is not the event peak, which was 2,286 cfs at 18:20Z.
The owner's "1,160 cfs at Three Points" is exactly USGS 09487000 at 02:00Z (19:00 MST).

## Against the v2x model and NWM

| | Observed | v2x model | NWM analysis |
|---|---|---|---|
| Inlet (USGS 09487000) | front 21:15Z, peak 1,740 cfs (49.3 m³/s) at 21:30Z, ≥1,300 cfs until 01:45Z | forcing: 48.42 at 22Z (top of hour) | 15876941: 46.8 at 23Z |
| Mile Wide, peak | **18:20Z Nov 1**, 64.7 m³/s (rain) | **09Z Nov 2**: Black Wash band 40.66, both bands 47.54 | 15876811: 39.13 at 02Z. 15876815: 0.33 |
| Mile Wide, post-rain pulse | 02:10Z Nov 2, 25.7 m³/s (no rain at any gauge from 21Z to 07Z) | 5.66 at 02Z (both bands 8.65) | 15876811: 39.13 at 02Z |
| Mile Wide at 09Z Nov 2 | 430 cfs = 12.2 m³/s, flat | 40.66 / 47.54, its window maximum | — (analysis ends 07Z) |
| Manville, Tucker, outlet | **no sensor** | 11Z, 13Z, 14Z | 15876711: 37.77 at 03Z |

- **Volume.** From 18Z to 18Z, observed volume at 6443 is 1.78M m³. The model Black Wash band carries 1.58M m³ and
  both bands 1.86M m³ (trapezoid; the observed figure is linear across report gaps, which is an assumption).
  So the volume is similar, and the timing is not.
- **Stage rise.** Observed stage peaks 0.78 m above the zero-flow stage; at 09:15Z Nov 2 it is 0.12 m above it.
  The model gauge-cell zs peaks at 09:15Z, 1.97 m above the cell bed. The datums differ, so only the size of the
  rise is roughly comparable.

## Verdict

**At Mile Wide the model's slow wave is refuted by observation.**
- The gauge shows no rise at 06–10Z Nov 2 (hourly 15.8, 14.9, 13.0, 12.2, 12.3 m³/s). It falls onto a flat
  ~12 m³/s plateau while the model has its window peak
  of 40.7 m³/s (Black Wash band) to 47.5 m³/s (both bands) in that channel.
- The observed maximum came 14.7 h earlier (18:20Z Nov 1) and was driven by local rain. The frozen HRRR forcing
  misses that rain (see §12.1 of the validation doc).
- The only rise not driven by rain peaked at 02:10Z Nov 2. That is 4.7 h after the inlet peak, the same hour as
  NWM's 15876811 peak, and 7 h before the model's. That this pulse is inlet water is an inference: it could also be
  delayed Black Wash runoff.

**Manville, Tucker and the outlet: not testable.** No sensor exists there, and the Santa Cruz gauges at Trico are
upstream of the Brawley confluence.

The pending v2r all-observed-rain sensitivity case (commit 8b1d2f0) can be judged against the same 6443 series.
