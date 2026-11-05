# Integrated frontend and diagnostic backend (not deployed)

The user-created Worker `floodplain`, account
`e2f4d2bba324bf47a074890619e83af3`, serves the existing FLOODplain frontend at
https://floodplain.marshallp66.workers.dev/. Do not replace it with `worker/index.js`
alone. The root `wrangler.jsonc` instead packages `worker/site.js` and all of
`public/` together through the `ASSETS` binding.

`/api` and `/api/` accept the existing diagnostic feed query contract. Unknown
`/api/*` paths return JSON 404, never HTML. Other GET/HEAD requests retain asset
handling (including normal missing-file 404); root query strings do not turn the
homepage into an API. The frontend's TEXT_API, alerts and write handlers remain
on Apps Script. The site Worker has no scheduled handler. PUBLIC_LIVE and
AZ511_ENABLED remain false; the secret is never part of the public asset bundle.

## Observed connected deployment

Dashboard version `09d792a9` was Ready at 100%, from GitHub build
`063d67a7-9f4e-4bc2-9b97-a3f63c7d7b87`, branch `ccr-ae06b197-a01a6o`.
That branch and main both resolved to `6c4ff789` when inspected. Build command
was None; root `/`; deploy command `npx wrangler deploy`. That commit has no
tracked Wrangler configuration. The observed static deployment therefore does
not establish which generated config/autodetection settings Cloudflare used.
The editor stayed loading; dashboard settings inspection was blocked by the
computer tool's URL-confidence restriction. Existing asset bindings, variables,
custom routes, schedules and auto-build/preview triggers must still be reconciled.

## Before deployment

- Do not change connected build branch or click Retry/Deploy as part of this work.
- Inspect production and preview build triggers before pushing to a branch that
  Cloudflare may automatically publish. A manual edit can be replaced by the next
  connected build. The experimental branch is code preparation, not approval to
  change the deployment branch.
- Confirm deployed code/assets and dashboard settings. The root config is a
  proposed explicit configuration, not an export of unknown existing settings.
  It preserves the observed workers.dev hostname, adds no custom routes, enables
  no cron, and keeps both live flags false. Reconcile before uploading a version.
- Use pinned local Wrangler 4.157.0 (the version observed in the connected build),
  with root configuration. `npm run check:worker-package` only dry-runs packaging.
- Uploading an undeployed version, deploying it, and providing AZ511_API_KEY are
  separate operations. `wrangler secret put` deploys immediately; where approved,
  `wrangler versions secret put` stages a version instead. Do not create a token
  or expand OAuth access merely to work around a blocked dashboard.
- AZ511 is still a diagnostic feed, not merged into frontend route decisions.
  Production integration still needs quota coordination and authoritative source
  reconciliation, as recorded in AZ511-PHASE1.md.

Documentation: https://developers.cloudflare.com/workers/static-assets/binding/
and https://developers.cloudflare.com/workers/configuration/secrets/.

Validation: 38 relevant routing/adapter/reconciliation/Worker tests pass. Wrangler
dry-run reads 704 public assets and packages the integrated module. Existing
development dependencies still have the pre-existing esbuild moderate and
Playwright high advisories; no blanket dependency upgrade is included here.
