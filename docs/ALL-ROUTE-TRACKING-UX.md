# All-route tracking UI

Original requests, verbatim:

> I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.
>
> I explicitly said earlier to start all fucking junctions dickhead
>
> Get these done in my usage limit. Start handing things off to claude a lot more.

Experimental branch: `experiment/all-route-tracking-ux`, based on the verified remote UX HEAD 2461a8d. Brawley correction 3985ebb was cherry-picked as 8c4420a before integration. No fluid renderer, solver, main merge, production deployment, new dependencies or unrelated sessions changed.

Open the existing app, choose Avra Valley or Picture Rocks, open a route and expand **Coverage & gauge tracking**. Search by location, coordinates or record ID, or filter by coverage/overlap. Existing crossing screens show their exact record; existing map crossing links continue to lead to those screens. There is no new analytics page or home-screen ledger.

The c3c48cb adapter supplies 458 canonical evidence identities: 234 full-window, 165 partial-window, 59 uncovered. The UI replaces the old partial inventory list with this ledger while retaining original gauge metadata/cards and refresh controls. Shared route memberships remain attached to each identity; route totals overlap and are not counts of independently confirmed physical dips. Per-route counts checked: Avra65, Trico37, Silverbell north42/south51, Picture Rocks via Avra64/Twin Peaks84/Ina73/Gates155.

Each expanded record has one recorded-time control and separately named case cards. The Northern/Picture Rocks conflict remains unresolved and both values are displayed without selection, averaging or risk-score changes. At the maximum reported discrepancy location and time the actual UI showed cell-average depths4.542ft and0.093ft; the separate water-surface difference is4.785ft, not a confidence interval. Sources and water-surface elevations are under expandable details.

Frozen source issue dates and each case's real validity window remain visible. Picture Rocks ends at Nov2 06:45UTC; selecting07:00UTC shows unknown/no output rather than holding its previous reading or borrowing Northern output. Native volume and surfaces are consumed unchanged. Displayed depths are full-cell means in feet, never validated pavement depth or clearance. Unknown/missing data never becomes zero. Each case's terrain, exact wet extent and velocity are unavailable; existing maps keep their own runs.

Validation: full suite264 tests,263 passed,1 skipped (optional large native-map check; backend owner already verified those artifacts, and this UI does not load them). Final focused33 tests passed after label refinements. Chrome verified all eight counts, exact Brawley record and two gauge cards, search, uncovered filter, both overlapping outputs, missing final frame,390px/desktop/200% text with no horizontal overflow or page errors. Opening point details requested no large native maps or archives. App-only screenshot crops hide the fixed header for export. Physical Android, new full-case rendering and geometry diagnosis were not performed.

Local preview: http://127.0.0.1:18769/index.html (home PC only). Hidden local preview process22644; no remote deployment. Evidence: `public/ux-preview/all-route-checks.json` and `all-route-*.png`.

Remaining limits:59 uncovered records including the Gates terrain gap;165 partial-window identities and the missing Picture Rocks final frame;24 identities have multiple available outputs (23 have finite matched surface comparisons), with unresolved inter-case differences; no guarantee every real-world dip is surveyed; no invented gauge associations. Existing working maps are not switched to these new point cases.
