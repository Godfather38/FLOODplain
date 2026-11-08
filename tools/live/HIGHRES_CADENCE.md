# High-resolution model refresh cadence

The hourly `experiment/live-sfincs` coordinator checks the newest available HRRR
rain forecast before running the independent coarse model. For each of the three
owning high-resolution cases it reads `live-model/all-route/<case>/compact/road-forecast.json`.
It dispatches only cases that need work:

- Missing, incomplete, expired, or invalid model summary.
- At least 1 mm/hour forecast rain in that case's domain on a newer HRRR cycle.
- A dry model that would expire before the next hourly check could finish a refresh.

Model summaries must use schema version 1 and `live_current_forcing`. They are
current for up to three hours after `issuedAt`, and never beyond `validTo`. To avoid a gap
caused by hourly polling, the refresh age is `180 - 60 - runtimeBudget` minutes.
The completion budgets are 65 minutes for northern, 50 for Picture Rocks, and 30
for Gates, including a margin over observed approximate 50/35/18-minute runs.
`brawley-avra-west` (experimental, west Avra Valley / Brawley Wash) has an 80-minute
budget (refresh age 40 minutes) that is not yet an observed runtime: its v2 mesh has
643,056 cells, and the measured rates of the other cases (gates 5.16, northern 6.35,
Picture Rocks 6.72 ms per cell) give about 3,300-4,300 s of solver time. The planner only considers cases that
are both in its `CASES` list and registered in `tools/live/all-route-cases.json`, so
the new case is known here before it is registered and is never dispatched until the
registry lists it. A registry case unknown to the planner fails closed.
This produces one run of each case about every two hours in dry steady state,
not three runs on every hourly poll. The same look-ahead also refreshes a forecast
whose `validTo` would end before the next check could finish a replacement. Queue delays, source outages, failures, and
runs taking longer than these budgets can still create a freshness gap; the
helper does not change summary timestamps or pretend stale data is current.

## Safeguards

- All active/queued all-route workflow runs, across branches, are inspected.
  A busy case is skipped. If a queued/check-stage workflow has not yet selected
  its cases, all cases are skipped until its matrix is known. Existing model-job
  concurrency remains the final protection against simultaneous same-case jobs.
- A complete result already using this HRRR cycle or a later cycle is skipped.
- `live-model/highres-cadence/state.json` holds only the latest attempt for each
  case. A conditional contents-API write reserves the cycle before submission,
  preventing a restart or uncertain API response from dispatching it again.
- The ledger records coordinator run ID, workflow ref, timestamp, reason and
  `reserved`, `accepted`, or `uncertain` dispatch state. `accepted` means GitHub
  accepted the dispatch, not that a solver completed. A dispatch response does
  not provide the new workflow run ID. `reserved` may include an interrupted or
  uncertain submission. A newer HRRR cycle can retry after failure.
- Missing files are recognized only on HTTP 404. API errors, rate limiting,
  malformed state and failed state reservations fail closed for dispatch.
  They do not delete model data or prevent the coarse model from continuing.
- Partial road coverage within a solver-complete summary (currently Gates) is
  not treated as an incomplete solver and does not cause a refresh loop.
- Existing jobs are not cancelled. There is no app deployment, main-branch edit,
  paid runner, new cache allowance, or billing setting change.

## Compute and limits (verified 2026-11-06)

`Godfather38/FLOODplain` is public. Its `ubuntu-24.04` model jobs use standard
GitHub-hosted Linux runners: 4 CPUs, 16 GB RAM and 14 GB SSD. Standard public
repository runner compute is free. The GitHub Free standard-runner concurrency
limit is 20 jobs; the platform execution limit is six hours per job. The existing
model job timeout is 150 minutes and its solver cap is 5,400 seconds. At most
three owning model cases run at once, each with four solver threads; the existing
coordinator is one additional runner. Other repository/account workflows also
consume concurrency, so capacity and a sub-three-hour refresh are not guaranteed.

Expected additional high-resolution work, assuming normal timings and no gaps:

- Dry day: about 12 refreshes per case, 36 model jobs/day. At 50 + 35 + 18 minutes
  of native model work per three-case refresh, about 1,236 runner-minutes/day
  (20.6 runner-hours), plus checkout, preparation, export, and check-job overhead.
- Rain on every case every cycle: at most 24 refreshes per case, 72 model jobs/day,
  about 2,472 native model runner-minutes/day (41.2 runner-hours), plus overhead.
  Busy-case protection can reduce these counts if a job lasts into the next hour.
- The already-running five-hour chained coordinator occupies a runner even while
  sleeping. This change does not add a second coordinator or change its chain.
- These are compute-resource estimates, not a charge estimate. Standard public
  runner compute remains $0. No larger runner is requested. Private-repository
  quotas must not be mistaken for this public repository's runner allowance.

This helper adds no Actions artifact upload. The existing model workflow retains
small check and log artifacts for seven days. The existing coordinator republishes
its engine artifact with 90-day retention. A read-only repository artifact listing
on 2026-11-06 showed 62 unexpired artifacts totaling 5,556,085,953 bytes (~5.17 GiB),
including 1,231,056,343 bytes (~1.15 GiB) of engine copies. This is a storage
footprint, not evidence of an account charge. Actual account storage billing was
not available. No retention or deletion change was made.

Official sources:

- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://docs.github.com/en/actions/reference/limits
- https://docs.github.com/en/billing/concepts/product-billing/github-actions

## Verification

Run from the repository root:

```
python -m unittest discover -s tools/live -p 'test_*.py' -v
python -m py_compile tools/live/refresh_highres_models.py
```

For a read-only plan using a newly generated rain check and an authenticated
GitHub CLI, omit `--dispatch`:

```
python tools/live/refresh_highres_models.py --rain-check all-route-check.json
```

The output file and log include each case's reason, age, completion budget and
selection. Passing `--dispatch` reserves and submits only selected cases to the
existing `live-all-route.yml` workflow on `experiment/all-route-models`.
