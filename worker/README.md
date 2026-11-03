# Cloudflare shadow preview — not a completed migration

Isolated branch: `experimental/cloudflare-backend-20261103`.
Baseline: owner-health `35ced2e2266f8575a8631fe26bc6ac73dc0ad512`, based on published-default checkout `e82d682` (`ccr-ae06b197-a01a6o`). Owner-health is not deployed. No edits to Apps Script, public assets, ratings, TEXT_API, deployment workflows, credentials or Claude's wording work.

## Run locally

Requires Node 22.13+ (Node 24 recommended for the SQLite test API).

```sh
npm ci
npm run build:worker
npm run test:worker
npm run preview:worker
```

Open `http://127.0.0.1:8787/?feed=preview` for numeric assessments for both areas and all 20 input health checks. This is synthetic data with a fixed observation time, clearly marked by the response header `X-FLOODplain-Mode`. It is not a current road assessment. `?feed=all` preserves the app's four-part feed envelope. The HTTP adapter binds only to loopback.

Optional local public-source shadow reads: `npm run preview:worker -- --live-public`. This only calls fixed USGS, Pima, county ArcGIS, NWS, TransView and NOAA endpoints; no keys or private state. Nothing changes the published app. Live reads are not required by tests and may fail independently. `?feed=preview` includes granular observation ages and reasons; `?feed=health` retains the older aggregate health envelope.

The same entry is a module Worker. If Wrangler is installed, use `wrangler dev --local --config worker/wrangler.jsonc`. The config contains no account, routes, cron triggers or storage bindings, and disables workers.dev/preview URLs. Do not deploy it. The scheduled handler is a hard no-op regardless of environment variables. There is no sender implementation or deploy command.

Verification on 2026-11-03: all 228 repository tests pass, including nine Worker contract/state tests and direct fixture GET parity against the built Apps Script. `node worker/smoke.mjs` passes the loopback HTTP check. Wrangler 4.157.0 local workerd serves HTTP 200 with the fixture header, both areas, 20 input checks and the expected consolidated feed keys. The unbound ledger is tested with Node SQLite, not a deployed Durable Object. Real upstream availability and production delivery remain untested.

## Contract inventory and deliberate gaps

| Surface | Preview behavior | Required before cutover |
| --- | --- | --- |
| GET `feed=usgs` | `{fetched_at,series}`; each station independent, original observation timestamps | Shared cache/limits and validated freshness policy |
| GET `feed=alert` | Existing `alertSnapshot` shape, unavailable on source failure | Cache parity; don't convert failed reads to empty measurements |
| GET `feed=roadevents` | `{events,fetchedAt,stale:false}` or unavailable; both TransView lists use shared normalizer | Six-hour last-good fallback with truthful stale flag and original time |
| GET `feed=all` | `{usgs,alert,roadEvents,drive}`; drive is mock `[]` | Restore real authorized drive state, expiry and abuse limits |
| GET `feed=health` | `{ok,sources}` with current-cycle aggregate timestamps | Durable historical lastOk/downSince; do not mistake request-local values for outage duration |
| GET `feed=forecasts&paths=...` | `{responses}`; existing allowlist, dedup and 40-path cap; mock `{}` by default | Shared 15-minute cache and upstream quota/load controls |
| GET service status | Explicit shadow identity, sender disabled, quota zero | Correct production capabilities only after activation |
| GET hit/new/fail counters | 405, no persistence | Authorized migration of counters/owner reporting |
| POST drive/request/report/push/pushstop/signup/confirm/stop/waitlist | 405, body never used or stored | Validated/authenticated handlers, retention and consent, abuse prevention, data migration |

All-area ratings call the unchanged `public/config.js`, `logic.js` and `engine.js`. Source failures remain separate from structural uncertainty such as unmeasured pavement or unconfirmed crossing geometry. Scores remain numbers. A failed TransView list is not proof of no closures; detailed health retains individual failures even when its peer succeeds. Preview intentionally lacks last-good caching. Malformed data that prevents evaluation returns 503 rather than fabricating a successful assessment.

`build_worker.mjs` extracts the pure `expectedInputHealth_` function from the preserved Apps Script source and generates stripped route properties; a test detects validator drift. The generated file contains no Apps Script service functions. Owner-health tests from the baseline still verify every configured rain window/stream/USGS input, all-area computation validation, serialized observation writes, deduplicated notices, retries and observation age. Preview input diagnostics do not send or persist notices.

## Transactional state design

`ledger.js` is an unbound SQLite Durable Object prototype, exercised against local in-memory SQLite transactions. It is never reachable from the Worker. `ShadowLedger.update()` wraps observation changes, retry bookkeeping, budget checks and dedup reservations in `storage.transactionSync`. The fixture-only delivery command records simulated success/failure; it does not call a sender. Synthetic reservation keys only are accepted. One future namespace identity (for example `idFromName('alert-authority-v1')`) must own the whole scheduling and delivery ledger; do not shard global budgets across independent writers. Workers KV alone is unsuitable for this state.

The production schema must replace the prototype JSON row with versioned subscriber/schedule, owner-health, closure-baseline, counters, daily budgets and outbox tables. All writers, including imports and owner observations, must go through the same authority. Persist an incident version and compare it during delivery acknowledgement so a delayed success cannot overwrite a newer failure. Ignore observations older than the stored check. Recover only after fresh validation and successful all-area computation. Preserve five-attempt bounded retries, no false delivered flag, deduplicated reason changes, last observation and age. Include compute failures independently of closure-watch errors.

Production delivery requires an outbox reservation transaction, a single active sender epoch/lease with fencing, and an acknowledgement transaction. Network calls must be outside a synchronous SQL transaction. A provider timeout after accepting a message has an uncertain outcome: reconcile provider IDs/idempotency before retrying. A budget reservation must remain charged while outcome is uncertain. This preview's simulated delivery is NOT a production exactly-once guarantee. Add crash/restart, overlapping cron, lease-loss, stale acknowledgement and quota tests before adding any sender binding.

## Staged migration and cutover blockers

1. **Parity:** compare a bounded set of public-only live shadow responses and numerical assessments against the existing service without changing TEXT_API. Validate malformed/partial inputs, cached fallback times, both areas, forecasts and closure semantics. Workerd integration and real upstream availability are separate checks from Node fixture tests.
2. **Private state inventory:** separately authorize and securely migrate Sheets subscribers, confirmation/stop state, keys and usage limits, push topics/times/days/modes/areas, waitlist/texted flags, reports, driving reports and expiry. Preserve consent and retention; do not copy these into this public branch or logs. Version and reconcile import counts privately. No such data has been accessed here.
3. **Schedule parity:** keep `America/Phoenix`, exact selected times, weekday/month-day selectors and per-day limits. Cloudflare cron is UTC. Establish a persisted last-completed cursor with a bounded catch-up window; reserve each `(subscriber, local-date, selected-slot, channel)` once. Explicitly define late/missed alert handling and never replay an unbounded backlog.
4. **Owner mail and fallback:** Apps Script's effective-user MailApp identity/quota does not transfer. Select and authorize an owner-mail provider and recipient privately. Verify Verizon email-to-text deliverability and shutdown timeline before retaining it as a temporary fallback. Do not assume Cloudflare supplies outbound mail or interchangeable MailApp behavior.
5. **Twilio:** verify sender approval and preserve the explicit approval gate, access keys, confirmation semantics, waitlist once-only notice, per-person daily allowance, global spend/segment budgets, rate limits, opt-outs and delivery receipts. Credentials and sender approval are separate from enabling sends. Billing changes are not authorized by this preview.
6. **Closure watch:** import last known closed sets, distinguish first baseline from new closures, never call a failed source a reopening, preserve opt-in area routing and 12/day area budget. Drive reports remain distinct from verified closures.
7. **Single sender cutover:** approve a production plan separately. Stop/fence Apps Script triggers, reconcile in-flight sends and frozen state, then activate exactly one Worker authority. Keep rollback snapshots private and never reactivate both senders. Change live routing only under explicit cutover authorization. The current service and published app remain active throughout this preview.
8. **Operational prerequisites:** account/bindings and storage creation, provider permissions, secrets, costs, monitoring, authentication, abuse controls and production deployment all remain undone and require a separate authorized task. No account setup, production cron, real send, signup or new private-data storage occurred.

## API references checked 2026-11-03

- [SQLite Durable Object transactions and transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Storage best practices](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [KV consistency limitations](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [Local Worker execution and local bindings](https://developers.cloudflare.com/workers/local-development/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [UTC cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
