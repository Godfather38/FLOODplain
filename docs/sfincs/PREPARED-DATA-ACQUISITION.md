# Prepared professional data acquisition contract

Verified 2026-11-01 by live REST metadata requests. No feature bulk downloads, terrain changes or solver runs performed for this inspection.

Service: https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/FloodControl2/MapServer

## Standard acquisition

Use the service's Query operation with the agreed domain envelope, explicit input/output spatial references, and JSON or GeoJSON. Preserve the unmodified source response, request URL/parameters, retrieval UTC, SHA256, layer metadata, object IDs and completeness count. For larger exports request object IDs first and fetch bounded ID batches; verify every requested ID was returned. Preserve null values and source field units; never convert missing bed elevations to zero. Reuse the research team's exported features rather than downloading duplicates.

Store professional elevation products as original GeoTIFF with their native CRS, vertical reference, units, nodata and acquisition metadata. The separately researched AZ_PimaCounty_2021_B21 product remains a candidate pending receipt of its verified source bundle; this inspection did not download or certify that terrain. Acquisition date, processing date, effective study date and GIS edit date are distinct fields.

## Verified layer semantics and import limits

| Layer | Prepared content | Permitted use |
|---|---|---|
| 0 | Regulatory discharge points; Q100, STUDYID, STUDYTITLE, ENGFIRM, STDYSTATUS, EFFDATE | Reference design-discharge/study inventory; not a current hydrograph |
| 2 | Cross-section polylines; STREAM_STN, STRMBED_EL, WSEL_REG, V_DATUM, START_ID, CS_ALPHA | GIS cross-section locations and scalar attributes; not complete station-elevation arrays |
| 19 | Flow-contained lines; structure domain STR=street, CHN=channel, STMDN=stormdrain | Structure-type inventory; no opening/invert dimensions supplied |
| 12,16,17 | Study status/areas/delineations with study IDs and dates | Locate responsible professional study and its effective/superseded status |

All six inspected layers have hasAttachments=false and empty relationships. No dedicated native-model download URL field appears in those schemas. Their description URLs are metadata references, not model packages. This does not establish that native models are unavailable elsewhere.

## Native tooling handoff

Import complete professional model packages into their matching supported native application/version, retaining geometry, structures, boundary definitions and units together. Use ordinary GIS readers for REST GeoJSON and standard terrain import for GeoTIFF. Do not treat a GIS overlay import as hydraulic-model import. Do not manufacture station-elevation arrays from STRMBED_EL, use WSEL_REG as terrain, infer culvert dimensions from structure labels, or promote Q100 into forecast flow.

Before model execution, the received source manifest must identify actual survey acquisition dates and coverage, horizontal/vertical units and datum, professional processing provenance, native model/version if present, and any excluded structures or unsurveyed channel bed. Keep unavailable fields explicit. No fallback to 2015 terrain or estimated channel construction is authorized by this contract. Product error criteria and source suitability remain separate unresolved requirements.
