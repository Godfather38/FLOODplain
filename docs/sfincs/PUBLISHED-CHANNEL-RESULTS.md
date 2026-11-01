# Published channel setup: completed historical diagnostics

Run [41311500838](https://github.com/Godfather38/FLOODplain/actions/runs/41311500838), input commit `3a00002`, reused engine build `41290378239`. No recompilation. Both full events used the same published channel setup and source placement.

| Event | Model peak (m³/s) | Observed peak | Signed peak error | Signed timing error | Solver time |
|---|---:|---:|---:|---:|---:|
| 2013 | 11.4583 | 30.8654 | -62.88% | +328 minutes (late) | 536.530 seconds |
| 2014 | 306.0354 | 339.8022 | -9.94% | -61 minutes (early) | 104.947 seconds |

These are N=2 historical diagnostics conditioned on measured Cortaro inflow, not operational forecasts. The 2015 terrain and later estimated river dimensions are not demonstrated contemporaneous geometry for either event. The 2013 result does not establish the error of a correctly reconstructed 2013 model. The 2014 event is a development comparison. General prediction uncertainty remains unknown; this table is not a confidence interval, future guarantee, or road-depth accuracy estimate. No product error tolerance has been approved by these results.

The official HydroMT-SFINCS river workflow uses HydroGeom published bankfull estimates with NOAA river paths. It reduced 2013 pocket storage gain from 907,232 to 266,192 m³ and improved peak propagation, but did not resolve the observed discrepancy. This is evidence of sensitivity to channel representation, not an uncertainty distribution. The grid audit found exact cell minima and less than 0.00001 m face-threshold serialization differences, ruling out the tested indexing/flip errors. Budget residuals were +0.00778% and -0.03337%; budget closure does not prove hydraulic correctness. The 2013 antecedent rainfall includes an explicitly qualified six-hour allocation scenario.

## App integration

`tools/sfincs/data/published-channel-results/manifest.json` identifies both gzip JSON exports and SHA256 hashes. Paths in this committed manifest are repository-relative. Each case includes checks, provenance, native input/source, solver log, history NetCDF and storage/section summary. The large native maps remain in the workflow artifact (seven-day retention) and local run cache. Both exports passed the existing inundation contract: 6,578 cells, 433 hourly frames for 2013 and 97 for 2014. Completion describes execution, not predictive accuracy.

## Retrieve or intentionally replay

From the repository root with Python and authenticated GitHub CLI on PATH:

```sh
python tools/sfincs/replay_published.py
```

This retrieves the completed result without running the solver. It writes `.sfincs-runs/ci-41311500838/app-results/manifest.json`; that generated manifest uses paths relative to its own directory. If the temporary GitHub artifact has expired, use the committed exports above.

An intentional repeat of both historical events uses the existing Linux workflow and saved executable:

```sh
python tools/sfincs/replay_published.py --run
```

The command reuses an active workflow instead of dispatching a duplicate. There is no rebuild fallback. GitHub runner setup/download time is additional to the measured solver runtimes. The saved engine artifact has finite retention; this command requires it and the workflow's reference-case artifacts to remain available. Retrieval was executed successfully against the completed run; no unchanged solver replay was launched merely to test the wrapper. This is a historical replay adapter, not a current forecast refresh service.

Current-data selection and new runs remain deferred until the intended decision and acceptable product error are defined. Available historical errors cannot establish that tolerance or certify current terrain suitability.
