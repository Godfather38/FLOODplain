# The published app shows live data only

**Frozen model runs NEVER go into the published app. Frozen time is only for development.**

This has no exceptions: not as a default, not as an option, not behind a link or URL setting, not labeled "replay", "preview", "retained", "dated" or "experimental", and not as bridge evidence or a coverage label.

"Frozen" means any saved model run shown after the fact, including SFINCS runs with stored inputs, saved frames, saved road-flood comparisons and frozen coverage records.

## What may be published

Feeds with their own observation or issue times: county closures, TransView, USGS and Pima ALERT readings, National Weather Service alerts, and current NOAA forecasts through HAND. Fixed reference data is fine too, such as routes and road heights.

If nothing live covers something, the app says it is unknown. It does not fall back to a frozen run.

## How this is enforced

- `tools/prune-published.mjs` runs on the deploy copy. It deletes frozen data and fails the deploy if any remains.
- `test/live-only.test.js` fails if published code can start a frozen run.
- Frozen runs may stay in the repo and on development branches, for development.

## Before publishing

1. Open the published Map screen fresh, with no URL settings.
2. Confirm that no frozen date, "replay", "simulation" or "retained" text appears.
3. Confirm that the browser requests no model frames or terrain.
