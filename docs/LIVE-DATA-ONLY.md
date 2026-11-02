# Live data, saved runs and simulated visuals

**Saved model runs NEVER appear in the live app. They appear only in the opt-in "Test and view a flood!" mode.**

The live app is everything people use by default: routes, ratings, alerts, the Map screen and bridge details. No default, setting or label brings a saved run into it. That includes "replay", "preview", "retained", "dated" and "experimental".

"Saved run" means any model run shown after the fact, including SFINCS runs with stored inputs, saved frames, saved road-flood comparisons and frozen coverage records.

If nothing live covers something, the live app says it is unknown. It does not fall back to a saved run.

## Three kinds of water on screen

| Kind | What it is | Where it may appear | Notice |
|---|---|---|---|
| Model estimate | HAND, computed from a current river forecast | Live app and `public/inundation` | `estimate` |
| Saved run | A model run shown after the fact | Test flood mode only | `savedRun` |
| Always-on simulated visual | See below | Live app, off until opened | `simulated` |

## Always-on simulated visuals

This is a separate category from saved runs. It covers graphics such as an optional 3D map layer showing simulated water at all times.

An always-on simulated visual:

- is not a saved run,
- is not fed from real conditions,
- must never feed ratings, closures, bridge evidence or alerts,
- is off by default, and loads its files only when opened.

Its files go in `ALWAYS_ON_SIMULATED` in `tools/prune-published.mjs`, on purpose.

## How simulated and modeled content is identified

Only two things are used:

1. **One dismissible acknowledgement.** `public/model-acknowledgement.js` shows it when someone first opens simulated or modeled content. Each device sees it once per browser session, whichever kind comes first. Anything new that shows simulated or modeled water calls `showAcknowledgement(kind)`.
2. **The wording already on screen.** Titles, panel text and status lines say simulated, modeled or estimated.

Permanent banners, tags and labels are not used. The owner finds them too invasive. This app is not a safety advertisement, and features are not limited because someone might ignore a clear statement. Keep the tone neutral: don't call anything "safe", and don't inflate risk.

## Test flood mode

"Test and view a flood!" is a small side feature, for people to try the map and for testing map renders. It is not a main feature. All frozen-time display belongs here, so it does not need writing and undoing elsewhere.

- It opens only from its link in Settings, which adds `?mode=test-flood`.
- It is never remembered. Routes & conditions, Routes and the Settings link all return to live, and so does the ordinary address.
- It never feeds ratings, closures, bridge evidence or alerts. Those stay live while the mode is open.
- All its code paths check `isTestFlood()` in `public/simulation/test-flood.js`.

## How this is enforced

- `tools/prune-published.mjs` runs on the deploy copy. It keeps the exact Test flood file list and any listed simulated visuals, deletes all other model data, and fails the deploy if any remains.
- `test/live-only.test.js` fails if the live path can start a saved run.
- `test/model-acknowledgement.test.js` fails if the acknowledgement or wording is removed, or if 3D files load on a fresh Map screen.

New map rendering work should be tried in Test flood mode. If it needs another saved file, add that file to the list on purpose.

## Before publishing

1. Open the published Map screen fresh, with no URL settings.
2. Confirm that no saved run date, "replay" or "retained" text appears. Words like "simulated", "modeled" and "estimated" are expected.
3. With 3D not opened, the browser requests no 3D or terrain files and no saved run frames.
4. In a new session, open modeled water, confirm the acknowledgement appears once, and confirm it stays gone for that session after "Got it".
5. In another new session, open Test flood from Settings, confirm the acknowledgement, then return to live.
