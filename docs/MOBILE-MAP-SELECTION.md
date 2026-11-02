# Mobile map point selection

Focused correction on experiment/accessible-colors-onboarding, following combined UX/inventory checkpoint edb9641. No new dependencies, model/risk changes, new map design or production deployment.

## Behavior
The geographic renderer keeps 26px crossing symbols and 12px gauge dots. Selectable point centers now have invisible 48x48 CSS-pixel hit areas, and visible gauge text also remains selectable. Hit testing uses the renderer’s existing geographic-to-screen projection in flat and 3D views. The existing 8px movement guard and map interaction check run before any point or model-cell selection. Tiny canvas geometry events no longer bypass that guard.

A single point opens its existing route/details action. Overlapping targets open a native dialog listing every hit, ordered by distance. Crossing numbers/colors and gauge source descriptions remain visible. The chooser has labeled Close, Escape/backdrop dismissal, native keyboard focus containment, and a scrolling layout at enlarged text. Gauge details have their own explicit Close/Escape action.

Existing route lists and the recent-USGS gauge selector remain intact. Map options additionally offers “Crossings & gauges in view”, using the same chooser as a keyboard-accessible list for all current point types, including county readings. It shows points in the current geographic viewport, including points covered by UI panels. It does not dump all inventory entries on home or invent new locations.

## Actual verification
Full unit/regression suite: 223/223 passed. Final focused checks for picking, retained terrain provenance and route tracking: 9/9 passed. Browser test is test/verify-mobile-map-selection.mjs (uses the same existing external Playwright/Chrome setup as other renderer checks).

Actual 390x844 Chromium touch emulation: Trico-Marana bridge plus nearby USGS and county readings opened an overlap chooser. Rows measured 316x74 CSS px. A tap outside the compact symbols selected their enlarged hit areas. The gauge opened its original source/time details; the crossing opened #/r/trico/sc-trico-marana and remained reachable from the original route list. The USGS history selector retained the station. Keyboard Enter on the existing Map options list opened the county reading without a point tap. Close and Escape dismissed the chooser; touch dragging did not open a chooser or model-cell popup. The same real nearby targets were selectable in 3D. At 200% text the dialog and badges reflowed without horizontal clipping; long lists scroll vertically. Chooser-only screenshots were visually inspected.

The test uses real geographic identities and existing public feed content, not invented crossing positions. It requires the app’s normal geographic/model assets and public feeds. No physical Android performance or full screen-reader certification is claimed.

## Build and evidence
Regenerated the existing split renderer bundle using the already-installed matching renderer dependency versions; no package or lockfile changes. Removed superseded generated chunks. Existing license notices remain. Structured results and app-only chooser crops are in public/ux-preview/map-selection-checks.json, nearby-chooser-phone.png and nearby-chooser-200.png. Other map screenshots remain local.

The CDP touch-drag check also compared map centers before and after the gesture: the camera moved while chooser and model-cell selection stayed suppressed (panMoved=true).
