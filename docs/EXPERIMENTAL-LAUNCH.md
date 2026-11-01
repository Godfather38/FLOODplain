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
