# Live UI recovery

Branch `experiment/live-ui-recovery`, from `main` at `8aaa035`. Selected work from `a6a457e` (`experiment/today-roads-release`), originally `768296b` (`experiment/all-route-tracking-ux`). Not merged or deployed.

## Restored

- Shared accessible risk colors, on route lines and every map pin. Half-point scores such as 2.5 now get a color.
- Accessibility styles, visible Back and Refresh labels, Help link, risk key and the 3-step guide.
- Heights and bridge evidence in feet.
- Cache stamping for all modules and `release-version.json`.

## Rebuilt for live data

- Route tracking lists all 458 locations. `public/simulation/data/route-tracking.json` holds identities and gauge links only. Coverage now means which live sources reach a location: forecast, road height comparison, county barricade and linked gauges. Gauge readings come from the app's live feeds with their own observation times.

## Left out or switched off

- Road replay, Silverbell scene, all-route model points, scene contract, recorded readings and the frozen outlook button.
- The Map screen opens with SFINCS showing, as in the original design.

All model data is published.

## Kept from main

Route closures, closure banner and markers, no directions on closed routes, TransView feed, lone caution rule, distant gauge rule and road height in the flood check.


## HAND water layer

HAND now paints estimated water depth in six blue to teal bands, in feet, with a matching legend on the map. Depth is stage minus HAND for each cell, read from the same stages and mask as the extent, so the painted area is exactly the estimated extent. The old layer used one amber fill and depended on the renderer that production no longer starts. Amber and red stay reserved for routes and crossings.

Checked in a browser against live forecasts: Trico-Marana at 2,460 cfs painted 5,087 cells and Brawley at 43 cfs painted 961, both equal to the HAND grid.

## Test flood mode

Removed. It hid the simulator behind an opt-in mode, which was never asked for. See `SIMULATED-CONTENT.md`.
