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

Validation: 102 existing tests passed. Remote interaction checks passed as recorded below. Production risk, notifications, Apps Script and workflows are unchanged.

## Scope mistakes to prevent

The supplied handoff identifies four distinct failure types: making fresh/refined solver work a release prerequisite; replacing full water shading with HAND-only markers; shipping only a frozen replay without the current product layers; and redoing already-working UI/renderer work. This is a count of evidenced failure types, not an invented count of every occurrence in unavailable conversation history. The common cause was substituting a new technical project or narrower deliverable for the requested visual integration.

## Remote acceptance, November 1, 2026

Verified bf72901 in the browser: full original water rendered; four desktop pans plus two phone pans; zoom; frame change from 2 PM to 3 PM; HAND and Combined; range 1 PM–4 PM; exact cell 14641 picked at 3 PM (0.012 m / 0.04 ft); 390x844 phone layout; return to live safety home and Trico route details, then map again. HAND displayed valid 3 PM / issued 10:16 AM MST separately from retained SFINCS issued 9:47 AM with calculated age. Six current river gauges and current county closures appeared in map options. No fresh heap measurement or physical-phone claim.

Remote packaging check caught missing original water-footprint frame files; all 15 existing frames were copied unchanged. A stale experimental forecast link was wired to the existing forecast detail page. No new assets generated.

Draft PR: https://github.com/Godfather38/FLOODplain/pull/10

## Completed original-model publication

Bound solver-owned existing result 81bec601b3095de8e66b73245795c335194a023a / run 41350254061. The unchanged existing adapter reuses retained terrain and native grid; it derives display frames from delivered native water levels. No solver or terrain/geometry rebuild was performed. Original retained output and original display frames remain available with ?case=coarse.

Local publication verification accepted all 29,685 cells and 15 hourly frames (Nov 1 22Z to Nov 2 12Z), verified identical cell coordinates/order, CRS and area, and verified all 16 display artifact checksums. NWM 18Z and HRRR 19Z issues are preserved. This is one issuance, without automatic refresh. Remote current-publication check follows.
