# Accessible colors and optional guide — experimental checkpoint

Base remote HEAD verified before branching: 532d85b602a4f462f223ff0d59750924681c56fd. Independent checkout; branch experiment/accessible-colors-onboarding. No solver, scoring, closures, validity, renderer implementation, dependencies, auth or deployment changes.

## Implemented
- Shared risk palette for route lines, HTML badges and the existing geographic marker interface. Fractional scores use their integer risk color consistently; numeric scores remain unchanged.
- White badge text contrast: levels 1–5 respectively 6.53, 6.46, 6.53, 5.85, 6.57; unknown 6.75. Unknown uses a separate purple-gray and dashed HTML badge treatment. Existing numeric/question-mark cues remain.
- Readability overrides, labeled Back/Refresh/Help, wrapping secondary text, large controls, independent risk explanation beside map tools. Existing blue/purple quantitative depth key is unchanged.
- Explicit Help > Show me how, three steps: route, warnings/source freshness, time/details. Back, Skip, Close, Done, Escape and replay; native modal focus containment and return focus. Never opens automatically or changes model/route state.

## Actual checks
Chromium at 390x844 and 1440x1000; phone home, desktop home, guide and flat geographic map screenshots inspected. Dark map and 200% root text captured and inspected. No horizontal overflow in measured guide/help or map views, no browser page errors. At 200% the guide scrolls vertically and all four controls have 76px height. At normal size guide buttons exceed 48px. Enlarged map permits page and dock scrolling.

Initial full existing suite before test correction: 214 tests, 213 passed, one failed: test/forecast-regional.test.js:22 expects simulation/forecast.html while unchanged map-shell.js links inundation/index.html. Both failing-test inputs identical to base HEAD. npm ci used existing lockfile; reported one moderate advisory, no automatic upgrade performed. Test-generated Apps Script file restored; it is not part of this patch.

## Remaining limits — not acceptance claims
- The final phone flat-map screenshot shows the acknowledged Nov 1, 6:00 PM MST model time, separate feet depth legend and restored green route risk marker. Full loaded-water 3D, model failure states, all hour controls and selected-cell transitions still need a dedicated verification run. No 3D acceptance claimed.
- Geographic canvas markers remain the existing 26px targets and map labels are small; improving their target geometry requires renderer-owner work. Unknown question marks use the existing renderer sizing behavior.
- This is the shared-shell pass, not a completed audit of every standalone experimental page, all Android accessibility services, every source state or every screen at 200%. The guide is instructional rather than an interactive spotlight walkthrough.
- Existing bridge wording/data and all model quantities are preserved. No freshness/scoring changes made.

## References read
https://developer.android.com/guide/topics/ui/accessibility/apps (48dp native targets; web controls here target 48 CSS px)
https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html (4.5:1 normal, 3:1 large)
https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html (200% without lost functionality)

## Upload review
Automatic approval review denied git push to Godfather38/FLOODplain experiment/accessible-colors-onboarding: it requires end-user-authored authorization specifying destination and code/screenshots payload. Parent subsequently supplied the explicit user authorization for non-sensitive experimental uploads. One retry is authorized. Map/home screenshots containing third-party basemap imagery remain local and are excluded from the outgoing history; only app-only guide screenshots and checks are included. No production deployment.


The failing test also expects the label 'Official river forecasts'; base map-shell.js instead uses 'River forecast details'. Both assertions describe the older destination; this UX patch changes neither file.


## Follow-up: forecast target and 3D attempt
The actual Map options > River forecast details link opened /inundation/index.html in Chromium. It rendered “Estimated flood extent”, populated 52 crossing choices, and showed “Choose a forecast or a flow.” No live forecast request was enabled. The obsolete test expectation now matches this existing destination and label, and additionally reads the target HTML to check its heading, crossing selector and recorded forecast control. No navigation implementation changed. Affected checks: node --test test/forecast-regional.test.js — 5/5 passed. The full suite was not rerun after this test-only correction; the initial 213/214 result above is historical, not a current full-pass claim.

At 390x844, attempted Map options > More layers & 3D > 3D map. The existing renderer refused activation with “Rendering failed: Terrain detail provenance mismatch”. Button remained “3D map”, aria-pressed=false, and no displayed model frame was acknowledged. The flat fallback and explicit error remained visible. Active 3D risk colors therefore could not be verified. No renderer assets, provenance checks or model data were changed.

Observed camera controls measured 48x48 CSS px for zoom and 56.45x48 for Locate, with 14px labels; no horizontal page overflow. The numeric risk key retained all five levels and Unknown separately from depth. Help remained reachable after the failed 3D attempt; the guide advanced through all three steps, closed, and Map could be reopened. No browser page errors. The screenshot containing basemap imagery stays local at ux-evidence/3d-phone.png; only the non-sensitive structured result is uploaded.

## Combined integration supersedes the earlier 3D blocker
The renderer-owner fix is now cherry-picked as 355a557. Both current and refined paths successfully entered 3D alongside the final tracking UI. Full suite 219/219 passed. See ROUTE-TRACKING-UX.md and public/ux-preview/combined-verification.json for final evidence and remaining limitations; the mismatch reported above describes the earlier checkpoint.
