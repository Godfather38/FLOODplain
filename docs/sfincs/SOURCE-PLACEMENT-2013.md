# Controlled river source placement: July 2013

Run [41300122434](https://github.com/Godfather38/FLOODplain/actions/runs/41300122434), input d72ff5b, reused the saved engine without compiling. Native solver runtime was 560.337 seconds. This is a post-failure diagnostic, not independent validation.

The source moved approximately 98 m from cell [23,239] to [23,240], supported independently by NOAA and USGS mapped river paths. Geometry, levee, subgrid, hydraulic parameters, antecedent forcing and scoring window stayed fixed. Added pocket boundary observations do not alter hydraulics. The gauge's actual location remains recorded separately from the model injection point.

| Original scoring window | Baseline antecedent | Mapped source |
|---|---:|---:|
| Trico peak, m³/s | 1.489915 | 1.410212 |
| Peak lateness | 41 h 15 min | 42 h 33 min |
| RMSE, m³/s | 7.976913 | 7.976413 |
| Pocket event storage gain, m³ | 907,232 | 908,448 |
| Pocket event net export, m³ | 68,210 | 66,999 |

Observed peak was 30.865363 m³/s. The mapped-source peak is 95.43% low. The tiny RMSE change does not offset worse peak and timing. The placement change does not explain or resolve the pocket storage problem; no 2014 repeat is justified by this result. Both cases remain preserved, without selecting a different source cell per storm.

Pocket bounds are EPSG:32612 [490000,3579000,491500,3581500]. Event storage/export cover July 19 07:00 UTC through July 23 07:00 UTC; peak scoring excludes the first day. Export comes from four outward-positive native sections integrated at one-minute intervals, not inferred from storage. Candidate final domain storage is 7,831,793 m³. Whole-run accounted budget residual is -473 m³ (-0.00252%); this is a numerical accounting check, not evidence of hydraulic accuracy.

Antecedent rainfall retains its explicit six-hour uniform-allocation scenario caveat. Terrain and levee data postdate the 2013 event. Historical channel geometry and unrepresented lateral flow remain unresolved; this experiment does not establish either as the sole cause. No further physical change is supported by this comparison alone.

Artifacts: `tools/sfincs/data/reach-placement-2013-result/` contains native history, checks, source/case provenance, box budget, and app-consumable gridded output. The large native map stays in the run artifact with its SHA-256 recorded in run-provenance.json.
