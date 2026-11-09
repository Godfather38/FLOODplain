# v2n channel-roughness SENSITIVITY, run 42565074684

Not for live registration. Case `brawley-avra-west-native-case-v2n-observed-inflow` (commit 9b6f4ea): v2x with Manning n 0.030 inside the lidar-centred channel mask (2.18 km2, script fix cdbe737). Subgrid elevation tables, infiltration, inflow, rain and window are identical to v2x. Solver 6,092 s (cap 7,200).

Mean n at velocity points inside the mask: 0.0463 (v2x) to 0.0329 (v2n), 17,564 points.

| Section | v2x peak | v2n peak |
|---|---|---|
| Donaldson Ranch (15877627) | 21.3 m3/s at 03:00Z | 21.0 m3/s at 03:00Z |
| Mile Wide Black Wash 15876815 band (ALERT 6443) | 40.7 m3/s at 09:00Z | 40.5 m3/s at 09:00Z |
| Mile Wide both bands | 47.5 m3/s at 09:00Z | 47.5 m3/s at 09:00Z |
| Manville (15876771) | 62.8 m3/s at 11:00Z | 62.7 m3/s at 11:00Z |
| Tucker (15876711) | 64.3 m3/s at 13:00Z | 64.1 m3/s at 13:00Z |
| Outlet 720060498 (outflow links) | 26.3 m3/s at 14:00Z | 27.3 m3/s at 14:00Z |

Road crossings, max water over road (m):

| Crossing | v2x | v2n |
|---|---|---|
| West Donaldson Ranch Road | 0.057 | 0.055 |
| West Manville Road | 0.612 | 0.612 |
| West Mile Wide Road | -0.128 | -0.121 |
| West Little Williams Drive | 0.429 | 0.416 |
| West Tucker Road | 0.921 | 0.928 |

ALERT 6443 at 03Z Nov 2: observed 21.974 m3/s; model Black Wash band 8.834 (v2x) / 9.496 (v2n).
Negative depth min -0.609 mm, 0 cells below -1 mm. Velocity proxy max 1.74 m/s. Residual -0.09% (estimate, outflow from first restart).

**Verdict:** lowering channel n by about 30% inside the channel mask does not move any peak by even one hour, so roughness of the measured channels is not what delays the wave. The mask covers only 17,564 of 1,308,350 velocity points (2.18 km2); if most of the flow travels outside it (overbank or sheet flow on 25-100 m cells), this test says nothing about roughness there. Candidates left: overbank/sheet flow across coarse cells outside the narrow mask, storage behind roads and in flats, runoff generation (see BRAWLEY-RUNOFF-ROUTING), and the closed outlet lobe (BRAWLEY-OUTLET-POND).

Re-run: `validate_extended.py --wt . --run .sfincs-runs/brawley-avra-west-result-v2n-42565074684/artifact/runs/current --baseline .sfincs-runs/brawley-avra-west-baseline-v2x-nwm42543054067/artifact/runs/current --compare .sfincs-runs/brawley-avra-west-result-v2x-42544624673/artifact/runs/current --output <json>`. Native output not committed (artifact sfincs-verification, 7-day retention).
