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

## Narrow river-bridge engine correction

The earlier bridge patch was presentation only: 4,350 cfs exceeded the shared 3,000 cfs threshold, producing bridge caution/3 and route 3 without a bridge-clearance comparison. The focused correction keeps that discharge threshold as source evidence (`dischargeLevel`) but treats discharge alone as the existing watch/advisory level for river bridges. Deck/approach clearance remains explicitly unknown. Exact-site registry matching and history are reused; historical marks, inventory dimensions and other bridges' reports are not current clearance thresholds. Official closures and independent local hazard checks retain precedence; at-grade rules and HAND weighting are unchanged. An advisory bridge with unknown clearance cannot make `recommend.clear` true.

Fixtures: Cortaro 4,350 cfs -> Trico bridge/route 3 to 2, clearance unknown; Brawley at-grade 4,350 cfs stays 5; closed bridge stays 5; missing registry/height remains advisory with unknown clearance and no borrowed history. All 109 checks pass, including service bundle compatibility. Existing all-sources-missing fallback behavior is outside this focused change.

## Bridge roadway and water elevations (2026-11-01)

The safety view now shows the supplied provisional roadway profile estimates, the native water elevation in the 100 m cell containing the same bridge, and their difference in NAVD88 metres. Trico-Marana is approximately 590.7 m roadway versus 586.7153 m peak modeled water (3.9847 m below the estimated road). Avra Valley is approximately 633.8 m roadway versus 627.6460 m peak modeled water (6.1540 m below the estimated road). Trico peaks at 2026-11-02 12:00 UTC (5 AM Arizona); Avra peaks at 2026-11-01 23:00 UTC (4 PM Arizona), within the delivered 15-hour forecast. These are estimated roadway differences, not underside clearance or observed road conditions.

Road approach inputs supplied for crosschecking: Trico 590.841/590.577 m; Avra 633.598/633.953 m. Exact approach point checks against retained 1 m terrain remain pending with the geometry owner. The source road profile is linked. No surveyed deck or low-chord elevation is claimed. Existing native `zs` was extracted from cells 15761 and 6804 after matching the bridge coordinates to the unchanged grid; the registry records native file hash, run, issue, frame times and model limitations. No solver, new terrain or packages were used. The evidence loader suppresses water values if the publication run changes, and expired forecasts cannot supply a current comparison.

Checks: reported 4,350 cfs remains a river advisory, not asserted bridge inundation; at-grade Brawley retains its existing 5; a county closure stays 5 even when modeled water is below the estimated road; unavailable/stale measurements do not produce a clear-route recommendation; wrong datum, another location or discharge instead of elevation cannot be subtracted. All 113 existing and focused tests pass. The provisional height comparison does not override observed closures or local hazards. The separate proposed 2014 flag was not implemented.
