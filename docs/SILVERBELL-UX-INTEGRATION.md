# Silverbell recorded results integration

Original request, verbatim: "I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river."

Also preserved: "I explicitly said earlier to start all fucking junctions dickhead"

This increment connects backend 8e5260c to the experimental app. Both West Silverbell minimum records now open 57 source-bound point samples on both Silverbell routes. Dates remain the original frozen NWM/HRRR issue and validity times. Values are cell-average depth in feet, not pavement depth or clearance. Unknown and tiny nonzero values remain distinct from zero. Separate recorded-time controls do not change map time or route risk.

The point consumer verifies the publication manifest and point-scene checksums, run/geometry/location/frame identities and original source clocks. It downloads only the small point scene and metadata; the complete native package and opt-in loader remain available at their contract paths. Source JSON byte preservation is covered by the imported .gitattributes.

New matching 3D terrain, precise wet extent and velocity remain unavailable. Existing maps are retained. Gauge associations and refresh adapters remain unchanged; neither Silverbell minimum has a supplied linked gauge, so no association is invented.

Validation: all 229 tests passed. The old awaiting-output test uses a synthetic pending record now that both real records have completed. Both routes and both points were exercised in Chrome at 390 px, desktop and 200% text: 57 options, next/end controls, no horizontal page overflow, no page errors, no full native geometry/frame download. Full selected time is also printed below the native select, which can truncate its option text at 200%. App-only screenshot exports hide the fixed appbar to avoid overlaying the captured panel; this does not change application code. Existing default/current and refined 3D maps rendered at 390 px, with 15/57 frames, matching picked values, visible risk symbols and working optional guide. Physical Android was not tested.

Scope remains incomplete: 88 inventory locations include 49 original-refined memberships and two completed Silverbell points. The other 37 are outside the original refined footprint, not a claim about the new domain. Only two routes have complete supplied centreline-minimum screening. This is not completion of every junction or a survey of every real-world dip. No model run, main merge or production deployment occurred.
