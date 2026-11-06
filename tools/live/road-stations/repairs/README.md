# Two measured-source Gates road heights

The original package omitted two North Kinney Road stations because the TNM
catalog does not list an existing USGS 2021 tile, x47y357. Its adjoining northern
tile ends north of these two points. The same omitted tile was already recovered
for model terrain; this repair changes only the separate road-height input.

| pr-gates zero-based index | Latitude | Longitude | Distance m | Road height m NAVD88 |
|---|---|---|---|---|
| 5053 | 32.266399 | -111.214916 | 25265 | 734.59 |
| 5054 | 32.266435 | -111.214949 | 25270 | 734.49 |

`gates-2021-repair.json` records the verified USGS URL, project, horizontal and
vertical references, HTTP object identity, original route geometry hash, exact
unrounded station/footprint coordinates and original encoded fields.
`gates-2021-pixels.f32.gz` contains an unresampled 32 by 32 window starting at
source column 9744, row 0, in row-major little-endian float32. Both compressed
and decoded pixel bytes have SHA256 hashes. The HTTP multipart ETag identifies
the source object but is not a whole-file SHA256. No whole-TIFF checksum is claimed.

The original recipe uses five cross-road offsets (-3, -1.5, 0, 1.5, 3 metres),
bilinear sampling within each finite four-pixel footprint, their median and
centimetre quantization. Every contributing source pixel is finite and not
nodata. This is ordinary sampling of measured terrain, not interpolation across
missing terrain. The unrounded medians are 734.586793685635 and
734.4873434961403 metres. Lateral spreads quantize to 2 and 1 decimetres.

`repair_road_heights.py BASE_ROUTES OUTPUT_ROUTES` reproduces the correction
offline from the exact original package, whose SHA256 is recorded in the
evidence. It rejects a newer/already-corrected package, mismatched identities
and missing source pixels. Original coordinates, line metadata and all other
absolute heights remain unchanged. Only target height deltas (plus the next
delta needed to preserve subsequent heights), flags, source IDs and spreads
change. Tests restore these declared fields and match the full original decoded
package hash, as well as comparing every existing valid absolute height.

## Existing live package backfill

No native solver output, forcing, rating or physics change is needed. For a
complete immutable Gates compact snapshot, verify all original descriptors,
run `python tools/live/export_road_forecast.py gates PACKAGE_DIRECTORY`, and
replace only `manifest.json.roadForecast` with the printed descriptor. Preserve
every other manifest field, especially runId, issuedAt, sourceIssues, times,
geometry and frame descriptors. Verify all native hashes again and run
`verify_all_route_package.py PACKAGE_DIRECTORY gates ORIGINAL_HRRR_CYCLE`.

This is not authorization or a command to publish. Before any eventual remote
backfill, first verify every currently used all-route dispatch target and install
the corrected pinned input on those model branches. The active November 6
coordinator at live-sfincs commit b7fd3f03 uses refresh_highres_models.py, whose
default target is experiment/all-route-models (overridable by ALL_ROUTE_REF).
Do not infer the target from the older workflow copy in another branch. Check
for running, queued and pending Gates jobs started from older input commits
across all refs, and let them finish before applying a backfill.
Pin the then-current complete Gates package, not an older locally tested run.
Immediately before committing, compare its manifest/native hashes with the
current branch. If Gates changed, recompute from that newer package. If only a
sibling case or coarse result changed, retain those exact newer files. Publish
only the two Gates JSON changes with an exact branch-head lease. On lease loss,
repeat the case-identity check; do not retry the old whole-folder publisher blindly.

The separate upstream road-height builder needs its catalog omission repaired
too. Adding the verified tile to intake does not itself require or authorize a
full rebuild; a full rebuild could replace existing older heights elsewhere.
The narrow live repair deliberately preserves all existing valid station values.
