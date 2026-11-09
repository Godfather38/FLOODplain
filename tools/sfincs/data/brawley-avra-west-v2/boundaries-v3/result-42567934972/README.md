# Native route result 42567934972: v3x (v3 boundaries), validation only

Case `../../../all-route-ready-v3/brawley-avra-west-native-case-v3x-observed-inflow` (`validationVariant: true`, not for live registration).
It is the v2x case (run 42544624673) with one change: the boundary mask. Mesh v2, parameters v2, observed inflow, rain
and the 74 h window (2026-10-30T16Z to 2026-11-02T18Z) are byte-identical to v2x; in `sfincs.nc` only `mask` differs
(45 cells 1 -> 3, 92 outflow cells in all). Boundaries: `../placement-report.json`.

**Solver.** GitHub Actions run 42567934972 (sfincs.yml, ref experimental/brawley-avra-west-20261108, commit ebfc4828,
engine run 42528021117, cap 7200 s). "Simulation finished", total time 5,593.1 s.

**Files here.**
- `summary.json`: `tools/sfincs/brawley/extend/score_v3x.py` output, v3x against v2x: outflow by boundary source
  (each its own series), the outlet pond and lobe storage, sections, ALERT 6443 against the primary county series,
  mass balance, negative depth, velocity proxies, road over-topping changes, road stations that now sit in outflow cells.
- `validation-full.json`: `validate_extended.py` on the v3x run (`--baseline` v2 NWM 42543054067, `--compare` v2x).
- `v2x-validation-full-same-script.json`: the same script (same version) on the v2x run, so both sides of the comparison use one script.

**Not committed.** Artifact `sfincs-verification`, 927,329,856 bytes on disk after download, retention 7 days.
`sfincs_map.nc` sha256 905f8d0a8731119d….

Reproduce (cwd = repo root):

    gh run download 42567934972 -n sfincs-verification -D .sfincs-runs/brawley-avra-west-result-v3x-42567934972/artifact
    python -I tools/sfincs/brawley/extend/validate_extended.py --wt . --run .sfincs-runs/brawley-avra-west-result-v3x-42567934972/artifact/runs/current \
      --compare .sfincs-runs/brawley-avra-west-result-v2x-42544624673/artifact/runs/current \
      --baseline .sfincs-runs/brawley-avra-west-baseline-v2x-nwm42543054067/artifact/runs/current --output validation-full.json
    python -I tools/sfincs/brawley/extend/validate_extended.py --wt . --run .sfincs-runs/brawley-avra-west-result-v2x-42544624673/artifact/runs/current \
      --baseline .sfincs-runs/brawley-avra-west-baseline-v2x-nwm42543054067/artifact/runs/current --output v2x-validation-full-same-script.json
    python -I tools/sfincs/brawley/extend/score_v3x.py --wt . --v3 .sfincs-runs/brawley-avra-west-result-v3x-42567934972/artifact/runs/current \
      --v2x .sfincs-runs/brawley-avra-west-result-v2x-42544624673/artifact/runs/current --v3-validation validation-full.json \
      --v2x-validation v2x-validation-full-same-script.json --output summary.json

Outflow is from the hourly restarts (instantaneous flux snapshots, trapezoid from 18Z Nov 1); there is no his file.
Road comparisons use cell zs against station roadZ in wet frames only (vol/area >= 0.0091 m); frames that are not wet
are never counted as dry evidence. Depth at the pond is zs minus the cell's lowest sub-pixel (z_zmin), not a mean depth.

## Corrections and caveats (round-7 checker, 2026-11-09)

Docs only; nothing was re-run on the solver. Numbers re-derived from the hourly restarts with
`tools/sfincs/brawley/diagnose/outflow_roads.py` (`--outlets .sfincs-runs/brawley-avra-west-boundaries-v3/outlets.geojson`)
and the per-face fluxes of the 47 v2 outflow cells in both runs.

- **The lobe outflow is not purely head-driven.** Every msk 3 link gets SFINCS's boundary flux, which is
  the head-driven part plus the `uvmean` memory term (`docs/upgrade/BRAWLEY-STABILITY-20261109.md` §1.3).
  - At the lobe tip's 15Z peak the stored flux is 39.49 m³/s; the head-driven part,
    Σ sqrt(g·huv)·(zs_inside − z_zmin)·width, is 13.83 m³/s (2.9×).
  - Over 18Z–18Z the stored series gives 1,108,288 m³; the head-driven part alone gives 676,188 m³.
    In snapshots where the head-driven part is above 0.5 m³/s, the stored flux is 0–4.8× it.
  - So 39.5 m³/s and 1.11M m³ are what the boundary formula drew, not a physical outfall rate.
  - The lobe's storage did fall by about the same amount (1.17M m³ less than v2x at 18Z), so the water did
    leave. How fast it would leave through a real outfall is not known.
- **The 47 v2 outflow cells pass 101,169 m³ less in v3x** (1,904,422 against 2,005,591 m³, 18Z–18Z). **This is
  not explained.**
  - Most of the drop is at six faces: 36344 (−47,892 m³; 0 in v3x), 37645 (−27,197), 34353 (−21,564; 0 in
    v3x), 37960 (−19,547), 37001 (−13,400) and 35022 (−10,350), 139,950 m³ in all. It is partly offset by
    gains, mainly at 37011 (+42,886).
  - 36344 and 37011 are 382 m and 601 m from the new OSM 1489567547 cells. 34353 and 35022 are 762 m and
    707 m from the new OSM 1489567542 cells. Water taken upstream by the new outfalls would fit there, but it
    was not traced.
  - 37645 and 37960 are 4.0–4.2 km from any new outflow cell. Their hourly flux agrees between the runs within
    0.02 m³/s up to 16Z and differs in the 17–18Z snapshots. 37645 is 5.02 and 5.04 m³/s in v2x, against 0 and
    0 in v3x; 37960 is 10.72 and 8.47 against 6.45 and 6.19. 37001 is 2.25 km away and differs at 12Z and 17Z
    (1.86 m³/s in v2x, 0 in v3x).
  - At these cells the hourly flux switches between 0 and a few m³/s from one snapshot to the next
    (drain and clamp, STABILITY §1.2). One 5 m³/s snapshot adds 18,000 m³ to a trapezoid total, so the
    sampling error of these volumes is of the same size as the drop. The cause is left open.
- **No sheet depth is claimed.** An earlier text (VALIDATION §16.2) said water leaves the lobe tip "as a
  sheet 1–5 cm deep". That figure was zs − z_zmin (water surface above the cell's lowest sub-pixel). That is
  not the flow depth, and it was withdrawn.
  - What can be said: on every new outflow link that difference stays below 0.1 m, so the validate_extended
    velocity proxy (depth > 0.1 m) is not evaluated there.
  - The largest unit flux on a new link is 0.254 m²/s (lobe tip, 15Z).
  - The 16.9 m/s (lobe) and 33–35 m/s (v2 outlet) "shallow proxy" values divide by the same zs − z_zmin. They
    are not speeds.
- **Placement report wording** (`../placement-report.json`, rebuilt by `tools/sfincs/brawley/boundaries_v3_report.py`):
  - "500m corridor" is the build's label for a 250 m buffer radius around each outflow point
    (`prepare_route_case_boundaries.py:49`, `buffer(250)`), i.e. a circle up to 500 m across. The report now
    says so; the build's own text is kept as `methodAsRecordedByBuild`.
  - The edge-audit cluster counts (cluster 0: 3, cluster 4: 30, cluster 25: 3 new outflow cells) count only
    cluster faces, i.e. cells with an edge side where the ground keeps falling outward. The sources have 5, 35
    and 5 new cells. The others (for example 32957 and 33299 for OSM 1489567542) were marked by the same 250 m
    buffer, but their edge sides do not keep falling. Each cluster now lists them (`newCellsBySourceInCluster`).
  - `nativeMeshSha256` changes from 328042f0… (v2x) to 9e2f1498… (v3x) because it is the sha256 of
    `sfincs.nc`, and `sfincs.nc` holds the mask. Every other variable in it is identical (45 mask cells
    1 → 3); the mesh geometry did not change. Both hashes are now in the placement report.
