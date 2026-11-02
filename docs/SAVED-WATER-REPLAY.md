# Saved model water replay

Original request, verbatim:

> that one worked because of ther caution signs, but shit we gotta use history for previewing visuals on map

The existing map now offers **Preview saved water · Brawley**. It opens the existing refined native run at November 1, 2026, 22:00 UTC / 3:00 PM Arizona time, near Brawley Wash and Avra Valley Road. The initial camera exposes actual model water south of the road above the phone controls. The existing geographic renderer, prepared native geometry, depth palette, feet legend and frame scrubber are reused. No renderer bundle, solver, fluid worktree or geometry process was changed.

The bookmark pins run `refined-full-41344983607`, geometry SHA `77d581fff18b51fba5d1f6f935de78285364c4223824e2251c242e211d7e8b7b` and exact initial frame. A mismatch produces an error instead of substituting another run. Source inspection of the committed Brawley scene found 0.71841923828125 m (about 2.357 ft) cell-average depth at native face 266577, south of the road. That is not road depth. The entire existing 57-frame window remains available for scrubbing.

A persistent **REPLAY · Saved model run** label carries the actual displayed time in Arizona, including year. It is not described as observed historical flooding. Current route/gauge symbols remain visible and explicitly labeled as current conditions, separate from replay water. The replay prevents blending in current HAND/rain/flow layers. **Return to live** reloads the ordinary geographic map with model water off; it does not claim that the absence of the overlay means dry conditions. Existing warnings, Brawley correction and full all-route ledger are retained.

The supplied 8b248dac native-flow contract was inspected. It belongs to the same refined run but is an exact-time regional transport export; this UI does not draw flow arrows or animate water direction. No invented velocities, interpolated flow or 2014 historical-reconstruction claim is introduced. This is one useful saved model preview, not a historical-event catalog or validated reconstruction.

Validation: full suite 266 tests, 265 passed, 1 optional large native-map test skipped. Chrome at 390 px phone and 1440 px desktop verified exact initial native time, actual rendered water, scrub to 23:00 UTC, previous/next native frames, return-to-live removal of both cell polygons and overview water, and reopening replay. No page errors. Phone uses native cell polygons; desktop uses the existing maximum-native-depth-per-screen-bin overview. The checks recognize both actual renderer paths. Final phone viewport 390×844 keeps the dock within the screen. Local full-map screenshots were visually inspected; uploaded images contain only app controls. Physical Android was not tested. Existing 3D remains available but was not changed or newly accepted in this increment.

Preview on the home PC:
http://127.0.0.1:18769/index.html?case=refined&replay=brawley-nov1#/map

Evidence: `public/ux-preview/saved-replay-checks.json`, `saved-replay-controls-390.png`, `saved-replay-controls-1440.png`. Local full-map captures: `ux-evidence/replay-390.png` and `ux-evidence/replay-1440.png`.

No main merge or production deployment. Remaining limitations are the saved model's coverage/quantity limitations, unresolved all-route overlaps and uncovered records, no directional flow visualization, and no observed historical reconstruction.
