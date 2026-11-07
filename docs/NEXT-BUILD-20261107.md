# November 7 next-build integration

This experimental build starts from map repair `1bdd77dc203296d38b53a53ce22e4bc1c03438b8`.
It is not a production release. The app URL, Apps Script URL, alert topics and
hosting remain unchanged. No Cloudflare migration is part of this build.

## Included baseline

- Model water is visible on route scores and on the main map, including positive
  depths below the warning threshold. A model forecast still raises route scores.
- Road comparisons distinguish the raw water-surface elevation from a coarse
  model's capped rating depth. Missing height or water is not reported as dry.
- Current high-resolution forecasts cover the three owning model areas and all
  eight routes. The current coarse forecast is a fallback where it has coverage.
  The app and alerts use the same selection rules. Closures are never lowered by
  a dry model prediction.
- Map run changes clear old comparison data and keep the timestamp tied to the
  exact frame being compared. Repeated navigation does not duplicate markers.
- Cross-area route navigation and assessment-cache refresh fixes are included.

## Gates road-height synchronization

The live model's runner already corrected two missing Kinney Road stations,
but the app's route-height tile still contained the old missing values. This
build copies the exact corrected tile from
[`97f9291`](https://github.com/Godfather38/FLOODplain/tree/97f9291cfb93cdb01a63b68c9b34f50598beeeff/tools/live/road-stations).
The compressed SHA256 is
`dc8dcf3e5420f623444c534a005e2dbd8225f1ae890edc9baa0b956b233efe99`.

Gates now has heights at all 6,445 route stations, matching the live forecast
input. Stations 5053 and 5054 use 734.59 m and 734.49 m NAVD88, from the existing
USGS 2021 source tile omitted by the original catalog. They are lidar-derived
terrain estimates using the original five-sample recipe, not pavement surveys.
No measured or inferred road height elsewhere is changed. Unresolved bridge
openings and other model limits are unchanged.

The app keeps the upstream `source.json`, repair evidence and original pixel
window alongside its tile. Tests reproduce both heights from finite source
pixels and restore only the declared fields to match the entire original
decoded package hash. This also proves that coordinates, metadata and all other
station values are unchanged. The road-cell table and generated service bundle
were rebuilt; these two stations are outside the coarse grid, so neither changes.

## Alert-lock resilience

Integrated service repair `05bfc035` keeps diagnostic health recording from
blocking assessment, caching, scheduled texts or pushes. Health-state lock
attempts are limited to 100 ms and property writes are batched. Owner health
email is attempted after subscriber delivery and outside the shared script lock.
Exception diagnostics are bounded and scrubbed of credentials, URLs and contact
details. Recovery is recorded only after the replacement assessment is cached.

A ten-minute lease prevents concurrent owner email attempts. Completion merges
only the delivered fingerprint, preserving any newer observation or recovery.
If email was accepted but its final state cannot be saved, a later retry may
duplicate that owner email after lease expiry. Tests explicitly cover this
uncertain outcome; the service does not promise exactly-once email. Retries are
limited to five attempts per reason transition. This patch does not claim that
earlier subscriber alerts were missed, and does not send any live test messages.

## Kept separate for review

[Draft PR #13](https://github.com/Godfather38/FLOODplain/pull/13), head `3064a539`,
contains SMS provider-acceptance fixes, consent wording, public policies and
support pages. It is not included. Its wording and operational claims still
need review. A merge-tree compatibility check against `1bdd77d` found an
`index.html` conflict between the map entry change and the new policy links.
App, source/generated service and service-test mock files merge textually with
the combined build too, but that does not establish behavioral compatibility.
Resolve from source, regenerate the service and rerun both browser suites before
any later approved integration. Do not enable Twilio, resubmit registration or
send live texts as part of this build.

## Verification and release status

- Baseline: 393 unit tests passed; the generated service parses as ES2019 and
  rebuilding it produces no diff.
- Combined build: 410 unit tests passed, including the four Gates input tests
  and thirteen new alert-lock tests. The service bundle was regenerated and
  parses as ES2019. Rebuilding again produces no diff.
- Baseline browser evidence: all 15 checks passed for `1bdd77d` on GitHub runs
  [42317836938](https://github.com/Godfather38/FLOODplain/actions/runs/42317836938)
  and [42317258103](https://github.com/Godfather38/FLOODplain/actions/runs/42317258103).
- Local browser execution for this build is blocked before tests start by this
  executor's Chromium socket restriction. A prior baseline pass is not a pass
  for the final combined build. Check the experimental branch's exact-commit CI.
- Production publication remains separate. Do not treat a branch push, passing
  tests or a prepared bundle as a live deployment.
