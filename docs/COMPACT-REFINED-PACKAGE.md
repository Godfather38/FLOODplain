# Compact refined model package

The opt-in refined case now uses a gzip-compressed columnar binary transport. The existing renderer contract is unchanged: the loader reconstructs exact native cells/rings and plain quantity arrays. Renderer-owned code was not modified. Original JSON package and solver archive remain retained, with original manifest/geometry hashes in compactSource.

| Actual model payload | JSON gzip | Compact gzip |
|---|---:|---:|
| Geometry | 17,355,685 B | 12,728,211 B |
| First frame | 6,175,970 B | 1,822,663 B |
| Last frame | 8,079,673 B | 2,377,099 B |
| First-frame startup (geometry + frame) | 23,531,655 B | 14,550,874 B |
| All geometry + 21 frames | 172,644,571 B | 58,592,476 B |

These are actual whole-case model payloads, not renderer-only bundle measurements. Add unchanged app/renderer code, manifests and viewport-dependent vector tiles to obtain total page transfer. No network latency or physical-phone FPS guarantee is implied. First model display transfer falls38%; frame transfer about70%; full model payload66%.

Decoded geometry bytes fall124,480,135 to45,177,836; first-frame decoded bytes19,675,407 to3,189,256. This reduces parse/decompression working buffers, not a measured total browser heap. Shared vertex objects also remove repeated coordinate pairs across adjacent rings. Renderer arrays remain compatible; further typed-array renderer changes are not required for this release.

Geometry coordinates, centers, areas and edge lengths remain Float64. Polygon vertices are deduplicated by exact coordinate pair, with UInt32 indices and offsets; hanging-node ring order and all native IDs are retained. Native volume and zs are stored Float32 only after the exporter proves every nonmissing value round-trips exactly; null maps to NaN. Negative native volume remains negative. Depth is derived as max(0, native volume)/full native area, exactly as the original export. No quantization, hydraulic interpolation, datum change or new model result.

Validation compared all398,613 cells and every ring exactly against the original JSON, plus all quantities in first/last frames. Local compact geometry decode+validation took587ms in one Node run; this is not browser/network startup timing. Focused loader tests cover negative/missing values and malformed headers. Remote app verification is recorded below after publication.

Reproduce conversion:
`python tools/simulation/compact_quadtree.py public/simulation/data/refined-partial-41339621278 <new-destination>`

Original frozen preview and original partial commit remain available. Partial timeframe and unavailable refined3D are unchanged. No production deployment.

## Actual remote app check

Published implementation4aeb310 rendered the compact first and last frames through GitHack. Exact visible readings matched the original: face266577 at10AM0.653m; face387171 at3PM2.204m. Resource inventory showed geometry.bin.gz, frame-0.bin.gz and frame-20.bin.gz only. No JavaScript errors reported. Desktop and390x844phone screenshots are public/simulation/preview/refined-compact-{desktop,phone}.png. Partial/frozen labels and timestamp acknowledgement remained visible.

Fresh commit-URL spot checks observed ready UI within14990ms(compact) and14184ms(original). These upper-bound observations include tool/network/CDN delay and were not controlled cold-cache measurements; they do NOT demonstrate a wall-clock speedup. The reproducible improvement is actual byte volume and decoded buffer size. All sources remain unchanged. Further viewport streaming could reduce initial geometry transfer, but is not claimed implemented.
