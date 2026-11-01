# SFINCS technical handoff — 1 November 2026

## Outcome

The experimental engine, real terrain/river/rainfall pipeline, native diagnostics, and app export work. The local hydraulics have NOT met the proposed accuracy targets. Preserve the 2013 failures in the app beside the 2014 development result. Do not promote the source-relocation scenario to the default.

| Case | Run | Trico peak m3/s | Observed m3/s | Timing error |
|---|---|---:|---:|---:|
| 2014 levee development | 41293656870 | 301.306 | 339.802 | 66 min early |
| 2013 frozen dry check | 41295025856 | 0.01157 | 30.865 | 672 min late |
| 2013 antecedent scenario | 41297523344 | 1.48992 | 30.865 | 2475 min late |
| 2013 mapped-source diagnostic | 41300122434 | 1.41021 | 30.865 | 2553 min late |

The last two are post-failure diagnostic scenarios, not independent validations. All use the existing pinned executable. No new solver run is justified by the evidence review below.

## Observed reach balance

`tools/sfincs/analyze_gauge_balance.py` reads the retained original USGS discharge observations, with exact cfs conversion, common UTC endpoints and trapezoidal integration. Reproduce without network or solver:

```powershell
.venv\Scripts\python.exe tools/sfincs/analyze_gauge_balance.py --gauges tools/sfincs/data/gauges
```

Results and source-file hashes: `tools/sfincs/data/gauge-balance.json`.

* July 19–23, 2013, 07Z endpoints: Cortaro 966,862.865 m3; Trico 1,243,520.443 m3. Downstream minus upstream is +276,657.578 m3 (+28.614% of Cortaro, mean 0.801 m3/s). Observed peaks are 32.848 and 30.865 m3/s, separated by 6 h 30 min. Both series are approved, unqualified, with maximum 15-minute intervals.
* September 7–11, 2014, 07Z endpoints: Cortaro 13,276,939.455 m3; Trico 9,769,843.100 m3, a net reduction of 3,507,096.355 m3. Trico retains 16 qualified observations; none were silently dropped. Observed peak lag is 9 hours.

These are finite-window station balances, NOT tributary hydrographs. With `DeltaStorage = upstream + lateral + directRain - downstream - losses`, positive downstream-minus-upstream can reflect lateral input, rain, released initial storage, measurement uncertainty, or their combination. Both 2013 endpoints still have nonzero flow; travel and storage across the window edges matter. No time shift or inferred residual has been inserted as model forcing.

Pima County's [Lower Santa Cruz plan](https://content.civicplus.com/api/assets/9e8e0f8b-3c86-4d17-9758-72436c1d7982?cache=1800), printed pp.246–248, lists drainage areas of 3,503 square miles at Cortaro and 3,641 at Trico, a 138-square-mile increment. It describes eastern fan flow, infrastructure-controlled drainage and levee protection. These establish potential additional contributing areas, not their July 2013 hydrographs. The [county discharge table](https://content.civicplus.com/api/assets/3246c546-63eb-4df1-9b27-a3d617576af9), p.28, places Rillito and Canada del Oro upstream of Cortaro: adding those flows again would double count the observed boundary. Do not assign Brawley flow to Trico merely because a source mentions Trico Road; exact station/confluence topology must be verified.

The [UA monitoring study](https://content.civicplus.com/api/assets/3a2eba4f-5938-4c26-8302-1ed10a06bf61), printed p.10, reports summer irrigation return flow and downstream flow loss during other surveys. Pages 8–9 document post-2014 channel migration/incision, including approximately 1.7 ft incision and 10 ft eastward movement at Trico. These support nonstationary geometry and additional water sources, but do not quantify the July 2013 event or prove the modeled pocket connection wrong. Page 6 identifies `Fig.3-8.cross section summary.xls`; pp.22–24 describe the 2014-calibrated HEC-RAS case. The workbook and native model remain unavailable in this checkout. The report's relative section plots cannot safely replace absolute bed geometry. A bounded exact-filename web search found the report, not a downloadable workbook.

The baseline model retains 907,232 m3 in the source-area box over the original 2013 event and exports only 68,210 m3 from it. This is much larger than the observed station net gain. The two quantities have different control volumes and cannot be subtracted to manufacture a correction. They show that omitted lateral water is plausible but does not alone establish why this model stores most of the upstream pulse. Independently moving the source onto two mapped river paths did not resolve it. The 1 m/10 m topographic depression is supported by terrain data; that does not establish historical bank openings or hydraulic connectivity. No arbitrary fill/burn follows from this evidence.

## Exact frozen case and assumptions

Configuration freeze: `86466e74425f3ab467939602edc31c89b83368dc`, reference run 41293656870. `evaluation-2013-freeze.json` and `antecedent-2013-protocol.json` record native file hashes. Base source remains [23,239]; [23,240] is a separately preserved failed comparison.

* Grid: 265 by 190, 100 m, EPSG:32612, extent [467000,3577000,493500,3596000], NAVD88 terrain; native 10 m subgrid. No assumed bathymetric river burn. `datasets_riv` is optional and its absence is not a proven misconfiguration.
* Lower Santa Cruz finite weir follows the documented levee path; crest elevations use 2015 1 m terrain. Those elevations and contemporary terrain postdate both events. Surveyed channel bathymetry, historical openings/flap gates and local conveyance are not established.
* Manning 0.04, infiltration zero, advection 1, wetting threshold 0.01 m; no target fitting or temporal shift. Single-cell observed Cortaro inflow; Trico is comparison only. Five downstream mask-3 outflow cells near the connected river outlet, remaining perimeter closed. This is not the UA normal-depth boundary implementation.
* July 2013 original case starts dry, excludes 24 hours. Antecedent scenario starts dry July 5, supplies 14 prior observed-inflow days, but does not reach demonstrated equilibrium. The one missing hourly Stage IV block is replaced by an explicitly qualified six-hour uniform-allocation scenario, not recovered observations. Original 96 event hours are unchanged and complete.
* All-domain rainfall is not a complete runoff model for external contributing catchments. Rainfall upstream of the interior point source may overlap water already included at Cortaro. Infiltration/evaporation and external lateral hydrographs are not represented.

## Verified execution versus unverified hydraulics

Verified: pinned official source executable and hashes, cross-runner reuse, elementary analytical checks already completed, native unit/date/quality handling, unchanged geometry hashes across frozen cases, completed native runs, bounded budget diagnostics, and app schema acceptance. The latest output contains 6,578 cells and 433 hourly frames. Native face output independently shows where water stores and exits.

Not established: event-general peak/timing accuracy, local depth accuracy, historical geometry fidelity, a calibrated uncertainty band, scour/bridge response, or crossing passability. Cell-average subgrid storage depth is not road-local depth. A small accounting residual does not validate hydraulics.

## Reuse the saved engine — no compilation

Engine artifact `sfincs-engine` from run **41290378239**, official source commit `f3647fc0289bb15cb2512d60686cef74cb853c78`. Executable SHA-256 `c4917bc54158b0943d6d128b45c4346a33d059fb5d93808d05520c975e38f090`. Archive includes source/license and runtime manifest. Local archive: `.sfincs-runs/engine-41290378239/sfincs-engine.tar.gz`. GitHub engine retention is 90 days; case artifacts retain 7 days, so preserve local copies. Windows Docker remains unavailable; the tested runtime is Ubuntu 24.04.

For an intentional replay on a compatible Linux machine, install the runtime dependencies shown in `.github/workflows/sfincs.yml` (`libnetcdf-dev libgfortran5 libgomp1`, Python 3.12 requirements). Download engine and the BASELINE antecedent case into new directories:

```sh
gh run download 41290378239 -R Godfather38/FLOODplain -n sfincs-engine -D engine-download
mkdir engine-reused
tar -xzf engine-download/sfincs-engine.tar.gz -C engine-reused
(cd engine-reused && sha256sum -c SHA256SUMS)
ldd engine-reused/sfincs  # all dependencies must resolve; stop if any are missing
gh run download 41297523344 -R Godfather38/FLOODplain -n sfincs-verification -D baseline-download
```

Use a new empty case directory and copy only the baseline `case.json` and files enumerated in its `inputArtifacts`, checking their SHA-256 values first. Do not overwrite downloaded evidence. With `ENGINE` set to the absolute verified executable path, run `OMP_NUM_THREADS=2 "$ENGINE" > solver.log 2>&1` inside that new case, then `python tools/sfincs/export_reach.py NEW_CASE --target tools/sfincs/data/gauges/trico-evaluation-2013-07.json` from the repository root. Baseline native runtime was 393.175 seconds; this is not a guarantee for other hardware.

The current manually dispatched workflow reproduces the FAILED mapped-source comparison, not the preferred baseline; do not launch it as a default forecast. It has no compilation fallback. No further dispatch was made during this review.

## Most efficient next evidence

Obtain the existing county/UA native geometry and survey workbook with survey-date, XY, vertical-datum and benchmark metadata, plus documented openings/structures along the source-pocket connection. Compare that connection and downstream section geometry before editing terrain. Also obtain independent event lateral-inflow/return-flow evidence or a documented contributing-catchment model; station residuals alone cannot supply it. Neither a generic HAND synthetic rating table nor flow-specific USGS wetted width/area is absolute bathymetry.

Until those gaps are resolved, deliver the app as a transparent experimental replay with both successes and failures. The reusable solver and export are complete; dependable local predictive hydraulics are not. No main deployment, Twilio changes, additional physical tuning or external contacts were made in this final review.
