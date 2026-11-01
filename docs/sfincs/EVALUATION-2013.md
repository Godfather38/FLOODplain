# Frozen configuration: independent July 2013 event

Configuration frozen at `86466e74425f3ab467939602edc31c89b83368dc` before scoring. July 19 07:00Z through July 23 07:00Z, 2013; first 24 hours excluded. Event selected for complete approved, unqualified Cortaro and Trico observations. It previously calibrated a separate simplified routing model, so this is not blinded, but it was not used to tune SFINCS.

Run [41295025856](https://github.com/Godfather38/FLOODplain/actions/runs/41295025856) succeeded. Saved executable reused; no compilation. Solver total 69.130 seconds, including 69.001 seconds of simulation. Only native rainfall, discharge and date configuration changed; every other native input matched frozen hashes. Complete Stage IV forcing: 96 hours, zero missing cell-hours. No parameters changed after scoring.

**Prediction failed:** short Trico section peak 0.0115658 m3/s at July 21 21:57Z versus observed 30.86536 m3/s at 10:45Z: 99.9625% low, 11 hours 12 minutes late. RMSE 8.08251 m3/s over 289 observations. No timing adjustment applied. The full-valley section also peaked at only 1.39432 m3/s; it is not interchangeable with the gauge section.

Native input volume was 966,886.72 m3 river flow plus 1,644,897.48 m3 rainfall. Final interior storage was 2,530,874.02 m3, net enclosing-section outflow 80,927.82 m3. Residual -17.637 m3 (-0.0006753%). Thus almost all input remained stored despite a small mass-balance residual. Cross-section peaks declined downstream: 18.219, 10.626, 5.225 and 2.296 m3/s at x489000, x485000, x480000 and x475000. These facts identify severe low-flow transmission/storage failure, not its unique cause. Initial wetness, unresolved channel connectivity/bathymetry, and dated geometry need evidence-based review; do not tune this event into a passing held-out score.

The 2015 terrain/levee condition postdates the storm. Dry initial state and a 24-hour spinup are assumptions, not measured antecedent wetness. External lateral tributaries remain omitted. The better 2014 development fit does not establish generalization or production accuracy. No quantified depth accuracy or passability claim follows from either event.

Artifacts: `tools/sfincs/data/reach-evaluation-2013-result/` includes native history/map, solver log, checked case, app-contract output and provenance. The app output contains 6,578 cells and 97 hourly frames; displayed depth remains a 100 m cell mean, not roadway depth.
