# Silverbell road-dip extension: prepared, not simulated

This separate extension preserves connected-v2 and completed run 41344983607 / package af47c69. It follows the same county-road / professional 1 m terrain / official Deltares quadtree and subgrid / published roughness and infiltration workflow. No new hydrology equations or bridge openings were invented.

## Actual road and missing dips
Pima County Street Network layer 11 supplies five named W SILVERBELL RD records. Their geometry is intersected with a 40 m neighborhood of the existing Silverbell-north route to retain the actual 7.668 km named road leg, not unrelated route labels or the westward continuation. Source URL is in scope-audit.json; raw county records are retained in county-silverbell.geojson.

The unchanged baseline has 324 of 3835 two-metre road samples outside its active mesh and 3454 at resolutions coarser than 6.25 m. Only 57 were already fine. Full 1 m profile screening identifies:

- 32.427773,-111.267809:601.560 m NAVD88,0.286 m profile prominence; baseline 100 m cell.
- 32.437518,-111.287309:595.835 m NAVD88,0.753 m profile prominence; outside baseline.

These are terrain minima, not verified flooded dips, pipe openings or measured road-depth thresholds. The unchanged SciPy screening uses 0.25 m prominence and 26 m separation. Narrow features below those choices remain possible.

## Prepared extension
Three existing NHD catchments add 0.592 km², extending the full domain to 483.928 km². The official builder produces 480227 active cells, retaining original route refinement plus 6.25 m within 100 m of Silverbell and 12.5 m within 500 m. All 3835 road samples and both candidate locations are active at 6.25 m. All 8451102 retained 1 m pixels inside the 500 m surroundings are valid. 13 new 1000 m windows supplement 10 cached windows; source URLs/hashes are in terrain-manifest.json. No 2015 fallback.

Cached NHD topology makes former inlet 945050483 internal. The other 13 external inlets are unchanged and use the existing frozen series. No new flow model, split fraction or cumulative-flow subtraction is introduced. Frozen rainfall remains original NWM 13Z / HRRR 14Z package, 63 hours from Oct30 16Z through Nov2 07Z; forecast output remains Nov1 17Z through Nov2 07Z. This is simulated-live replay, not automatically current weather.

## Execution boundary
No SFINCS execution is authorized or performed for this extension. The prior 398613-cell run took 2368.126 seconds. Simple cell-count scaling gives about 47.5 minutes for 480227 cells; changed wetting/conveyance can alter that substantially. Proposed next action is one fresh run capped at 60 minutes on the existing saved-engine runner, same frozen inputs and no new paid service. Obtain scoped approval before dispatch; preserve any partial result at the cap. Do not resume a type 1 restart as if it preserved cumulative infiltration.

## Reproduce preparation
Run prepare_silverbell_extension.py to scope cached county geometry; import_silverbell_terrain.py --output .sfincs-runs/silverbell-terrain-v1 to acquire missing windows; rerun scope/profile after intake. prepare_silverbell_mesh.py uses the retained official builder and separate output directory. prepare_silverbell_parameters.py accepts that mesh and reuses all baseline plus new fine windows. prepare_silverbell_boundaries.py, stage_silverbell_native.py and finish_silverbell_case.py assemble the native case using existing frozen weather. package_current_case.py archives it. No script in this sequence runs the solver.

Future output must use the new mesh/face-ID correspondence; old 398613-face outputs cannot be relabeled as coverage of this extension. Use terrain-low-point-candidates.geojson extensionNativeFace for point extraction only against this new mesh. Existing full 57-frame Trico/Avra publication remains the usable completed result.

## Prepared native archive

manifest.json lists two archive parts, their hashes and reassembly order. The case is fully assembled but unexecuted. The terrain/roughness/infiltration table took538.1seconds to prepare. All63rainfall intervals and64discharge timestamps are present; no new live refresh. The execution approval field is false. Do not dispatch through an older workflow with an unrelated archive or budget.
