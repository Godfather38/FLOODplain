# Existing-product 2D release

Base: production rollback 463a510. Experimental only; no main merge or production deployment is authorized.

## Acceptance checklist

- Full original SFINCS water map: pan, zoom and native cell depth picking.
- HAND, SFINCS and Combined, with independent source clocks.
- Frame selection and Start/End browsing range preserve viewport.
- Prominent Map navigation and return to existing live routes and conditions.
- Sparse phone layout and existing bounded pan renderer.
- Retained original water shapes remain visible with issue time, age and actual available valid window.

Reuse: full map integration from experiment/current-map f234d23, original fast model default from 30bcc7f, and published renderer/click stability bundle from ea27bb3. No new packages, solver runs, geometry work or model artifacts were created. Locked test dependencies were installed unchanged.

Fresh SFINCS output is independent follow-up work. It is not required to finish this visual integration. The existing verified publication consumer remains; no automatic SFINCS refresh trigger is enabled. Current observations, closures and HAND retain their live timestamps. Retained SFINCS is not represented as current weather.

Validation: 102 existing tests passed. Remote interaction verification pending. Production risk, notifications, Apps Script and workflows are unchanged.

## Scope mistakes to prevent

The supplied handoff identifies four distinct failure types: making fresh/refined solver work a release prerequisite; replacing full water shading with HAND-only markers; shipping only a frozen replay without the current product layers; and redoing already-working UI/renderer work. This is a count of evidenced failure types, not an invented count of every occurrence in unavailable conversation history. The common cause was substituting a new technical project or narrower deliverable for the requested visual integration.
