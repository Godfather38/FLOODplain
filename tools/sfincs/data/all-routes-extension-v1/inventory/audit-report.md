# All-route inventory and coverage audit

The requested scope is preserved verbatim:

> I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.

> I explicitly said earlier to start all fucking junctions dickhead

## Source snapshot

The current inventory is `public/simulation/data/scene-contract/inventory.json` on `experiment/scene-data-inventory`, commit **8e5260c4133cfcca2e3c055265dcd20bb90da885**. This supersedes c801a1765b73cc503ee761e74d61c7df4a273c86 and includes the completed Silverbell output. Its embedded `sourceCommit: 532d85b` is an earlier generator baseline, not the latest artifact commit. Its root `modelRunId` also does not replace per-entry model identities.

Current checked refs: main 351d84dc86f7efc6739e8c829ae91a7a46860127; experiment/avra-radar-runoff e9065bb9cba3a9bf43f3cb77993b058523594085; codex/ui-saved-crossings 88a4062719f3d0fe0b8fc82a66265a2af2f421bb. The public route and crossing blobs are identical across all four checked refs. Route blob: ad0ae340fae032da42d681ea6fece55051c01ae4. Crossing blob: 0375ce358fd2fb2564eaf2c3069ca7e0d5129efc.

Files read: public/data/routes.geojson, public/data/crossings.geojson, public/simulation/data/scene-contract/inventory.json and uncovered.json, tools/simulation/build-scene-contract.mjs, docs/SCENE-DATA-CONTRACT.md. The existing local tools/sfincs/data/silverbell-extension-v1/target-roads.geojson was copied unchanged for geometric reconciliation; its snapshot is included here.

## Counts and deduplication

There are eight configured public routes, 60 original mapped crossing records, and 88 inventory entries at 88 distinct coordinate pairs. The original crossings collapse to **52 coordinate identities at the existing builder's six-decimal precision**. The inventory already merges these shared source records and named configuration identities. It retains 125 route memberships across 88 entries; 23 entries belong to more than one route.

Of the 88 entries, 51 have native-cell model coverage and 37 are outside coverage. There are no pending Silverbell entries in this snapshot. The kinds are 39 mapped crossings, 26 terrain minima, 14 dips, six river entries, and one each bridge, flat and road. These are classifications from the application, not a complete junction or dip survey.

Ten pairs lie within 25 m. They remain separate because a river crossing and a nearby terrain minimum can represent different observations. The deduplication file includes their exact distances, all original source crossing groups, and their source indices. Merge only when source identity or physical-location evidence establishes equivalence, preserving both aliases and every route membership. Never merge just because points are nearby. In particular, the Sanders named crossing and mapped crossing are 4.43 m apart and need identity reconciliation; Los Robles and its terrain minimum are 0.73 m apart but have different evidence types.

## Route coverage and missing screening

Combined route bounds in longitude/latitude are **[-111.3042915, 32.2176924, -110.9843155, 32.4611121]**. Per-route bounds and lengths are in route-audit.json. Their exact union contains about 115.67 km of distinct centerline. That exact union does not snap nearly coincident routes together.

The following lengths are geometric screening-reuse accounting, not hydraulic coverage. Existing Trico/Avra centerlines and the actual West Silverbell prepared road were combined, buffered by 5 m, and subtracted from each route. Internal repeated traversal was dissolved before comparison. A shared alignment is a candidate for reusing screening evidence, not proof that every real road dip was found.

| Route | Listed entries modeled / outside | Centerline remaining outside existing screening alignment |
|---|---:|---:|
| trico | 11 / 0 | 0 km |
| avra | 22 / 0 | 0 km |
| silverbell-north | 10 / 0 | 5.788 km |
| silverbell-south | 17 / 0 | 1.289 km |
| pr-ina | 2 / 4 | 17.891 km |
| pr-twinpeaks | 11 / 1 | 16.698 km |
| pr-avra | 14 / 1 | 8.309 km |
| pr-gates | 0 / 32 | 32.218 km |

Membership counts must not be summed as unique locations. Shared outside points account for the difference between table totals and 37 unique outside entries.

The Silverbell route names include Sanders and other roads; completing the West Silverbell extension did not complete those routes. Sanders approaches and connecting segments still need full low-spot screening and actual cell-resolution inspection. Picture Rocks/Ina includes Picture Rocks Road, Wade Road, Ina Road and its freeway connection. Twin Peaks and Picture Rocks/Avra share Sandario sections; prepare these once, retain both memberships. Gates includes southern Sandario, Kinney, Gates Pass, Speedway and its freeway connection. Its 32 listed locations are all outside the existing model inventory coverage.

A modeled point only proves containment in a native cell. It does not establish 6.25 m resolution, complete road-approach coverage, culvert connectivity or validated road depth. Native mesh inspection remains the geometry owner's task. The supplied ledger does not manufacture these properties.

## Junctions and gauges

The eight existing LineStrings provide actual route centerlines. Their rounded leg lengths do not establish exact road-intersection locations. Existing named junction-like entries are not an exhaustive county-junction set. The parent completed official Pima Transportation/MapServer/1 acquisition. The ledger now contains 203 actual county junctions with 203 distinct STINTERID identities, separate from the 88 flood-related entries. All are within the documented 35 m acquisition tolerance of at least one route. Their 265 route memberships preserve measured perpendicular offsets: Trico 17, Avra 28, Silverbell north 21, Silverbell south 22, Picture Rocks/Ina 46, Twin Peaks 43, Picture Rocks/Avra 28, Gates 60. A tolerance match is not proof of exact connecting-road identity; retain the county street names and inspect ambiguous offsets. No automatic proximity merge was performed.

Existing gauge relationships are copied per entry with their source evidence. They are reach-based context, not a nearest-gauge join. Brawley/Los Robles regional links do not supply a verified travel time or road-depth correction. Observed-gauge context must retain its original timestamp and cannot be silently treated as native boundary forcing; the frozen model uses its own documented NWM/HRRR inputs.

## Reusable outputs and next use

- coverage-ledger.json: every current inventory entry, route memberships, source evidence, actual per-entry model identity, gauge associations, nearby-entry links, and explicit junction/model-resolution gaps.
- route-audit.json: exact source identities, counts, route bounds, geometric screening accounting and common source blob hashes.
- dedup-audit.json: source-record deduplication groups plus ten proximity review pairs.
- unscreened-route-segments.geojson: remaining alignments for terrain screening. This is not an unmapped-flood prediction or a proof of absent model coverage.
- Source JSON/GeoJSON snapshots plus audit.py and reconcile.py: reproducible read-only derivation. Run audit.py, reconcile.py, then add-junctions.py; the latter two add the actual Silverbell screening alignment and acquired county junctions.

Inspect the acquired county junction associations, screen the remaining alignments against retained professional terrain, deduplicate newly discovered minima with evidence, and then inspect native mesh coverage/resolution. Preserve all 88 existing entries and completed Trico/Avra/Silverbell model identities. Neither eight route names nor 88 entries is evidence that every real-world dip has already been enumerated.

No model execution, test campaign, deployment, shared repository file edit or git-ref update was performed. No terrain was downloaded. There is no remaining access blocker for this audit; native terrain/mesh inspection remains in the parent's parallel preparation.


## Completed all-route screening update

This section supersedes the earlier statement that the remaining alignments still await their first terrain screening. Those earlier GeoJSON segments remain a preserved pre-screening snapshot, not a current to-do list.

The parent's completed `all-routes-extension-v1` screening produced **184 raw minimum records, reduced to 167 exact-coordinate identities**. Only exactly equal parsed longitude/latitude pairs were merged; all original source indices, segment IDs, chainages, heights, prominence values, native face IDs and route memberships remain in the evidence arrays. Nearby points remain separate. The ledger now has **458 distinct evidence identities: 88 original flood-related entries, 203 county junctions, and 167 new terrain-minimum identities**. This is not a claim of 458 different physical sites; cross-evidence identity reconciliation remains explicit.

The completed Silverbell grid is the unchanged native baseline. Candidate coverage comes from its actual `baselineNativeFace` and `baselineCellSizeM` fields. Negative or absent face IDs are outside-active, not dry. No new hydraulic results were created.

| Route | Minimum identities | At 6.25 m | Coarser active cell | Outside active grid | Missing terrain samples |
|---|---:|---:|---:|---:|---:|
| trico | 9 | 9 | 0 | 0 | 0 |
| avra | 15 | 15 | 0 | 0 | 0 |
| silverbell-north | 11 | 6 | 5 | 0 | 0 |
| silverbell-south | 12 | 12 | 0 | 0 | 0 |
| pr-ina | 21 | 0 | 11 | 10 | 0 |
| pr-twinpeaks | 29 | 0 | 24 | 5 | 0 |
| pr-avra | 21 | 9 | 7 | 5 | 0 |
| pr-gates | 63 | 0 | 8 | 55 | 169 |

Shared minima retain all memberships, so per-route counts must not be summed as unique locations. Sampling used the supplied route parts at 2 m spacing, with 0.25 m prominence and 26 m separation as inventory criteria, not flood thresholds. Raw profile coverage totals include repeated route alignments and are explicitly labeled as such.

**The 169 Gates samples lacking terrain remain a real gap.** Their actual point coordinates and chainages are exported in `terrain-sampling-gaps.geojson`; no-dip and dry conclusions are prohibited there. The recorded minimum count cannot establish that this gap contains no additional minima.

Updated artifacts: `coverage-ledger.json`, `terrain-screening-summary.json`, `terrain-sampling-gaps.geojson`, `all-route-minima-source.geojson`, `terrain-scope-source.json`. `add-terrain-screening.py` preserves the source evidence and adds these records after the earlier audit scripts. It reads the parent's existing road-profile.csv without modifying it. No solver, test campaign, new terrain acquisition or shared repository modification occurred.
