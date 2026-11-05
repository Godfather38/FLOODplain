# Experimental owner input alerts

Owner alerts compare fetched inputs with the configured inventory; they do not use crossing confidence, numerical ratings, `evidenceAvailable`, or lack of local instrumentation as outage criteria. No UI or rating behavior changes.

## Expected inputs

- Each of the six `USGS_SITES`: nonnegative discharge (`00060`) and a valid observation time no more than three hours old.
- Rain stations referenced by `FAILURE_POINTS.rain` (currently nine): nonnegative values for the windows used by their configured rules, including h6; timestamp no more than 24 hours old, matching existing rain evaluation. Maintenance is reported separately.
- Stream stations referenced by `FAILURE_POINTS.wash.alert` (currently 6443): nonnegative flow and a timestamp no more than three hours old.
- County, NWS, and both TransView event lists: valid expected structure. Empty lists are healthy. No particular event or nearby barricade is required.
- Successful evaluation of every configured area.

No local pavement sensor, retired USGS gauge, bridge model, structure elevation, driver report, or site-specific flow-to-road relation is required. These are not monitored outages. In particular Sanders uses Cortaro and Trico remote measurements; its structural unknown assessment is not an owner alert.

## Delivery

Every tick attempts computation before subscriber scheduling and independently of the closure monitor. The existing four-minute verdict cache is retained: alerts occur on the first actual failed check, normally within four minutes plus trigger delay. A stopped Apps Script trigger cannot report its own failure.

Messages go only through MailApp to Session.getEffectiveUser().getEmail(), the established owner destination. No public/private push topics are used. Check the trigger's effective owner and MailApp authorization before any separately approved deployment.

State is stored in individual `ownerHealth:<input>` script properties plus `ownerHealthIds`. Identical reasons are sent once; changed reasons are new incidents. A validated input recovery is sent only after a delivered problem. Unchecked inputs do not recover. Computation failure suppresses pending input recovery. Recovery describes input availability, never road conditions.

Failed delivery is retried with delays of 2, 4, 8, and 16 minutes (five total attempts per reason transition); attempts persist across runs. Delivery is marked only after MailApp returns successfully. After five failures it stays pending without further sends until the condition changes; inspect the per-input state to diagnose delivery. MailApp cannot guarantee exactly-once delivery if a process stops after acceptance but before state persistence. A script lock serializes owner delivery.

The legacy aggregate `feed=health` response is retained for compatibility; it is not the source of the new owner alerts. The detailed inventory is persisted in script properties, not exposed as a new public endpoint.

## Validation

`npm test`: full repository suite, including owner-health tests for expected inventory, structural non-alerts, partial outages, stale/future/malformed/empty readings, valid empty event lists, stable deduplication, reason changes, recovery, failed sends, retry limits, compute failure, and closure-monitor isolation without subscribers. All sends are mocked.

`npm run build:gas`: rebuild the tracked WashWatch.gs bundle and parse as ES2019. No deployment or live notification is part of this work.

## Review hardening

Missing evaluator, null output, incomplete area coverage, malformed verdict fields, and malformed or stale cached verdicts produce actionable compute incidents. Only a newly computed, validated all-area result records compute recovery; reading a valid cache never clears an incident.

Reading diagnostics include the actual last observation timestamp and its age at the input check. These fields update without becoming part of the reason fingerprint, so increasing age alone does not resend an alert.

Observation writes and delivery share the script lock. An observation older than the stored check is ignored. This prevents delivery's final save from overwriting an interleaved newer observation. The mock exercises lock contention and the subsequent newer-state update.
