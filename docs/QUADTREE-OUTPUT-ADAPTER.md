# Refined output adapter — prepared, not published forecast

Source audit: solver branch b32d291, connected-v2 case: 398,613 cells, 14 inlets, frozen inputs, forecast map window 2026-11-01T17Z through November2T07Z at planned15-minute intervals. The earlier mesh-report describes398,591 cells and is not the final connected-v2 mesh. Neither report is a completed output. Existing current preview/manifests remain unchanged.

## Implemented separate path

`tools/simulation/export_quadtree_output.py --config CONFIG.json --destination NEW_DIRECTORY` reads completed native NetCDF and CF/UGRID topology. Config paths are relative to the configuration file. Required fields: runId, executionMode=`simulated_live_frozen_inputs`, meshFile, mapFile, logFile, meshTopology, meshFaceIdVariable, outputFaceIdVariable, volumeVariable, surfaceVariable, projectedCrs, verticalDatum, nativeTimeZone=`UTC`, validFrom, validTo, assumptions, inputArtifacts[{path,sha256}]. Optional negativeVolumeToleranceM3 defaults0.

Variable names must be taken from the actual produced NetCDF, not guessed from this document. Completion marker, input hashes, native volume units(m3), surface units(m), exact native face-ID correspondence and valid endpoints are required. If native volume or proven face IDs are absent, export stops. Do not synthesize IDs from equal array lengths or substitute zs-minus-terrain depth.

The exporter uses native polygon connectivity including collinear hanging-edge nodes, projected metre areas and polygon centroids. Output order is mesh face-ID order; native output is reordered by exact IDs. It never computes rows/columns from a100m origin. Depth is max(nativeVolume,0)/individual full polygon area with an explicitly declared negative-volume tolerance. Raw signed volumes and native water-surface values are retained alongside depth. Missing values staynull. Raw NetCDF is referenced by SHA256.

Package: manifest.json, geometry.json.gz, frame-N.json.gz. Each frame carries runId, geometry hash, exact native UTC time, depthM, nativeVolumeM3 and waterSurfaceM. One frame is read/exported at a time. Geometry carries nativeFaceId, areaM2, equivalent-square resolutionM, actual edge lengths, centroid and full geographic rings. All compressed files have hashes. Manifest resolution is actual min/max; coverage is native-geometry-only with crossing registry null until independently mapped. Terrain display is explicitly unavailable. No current-sfincs-manifest is written.

`public/simulation/quadtree-output.js` supplies opt-in checksum loading and geometry/frame validation, including independent per-cell volume/area consistency. It is not imported by the current app. Synthetic tests under test/ are code checks only, never copied into public forecast data.

## Renderer/UI contract changes required from owners

- Accept package geometry and lazy frame descriptors; do not preload57frames ×398kfaces. Reuse cancellation/cache limits.
- Use arbitrary-length native rings, nativeFaceId and per-cell area/resolution. Avoid the current4-corner loop,100m label and fixed-origin row/column assumptions.
- Existing frozen terrain export assumes10×10 DEM blocks per100m cell; it is invalid for this mesh. No padded/repeated blocks or old terrain/zs arrays may be joined by index.
- Existing water-footprint files are bound to the old run. Require new source-bound terrain intersection artifacts before using that display path. A native footprint depth view remains possible with an explicit full-cell-mean label; it is not resolved wet extent.
- Preserve native surface elevation/datum separately from cell-average depth. Terrain refinement does not establish road-depth accuracy.
- Bind coverage/crossing evidence to the new completed run and geometry hashes. Prepared expanded domain is never displayed as completed forecast coverage. Preserve current bridge evidence nulls/history and official closures.
- Existing inset/current100m publication stays intact until actual output/export and the new renderer path are verified together.

## Remaining native-output dependency

The completed connected-v2 result was not available in this preparation task. Exact native variable names, face-ID linkage and native volume availability must be checked on arrival. This adapter deliberately fails closed on absent evidence. No refined depth, water surface or expanded coverage has been fabricated or published.
