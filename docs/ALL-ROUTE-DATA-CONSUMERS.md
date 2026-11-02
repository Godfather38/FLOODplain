# Completed all-route data consumers

Original user requests, verbatim:

> I explicitly said earlier to start all fucking junctions dickhead
>
> I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.
>
> Get these done in my usage limit. Start handing things off to claude a lot more.

This opt-in adapter binds existing published results at commit `3dce053f1b22f80bbfb8cb9d3fbe46636fba6620`. It reuses `quadtree-output.js` and `modelFreshness`; no renderer, risk engine, production pointer or solver is changed. Claude's fluid renderer remains separate.

```js
import {loadAllRouteData} from './all-route-data.js';
const data = await loadAllRouteData({now: new Date().toISOString(), signal});
const rows = data.inventory({routeId:'pr-avra', time:'2026-11-02T07:00:00Z'});
// Choose an explicit modelOutputs[].runId; this adapter never chooses for you.
const c = await data.openCase('all-routes-picture-rocks-v2-41382872468');
const point = await c.readPoint(rows[0].id, '2026-11-02T06:45:00Z');
// Optional full-map loading: await c.geometry(); await c.readFrame(exactUTC);
```

Integration files:

- `public/simulation/all-route-data.js`: inventory, per-case point and compact-map consumers.
- `public/simulation/data/all-route-publication.json`: checksummed catalog pointer.
- `public/simulation/data/all-route-data/catalog.json`: 458 canonical evidence identities and all case bindings.
- `public/simulation/data/all-route-data/points-<sourceRunId>.json.gz`: small native point-series packages.
- `tools/simulation/bind_all_route_results.py`: deterministic binding from the pinned Git objects; does not rebuild source models or maps.

Use `inventory()` for the new all-route results instead of treating legacy inventory `model` fields as current coverage. The source ledger remains immutable and linked by hash. Its actual allRouteNativeOutputs replace old pending states in this consumer, without overwriting the historical scene inventory. Original gauge associations are carried through. Existing closures, thresholds, route weighting and assessments remain owned by the existing safety engine; this adapter does not clear or calculate them.

| Package runId | Recorded window UTC | Frames |
|---|---|---|
| all-routes-gates-supported-v2-41382857288 | Nov1 17:00–Nov2 07:00 |57|
| all-routes-northern-v3-41382880257 | Nov1 17:00–Nov2 07:00 |57|
| all-routes-picture-rocks-v2-41382872468 | Nov1 17:00–Nov2 06:45 |56|

All dates are2026. Frozen issue times remain NWM Nov1 13:00Z and HRRR Nov1 14:00Z. A supplied assessment clock determines freshness; output availability never makes a frozen result current. Picture Rocks07:00 is absent following the approved timeout. `readFrame` rejects it before loading; `readPoint` returns `missing_frame` and null depth. No last-frame hold, interpolation, extrapolation or alternate-run fallback occurs.

Counts are234 full-window,165 partial-window-only and59 uncovered evidence identities. Eight routes share identities; route totals overlap. The458 records comprise88 original entries,203 official road junctions and167 terrain-minimum candidates. These are evidence identities, not458 independently confirmed physical dips. Exact uncovered coordinates and route memberships are the catalog entries with `coverageStatus:'uncovered'`; they preserve the Gates terrain gap rather than declaring those roads dry.

Each native face is keyed by **package runId plus nativeFaceId**. Numeric GitHub workflow IDs are separately named `sourceRunId`. Never use a face ID alone across cases. Every case loads its own compact manifest, geometry and exact requested frame through existing checksum and native-quantity validators. Maps and native archive manifests reference the already-published pinned GitHub commit; opening inventory or point data does not download the large maps/archives. This requires network access to raw.githubusercontent.com for full maps. No new service or credentials are introduced. A network/checksum failure is an error, not dry data; failed cached requests can be retried.

Point samples preserve signed native volume and NAVD88 water surface. Display mean depth is max(0,volume)/full cell area, matching the existing compact reader. Missing quantities remain null. These are not pavement depths or passability determinations. Terrain for each new geometry remains unavailable until separately source-bound; the Brawley terrain/flow package must not be borrowed for these face IDs.

**Overlap remains unresolved.**24 identities have multiple available outputs; the source readout compares23 identities with finite matched surfaces. Northern/Picture Rocks differ by up to1.4583740234375m at `terrain-minimum-f39cdaa394b1`, [-111.14677950660457,32.402354407487806], Nov2 02:45Z. Both outputs and the entire original readout are retained. This is an actual inter-case difference, not an uncertainty interval. There is no averaging, safer-case selection or seamless combined surface. `inventory()` reports overlap status and the matching comparison where available; geometry diagnosis belongs to the geometry owner.

Focused checks verify ledger counts, route deduplication, freshness, missing final frame, uncovered/null states, overlap values, source hashes and each case's actual geometry/frame against its native point series. No full archive unpacking or solver execution is required.

Routine `node --test test/all-route-data.test.js` uses the small checked-in packages. The additional real compact-map check is enabled with `FLOODPLAIN_NATIVE_CHECK=1` after fetching the pinned source commit; it reads those Git objects without extracting or rebuilding them. That check was run for all three cases for this delivery. Rebuilding the bindings likewise requires the pinned source Git objects locally.
