# brawley-avra-west build status, 2026-11-08T22:40Z

Case `brawley-avra-west`, modelVersion `all-routes-brawley-avra-west-v1`.

The case is **not live and not yet solved**. All inputs are built and checked. The subgrid parameter
step died partway, so no solver run exists. Nothing has been merged, deployed or published, and no
workflow has been dispatched.

Validation detail is in `docs/upgrade/VALIDATION-BRAWLEY-20261108.md`; §10 there is the reviewer's addendum.

## Branches and commits

| Branch | Base | Commits | Pushed | CI |
|---|---|---|---|---|
| `experimental/brawley-avra-west-20261108` (model, wt-model) | `origin/experiment/all-route-models` @97f9291, which is still its tip, so this fast-forwards | 8e1dfdc live tooling; f758883 prep inputs; plus this review commit (docs only) | yes, by the review step | pages run on push (deploy is gated to the default branch) |
| `experimental/brawley-live-sfincs-20261108` (wt-ls) | `origin/experiment/live-sfincs` @b7fd3f0 | cc8a21a refresh planner knows the case | yes | 42528148409: test success, deploy skipped |
| `experimental/brawley-app-20261108` (wt-app) | `origin/experimental/model-upgrade-diagnostics-20261107` @27b2500, **not** ccr/main | 7cb8639 map-only local roads | yes | 42528566512: test, browser success; deploy skipped |

Merge checks (verified with `git merge-tree`, nothing written):
- The model branch merges clean into `experiment/all-route-models`.
- The LS branch merges clean into `experiment/live-sfincs`.
- 7cb8639 alone cherry-picks clean onto `ccr-ae06b197-a01a6o`.
- **Merging the app branch as a whole would also bring 5 diagnostics/alert commits** (d152016, fbc5995, cbfff13, 201fe07, 27b2500), including worker alert behaviour changes. Cherry-pick 7cb8639 unless the owner wants those too.

## Publish safety (verified by reading every workflow on all three branches)

- Push triggers that publish anything: `live-all-route.yml` fires only on `claude/all-route-expansion-78d5d4`, `experiment/live-sfincs` and `experiment/all-route-models`. `live-sfincs.yml` fires only on `experiment/live-sfincs`. `deploy-service.yml` fires only on main (on the app branch, main and ccr).
- Schedules (alert-snapshot, notify, service-check) run only on the default branch (ccr-ae06b197-a01a6o).
- `pages.yml` runs on every push. Its deploy job requires the default branch or a manual dispatch.
- `live-all-route.yml` on the model branch: `publish_live_model.sh` is called only in the step gated `if: github.ref_name == 'experiment/all-route-models'`, and the shell re-tests the same condition. Every other ref uploads the artifact `live-<case>-unpublished-output`.
- `sfincs.yml` is dispatch-only and does not push.
- `tools/live/all-route-cases.json` is unchanged from 97f9291 on the model branch, both committed and in the working tree. So the three existing cases are untouched.
- Residual risk: a **manual dispatch** of alert-snapshot, live-sfincs, pages or deploy-service on any ref can push or deploy. Never dispatch those on experimental refs.

## Tests (reviewer re-runs)

- model `tools/live`: 114 OK, 20.4 s.
- model `tools/sfincs`: 14 OK, 2.9 s.
- LS `tools/live`: 87 OK, 17.2 s.
- app `npm test`: 450/450 pass, 2.8 s.
- app browser e2e: passing in CI run 42528566512, not re-run locally.

## Measured runtimes (from agent logs and reports)

| Step | Runtime |
|---|---|
| NHD fetch | 10.7 s |
| components | about 3 s |
| mesh | 120 s → 408,207 active cells |
| 1 m terrain | 26.7 s (162 new windows, 10 reused) |
| 10 m context | 6 min 18 s |
| rain | 19.4 s |
| NWM history / forecast / validation | 33 / 16 / 57 s |
| station file | 2.6 s |
| validate_prerun | 2.8 s |
| subgrid parameters | **died** at level 2 of 5 after about 8 min (log 22:1xZ → 22:19:56Z). Expected 15–25 min (Gates: 915–932 s for 384k cells; inference) |
| local export (surrogate) | 1.4 s, 7.16 MB |

## Coverage

- Domain is 839.02 km², of which 699.59 km² is outside all live domains; Gates overlap 139.42 km².
- Priority-road stations (14,633):
  - live models: 40.4%
  - new case only: 24.1%
  - **no model: 35.6%**
  - AC1 target of 95% is **FAIL**
- Uncovered priority roads: Avra Valley Rd west, Anway, Agua Dulce Ranch (all of it), most of Cocorague Ranch, Tucker, and Manville west.
- Owned stations: 31,680.
  - Cell sizes: 100 m 54.5%, 50 m 13.6%, 25 m 6.4%, 12.5 m 13.1%, 6.25 m 12.3%.
  - 8 have no height and 28 have no cell; these are kept as such.
- CSV dips (366):
  - The 48 owned dips and all 139 L4 points are at 6.25 m.
  - **102 dips are in no model**, 27 of them at least 1 m deep.
  - **149 dips sit in 100 m cells of existing live cases**, and refining them is **not done**.
  - 73 dips in the Gates overlap stay at Gates resolution.
- Inflow, NWM variant: peak 1.70 m³/s against 49.27 m³/s observed (ratio 0.035). V1 **FAIL**, so this variant's live output is map-only and unvalidated for convective events.

## What remains, in order (none of this is done)

1. Restart `prepare_route_case_parameters.py` into `.sfincs-runs/brawley-avra-west-parameters-v1b`, in a session that stays alive for at least 30 min. Use the same command as before, with `--extra-fine .sfincs-runs/brawley-avra-west-terrain-1m-v1`.
2. Run `prepare_route_case_boundaries.py`, then check for a second outflow at 15902533.
3. Run stage ×2 (NWM and observed), finish ×2 with the rainfall package and the official `active-domain.geojson`, and confirm that only `sfincs.dis` differs. Then package ×2 with `tools/sfincs/brawley/labels-*.json`.
4. Commit and push the model branch. Dispatch `sfincs.yml` ×2 on `experimental/brawley-avra-west-20261108` with engine_run_id 42528021117 (artifact expires 2027-02-06), cap 5400.
5. Result handling: download, run `tools/sfincs/brawley/inspect_route_result.py`, then `package_route_result.py` and `finalize_route_result.py`.
   - The inspect copy accepts `routeIds == []`. It is uncommitted, has CRLF line endings and is untested on a real result.
6. Validate:
   - mass balance
   - outflow against 37.77 m³/s at 03Z Nov 2
   - the three Mile Wide cells
   - §5 tables from `export_road_forecast.py local` → `sample-local-road-forecast.json`
   - run the app parser on that real sample
7. Add the `localRoads` entry with `verify_all_route_inlets.py` (registry diff: the three existing entries must stay byte-identical). Commit.
8. Dispatch `live-all-route.yml -f cases=brawley-avra-west` **on the experimental ref only**. The publish step is skipped there, and the artifact holds the output for checking.

## Exact merge steps to go live (owner only; after step 8 passes and owner review, AC8)

The order matters.
1. Merge `experimental/brawley-live-sfincs-20261108` → `experiment/live-sfincs`.
   - It must go first. Once the case is registered, a coordinator that does not know it fails with an error and stops **all** high-res dispatch.
2. Merge (fast-forward) `experimental/brawley-avra-west-20261108` → `experiment/all-route-models`, including the registration commit.
   - From then on, live-all-route on that ref publishes `all-route/brawley-avra-west/{compact/, local-road-forecast.json}` to live-model.
3. Cherry-pick 7cb8639 onto `ccr-ae06b197-a01a6o` (the default branch) or main, as the owner usually does, after fixing app defects 1–2 below.
   - Pages deploys from the default branch.
   - deploy-service is not triggered: no file in its paths changes.

## Owner decisions needed

1. **Domain extension.** Should the Northern-draining subtrees (to 15876639/15876633), plus 15876671 and 15876805, be added so that Avra Valley Rd west, Anway, Agua Dulce, Cocorague and Tucker are covered? Without that, AC1 fails at 35.6% uncovered.
   - Extending means a v2 domain with components, mesh, terrain, context, rain and stations rebuilt, at roughly +3–5 h compute (inference).
   - It would also overlap Northern, which keeps its NWM inlets.
2. **Accept the NWM-forced live variant as map-only.** It cannot represent the Nov 1 event (V1 FAIL). The observed-inflow variant is for validation only.
3. **Local file size.** 7.2 MB, fetched every 2 min. Publish over/below stations only, or accept the size.
4. **Refining the 149 live-case dips in 100 m cells** (Gates, Northern, Picture Rocks). This is separate work on the existing cases and is not done.
5. **ALERT 6443 mapping.** The site is 4.8 m from 15876815 (Black Wash), not on the Brawley mainstem. Which reach should V2 use?

## Defects found in review (listed, not fixed: code)

1. App ignores the exporter's `unknown` state; those stations are dropped as unreadable.
2. App ignores top-level `status: partial`.
3. Exporter rounding: water less than 0.5 mm over the road gives `over` with `maxOver` 0.0, which the app drops.
4. 8 committed brawley files have CRLF line endings (labels json, prepare_context.py, rain scripts and README). This is cosmetic.

## Revised ETA (inference)

| Path | Time |
|---|---|
| Restart to frozen results for both variants | about 2.5–3.5 h of wall time (parameters 0.5 h, boundaries/stage/finish/package 0.5 h, solver ≤ 1.5 h in parallel, result packaging 0.5 h) |
| Validation and the experimental live cycle | +1–1.5 h |
| Ready for owner review, current domain (from a restart tonight MST) | about 5 h → early Nov 9 MST |
| Live, current domain | Nov 9 after owner review and the merges above, plus the small app fixes |
| Domain extension | about +1 day → Nov 10, still inside the 2-day window only if decided by the morning of Nov 9 |
