# Brawley native flow for the fluid consumer

Original user requests, verbatim:

> And show it traveling, direction and animation are critical
>
> FLuid sim based on the fucking data
>
> I wanted a fluid particle sim

This additive package supplies actual saved model transport for the existing Brawley/Avra Valley scene. It does not run SFINCS or change the visual layer, original scene, terrain, water frames, risk scoring or published cases. Claude owns visual coupling.

## Load

```js
import {loadBrawleyFlow} from './brawley-flow.js';
// scene is the existing checksum-verified brawley-scene.json object.
const flow = await loadBrawleyFlow({scene, signal});
const frame = await flow.readFrame(flow.exactFrameIndex('2026-11-01T22:00:00Z'));
const transport = flow.boundaryTransport(frame, 'junction160');
// transport.boundary: signedInflowM3s > 0 enters the selected native-cell union.
```

Entry: `public/simulation/brawley-flow.js`. Publication pointer: `public/simulation/data/brawley-flow-publication.json`. Package: `public/simulation/data/brawley-flow/manifest.json`, compressed geometry and 14 compressed frames. Loader verifies compressed-byte SHA-256 before decompression, validates scene run/geometry/face IDs and checks frame budgets. Manifest separately records the exact original scene-file hash. Supply the original checked scene, not a modified object with reused IDs.

## Geometry and signs

Geometry coordinates are EPSG:32612 east/north metres. Convert to the map projection or scene-local east/north using the actual projection; do not interpret UTM as longitude/latitude. Edges have `id`, `solverIndexZeroBased`, `fromFace`, `toFace`, `positiveNormalEN`, two exact shared-boundary `endpointsUTM`, and `widthM`. Face IDs are native zero-based face IDs, not positions in the clipped scene array. Some endpoints connect an outside-scene neighbor; retain that neighbor identity.

`qM2s[i]` belongs to `geometry.edges[i]`. Positive q travels from `fromFace` to `toFace`. Multiply q by `widthM` for edge discharge in m³/s. This is unit-width discharge, **not velocity**. No velocity is exported. `positiveNormalEN` is east or north; negative q reverses it. No artist-defined direction is substituted.

Two masks are provided:

- `scene`: union of the original 2,628 scene faces.
- `junction160`: 676 of those faces whose native rectangle centres are within ±80 m east and north of the exact EPSG:32612 projection of scene centre [-111.29459,32.39322]. Exact projected centre is in the manifest. This is a stair-step native-cell union, **not a surveyed boundary or an exact square clip**.

Each mask lists its exact face IDs and `inwardSign` aligned with all 5,373 exported edges. Sign +1 means positive q enters, -1 means positive q exits, 0 means internal or irrelevant to this mask. The loader returns boundary edge segments, inward unit normals and signed discharge. Positive means inject; negative means remove. Internal edges cancel in the perimeter sum but remain available for transport inside the scene. The `junction160` boundary differs from the prototype's current 160 m raster boundary: align the consumer domain to this native-cell union, or perform an explicit conservative geometric remapping. Do not silently apply this budget to a different crop.

At 2026-11-01T22:00:00Z, junction160 inflow is 0.6156542878073878 m³/s and outflow is 0.6151355654090196 m³/s. Road face 267134's north edge is solver index 537505, connecting to 267135, width 6.25 m, q=0.019177289679646492 m²/s northward. Near-equal inflow/outflow still means traveling water.

## Time and simulation coupling

All data are frozen run `refined-full-41344983607`, not current weather. Flow snapshots are hourly from 2026-11-01T18:00:00Z through 2026-11-02T07:00:00Z. The existing 57 quarter-hour water frames stay separate and unchanged; there is no saved flow snapshot at 17:00 or at quarter hours. The loader only accepts exact flow times. No implicit nearest-time substitution, interpolation or extrapolation occurs.

Start with water frame20 and its exact 22:00 flow snapshot. Frame21 at22:15 has the greatest terrain-clipped water volume in the existing prototype, but no exact flow snapshot. A future interpolator must explicitly report its two source times and weight, interpolate signed physical-edge q before deriving budgets, remain within the saved interval, and label the result interpolated. Holding a snapshot while stepping particles also needs an explicit flow timestamp. Do not present either as additional native output.

For an open-boundary visual solver, use signed flux to account for transported volume over the chosen simulation-time step. Keep particle volume weights explicit; rounding particle counts must not silently create or destroy water. Reconcile with the selected native water state. Do not override dry/missing terrain or make an unsupported wet cell merely to satisfy an injected volume. Such a conflict is a coupling discrepancy to resolve, not license to manufacture flooding. This package does not implement that visual coupling.

Budgets are instantaneous perimeter transport, checked against the sum of signed cell incidence. They are not a full time-step mass balance: rainfall, infiltration and changing storage also matter. Restart q is a native solver snapshot; the model's staggered update does not turn it into a continuous measured hydrograph.

## Decoder and provenance

`tools/simulation/export_brawley_flow.py` reads existing files only and writes a separate destination. Dependencies are the existing pinned SFINCS environment (NumPy, xarray, pyproj). It never invokes the solver.

```powershell
python -B tools/simulation/export_brawley_flow.py --native <saved-run-directory> --scene public/simulation/data/scene-contract/brawley-scene.json --destination <new-export-directory>
```

Each source restart hash and source mesh/map/subgrid/input hash is retained. Generated compressed files have deterministic gzip timestamps. Manifest hash is pinned in the publication pointer; changing/rebuilding the package requires explicitly updating that pointer after verification.

The decoder follows official SFINCS commit `f3647fc0289bb15cb2512d60686cef74cb853c78`: [restart writer](https://github.com/Deltares/SFINCS/blob/f3647fc0289bb15cb2512d60686cef74cb853c78/source/src/sfincs_output.f90#L844), [physical-edge order](https://github.com/Deltares/SFINCS/blob/f3647fc0289bb15cb2512d60686cef74cb853c78/source/src/sfincs_domain.f90#L808), [subgrid correspondence](https://github.com/Deltares/SFINCS/blob/f3647fc0289bb15cb2512d60686cef74cb853c78/source/src/sfincs_subgrid.F90#L215).

Type1 records are identifier, zs, q, boundary uvmean. The last record is not a full velocity field. Physical edges follow active cell order, right mu1/mu2, then above nu1/nu2, respecting refinement flags. The first800,462 q entries are physical; combined/dummy entries are excluded. NetCDF ordinary edge order is never used. The decoder currently rejects inactive input faces, rotated grids, a different scene run and nonidentity source/map face ordering rather than guessing a remapping. This keeps its supported scope explicit.

Verification checks all record markers; physical/subgrid edge counts; exact shared edge boundaries; finite hourly map elevations against restart zs; all frame checksums and incidence budgets; and the known22:00 snapshot. Synthetic tests cover split-edge order, signed records and truncated input. No new solver, merge or deployment is needed to use this package.
