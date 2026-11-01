# Documented levee case

The Lower Santa Cruz Levee was imported through HydroMT-SFINCS `setup_structures(..., stype="weir")`. Source alignment: NOAA OWP FIM's public CIROH copy of National Levee Database system **1905023008**, retained unchanged in `data/levee-source`. It is one 12.823 km line with 540 vertices; 5.764 km overlaps the reach where the previous model lost much of its channel pulse. It does not intersect the supplied main-river path. No extension, horizontal shifting, crest raising, channel carving or target fitting was applied.

## Actual elevation evidence

At the source vertices, elevations were sampled directly from standard USGS 1 m 2015 GeoTIFFs in EPSG:26912. The [USGS standard-product specification](https://data.usgs.gov/datacatalog/data/USGS%3A77ae0551-c61e-4979-aedd-d797abdcde0e) establishes metres/NAVD88. The original project XML describes international feet, but those are original project units; the standard GeoTIFF elevations were **not converted a second time**. Acquisition was February 20-26, 2015, after the September 2014 event. URLs, original metadata, 540 sampled values, source hashes and structure provenance are retained.

The current 10 m terrain samples are lower than the 1 m crest samples by a median **0.594 m**, and by as much as **2.457 m**. The mirrored NLD Z values agree with the dated samples within -0.141 to +0.308 m, median -0.0035 m, but their own vertical datum field is absent. Therefore the imported crest uses the documented USGS values instead. Original multipart structure and vertices are preserved. HydroMT writes finite overtoppable weirs with its default coefficient 0.6; that coefficient was not calibrated. Undocumented culverts/openings and exact September 2014 condition remain unknown.

## Completed physical result

[Run 41293656870](https://github.com/Godfather38/FLOODplain/actions/runs/41293656870), input commit `9506e1a`, reused the saved executable and existing subgrid/forcing inputs. Runtime **73.50 seconds**. Only the documented levee structure changed.

The original short Trico section peaks at **301.306 m3/s on September 9 at 05:39 UTC**, versus reported USGS **339.802 m3/s at 06:45 UTC**: **11.33% low, 66 minutes early**. RMSE is **26.165 m3/s**, compared with 62.990 without the explicit levee. The reference peak is approved and unqualified; 16 estimated low-flow samples later in the event remain identified in source metadata. Trico is never an inflow. This event has now been used for iterative development and is not independent held-out validation.

The channel pulse no longer collapses through the diagnosed middle reach: peaks are 396.30 m3/s at easting 485000 and 408.82 at 480000, versus 315.42 and 129.46 before the structure import. Final interior storage falls from 12.813 to **8.805 million m3**. The original deep depression remains; the improved result does not require filling it or pretending its elevations are invalid.

The full valley section peaks at **367.889 m3/s at 05:43 UTC**. It includes other modeled floodplain runoff and is **not substituted for the USGS comparison**. Short-section event volume is 8.095 million m3; full-section volume is 13.543 million m3. Both are retained in `sectionCoverage`.

The approximate interior water-budget residual is **-9359.8 m3 (-0.0378%)**. The 60-versus-120-second outlet integration difference is 9017 m3. This is not an exact conservation proof.

## Numerical output and app handoff

The initial workflow export rejected small negative native dry-cell volumes. Maximum single-cell deficit is **1.006 m3**, equivalent to **0.0001006 m** over a 100 m cell; maximum total deficit in a frame is **1.864 m3**. Export now uses the declared 0.01 m wetting threshold as an explicit diagnostic bound, labels these native dry-cell deficits rather than claiming floating-point roundoff, clamps them only for display, and retains signed volumes in the budget. The native solver was not rerun. The original workflow failure status is preserved in run provenance.

`data/reach-levee-result/inundation.json.gz` is the app artifact. Depth is native subgrid water volume divided by full computational-cell area, not point/road depth. Native outputs, crest inputs, comparison, uncertainty and provenance accompany it. No numerical accuracy interval is asserted.

Proposed later engineering evaluation: one reach, at least five held-out storms including flood and nonflood cases; peak within 30% and timing within one hour in at least four of five, with worst misses, missed thresholds and false alarms reported. These are proposed project targets, not a safety standard or achieved validation. The present development event is not counted as held out.
