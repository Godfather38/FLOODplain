# FLOODplain experimental branch handoff

Branch: **experiment/avra-radar-runoff**. Separate from main; no experimental deployment or Twilio changes. Main saved-route UI is integrated through `24ba345`.

## Open it

From the `simulation` repository directory:

```sh
node tools/simulation/serve.mjs --app
```

Open **http://127.0.0.1:8081**. Refresh original observations, then choose **Combined route decision** or **Experimental river forecasts**.

## Working features

- Official NOAA forecast engine for Trico, Cortaro and Brawley, with units, issue age, cache/error states, recorded replay and JSON export. HEFS spread is separate from deterministic flow and is not labeled forecast accuracy.
- Combined route interface consumes the original observation/rule results. County closures exclude routes; current model concerns can raise concern, never erase observed danger. HAND's existing JSON export format is accepted without merging its branch; automatic HAND calculation is not installed here. Historical SFINCS is context only, not a present-day score.
- Rainfall replay and SFINCS-ready Stage IV forcing: September 2014 (72/96 hours), July 2013 event (96 hours), and extended antecedent (432 hours). The strict antecedent file retains one missing hour. A separate six-hour allocation scenario supplies complete values with explicit temporal and cross-product uncertainty. Original files, hashes, units, masks and audits are preserved.
- SFINCS viewer: original run selector, cell-average depth/time display, downloadable outputs, source/assumption details and an event comparison table. Diagnostic source-placement output is selectable but **not promoted to the default or best model**.

## What the actual runs show

| Case | Modeled / observed peak, m³/s | Timing error | Interpretation |
|---|---:|---:|---|
| September 2014 levee case | 301.31 / 339.80 | 66 min early | 11.3% low; iterative development using post-event crest evidence, not independent validation |
| July 2013 frozen model | 0.01157 / 30.865 | 11h12 late | Independent-event failure; not blinded |
| July 2013 longer antecedent | 1.490 / 30.865 | 41h15 late | Initial-state diagnostic still fails; not equilibrium or new independent validation |
| July 2013 source placement | 1.410 / 30.865 | 42h33 late | Tested placement change did not fix the miss; retain as rejected diagnostic |

No general accuracy ± is established. Depth is averaged over computational cells, not roadway depth. Contemporary terrain, unmeasured bathymetry/openings, omitted lateral inflows and historical geometry uncertainty remain material. The July 2013 source audit found no export/unit/time/cache error, but public gauge versus Stage IV rainfall discrepancies remain. All original failed results remain visible.

## Next useful work

Resolve the small-event routing/storage discrepancy using the retained native flux/storage diagnostics and independently supported channel geometry or lateral-flow evidence. Preserve the frozen result when evaluating changes. Integrate HAND's actual calculation/export path deliberately; its shared navigation and forecast-engine changes have not been merged. No new solver build was performed in the app thread.

Existing repository checks and actual artifact contracts have been exercised. Browser visual QA remains unperformed under the prior browser-operation prohibition. This is a usable experimental app and data/model integration, **not a field-validated flood or road-passability engine**.

Details: [launch/interface notes](EXPERIMENTAL-LAUNCH.md), [route fusion](ROUTE-FUSION.md), [rainfall forcing](STAGE4-FORCING.md), [2013 source audit](STAGE4-2013-AUDIT.md), [levee provenance](sfincs/LEVEE-CASE.md).

Historical issued RFC comparison is now integrated at `/simulation/official-history.html`, linked from the current forecast page. It retains all issuances across July 2013 and June/August/September 2014, with fixed lead windows, incomplete-coverage labels, observed curves and persistence baseline. See `docs/PREFAB-FORECAST-STACK.md` for the complete reuse architecture and remaining integration gaps. This evidence does not establish a general peak-flow accuracy range.

The current launch flow now includes the connected engine: refresh main observations → NOAA river forecast → enable requests → Refresh connected forecast stack → Combined route decision. This automatically loads official RFC, NWM target/upstream context, HEFS, local NWS forecast rainfall and the two existing HAND junctions. HAND evidence transfers automatically within the tab. See `docs/CONNECTED-ENGINE.md`; recorded connected replay never enters current route ranking. Full-domain forecast rainfall and validated peak-flow skill remain unresolved.
