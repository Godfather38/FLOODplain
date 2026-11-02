# Live-first roads and route-tracking release — November 2, 2026

## Included

- Production base `58df3e849db9d14a76884a937e1e71d612e871ad`; original Brawley scoring, upstream gauges, county-closure handling and service rules are unchanged.
- Accessible risk colors, visible Back/Refresh labels, an optional three-step guide, feet-first presentation, and the all-route coverage/gauge ledger from the reviewed UX branch. The ledger retains 234 full-window, 165 partial-window and 59 uncovered evidence records. Conflicting cases are shown separately and missing Picture Rocks endpoint data is not carried forward.
- An opt-in **flat, road-only frozen replay** at `?case=roads#/map`, with 57 exact 15-minute frames from November 1, 2026 17:00 UTC through November 2 07:00 UTC. It compares modeled water with estimated road elevations using the repaired 2 MB road-height package plus the 143 KB compressed flood payload. The small model manifest is retained as provenance; whole-domain geometry, water frames and terrain are not dependencies of this view.
- Checked manifest/artifact hashes, sparse global-station mapping, exact run/time identity, unknown states, bridge provenance, simple boundary-preserving road ribbons and isolated wet-sample markers. Priority routes load first; other visible roads load at street zoom, using actual geometry bounds rather than tile centroids. Nearby tile decoding is sequential and stale completions cannot replace a newer frame.
- Purple marks mean modeled water at least 0.03 m above estimated road, with the exporter’s 0.01 m wet-face check preserved. Missing heights, outside coverage, absent sparse records and null samples never establish a dry or passable road. Native-cell support is unresolved in this compact view and may be coarse; it is not a road-resolved flood measurement.

## Default and clocks

A fresh ordinary page and ordinary Map entry use the original current-condition feeds and do **not** automatically load a dated simulation. Model replay is opt-in. No date/time state is persisted by this release. Return to live removes the road case, replay/time/view selectors, reloads the ordinary map and removes frozen road graphics. Current route symbols are hidden by default inside the road replay and can be explicitly shown with their separate-clock warning.

Current official feeds still use their observation times, freshness rules and failure reporting. This release does not add automatic SFINCS model execution or refresh. Retained SFINCS remains explicitly dated, and an unavailable or expired publication is not relabeled as current weather.

## Not included

- Full geographic 3D rebuild, Tiny Toon water, old experimental fluid renderer, whole-domain full refined water-surface replay, or new solver runs.
- Road graphics in the old 3D renderer. The road replay's 3D control is disabled with an explanation. The source adapter is reusable by a future shared flat/3D scene, but that scene is not claimed complete.
- Changes to production route scoring, Twilio/service rules, credentials, source providers or recurring jobs.

## Verification

`npm test` covers the full production suite plus road package hashes, selected-frame/sparse indexing, unknown boundaries, bridge/dip preservation, actual tile extents, corruption rejection, run/time/source identity and return-to-live behavior. DOM integration tests exercise the moved road slider after the embedded live panel is inserted, rapid scrubbing, Off/On, back-forward cache restoration, and fresh ordinary map entry with zero frozen-model requests.

One existing optional comparison against separately archived whole-domain native output is skipped unless `FLOODPLAIN_NATIVE_CHECK=1` and that archive is available. This release uses checked point extracts instead and preserves their supplied source identity.

All public JavaScript is syntax checked. Browser/GPU visual performance is not established by the DOM tests: this cloud environment could not launch Chromium (socket sandbox restrictions; escalation failed before execution). No further programmatic browser attempts are permitted. Visible browser QA, where available, is separate. The release does not claim measured FPS or full 3D validation.

The Pages workflow stamps changed module/CSS references and emits `release-version.json` with the exact deployed commit and release time, so production cache/version verification does not rely on screenshots alone.
