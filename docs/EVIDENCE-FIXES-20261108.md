# Two Nov 3 fixes, judged Nov 8, 2026

An audit on Nov 8 found two fixes from Nov 3 that were built but never published. This note gives a verdict on each, checked against today's release (`90d0d12` plus the diagnostics branch `experimental/model-upgrade-diagnostics-20261107`).

## 1. "Say what the evidence is instead of calling it no readings" (`7505e3a`): ported with changes

**The bug is real today.** With both Santa Cruz gauges reporting normal flow (Nov 8 code and data), the three river bridges on the Avra Valley routes led with "No live readings right now; current road conditions are not established":

| Crossing | Gauges reporting | Before | After |
|---|---|---|---|
| Sanders Rd river bridge | 2 | No live readings right now… | 2 river gauges reporting, nothing measuring this road itself |
| Trico-Marana river bridge | 2 | No live readings right now… | 2 river gauges reporting, nothing measuring this road itself |
| Avra Valley Rd river bridge | 1 | No live readings right now… | 1 river gauge reporting, nothing measuring this road itself |

The other river bridges (Ina, Twin Peaks, Speedway) work the same way. Why: a river bridge's row is rated by comparing model water with the roadway height. Sanders has no roadway height. Trico and Avra Valley have one, but their saved model water expired on Nov 2. So the row is "unknown", and every all-unknown crossing was summed up as "no live readings", even with gauges reporting. Later work did not fix this.

**What was ported** (by hand, onto today's code):
- Each check says what kind of evidence it is: observed (county barricade), remote (a gauge somewhere else), model (HAND), official (weather service), missing, stale or unsupported. `evidenceState()`, `gaugePhrases()`, `evidenceSentence()` and `noRatingRow()` in `public/logic.js`.
- The "no rating" row names what did answer. Only a real silence still says "No live readings right now". When HAND adds its estimate afterwards, the row is rewritten to say "plus a model estimate" (`applyHand` in `public/hand-model.js`).
- The bridge's river row says which part is missing: "No river gauge reading either" or "The river gauge readings are listed, but they measure the river, not water on this bridge", instead of "Gauge discharge is context only".
- HAND at a crossing it was never built for reads "HAND model does not cover this crossing" (coverage, not an outage).
- Good signs: "the Santa Cruz is at its everyday flow" shows again at bridges with no roadway comparison. `b0f6e37` meant it to show there. `f6d65fb` made it unreachable as a side effect and updated a test to match. The test in `test/logic.test.js` now expects the line again.
- The alert service bundle (`apps-script/WashWatch.gs`) was rebuilt, so texts use the same wording.

**Scores don't change.** Levels, numbers and the "is this route clear" result are exactly as before: the row is still level ok, `evidenceAvailable` stays false, and the crossing is still listed as not established. `test/evidence-wording.test.js` pins this for all three bridges.

**Left out**, as wording changes the bug didn't need:
- The longer home-screen disclaimer, and removing "turn around" from the underpasses screen.
- "Least going against it" → "Best-supported route right now".
- The extra "Built from… None of these is a reading at this crossing" line on every crossing screen. That's a caveat on every screen, which `docs/SIMULATED-CONTENT.md` rules out.
- The rewritten dip "road-status" row and `crossingLead` text, which said "the flood model" even where no model row exists.
- The longer HAND calm-with-flow sentence, and the route-tracking wording.

## 2. "Exclude saved SFINCS water from production bridge evidence" (`ddda2f4`): rejected

The change deletes every bridge's `modelWater` on load, whatever its run. Its comment says committed model water is "never live evidence". The release instead keeps it only when its `runId` matches `current-sfincs-manifest.json`.

Why it's rejected:
- **It takes SFINCS out of a rating.** `bridgeRiverCheck` turns the bridge's water-vs-roadway comparison into that crossing's level (ok, watch, caution, danger). Deleting all `modelWater` means SFINCS can never rate a bridge, even with a matching, current run. `CLAUDE.md` and `docs/SFINCS-ROUTE-PREDICTION.md` prohibit this: SFINCS counts in the ratings, and reducing what it does needs the owner's explicit OK. The commit message follows the prohibited line of thinking ("it's a model, so keep it out").
- **The stale case it guards against is already handled.** The saved water at Trico and Avra Valley is from run `sfincs-current-coarse-20261101-19z-41350254061`, valid to 2026-11-02T12:00Z. `bridgeHeightComparison()` already returns "expired" for it, the row reads unknown, and it adds nothing to the score. The screen says plainly "The model water forecast expired at …".
- Its smoke test would also pin that the bridge screen never asks for the SFINCS manifest, which would lock the exclusion in.

Nothing from this change was ported.

## For the owner to decide

- **Bridge water isn't live yet.** Bridge-level SFINCS water comes only from the saved Nov 1 run. Route ratings use the hourly `live-model` run (`road-forecast.js`), but the bridge water-vs-roadway rows don't, so at Trico and Avra Valley that row will read "expired" until a new run is published into the bridge registry. Feeding bridges from the live run would be new work, not part of either fix.
- **Good-sign wording.** "The Santa Cruz is at its everyday flow" is back as a good sign on bridge-only routes. It describes the river, not the deck. Say if you'd rather it stay off.

## Checks

`npm test` 448/448, `npm run test:worker` 39/39, `npm run test:browser` all passed (Nov 8, 2026, Windows, branch `experimental/evidence-fixes-20261108`).
