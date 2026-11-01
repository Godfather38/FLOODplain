# 2D draft: authoritative delivery checklist

This checklist supersedes narrower current-HAND/replay-only completion claims. The product is one full pannable geographic water map in the existing FLOODplain app. Preserve routes, saved routes, warnings, official closures, live readings and the existing risk engine. Production is currently restored; this branch is experimental and is NOT ready for production publication yet.

| Requirement | State and evidence |
|---|---|
| Full pannable SFINCS spatial water map, exact depth legend/picking and actual time/range controls | Existing optimized renderer and compact full-domain output restored in be450c6; integrated remote verification pending. Retained output is partial, 21 native frames Nov 1 17–22 UTC, not a newly refreshed run. |
| HAND / SFINCS / Combined in the same geographic map | UI integration implemented in be450c6. Current HAND uses current NOAA forecast; Combined must show its separate issue/valid time, never average it with SFINCS depth. Remote combined verification pending. |
| Current readings, rain gauges and county closures | Verified six current gauges in 45b8e66. Shared five-minute refresh, original observation timestamps, stale/missing states and request caching. Recheck in restored renderer pending. |
| Current coarse SFINCS MODEL refreshed from current inputs, executed, exported and published to experimental map | MISSING and REQUIRED for this 2D draft. The retained approximately 29,685-cell model and 13.59-second prior run are reusable; old output alone does not satisfy this item. Input acquisition/assembler/exporter exist; newest complete input package and execution handoff with solver owner remain outstanding. |
| Last successful SFINCS retained during refresh/failure | Retained package restored. Source cycle and partial validity are explicit. Atomic new-publication switching exists in exporter; matching geometry/companion output integration must be verified with an actual new run. |
| Prominent Map navigation, safety-first home and current route ratings | Existing production logic preserved on this branch; original current HAND route logic unchanged. Restored shared map navigation is implemented; navigation verification pending. |
| Pan stability and mobile memory | Reusing prior pan-stability fixes, bounded overview, compact lazy frames and flat-first renderer. No new integrated performance claim until repeated pan/time/navigation check. |
| Source age, valid time, missing domain and unavailable frames | Current APIs verified; retained output labelled separately. Outside-domain is unknown, never dry/safe. No fake current water depths. |
| Preserve production/Twilio/notifications | No main merge or deployment; existing risk and notifications code unmodified. |

## User journeys / acceptance

1. Home: see current route ratings, closures, warnings and observation freshness. Map is a primary destination, not a separate tiny demo link.
2. Map: pan freely through actual supported model domain; tap a native cell for depth in metres/feet, model and selected valid time. Missing coverage is explicit.
3. Choose SFINCS, HAND or Combined. SFINCS is a spatial solver output; HAND is a separately labelled estimate. Combined preserves both clocks and disagreement, not a fabricated averaged depth.
4. Select a frame or Start/End browsing range without losing viewport. A range does not silently mean maximum flood depth.
5. Refresh current feeds and coarse SFINCS independently. Keep the last successful output visibly dated while a new run is pending or fails; only replace it after real completed output and matching geometry are available.
6. Repeated pan, zoom, frame switch and route-return work at phone/desktop widths without runaway allocations or eager 3D downloads.

## Rejected substitutions

HAND-only/marker-only map; frozen-replay-only completion; hiding/removing the full water map; relabeling old output as live; inventing SFINCS depths from gauge readings; replacing the safety engine; making 3D or finer/refined geometry prerequisites for the 2D draft. Sensors, credentials and production automation are not implicit prerequisites.

## Separate workstreams

3D and finer model geometry remain optional experimental work. They must not delay current coarse SFINCS plus the functional 2D map. No production release until separate approval after the concrete missing items above are addressed.
