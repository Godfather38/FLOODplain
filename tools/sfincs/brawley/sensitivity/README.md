# brawley-avra-west roughness sensitivity (v2n) — SENSITIVITY ONLY

This is a sensitivity test, not a calibration. Nothing in it is tuned to match an observation, and it is not for
live registration.

**Hypothesis being tested (not fitted).** In the observed-inflow runs the Brawley wave moves at about 1.7 km/h.
The idea is that this is slow because the sand-bed channel gets floodplain-shrub Manning n.

**How roughness is set now.** `tools/sfincs/prepare_route_case_parameters.py` maps WorldCover 2021 (`lulc.tif`, 10 m)
through `esa_worldcover_mapping.csv`:
- shrubland (20): 0.05
- bare (60): 0.023
- cropland (40): 0.037
- tree (10): 0.12
- built (50): 0.1

The official quadtree builder then samples these values linearly onto the subgrid pixels. Sampled every 100 m along
the order ≥ 3 NHD lines inside domain v2 (837 points):
- Mainstem (order 5): 244 shrub, 84 bare, 7 other; mean n 0.043.
- Order 3: 387 of 456 points are shrub; mean n 0.049.

## Scripts

- `prepare_parameters_channel_n.py`: a copy of `prepare_route_case_parameters.py`. The only change is Manning n inside
  a channel mask, set to 0.030 (Chow 1959 Table 5-6 A-1a normal value; the docstring cites the sources and explains
  the choice). The terrain and builder settings are the same, and so are the WorldCover n values outside the mask and
  the infiltration. The script writes `channel-mask.geojson`, `channel-sections.csv` and `channel-report.json`.
  `--mask-only` writes only those three files and skips the subgrid build. `--centerline nhd` gives the literal
  NHD-buffer mask.
- `compare_subgrid_n.py`: compares a variant subgrid table with its baseline. It checks that every elevation and volume
  table is bit-identical, then reports `uv_navg` inside and outside the mask.
- `labels-v2n-observed-inflow.json`: the v2x labels, with `sensitivityVariant: true`, a `roughnessSensitivity` block
  and its own caseId.

## Channel width and centreline

Widths were **measured**, not fixed. Cross-sections at 100 m intervals on the 1 m lidar windows: 9 m running median,
thalweg in the middle half of the section, incision D = section median − thalweg. Where D ≥ 0.3 m, the width is the
contiguous run below thalweg + D/2. Domain v2 has 839 sections over 83.5 km (order 3: 45.5 km, order 4: 4.6 km,
order 5: 33.5 km):

| Section outcome | Count |
|---|---|
| Measured | 341 |
| No lidar (order 3/4 outside the windows) | 315 |
| No incision | 128 |
| Unbounded | 55 |

| Measured width | Median | p10–p90 |
|---|---|---|
| Order 3 | 10 m | 6–32 m |
| Order 4 | 25 m | 7–36 m |
| Order 5 | 14 m | 5–126 m |

Sections without a measured width take the reach median (388 sections) or the order median (110). No section fell
back to the fixed width.

**The NHD line is often off the lidar channel.** At 297 of 341 measured sections (87%), the lidar channel centre lies
outside the NHD line buffered by half the measured width (|offset| median 36 m, p90 173 m). For that reason the
default `--centerline lidar` centres each 100 m rectangle on the measured channel where one was measured. The burned
area is 2.56 km² (polygons 2.10 km², plus centreline pixels burned with all-touched). Of the 25,582 pixels changed,
20,684 were shrub. 85.7% of mask pixels are lowered and 14.3% raised (bare 0.023 → 0.030). Mean n before: 0.047.

**Limits.**
- n is a 10 m raster, so the effective minimum channel width is one 10 m pixel.
- Edge pixels blend linearly.
- 100 m cells average n across the whole cell face.

## Validation done (tiny clipped mesh, foreground)

Test domain: a 2 km × 2 km box on the Brawley mainstem (475200–477200 E, 3565800–3567800 N), with one 12.5/6.25 m
zone. 3,208 cells, in `.sfincs-runs/brawley-avra-west-test-v2n/`. Baseline and variant ran for 33 s and 30 s.

- `z_zmin`, `z_zmax`, `z_volmax`, `z_level`, `uv_zmin`, `uv_zmax` and `uv_pwet`: identical.
- `infiltration.nc`: byte-identical.
- `uv_navg` inside the mask: 0.0494 → 0.0376 (190 uv points).
- `uv_navg` outside the mask: 0.04136 → 0.04124. 351 of 6,282 uv points changed, by at most 0.016, from edge blending.

## Commands (cwd `E:\FloodPLAIN\wt-model`, Git Bash)

```bash
export NUMBA_CACHE_DIR=$PWD/.sfincs-runs/numba-cache; PY=/h/AI/Projects/FloodPLAIN-sfincs/.venv/Scripts/python.exe
C=tools/sfincs/data/brawley-avra-west-v2/components
# 1. full v2 parameters (~95 min, like v2's 5,762 s) -- background
$PY -u tools/sfincs/brawley/sensitivity/prepare_parameters_channel_n.py \
  --mesh .sfincs-runs/brawley-avra-west-mesh-v2/active-refinement-mesh.nc --context .sfincs-runs/brawley-avra-west-context-v2 \
  --extra-fine .sfincs-runs/brawley-avra-west-terrain-1m-v1 --extra-fine .sfincs-runs/brawley-avra-west-terrain-1m-v2 \
  --network $C/brawley-avra-west-network.geojson --domain .sfincs-runs/brawley-avra-west-mesh-v2/active-domain.geojson \
  --output .sfincs-runs/brawley-avra-west-parameters-v2n > .sfincs-runs/brawley-avra-west-parameters-v2n.log 2>&1
# 2. prove only roughness changed (z tables identical => boundaries-v2 stays valid; it reads only z_zmin)
$PY tools/sfincs/brawley/sensitivity/compare_subgrid_n.py --mesh .sfincs-runs/brawley-avra-west-mesh-v2/active-refinement-mesh.nc \
  --baseline .sfincs-runs/brawley-avra-west-parameters-v2 --variant .sfincs-runs/brawley-avra-west-parameters-v2n \
  --output .sfincs-runs/brawley-avra-west-parameters-v2n/compare-vs-v2.json
# 3. stage / finish / package with the SAME 74 h window as v2x
$PY -u tools/sfincs/brawley/extend/stage_route_case_native_window.py --boundaries .sfincs-runs/brawley-avra-west-boundaries-v2 \
  --parameters .sfincs-runs/brawley-avra-west-parameters-v2n --inflow tools/sfincs/data/brawley-avra-west-v2/extended/brawley-avra-west-inflow-observed-v2x.json \
  --hours 74 --note 'SENSITIVITY v2n: channel n 0.030; same window/inflow/rain as v2x' --output .sfincs-runs/brawley-avra-west-case-v2n-observed
$PY -u tools/sfincs/brawley/extend/finish_route_case_window.py --case .sfincs-runs/brawley-avra-west-case-v2n-observed \
  --rainfall .sfincs-runs/brawley-avra-west-rainfall-v2 --extension .sfincs-runs/brawley-avra-west-rainfall-v2x/observed-extension-precipitation.nc \
  --hours 74 --domain $C/active-domain.geojson
$PY -u tools/sfincs/package_route_case.py .sfincs-runs/brawley-avra-west-case-v2n-observed \
  tools/sfincs/data/all-route-ready-v3/brawley-avra-west-native-case-v2n-observed-inflow --labels tools/sfincs/brawley/sensitivity/labels-v2n-observed-inflow.json
```

**Compare against.** The v2x observed run (same window) is the baseline. Report wave-front arrival at Mile Wide,
Manville, Tucker and the outlet, and the outlet hydrograph. Compare zs with road height. Report the result as a
sensitivity, whichever way it goes.
