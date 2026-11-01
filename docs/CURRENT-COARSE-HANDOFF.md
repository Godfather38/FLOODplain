# Current coarse SFINCS publication handoff (2D draft dependency)

The 2D app now consumes `public/simulation/data/current-sfincs-manifest.json` before retained output when opened without a `case` override. `?case=coarse` and `?case=refined` explicitly retain the older cases. A genuine completed current output is REQUIRED for draft completion, not an optional follow-up.

Simulation owner: reuse the approximately 29,685-cell aligned prepared case, not the 400k-face model. Known retained preparation is `H:/AI/Projects/FloodPLAIN-sfincs/.sfincs-runs/aligned-2021-model`; native case `aligned-current-case-20261101-13z`; exact workflow/config must remain simulation-owned. The old input cycle is NOT a current refresh.

App/export handoff:
1. Acquire genuinely current compatible forecast inputs and valid initialization/history; execute existing coarse model. Do not infer depth from gauges or substitute historical data.
2. Use existing `publish_current_sfincs.py` with actual case export configuration (no `--simulated-live`). It emits immutable gzip v1 output, provenance and then atomically switches the current manifest. Keep source issue and valid times.
3. Copy the emitted artifact/provenance/current manifest into this experimental branch. The app verifies checksum, matching current-run provenance, valid window and native frame coverage.
4. `current-map-publication.js` verifies that every cell coordinate/order, CRS and full-cell area match the retained coarse model before reusing exact source-proven footprints. A changed grid fails rather than guessing new geometry. Changed geometry needs its own verified footprints adapter.
5. Actual new-run visualization and issue/valid labels must be checked once output is supplied. Until then last-successful retained SFINCS remains visibly dated and current HAND/readings update independently.

No recurring compute jobs, credentials or production deploy are part of this handoff. Existing memory-bounded full-domain renderer is retained. The app-side adapter is implemented, but no fresh coarse solver output was available to exercise it at this checkpoint. Do not mark this dependency complete from synthetic fixtures.
