# Accessible colors and optional guide — experimental checkpoint

Base remote HEAD verified before branching: 532d85b602a4f462f223ff0d59750924681c56fd. Independent checkout; branch experiment/accessible-colors-onboarding. No solver, scoring, closures, validity, renderer implementation, dependencies, auth or deployment changes.

## Implemented
- Shared risk palette for route lines, HTML badges and the existing geographic marker interface. Fractional scores use their integer risk color consistently; numeric scores remain unchanged.
- White badge text contrast: levels 1–5 respectively 6.53, 6.46, 6.53, 5.85, 6.57; unknown 6.75. Unknown uses a separate purple-gray and dashed HTML badge treatment. Existing numeric/question-mark cues remain.
- Readability overrides, labeled Back/Refresh/Help, wrapping secondary text, large controls, independent risk explanation beside map tools. Existing blue/purple quantitative depth key is unchanged.
- Explicit Help > Show me how, three steps: route, warnings/source freshness, time/details. Back, Skip, Close, Done, Escape and replay; native modal focus containment and return focus. Never opens automatically or changes model/route state.

## Actual checks
Chromium at 390x844 and 1440x1000; phone home, desktop home, guide and flat geographic map screenshots inspected. Dark map and 200% root text captured and inspected. No horizontal overflow in measured guide/help or map views, no browser page errors. At 200% the guide scrolls vertically and all four controls have 76px height. At normal size guide buttons exceed 48px. Enlarged map permits page and dock scrolling.

Full existing suite: 214 tests, 213 passed, one failed: test/forecast-regional.test.js:22 expects simulation/forecast.html while unchanged map-shell.js links inundation/index.html. Both failing-test inputs identical to base HEAD. npm ci used existing lockfile; reported one moderate advisory, no automatic upgrade performed. Test-generated Apps Script file restored; it is not part of this patch.

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

