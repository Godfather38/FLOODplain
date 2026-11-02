# Scene data and crossing inventory

Additive backend handoff from `532d85b`, on `experiment/scene-data-inventory`. No UI, renderer, policy, solver inputs, production or existing worktree changes. Rebuild with `node tools/simulation/build-scene-contract.mjs` from the repository root.

The ready-to-copy package is `public/simulation/data/scene-contract/`. Start with `brawley-scene.json`; its roads and two compressed terrain tiles are in the same directory. No credentials or additional services are required. The source package is frozen replay, not current weather. Renderer acceptance and physical-device performance are outside this handoff.

## Scene v1

`public/simulation/scene-data-contract.js` exports validation, feet conversion, observation summaries, the existing recent-gauge cache adapter, and tracking-state selection. Values stay metric; convert only displayed lengths using `metersToFeet`. Unknown values are `null`, never zero. `validateScene` rejects unverified velocity for this version.

- Coordinates and cell rings use **longitude, latitude**, EPSG:4326. This differs from the existing native decoder's latitude/longitude rings; the builder explicitly swaps them. Elevations are NAVD88 metres; projected terrain provenance uses EPSG:32612.
- Brawley centre is **-111.29459, 32.39322**, at Avra Valley Road. 2,628 original native faces cover the selected neighbourhood. Source cell index and native face ID remain available. Selection is bounded by cell centres; rings remain complete and exact.
- All 57 native frames run from **2026-11-01 17:00 UTC** to **2026-11-02 07:00 UTC**, at 15-minute intervals. Each frame has `validTime`, source checksum, `depthM` and `waterSurfaceM` arrays in `cells` order. No interpolated frames are supplied. NWM issue is 13:00 UTC and HRRR issue is 14:00 UTC on November 1; package issuance is unknown and remains null.
- Cell-average depth is native volume divided by full face area. It is not road depth or wet extent. Reconstruct visible extent by clipping each face's source terrain triangles against its native water elevation, preserving missing data and the existing 0.01 m display threshold. Do not color the whole cell as an observed wet footprint.
- Terrain gzip files decode as JSON: `vertices` are `[longitude,latitude,NAVD88 metres]`; indexed `triangles` and `triangleFaceId` associate source terrain with native faces. Tiles retain their original partial-run headers. `terrainGeometryEquivalence` records the existing exact geometry certificate binding them to the completed run; do not relabel or discard it. Render only selected faces when using this subset. Source GCN10 notice is included under `sources/`.
- `risk` is explicitly unassessed in this replay example. Live consumers pass the unchanged existing assessment to `trackingState`, which preserves closures and numeric scores. This package does not replace the existing bridge comparison model or its coverage registry.

## Motion and direction

The published native columns are volume and water-surface elevation, **not velocity**. `flow.status` is unavailable, with null direction and velocity. Existing frames support time-varying extent/elevation playback. Cosmetic highlights may communicate motion only with a clear illustrative label; do not describe their direction, speed or particle paths as modeled. Do not substitute NWM discharge, a remote gauge or terrain slope for local native velocity. Future vector output needs a versioned adapter with face/time identity, units, vector coordinate frame and provenance before physical advection is supported. The visual worker can choose a bloopy/cartoon style while preserving these boundaries.

## Inventory and coverage

`inventory.json` includes all 60 existing mapped crossing records, all 23 named configuration points, 24 prepared centreline minima and two West Silverbell minima. It deduplicates exact shared geographic crossing identities while preserving legacy record indices and route associations. Named IDs stay unchanged; unnamed/minimum IDs derive from coordinates rather than array order. Nearby terrain minima remain separate evidence, not silently merged into surveyed road structures. Five-metre point-to-route-segment associations add shared route membership only; they do not establish hydraulic support.

There are 88 entries across eight routes: 49 have exact containing native faces in **completed refined run 41344983607**, 37 are outside it, and two await verified extension output. This is distinct from the older coarse/current registry where Brawley and Los Robles are outside. Never apply these refined memberships to another run or use them to change current bridge scoring.

Tracking states distinguish modeled, observation-supported, stale, outside coverage and not yet assessed. Hydraulic and observation statuses are also retained separately. Frozen model expiration and gauge observation ages are computed against the caller's explicit clock; retrieval does not renew an observation. No state grants clearance. Inventory completeness means the supplied sources were exhaustively included, **not that every real-world dip has been surveyed**.

The two West Silverbell candidates come from the actual prepared manifest at solver commit `a8089cb`:

| Longitude | Latitude | NAVD88 terrain m | Prepared native face |
|---|---|---|---|
| -111.26780853368487 | 32.427772754301735 | 601.5603637695312 | 358178 |
| -111.28730914790508 | 32.43751766117405 | 595.8352661132812 | 323310 |

Both remain `awaiting_verified_output` for run `41370039087`; the manifest's older approval wording is retained as historical source text, not a statement about current authorization. This worker neither queried nor altered that run. Original baseline membership is retained separately and does not become an extension result.

Only Trico and Avra have supplied full centreline-minimum screening. Silverbell has only these two extension minima. Picture Rocks route IDs `pr-avra`, `pr-twinpeaks`, `pr-ina`, `pr-gates` lack complete terrain screening, even where shared Avra segments inherit entries. `uncovered.json` contains every exact uncovered coordinate, route and ID, plus awaiting-results and unscreened-route lists. The matched solver coverage audit is included under `sources/refined-coverage.json`.

## Gauges and integration

Associations use the existing documented Brawley → Los Robles connection and Santa Cruz reach order, not radial proximity. Santa Cruz gauges are explicitly upstream/downstream on the same river; Canada del Oro is tributary context at Ina. No river gauge is assigned to unrelated roadside minima. Brawley/Los Robles uses Three Points and Milewide upstream regional context. See existing `docs/SENSOR-AUDIT.md` for source evidence and hydrologic limits.

`gauges` retains station IDs, source URLs, coordinates, cached source record IDs, original observation times and metric discharge. Example observations are from the October 31 cache and are stale at the example assessment clock. Each has only one reading, so trend is unknown. `adaptRecentGauge(existingRecentGaugeResult, now)` consumes the already-existing recent-readings feed/cache shape and computes rising/falling/steady only from two distinct times. It makes no network request. Preserve quality qualifiers when presenting provisional evidence.

`modelInputRole: context_only` means these observations were not fed into this exported frozen simulation; its forcing is the recorded NWM/HRRR package. `riskInputCrossingIds` separately records existing gauge use in the unchanged safety engine. Gauge stage datum and road correction remain null: gauge stage is not water height at a road. No numerical correction, travel time or hydraulic confidence is inferred.

UI owners can load `inventory.json`, select the route's `entryIds`, and apply `trackingState(entry,{now,observations,assessment})`. Renderer owners can load the Brawley scene directly. Preserve the existing shared-map-state requested/displayed-time lifecycle. These adapters are ready for integration; no shared UI files were edited.
