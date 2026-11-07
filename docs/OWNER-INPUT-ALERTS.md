# Experimental owner input alerts

Owner alerts compare fetched inputs with the configured inventory; they do not use crossing confidence, numerical ratings, `evidenceAvailable`, or lack of local instrumentation as outage criteria. No UI or rating behavior changes.

## Expected inputs

- Each of the six `USGS_SITES`: nonnegative discharge (`00060`) and a valid observation time no more than three hours old.
- Rain stations referenced by `FAILURE_POINTS.rain` (currently nine): nonnegative values for the windows used by their configured rules, including h6; timestamp no more than 24 hours old, matching existing rain evaluation. Maintenance is reported separately.
- Stream stations referenced by `FAILURE_POINTS.wash.alert` (currently 6443): nonnegative flow and a timestamp no more than three hours old.
- County, NWS, and both TransView event lists: valid expected structure. Empty lists are healthy. No particular event or nearby barricade is required.
- County records with a missing/unrecognized status or invalid geometry identify the affected record and field, rather than marking the whole response malformed. The Nov 5, 2026 incident was a readable response containing W Gates Pass Rd with a null Status. This remains an input gap until the county supplies a readable status; the app does not invent one. All seven official county status codes are accepted.
- Successful evaluation of every configured area.

No local pavement sensor, retired USGS gauge, bridge model, structure elevation, driver report, or site-specific flow-to-road relation is required. These are not monitored outages. In particular Sanders uses Cortaro and Trico remote measurements; its structural unknown assessment is not an owner alert.

## Delivery

Every tick attempts computation before subscriber scheduling and independently of the closure monitor. Owner email runs after subscriber delivery, including on an early return for an already-handled minute. Owner diagnostics, their persistence, and email failures cannot abort assessment or scheduled texts and pushes. The existing four-minute verdict cache is retained: alerts occur on the first actual failed check, normally within four minutes plus trigger delay. A stopped Apps Script trigger cannot report its own failure.

Messages go only through MailApp to Session.getEffectiveUser().getEmail(), the established owner destination. No public/private push topics are used. Check the trigger's effective owner and MailApp authorization before any separately approved deployment.

State is stored in individual `ownerHealth:<input>` script properties plus `ownerHealthIds`. Identical reasons are sent once; changed reasons are new incidents. A validated input recovery is sent only after a delivered problem. Unchecked inputs do not recover. Computation failure suppresses pending input recovery. Recovery describes input availability, never road conditions.

Failed delivery is retried with delays of 2, 4, 8, and 16 minutes (five total attempts per reason transition); attempts persist across runs. Delivery is marked only after MailApp returns successfully. After five failures it stays pending without further sends until the condition changes; inspect the per-input state to diagnose delivery. MailApp cannot guarantee exactly-once delivery if a process stops after acceptance but before state persistence. A ten-minute delivery lease serializes owner email attempts. The shared script lock covers only reading and updating state, never the MailApp network call. A failed final state save leaves the lease in place until it expires, after which a bounded retry may duplicate an already accepted email. This is reported in the private execution log, not claimed as exactly-once delivery.

The legacy aggregate `feed=health` response is retained for compatibility; it is not the source of the new owner alerts. The detailed inventory is persisted in script properties, not exposed as a new public endpoint.

County parsing is shared by the browser, assessment engine, Apps Script diagnostics, and Worker. Readable points survive a partial failure, while missing, malformed, and truncated responses stay distinct from a valid empty list. Closure change notifications can add a confirmed closure from a partial list, but cannot announce a reopening until county input is complete again.

## Kinds of problem, and source times

Every input problem carries a kind, shown in the email as a `Type:` line, so a lost connection can be told apart from a source that answered with bad data:

- **Lost connection** (`connection`): the source did not answer, or answered with an HTTP error. An HTTP 200 answer that is empty or isn't JSON is now a malformed response (`upstream-data`), not a lost connection.
- **Upstream data error, time** (`upstream-time`): the source answered, but the time it gave for the reading is missing, unreadable, or in the future. The reading is not used in ratings while this lasts.
- **Upstream data error** (`upstream-data`): the source answered, but a station is missing from its list, a reading is missing or malformed, or a county record is incomplete.
- **Stale** (`stale`): the source answered, but its newest reading is older than the limit.
- **Maintenance** (`maintenance`): the source marks the station as under maintenance.

Pima ALERT `last_rpt` has no zone and is Arizona time (UTC-7 all year). A time that already carries a zone (`Z`, `+00:00`) keeps it and is never given a second one. A time that isn't a real date and time is reported as unreadable, never guessed. A future time is never shifted, replaced, or treated as fresh. The email shows the time exactly as the source sent it.

**Nov 6 and 7, 2026.** Just after Arizona midnight, the county feed sent `last_rpt` `<that day>T17:00:00` for rain stations 6110, 6130, 6420, 6440, 6460, 6480, 6490, 6520 and stream 6443 (five on Nov 6). 5 PM Arizona is midnight UTC on the next day, so these readings were stamped about 17 hours in the future. The values cleared at about 01:04 Arizona both nights. The same `T17:00:00` stamp shows up during the day on other county stations (six at 10:51 AM on Nov 7: 541, 2180, 3052, 4100, 5030, 6200; see `test/fixtures/alert-future-stamp-2026-11-07.json`). What the county's feed does internally is not known. A future time is alerted on the first check that sees it, with no hold or delay, as an upstream time error rather than a lost connection. The email shows the time as sent and how far ahead of the check it is. The reading stays out of the ratings until a valid time returns. The usual rules apply: the same reason is sent once, and a recovery email follows only after a delivered problem and a validated good reading.

**County W Gates Pass Rd.** The county's own record (ArcGIS objectid 1608, created Aug 24, 2026, last edited Aug 26, 2026) has `Status`, `Event`, `Direction` and `timeUpdated` all null. The `Status` field still exists, and every other record fills it in. The value is missing at the county. It isn't a schema change or a parser error. The alert began Nov 5 because that day's change started checking record status. It remains an upstream data error until the county fills in the status. In the legacy `feed=health`, `county` now means the county list answered and was readable, and the new `countyRecords` entry tracks whether every record was complete. Before this change, `county` was marked down because of that one blank record.

## Validation

`npm test`: full repository suite, including owner-health tests for expected inventory, structural non-alerts, partial outages, stale/future/malformed/empty readings, valid empty event lists, stable deduplication, reason changes, recovery, failed sends, retry limits, compute failure, and closure-monitor isolation without subscribers. All sends are mocked.

`npm run build:gas`: rebuild the tracked WashWatch.gs bundle and parse as ES2019. No deployment or live notification is part of this work.

## Review hardening

Missing evaluator, null output, incomplete area coverage, malformed verdict fields, and malformed or stale cached verdicts produce actionable compute incidents. Only a newly computed, validated all-area result records compute recovery; reading a valid cache never clears an incident.

Reading diagnostics include the actual last observation timestamp and its age at the input check. These fields update without becoming part of the reason fingerprint, so increasing age alone does not resend an alert.

Observation and delivery state updates use a 100 ms `tryLock` and batched property writes. Contention defers observations to the next fresh input check and delivery to a later tick; it does not throw into the assessment path. Signup and report locks are unchanged. An observation older than the stored check is ignored. Email completion merges only the delivered reason into the latest state, preserving observations and recoveries that arrived during the send.

Unexpected compute exceptions retain a bounded diagnostic: error type, scrubbed message, and first function/line when available. Configured credentials, URLs, contact details, common response-body suffixes, and raw stacks are excluded. The diagnostic appears only in the existing private owner email, script properties, and execution log, never the public health feed. Details update without changing the incident's deduplication fingerprint. Logging remains best effort if properties or diagnostics themselves fail.

Computation recovery is recorded only after validated fresh output and its cache writes succeed. A current computation failure suppresses all recovery emails for that tick even if its failure could not be persisted.

Regression tests cover busy and throwing locks, property/cache quota errors, diagnostic-validator errors, SMS/push delivery under contention, subscriber-first ordering, email failures, concurrent observation and recovery writes, lease expiry after an uncertain final save, and diagnostic redaction. Tests use mocked services; no live SMS, email, or deployment is performed.

## Failure diagnostics (experimental, Nov 7, 2026)

**Why.** On Nov 7, 2026, stream station 6443 (Brawley Wash at Milewide Rd) was reported missing at 21:54 UTC. It recovered at 21:59 UTC with an observation from 21:00 UTC. The old check gave the same reason, "Expected station absent", for a readable list without 6443 and for a list it couldn't read entry by entry. The original response wasn't kept, so which one happened can't be established. A `null` entry in the list also made the whole check throw, so nothing was recorded for any input on that tick.

**What is reported now.** Each case has its own reason:

| What came back | Reason | Kind |
|---|---|---|
| No answer, or an HTTP error | Source unavailable | connection |
| HTTP 200, empty body | Malformed response: empty body | upstream-data |
| HTTP 200, not JSON | Malformed response: not readable JSON | upstream-data |
| JSON with no `data` list, or no entry with a readable station ID | Malformed station list | upstream-data |
| `data: []` | Empty station list | upstream-data |
| Readable list, station not in it, some entries unreadable | Expected station absent; some list entries unreadable | upstream-data |
| Readable list, station not in it | Expected station absent from a readable list | upstream-data |
| Station present: stale, future, unreadable or missing time | unchanged reasons | stale / upstream-time |

Station IDs match whether the county sends `"6443"` or `6443`. Surrounding spaces are ignored. Leading zeros are not ignored, because `06443` could be a different station.

**Metadata kept with a problem.** These fields are kept: check time, HTTP status, body size in characters, JSON or not, and top-level shape (key names only, at most eight, with odd names shown as `?`). For station lists they also include the number of entries, how many IDs were text, number or unreadable, and the station checked. The email shows them on one `Diagnostic:` line of at most 320 characters, and the same fields are stored as `response` in `ownerHealth:<input>`. Body text, values, URLs (the USGS URL can carry the API key), headers and contact details are never kept. The fields exist only while there is a problem and are removed on recovery.

**No new delay.** Diagnostics don't change when an alert is sent. A missing station is reported on the first failed check. Only a change of reason sends a new email: metadata that changes from check to check, such as the check time or size, does not resend. Recovery still needs a validated good reading after a delivered problem.

**Where.** `sourceResponse`, `jsonShape` and `findAlertStation` are in `public/logic.js` and shared by the Apps Script bundle and the Cloudflare shadow worker. They are used in `expectedInputHealth_` in `apps-script/Code.gs`. Tests are in `test/station-diagnostics.test.js`. This is on an experimental branch and is not deployed.
