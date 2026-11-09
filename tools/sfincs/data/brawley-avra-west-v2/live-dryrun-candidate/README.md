# Brawley-avra-west live-runner dry run: cnb + btfilter -1 (SENSITIVITY, not published)

SENSITIVITY only. Not for live registration. Nothing from these runs was published to `live-model`, `data`, `main` or Pages. The registered `tools/live/all-route-cases.json` is unchanged.

## What was run

| | cna (registered v2 live case) | cnb + btfilter -1 (dry-run case) |
|---|---|---|
| GitHub run | 42641933723 | 42642579287 |
| Branch / commit | experimental/brawley-avra-west-20261108 @ adabfd05 | same branch @ a2511cb8 (only change since adabfd05 in `.github`/`tools/live`: a 3-line test fixture fix) |
| Case archive (sha256) | 0dc4514f…7a5b (`all-route-ready-v3/brawley-avra-west-native-case-v2`) | aac61faa…f8ca (`live-dryrun-candidate/case`) |
| HRRR cycle | 2026-11-09T13:00Z (newest when dispatched) | 2026-11-09T13:00Z (passed explicitly) |
| Model window | cold start 2026-11-07T16Z to 2026-11-10T07Z; maps 10Z Nov 9 to 07Z Nov 10 | same |
| Inlet 15876941 | USGS 09487000 for all 46 past hours (provisional), NWM (NODD) forecast | same |
| Prepare | 116 s | 49 s |
| **Solver wall time** | **843 s** (15.6% of the 5,400 s cap) | **1,382 s** (25.6% of the 5,400 s cap) |
| SFINCS status | finished, status 0 | finished, status 0 |
| Average time step | 1.578 s | 1.578 s |
| Time in infiltration | 50.2 s (6.0%) | 163.5 s (11.8%) |
| Live verifier | passed: 43 half-hour frames, 643,056 cells, 0 negative native samples, minimum area-equivalent depth 0 m (limit -0.001 m, the -1 mm rule) | passed: same counts, 0 negative native samples, minimum 0 m |
| Local road forecast (58,140 stations) | over 0, below 0, dry 57,465, no road height 571, no cell 104, unknown 0 | identical |
| Publish to live-model step | skipped | skipped |
| Result kept as | workflow artifact `live-brawley-avra-west-unpublished-output` (7 days) | same |

The same step count with 1.64 times the wall time means each step cost more in the cnb run. cnb accounts for 113 s of the 539 s difference (infiltration time). The other ~426 s were not separated: they could come from runner hardware variation, since GitHub-hosted runners are not identical, or from the solver itself. The earlier v2 cna cycle (run 42550902383) took 849 s, close to this cna run.

## Output comparison (cnb+btf minus cna, same cycle)

The cycle was dry: the HRRR check found 0.0 mm/h as the largest one-hour forecast rain over the domain, and the USGS inlet gauge carried the past hours. Map water stays near the inlet. It grows from 0 m3 at 10Z to about 6,900 m3 at 07Z Nov 10 in both runs, with 761 (cna) and 759 (cnb) cells holding water at the last frame. Largest water-surface (zs) difference at any frame and any cell where both runs have a zs: -0.023 m (cnb lower), and the largest positive difference is +0.00006 m. At most 2 cells in any frame differ by more than 1 cm. The two runs agree within noise, and **this cycle cannot tell the configurations apart**. It shows only that the cnb+btf case runs in the live runner, passes the live verifier and fits the cap. The comparison data is in `compare-20261109T13z.json`, made by `tools/sfincs/brawley/live_dryrun/compare_live_dryrun.py`. It sums only cells known in both runs and counts every cell with an unknown value; nothing is filled with zero.

## The dry-run case

- Base: the registered v2 live case (`brawley-avra-west-native-case-v2`), unpacked from its hash-checked parts. The mesh `sfincs.nc` (sha256 328042f0…6767), `sfincs_subgrid.nc`, `precip_2d.nc`, `sfincs.dis` and `sfincs.src` are byte-identical. The live runner replaces the forcing values and time keys anyway.
- Change 1, `make_variant.py --infiltration-file … --inftype cnb`: infiltration.nc built by `tools/sfincs/brawley/variants/build_cnb_infiltration.py` on the unpacked v2 live case.
  - smax: GCN10 `scs` × 0.0254.
  - ks: POLARIS v1.0 ksat mean 0-5 cm (Chaney et al. 2019, doi:10.1029/2018WR022797), face-area mean, 360 mm/h cap, 0 faces capped, no fill.
  - seff = smax. The smax, seff and ks values are identical to candidate v3l-obsrain-cnb-btf (run 42622454115).
  - Only the seff `source` attribute was rewritten, for the live cold start. The seff values are unchanged.
- Cold-start seff: the live runner starts cold at HRRR cycle − 45 h (`SPIN`) and observes no soil moisture. seff = smax is the same dry-soil assumption the registered cna live case makes (full S at tstart). Antecedent wetness is unknown, and it is not estimated.
- Change 2, `make_variant.py --inp-set btfilter=-1`: the same physical change as v3l-obsrain-btf / cnb-btf. It turns off the SFINCS uvmean boundary memory term at msk 3 outflow links.
- `sfincs.inp` differs from the v2 live case only on the `btfilter` (60.0 → -1) and `inftype` (cna → cnb) lines.
- Not carried from the candidate: the v3l lobe-tip boundaries (5 extra outflow cells). The live runner pins the registered mesh hash, face mapping and geometry, so the dry run keeps the v2 boundaries (47 outflow cells). Also not carried: the observed-rain and observed-inflow forcing. The runner supplies HRRR rain and USGS/NWM inflow.
- Packaged with `tools/sfincs/package_route_case.py`. Labels: `tools/sfincs/brawley/variants/labels-v2-live-cnb-btf.json`. Package: `case/` (4 parts, 152,249,477 bytes).
- Registry used only for the dry run: `tools/live/dryrun/brawley-avra-west-cnb-btf-cases.json`. It is the registered brawley-avra-west entry with only `caseManifest` and `archiveSha256` changed, plus a `dryRunOnly` note. The case name, mesh hash, face mapping, geometry and local road stations are unchanged.

## How the earlier no-publish run worked (run 42550902383)

- workflow_dispatch of `live-all-route.yml` on `experimental/brawley-avra-west-20261108`, with `cases=brawley-avra-west`, 849 s solver time.
- Its jobs were `request`, `check` and `run`. In `run`, the step "Publish to live-model" was **skipped** and "Keep the unpublished result (not the live model branch)" uploaded an artifact.
- No input made this happen. The guarantee comes from the ref the workflow ran on (below).

## Why these runs could not publish (checked in the workflow at adabfd05 and a2511cb8 before dispatch)

1. **The only write to a branch** in `live-all-route.yml` and in all of `tools/live/` is `tools/live/publish_live_model.sh`. It pushes only `HEAD:live-model`. `git grep "git push"` finds it there and nowhere else outside tests. The workflow itself contains no `git push`, and `test_publisher_is_called_only_by_the_gated_step` checks this.
2. That script is called only by the step "Publish to live-model", which has `if: github.ref_name == 'experiment/all-route-models'`. Its first command is `test "$GITHUB_REF_NAME" = experiment/all-route-models`, so it fails even if the condition were bypassed.
3. Both runs were dispatched with `--ref experimental/brawley-avra-west-20261108`, so `github.ref_name` is that branch. The step was skipped in both runs, as the run records show.
4. Nothing else writes:
   - `request` (validate_highres_run_request.py) makes only read-only `gh api` GET calls.
   - `check` downloads HRRR data and uploads the `rain-check` artifact.
   - `run` makes a read-only `gh api` artifact lookup, downloads the engine artifact, fetches HRRR/NWM/USGS data, and uploads artifacts.
   - No step touches `main`, `data`, `ccr-*` or a Pages deployment. `pages.yml` deploys only from the default branch, and none of these runs pushes anything.
5. The `push:` trigger of `live-all-route.yml` lists only `claude/all-route-expansion-78d5d4`, `experiment/live-sfincs` and `experiment/all-route-models`. Committing to this branch does not start a run.
6. The new `cases_registry` input exists only on this branch. It must name `tools/live/dryrun/*.json`. The check job fails if it is set on `experiment/all-route-models`, which also stops `run`.

## Runner changes on this branch only

- `tools/live/run_live_all_route.py`: `CASES` = `$LIVE_ALL_ROUTE_CASES` if set, otherwise `all-route-cases.json`.
- `.github/workflows/live-all-route.yml`:
  - new input `cases_registry` (default empty);
  - workflow-level `env LIVE_ALL_ROUTE_CASES`;
  - a check-job step that refuses the input on the live branch and outside `tools/live/dryrun/`;
  - the two inline registry reads use the same variable.
- `tools/live/test_all_route_package.py`: the workflow harness drops `LIVE_ALL_ROUTE_CASES` from its fixture env. The first cnb dispatch, run 42642259673, failed its regression step on this: the check job failed, the solver never ran and nothing was published.
- With the input empty, behaviour is unchanged.
- No other branch was changed, and the live registration on `experiment/all-route-models` (northern, picture-rocks, gates) is untouched.

## Reproduce

```
GH_REPO=Godfather38/FLOODplain gh workflow run live-all-route.yml --ref experimental/brawley-avra-west-20261108 \
  -f cases=brawley-avra-west -f cycle=2026-11-09T13:00:00Z -f solver_cap_seconds=5400 \
  [-f cases_registry=tools/live/dryrun/brawley-avra-west-cnb-btf-cases.json]
python tools/sfincs/brawley/live_dryrun/compare_live_dryrun.py CNA/out CNB/out compare.json
```
