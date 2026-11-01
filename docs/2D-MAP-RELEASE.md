# Focused experimental 2D map release candidate

Base: current main c86a641. This is a draft candidate, not permission to merge or deploy.

Scope: a first-class Map destination in the existing application, showing only the retained partial November1,2026 SFINCS replay. Exact native depth picking, timestamp/range controls, variable-size cells and explicit unknown coverage. Current live conditions, HAND risk additions, underpass screens, saved routes/navigation, closures and notification behavior remain from main. Refined replay does not write current risk results. No solver automation or current predictive-service claim.

Only 2D is exposed. Historical dashboards, solver tools, original large JSON packages and optional3D terrain are not included. Generated renderer code retains an unreachable lazy3D dependency, but the release UI exposes no3D entry and refined manifest has no terrain support. Renderer notices remain included. The original native/JSON source package stays on its immutable experimental commit; compact manifest links it for provenance.

Data:21frames10AM-3PMMST; nine requested hours missing. Native full-cell mean depth is not road depth or resolved shoreline. Initial model payload14.55MB, subsequent frames1.8-2.4MB; exact values retained. No general accuracy interval supplied.

Preserved files with no functional changes: public/logic.js, config.js, engine.js, existing HAND files, underpasses.js, AppsScript/Twilio/notification files and all workflow configuration. Existing app.js changes are additive map lifecycle/navigation, source warning and bridge evidence UI, not risk computations. Existing index.html adds map styling.

Validation so far:97tests passed after installing locked dependencies. All copied relative module references checked. Actual pan-stability fix and remote candidate interaction checks are pending; do not merge until these are recorded. Production basepath should remain relative public assets under the existing Pages project directory; final deployment smoke check requires approval.
