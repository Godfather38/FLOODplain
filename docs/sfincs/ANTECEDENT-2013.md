# Antecedent initialization scenario: July 2013

Run [41297523344](https://github.com/Godfather38/FLOODplain/actions/runs/41297523344), input commit `38d9a2f`, reused the saved executable. All native geometry and hydraulic parameters match frozen `86466e7`; only dates, upstream discharge and rainfall changed. Total solver runtime 393.175 seconds (6m33s), simulation time 392.955 seconds. The job and export completed successfully.

**Prediction still fails in the unchanged July20 07Z onward evaluation window:** peak 1.489915 m3/s at July23 04:00Z versus observed 30.865363 m3/s at July21 10:45Z: 95.17% low and 41h15m late. RMSE 7.976913 m3/s over 289 observations. The dry baseline was 0.011566 m3/s, 99.96% low and 11h12m late. No target-based adjustment followed either result. The full 18-day section maximum occurs in an earlier storm and must not be substituted for the event-window peak.

## Initial state actually achieved

At July19 07Z, modeled interior storage was 6,253,640.66 m3, native Cortaro inflow 2.013328 m3/s, short Trico section flow 0.230278 m3/s and full-valley section flow 1.002012 m3/s. This establishes nonzero modeled connectivity, not an accurate gauge flow or equilibrium. The fixed 38-cell near-source mask stored 2,415,761.87 m3; sampled pocket water surface was 644.4942 m NAVD88. A day later that mask stored 2,525,032.40 m3 and the sampled surface was 644.9941 m. The state was still changing. The mask includes whole 100 m cells and is not identical to the fine-resolution connected depression used in the prior geometric capacity screen; their storage totals must not be equated.

Final interior storage 7,831,544.41 m3; applied river volume 3,636,968.95 m3, rainfall 15,154,423.37 m3, net enclosing-section outflow 10,966,962.61 m3. Residual -7,114.69 m3 (-0.03786%). Small mass residual does not establish spatial/hydraulic accuracy.

## Qualification

This is a post-failure initial-state sensitivity scenario, not new independent validation. The 432-hour rainfall includes a six-hour July16 block uniformly allocated from an actual six-hour Stage IV product. Its disagreement with the five available hourly analyses is retained (-32.25 to +5.61 mm across the source crop). Missing hourly rain was not silently treated as zero; the original input remains `requires_quality_review`. The exact hash-pinned scenario required an explicit run flag. All original 96 event hours remain unchanged.

No channel burn, roughness change, shifted source or target-based initialization was applied. The result does not justify repeatedly extending spinup until a target is matched. The next unresolved question remains local channel/pit representation and low-flow conveyance against dated terrain and measured channel constraints.

Artifacts in `tools/sfincs/data/reach-antecedent-2013-result/` include checks, original-window comparison, daily state snapshots, native history, solver log, app artifact and provenance. The complete native map is retained in run 41297523344 and the local run folder; at 125 MB it exceeds the repository single-file limit, so it is not committed. Its SHA256 is recorded.
