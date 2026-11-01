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
