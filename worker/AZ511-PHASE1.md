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
  `LastUpdated`, `StartDate`, `PlannedEndDate`; numeric `Latitude`/`Longitude`.
- [API overview](https://www.az511.com/developers/doc): ten requests per
  60 seconds. Per-instance coalescing/backoff here is not a distributed quota.

The adapter converts valid timestamps to epoch milliseconds, preserving
description, source, roadway, direction and official site link. The docs do
not establish a per-event permalink or recurrence grammar; neither is invented.
Unknown scope stays unknown. Explicit ramp/frontage text is retained as
diagnostic scope, never promoted to a mainline closure. Geometry uses the
[documented Google E5 polyline format](https://developers.google.com/maps/documentation/utilities/polylinealgorithm)
linked by AZ511, or a valid single location point when no polyline is supplied.
Malformed geometry yields empty parts and `geometryUnknown:true`; secondary
coordinates are not joined into an invented road segment. Every event supplies
`type`, `parts`, `headline`, `closed` and the shared timing fields.

`timingStatus` is `scheduled` before the start, `active` within a known
nonrecurring interval, `ended` at/after the end, otherwise `unknown`.
Intervals are start-inclusive/end-exclusive. Missing/invalid/reversed dates
set `timingUnknown: true`. Unparsed recurrence does too; daily minutes remain
null. A future end is a planned bound, not confirmation of a physical reopening.
Integration update: the closure-fix commits through
`37be39f2f3edc8a0f65427280356a24b8cb049f5` have now been cherry-picked
(five commits, including daily-window labels).
The adapter calls the shared `roadEventTiming` classifier. Unknown timing,
including unparsed recurrence, survives JSON serialization and always stays
unknown. The imported UI fix distinguishes scheduled/unknown from active
closures; the existing navigation blocker remains conservative for unknowns.

## Configuration and isolation

`AZ511_API_KEY` names a future server-only secret binding. It is deliberately
absent from Wrangler vars and all public modules. `AZ511_ENABLED=false` and
`PUBLIC_LIVE=false` keep the adapter disabled. No real key is needed for tests.
Do not put keys in URLs sent to the browser, logs, repository files or fixtures.

`?feed=az511` is a separate shadow diagnostic feed, including the existing
`roadEvents: {events,fetchedAt,stale}` envelope (null on failure). Fixture tests
transport that envelope through shared labeling and route matching. It is not
merged into the app's standard `feed=all`: source deduplication and ramp/mainline
matching policy must be validated first. Its statuses distinguish
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

### Offline reconciliation policy

`reconcile-road-events.js` is an offline experiment, not imported by the Worker
or browser. It receives normalized events plus a trusted, operator-reviewed
`verifiedLinks` crosswalk. Each link names exact source-qualified event IDs and
an HTTPS evidence reference. An evidence URL is provenance supplied by the
caller, not something this function verifies online. No real crosswalk is
included: the AZ511 `SourceId` documentation does not establish a common ID
namespace with TransView or county records. Equal-looking IDs, nearby geometry
and similar headlines alone never deduplicate records.

A linked pair is equivalent only when known scope (ramp/mainline/frontage/local),
known travel direction, normalized road name, exact geometry, boolean closure,
known timing and all interval/daily boundaries agree. Reverse line vertex order
is allowed only with independently matching travel direction. Parallel lines,
points versus lines, nearby ramps versus mainline, missing scope/direction,
unparsed recurrence and unknown/conflicting timing retain both records with
explicit conflict reasons. No proximity threshold promotes a ramp to mainline.

Equivalent groups retain every original and source provenance. Unmatched county
barricades are untouched. Transitive joins recheck every member; groups are
limited to 16 members, inputs to 5,000 events and 5,000 links. Consumers must
retain the groups/decisions alongside any projected event list. The helper does
not select a more authoritative source to resolve conflicts or change routing.
Fixture evidence links are synthetic, not evidence of actual source identity.

### Resource and credential limits

The server adapter allows at most 4 MiB decoded response bytes, 5,000 events,
16,384 characters per retained text field, 65,536 encoded-polyline characters,
4,096 decoded points per event and 32,768 decoded points per response. Streaming
reads enforce the byte cap even without Content-Length, using fixed storage;
oversized responses/counts/text and aggregate geometry limits fail the response
as unavailable, not an empty success. No description is truncated. Invalid or
over-complex individual geometry retains its event with empty parts and
`geometryUnknown:true`, never a fabricated line. These limits need validation
against authorized real samples before production use.

Fixed-host requests, denied redirects, ten-second request timeout and generic
errors remain. Raw or JSON-escaped key echoes in upstream responses are rejected
before caching/output. No secret is written to browser modules, logs, fixtures,
config vars or source control. The cache/coalescer and one-attempt-per-minute
backoff are **per Worker instance**, not a global ten-per-minute quota. Multiple
instances can still exceed AZ511's quota; shared limiting is a cutover blocker.

Cloudflare account and production Worker target remain unverified. No account
metadata connector or authenticated deployment target has been established;
the shadow configuration is not evidence of an existing deployment. No login,
credential inspection or account/access changes were performed.

Synthetic fixtures use the documented fields. They represent future Cortaro
ramp and Massingale–Cortaro frontage schedules, an ongoing explicit mainline
example and an expired example. They are not fetched live records or evidence
that an observed closure is false. Tests cover Arizona UTC−07 date rollover,
summer/winter offsets, start/end boundaries, bad dates, recurrence, malformed
responses, missing config, fixed endpoint, cache reclassification, coalescing,
throttled failure, error redaction, empty success and disabled writes/sends.

Local verification after reconciliation/resource limits: all 326 repository tests pass;
Worker generation succeeds; the rebuilt Apps Script bundle parses as ES2019.
Loopback fixture smoke passed before integration. Local Playwright smoke could
not launch because Chromium revision 1148 is not installed; branch CI installs
Chromium and runs browser smoke. No live-road visual verification is claimed.

Before any cutover:

1. Validate AZ511 geometry, ramp/mainline matching and source deduplication
   policy before feeding the adapter into route assessments. Shared classifier
   integration is complete. Do not blindly combine unknown-timing TransView
   duplicates with scheduled AZ511 events: the unknown record still blocks
   navigation. Reconcile verified IDs/geometry/direction and preserve relevant
   county barricades. Existing closure-page intro and `SRC['road-event']` name
   TransView; update source labels before any combined UI feed.
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
