# Live data, and the one place a saved flood may appear

**Saved model runs NEVER appear in the live app. They appear only in the opt-in "Test and view a flood!" mode.**

The live app is everything people use by default: routes, ratings, alerts, the Map screen and bridge details. No default, setting or label brings a saved run into it. That includes "replay", "preview", "retained", "dated" and "experimental".

"Saved run" means any model run shown after the fact, including SFINCS runs with stored inputs, saved frames, saved road-flood comparisons and frozen coverage records.

If nothing live covers something, the live app says it is unknown. It does not fall back to a saved run.

## Test flood mode

"Test and view a flood!" is a small side feature, for people to try the map and for testing map renders. It is not a main feature. All frozen-time display belongs here, so it does not need writing and undoing elsewhere.

- It opens only from its link in Settings, which adds `?mode=test-flood`.
- It is never remembered. Reloading the ordinary address returns to live.
- A banner stays on screen saying it is a saved run and not current conditions, with a link back to live.
- It never feeds ratings, closures, bridge evidence or alerts. Those stay live while the mode is open.
- All its code paths check `isTestFlood()` in `public/simulation/test-flood.js`.

## How this is enforced

- `tools/prune-published.mjs` runs on the deploy copy. It keeps the exact Test flood file list, deletes all other model data, and fails the deploy if any remains.
- `test/live-only.test.js` fails if the live path can start a saved run.

New map rendering work should be tried in this mode. If it needs another saved file, add that file to the list on purpose.

## Before publishing

1. Open the published Map screen fresh, with no URL settings.
2. Confirm that no saved date, "replay", "simulation" or "retained" text appears.
3. Confirm that the browser requests no model frames or terrain.
4. Open Test flood from Settings, confirm the banner, then use Back to live.
