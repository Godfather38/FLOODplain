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
