# AZ511 phase 1 — isolated server adapter

Related branch: `experimental/cloudflare-az511-phase1-20261105`.
Merged `origin/main` at `6c4ff7891ee3160bce20b451948ced5d274b2f2f` into the
existing Cloudflare history (`701a6e61040cc0ee6911d201910407b8a7e835ce`).
No shared history was rewritten. No credential was obtained or configured.
The two pre-existing owner-health commits on the experimental branch remain;
their Apps Script differences from main are not deployed or newly authored here.

## Verified official contract (2026-11-05 UTC)

- [Events endpoint](https://www.az511.com/help/endpoint/event):
  `GET https://az511.com/api/v2/get/event`, required `key` query parameter,
  optional `format=json`; response is an array.
- Raw fields used: `ID` (integer), `SourceId`, `RoadwayName`, `Description`,
  `DirectionOfTravel`, `Organization`, `EventType`, `EventSubType`,
  `LanesAffected`, `EncodedPolyline`, `Recurrence`, `RecurrenceSchedules`
  (strings), `IsFullClosure` (boolean), and Unix-second `Reported`,
  `LastUpdated`, `StartDate`, `PlannedEndDate`.
- [API overview](https://www.az511.com/developers/doc): ten requests per
  60 seconds. Per-instance coalescing/backoff here is not a distributed quota.

The adapter converts valid timestamps to epoch milliseconds, preserving
description, source, roadway, direction and official site link. The docs do
not establish a per-event permalink or recurrence grammar; neither is invented.
Unknown scope stays unknown. Explicit ramp/frontage text is retained as
diagnostic scope, never promoted to a mainline closure. Polyline text is
preserved without inventing geometry or passing events to route matching.

`timingStatus` is `scheduled` before the start, `active` within a known
nonrecurring interval, `ended` at/after the end, otherwise `unknown`.
Intervals are start-inclusive/end-exclusive. Missing/invalid/reversed dates
set `timingUnknown: true`. Unparsed recurrence does too; daily minutes remain
null. A future end is a planned bound, not confirmation of a physical reopening.
Integration update: the four closure-fix commits through
`d26dc872e9b3dfd3576cf90a176e741b99ca3cf3` have now been cherry-picked.
The adapter calls the shared `roadEventTiming` classifier. Unknown timing,
including unparsed recurrence, survives JSON serialization and always stays
unknown. The imported UI fix distinguishes scheduled/unknown from active
closures; the existing navigation blocker remains conservative for unknowns.

## Configuration and isolation

`AZ511_API_KEY` names a future server-only secret binding. It is deliberately
absent from Wrangler vars and all public modules. `AZ511_ENABLED=false` and
`PUBLIC_LIVE=false` keep the adapter disabled. No real key is needed for tests.
Do not put keys in URLs sent to the browser, logs, repository files or fixtures.

`?feed=az511` is a separate shadow diagnostic feed. Its statuses distinguish
disabled, unconfigured, unavailable and successful (including a valid empty
array). Fixed-host requests reject redirects and time out after ten seconds;
errors omit upstream bodies, URLs and exception text. A one-minute per-instance
cache retains observation time and reclassifies timing on each read. Failures
are not interpreted as no closures. No old response is relabeled fresh.

The adapter leaves existing feed envelopes, TEXT_API and write handlers untouched.
The Worker still rejects mutations and has no operational scheduled sender.
The subsequent integrated
closure fix changes local public logic/UI/engine and the regenerated Apps Script
bundle, but nothing has been deployed. TEXT_API and write handlers are unchanged.

## Verification and remaining work

Synthetic fixtures use the documented fields. They represent future Cortaro
ramp and Massingale–Cortaro frontage schedules, an ongoing explicit mainline
example and an expired example. They are not fetched live records or evidence
that an observed closure is false. Tests cover Arizona UTC−07 date rollover,
summer/winter offsets, start/end boundaries, bad dates, recurrence, malformed
responses, missing config, fixed endpoint, cache reclassification, coalescing,
throttled failure, error redaction, empty success and disabled writes/sends.

Local verification after closure integration: all 313 repository tests pass;
Worker generation succeeds; the rebuilt Apps Script bundle parses as ES2019.
Loopback fixture smoke passed before integration. Local Playwright smoke could
not launch because Chromium revision 1148 is not installed; branch CI installs
Chromium and runs browser smoke. No live-road visual verification is claimed.

Before any cutover:

1. Establish AZ511 geometry, ramp/mainline matching and source deduplication
   policy before feeding the adapter into route assessments. Shared classifier
   integration is complete.
2. Independently authorize secret provisioning and bounded credentialed shadow
   validation. No credentialed calls, account changes or deployment occurred.
3. Implement shared cache/rate limits, recurrence semantics, last-good/stale
   behavior and persistent observation health; validate real response samples.
4. Finish all write contracts and durable storage; authorized private-state
   migration, scheduling, delivery outbox/fencing, budgets, opt-outs, owner mail
   provider, monitoring and rollback remain unimplemented. See README inventory.
5. **Deleting Apps Script's minute trigger is not a sender fence.** `doGet` and
   `doPost` call `ensureTrigger_`, which recreates it. A future cutover must fence
   trigger recreation and every send path, reconcile in-flight delivery, and
   activate exactly one sender authority. No second sender is activated here.

Decisions needed later: owner-mail provider, late/missed-slot policy, authorized
private-state migration plan and an explicit single-sender cutover/rollback plan.
