# Open the experimental app

From this branch's repository directory, run:

```sh
node tools/simulation/serve.mjs --app
```

Open **http://127.0.0.1:8081**, then choose **Experimental river forecasts**. Main's saved crossings/routes UI is included through `24ba3453fa9578151c58dd54ba9b909521a0d4b0`. This branch has not been merged into or deployed to main.

The shared navigation offers:

- **NOAA river forecast:** choose Trico, Cortaro or Brawley; enable live requests and refresh, or explicitly load recorded data. Download the normalized engine response. Recorded downloads carry `displayMode: recorded_replay` and their replay clock. HEFS is separately labeled ensemble spread, not an accuracy interval.
- **2014 rainfall / Stage IV:** complete 72-hour rainfall analysis, time slider, native-resolution explanation, forcing download and original-file provenance. This is the replacement rainfall input for the solver.
- **2014 observations / source audit:** USGS discharge replay and the corrected but incomplete historical IEM PNG rainfall, with the missing-data defect visible.
- **SFINCS recorded run:** original completed integration output, explicitly marked as using superseded rainfall and no upstream river inflow. No corrected solver run is implied. New solver output must retain its run identity, input hashes and boundary assumptions when integrated.

## HAND coordination, no merge performed

Inspected `experiment/hand-inundation` at `6a0c56ac1bfabb925fad1527c65d9908518723d9`, based on our older `15299aa`:

- `public/index.html`: HAND adds an estimated-extent link alongside the experimental forecast link. Preserve both if authorized later; our main merge leaves this area intact.
- `public/simulation/forecast.html`: HAND modifies the bottom navigation paragraph; our shared navigation is inserted at the top. Both are compatible in intent, but resolve navigation deliberately to avoid duplicate/conflicting labels.
- `public/simulation/forecast-engine.js`: HAND imports its loader/estimator, adds `junctionLoader` and `engine.inundation()`, and changes inundation context. Our current batch leaves the engine unchanged. Integration must preserve disabled/unsupported/error states and keep HAND estimates separate from SFINCS scenarios and NOAA gauge forecasts.
- `.gitignore`: both branches may carry independent artifact exclusions; retain the union where appropriate.
- HAND's new `inundation.html`, `inundation-app.js`, `hand-inundation.js`, data and tools do not collide with `solver-replay.*` or Stage IV files.

No HAND files were merged and no contributor was contacted. Browser interaction remains prohibited under the earlier tool denial; this pass uses the existing repository checks and direct file/contract inspection.


## Reach-result update

The SFINCS viewer now defaults to the original reach artifact from solver commit `86b5293`, with an explicit run selector retaining the old rain-only artifact. This 96-hour scenario uses observed Cortaro discharge and withholds Trico observations; local rainfall was omitted. It predates the new expanded Stage IV forcing. Displayed output has 6,578 Trico-crop cells and 97 hourly frames. Native comparison peak is 81.425 versus 339.802 m3/s, 7 h 55 min late. Full-domain maximum depth 26.884 m reflects problematic upstream pooling; displayed Trico-crop maximum is 2.466 m. The app labels hydraulic review, distinguishes these domains, and preserves original checks and input hashes. No rainfall-enhanced rerun or validated flood extent is implied.


## Latest rainfall-plus-inflow run

The viewer now defaults to `reach-stage4-31abefafe5877852`, preserved from solver branch commit `1040515`, with both earlier runs still selectable. It contains 6,578 displayed cells and 73 hourly frames, September 8 07Z through September 11 07Z. Stage IV rainfall is included, but this run predates the full 96-hour rainfall input: initial water levels come from inflow-only spinup and velocities were reset. No 96-hour rainfall rerun is implied.

Native model-section peak is 93.033 versus 339.802 m3/s observed, 6 h 57 min late; RMSE 88.205 m3/s. Full-domain maximum depth remains 26.884 m with problematic upstream pooling; displayed Trico-crop maximum is 2.991 m. The app labels poor fit and hydraulic review, retains original boundary/forcing hashes and assumptions, and offers the unchanged original output download. No geometry correction, solver build, or rerun was performed by the app thread.


## Geometry-result checkpoint

Latest default is `reach-geometry-b0530ca20c3f3643` from solver commit `39afc29`: 6,578 displayed cells, 97 frames, full 96-hour rainfall/inflow run. Contemporary 10 m terrain is represented by native subgrid tables and directed river topology constrains outlets. Displayed depths are **cell-average water depth (native volume / full 100 m computational-cell area)**, not road or local channel depth.

Peak timing improves to 39 minutes late from 6 h 57 min; peak flow remains only 96.725 versus 339.802 m3/s observed, with RMSE 62.990 m3/s. The viewer presents timing and magnitude separately and retains hydraulic-review warnings. Full-domain cell-average maximum 25.268 m remains problematic; displayed-crop maximum is 3.007 m.

The solver completed in 104.011 seconds using the saved executable on a fresh runner. Its workflow initially failed during export because a volume tolerance was compared with depth units; the solver owner corrected export locally against unchanged native outputs. `tools/sfincs/data/reach-geometry-result/run-provenance.json` preserves this outcome and native hashes. The app thread did not rerun/build the solver or merge the HAND branch. All prior outputs remain selectable and unchanged.


## Latest documented-levee development benchmark

Default viewer and historical route context now use the unchanged levee artifact from solver commit `86466e7`. All prior runs remain selectable. Native short-section peak is 301.306 versus 339.802 m3/s observed (11.33% low), 66 minutes early, RMSE 26.165 m3/s. The full-valley peak is a different spatial measurement and is not substituted for the gauge comparison. This is iterative development against the 2014 event, not held-out validation. Levee geometry is published and crest samples come from February 2015 USGS 1 m NAVD88 data; exact September 2014 condition remains uncertain.

`docs/sfincs/LEVEE-CASE.md` and original run provenance preserve source details, the approximate signed water budget, and export handling. Negative native dry-cell storage is clamped for display only; signed storage remains in the budget. No solver rerun, model parameter change, main deployment or HAND branch merge occurred in the app thread.


## Frozen July 2013 failure

The viewer now opens the July 2013 independent-event check and presents it alongside the September 2014 development fit. Source solver commit `76cb1e8225c93f130ba98c1864c50e0d951546d5`; the original freeze record is retained in `tools/sfincs/data/evaluation-2013-freeze.json`. The unchanged model produced peak 0.0115658 versus 30.86536 m3/s observed (99.9625% low), 11 h 12 min late, RMSE 8.0825 m3/s. This is a scientific failure, not a software execution failure. No event-specific tuning was performed. The event was previously seen in a separate simplified routing model, so this is not a blinded experiment.

`public/simulation/data/sfincs-event-comparison.json` records both original artifact hashes, metrics and evaluation roles. The improved 2014 development fit does not establish transferable accuracy or a ± interval. Historical SFINCS remains context only in combined route decisions; these metrics do not alter a current route score. Numerical deficit labels are now sourced per run rather than copied from the latest 2014 case.


## Antecedent diagnostic, not a successful correction

Default viewer now includes the completed `9200dd2` antecedent run: 6,578 cells, 433 frames, July 5–23. The event-window short-section peak is 1.4899 versus 30.8654 m3/s (95.17% low), 41 h 15 min late; RMSE 7.9769 m3/s. Whole-run antecedent peaks are not substituted for the July 20–23 evaluation. At July 19 07Z the model contains 6.254 million m3 interior storage and 0.2303 m3/s short-section flow; this is time-varying antecedent forcing, not equilibrium.

The six-hour allocation caveat remains explicit. This post-failure initial-state sensitivity experiment is not a new independent validation, and it did not fix the flow miss. Original `antecedent-state-check.json`, case, checks, output and run provenance are preserved under `tools/sfincs/data/reach-antecedent-2013-result`. The comparison table retains the frozen-event failure and 2014 development result. No current route score is changed by this historical diagnostic.
