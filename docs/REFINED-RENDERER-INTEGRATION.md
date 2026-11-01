# Opt-in refined renderer compatibility

Prepared against UI adapter commit `324a841` and `docs/QUADTREE-OUTPUT-ADAPTER.md`. This is compatibility code, not a completed refined forecast. The current frozen preview, current manifest and existing 100 m assets remain unchanged. No new solver run or expanded coverage is published.

## Integration

The existing renderer entry now exports `createRefinedRendererSource` alongside `createGeographicView`. The UI owner can opt into the completed package after its existing checksum/identity checks:

```js
import {readQuadtreeArtifact, acceptQuadtreeGeometry}
  from './quadtree-output.js';
import {createRefinedRendererSource, createGeographicView}
  from './geographic-view.js';

// manifest must describe the actual completed immutable package.
const geometry = acceptQuadtreeGeometry(manifest,
  await readQuadtreeArtifact(packageBaseURL, manifest.geometry));
const source = createRefinedRendererSource({
  manifest,
  geometry,
  readArtifact: (artifact, options) =>
    readQuadtreeArtifact(packageBaseURL, artifact, options),
});
const view = await createGeographicView({
  leaflet, source, routeLayer, sharedState,
  initialView: 'flat', onError, onStatus, onSelectCell, onPick,
});
await view.ready;
await view.update(manifest.frames[index], modelMode, contextGroup);
// Existing UI displayed-frame acknowledgement happens only after this resolves.
```

`readArtifact` must verify each compressed artifact's SHA256, as the UI package reader does. It must forward `AbortSignal`. Do not substitute unchecked JSON fetches. The renderer validates run ID, geometry hash, exact timestamp, array lengths, finite/null quantities and native volume / individual face area again. Already verified full frame objects may also be passed to `update`. Hourly and subhourly times are taken literally; the source never invents intermediate frames or assumes an hourly index. Popup times include minutes for this path.

Only the requested frame is loaded. The source retains at most two frames; obsolete requests are aborted and cannot install late. Prior water and popup are cleared while a new frame is pending. A failed or missing frame cannot leave a preceding forecast painted on the map. Hide cancels pending source work; dispose releases the source cache. Create one source per view lifecycle.

Without `source`, the published continuous flat/3D path keeps its existing behavior. The new path never accesses `frozen-terrain-display`, `frozen-voxel-terrain`, `voxel-detail-1m`, or old `water-footprints-N` files. Include the generated entry and its current hashed chunks together during integration. No main app/UI-owned files were edited in this checkpoint.

## Geometry, quantities and display

- Native ring length is arbitrary, including collinear hanging-edge nodes. Polygon bounds determine visibility; selection uses every edge. Exact string `nativeFaceId` values are never coerced to numeric IDs. The shared selection callback still receives the geometry-order index; the exact ID, area and resolution are available through `source.cellInfo(index, frame)` and the 3D model's `cellInfo`.
- `areaM2` and `resolutionM` belong to each native face. No fixed origin, row, column, 100 m assumption or area padding is used. Raw signed `nativeVolumeM3`, separate native `waterSurfaceM`, datum, explicit zero and explicit null are retained.
- With no terrain, flat rendering is explicitly **native full-cell mean depth**, not resolved wet extent. Missing depth gets a gray unavailable fill; dry zero is distinct in picking. This provisional native polygon path does not pretend to reproduce the old terrain-clipped shoreline. Any later joined extent artifact must be bound to this run and geometry.
- Flat rendering culls against exact footprint bounds. To avoid blindly allocating hundreds of thousands of map objects, more than 40,000 visible faces fails closed with an explicit zoom-in message and clears the flood display. This is a bounded compatibility path, not a validated whole-domain overview at 398k faces. The positive integer `maxVisibleFaces` option can be supplied when measured evidence supports a different budget.
- Route geometry and official closure context remain UI-owned. Bind model-derived crossing/coverage evidence to the new completed run before passing it to the renderer. This adapter produces no crossing registry or expanded-coverage claims.

## Source-bound terrain contract

The current exporter correctly sets `terrainDisplay.status = 'unavailable'`. Explicit 3D requests then reject without downloading the runtime or any old terrain; the valid flat map remains available. The UI should retain flat mode and show the returned reason.

To enable the implemented native 3D path, a future verified terrain exporter must set:

```js
manifest.terrainDisplay = {
  status: 'available',
  artifact: {path: 'terrain.json.gz', sha256: '<compressed artifact SHA256>'},
};
// Decompressed artifact:
{
  kind: 'native_face_triangle_terrain',
  runId: '<same native run>',
  geometrySha256: '<exact manifest.geometry.sha256>',
  verticalDatum: '<same manifest.provenance.verticalDatum>',
  vertices: [[longitude, latitude, elevationMetres], /* ... */],
  triangles: [[vertexIndexA, vertexIndexB, vertexIndexC], /* ... */],
  triangleFaceId: ['<exact native face ID for each triangle>', /* ... */],
  // Optional; must describe the actual terrain sampling, not hydraulic resolution:
  displayResolutionM: 10,
}
```

The core verifies identity, datum, indices, distinct triangles, exact face membership and triangle containment in the assigned native polygon. Water clips each terrain triangle against its own face's native hourly/subhourly surface. Missing surface/depth or dry faces produce no water. No mean-terrain-plus-depth construction or interpolation through other native faces is used.

Geometry budgets select whole faces and explicitly report omitted faces through the map note and `onStatus({kind:'terrain-detail', status:'partial', omittedFaces})`; they do not bridge omitted areas. Unknown terrain resolution stays unknown. The runtime is still imported only on explicit 3D entry. It currently loads one source-bound terrain artifact, not a tiled refined-terrain stream; production-scale terrain memory and full-output performance remain unverified.

## Evidence and remaining dependency

Seven Node tests pass across the existing frozen path and the new source/core fixtures. `test/fixtures/refined-renderer-synthetic.js`, `test/refined-renderer-source.test.js`, and `test/refined-water.test.js` are explicitly synthetic. They check unequal areas, hanging nodes, exact IDs beyond JavaScript's safe integer range, raw volume, missing/zero, source mismatch, outside-face terrain rejection, stale-frame cancellation, bounded caches and native surface clipping.

`tools/simulation/verify-refined-renderer.mjs` passes actual browser pointer selection inside the five-edge polygon, missing-data fill, 15-minute/hourly switching, no legacy asset requests, unavailable-3D preservation of flat mode, then a separately injected synthetic source-bound terrain mesh and disposal. Zero browser JavaScript errors. Evidence lives in `public/simulation/preview/refined-SYNTHETIC-*`, clearly marked as contract checks, not forecast output. No synthetic fixture is placed in public forecast data. Existing flat-first cancellation/missing-frame regression also passes.

Actual refined NetCDF, proven output face-ID linkage/raw volume, verified export, new source-bound terrain and production-size performance/coverage acceptance are still required. This checkpoint neither fabricates those artifacts nor marks expanded coverage complete.
