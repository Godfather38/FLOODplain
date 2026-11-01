# Focused experimental 2D map release candidate

Base: current main c86a641. This is a draft candidate, not permission to merge or deploy.

Scope: a first-class Map destination in the existing application, showing only the retained partial November1,2026 SFINCS replay. Exact native depth picking, timestamp/range controls, variable-size cells and explicit unknown coverage. Current live conditions, HAND risk additions, underpass screens, saved routes/navigation, closures and notification behavior remain from main. Refined replay does not write current risk results. No solver automation or current predictive-service claim.

Only 2D is exposed. Historical dashboards, solver tools, original large JSON packages and optional3D terrain are not included. Generated renderer code retains an unreachable lazy3D dependency, but the release UI exposes no3D entry and refined manifest has no terrain support. Renderer notices remain included. The original native/JSON source package stays on its immutable experimental commit; compact manifest links it for provenance.

Data:21frames10AM-3PMMST; nine requested hours missing. Native full-cell mean depth is not road depth or resolved shoreline. Initial model payload14.55MB, subsequent frames1.8-2.4MB; exact values retained. No general accuracy interval supplied.

Preserved files with no functional changes: public/logic.js, config.js, engine.js, existing HAND files, underpasses.js, AppsScript/Twilio/notification files and all workflow configuration. Existing app.js changes are additive map lifecycle/navigation, source warning and bridge evidence UI, not risk computations. Existing index.html adds map styling.

Validation:97 existing/targeted checks plus one release-asset integrity check passed; CI also passed. Renderer fix6578ef9 is integrated. Its actual-data stress ran24pans,4framechanges,4zoomchanges with one active overview and no crashes/errors. Diagnostic collected JS heap stayed152.5-156.6MB through pans,189.8MB after frame/zoom changes; this excludes total browser/GPU memory. Remote main-based candidate checks covered20desktop pans across two UI checkpoints,6zoom changes,actual frame changes,range1PM-3PM,route/underpass navigation,phone rendering and opt-in data loading. No JS errors or tab crash observed. The original user crash remains unproven; bounded work/memory fixes address demonstrated problems, not a claimed root-cause proof. Production basepath uses relative assets; the exact deployed-site smoke check awaits separate deployment approval.


Draft PR: https://github.com/Godfather38/FLOODplain/pull/8 . Main/default branch and production are unchanged. Remaining minor issue: a drag can sometimes open a no-coverage popup. Frozen partial scope, unvalidated road depth and missing nine hours remain visible. Refined3D is not exposed.

Final remote phone check at 5dee742: 390x844 viewport, document height844 (no page overflow), native face266577 displayed0.653m/2.14ft at10AMMST. Replay dock hidden after returning to live home. Screenshot: public/simulation/preview/2d-release-phone.png. Preview: https://raw.githack.com/Godfather38/FLOODplain/5dee742/public/index.html#/map

Focused drag fix7a6eb0c:8CSS-pixel movement threshold plus map dragstart suppresses ensuing pointer click until a fresh pointer gesture. Keyboard-origin clicks and programmatic cell selection remain available. Remote verification:six pans without popup, direct tap on face266577 returned0.653m/2.14ft at10AMMST, second tap after further pans opened face97186, no JS errors. Guard and asset integrity checks passed. Existing renderer bundle/chunks preserved; no model changes.
