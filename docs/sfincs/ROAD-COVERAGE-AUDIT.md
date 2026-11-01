# Actual road-model coverage: connected-v2

This audit reads the exact native mesh used by the frozen road run. It does not modify that mesh or claim that new geometry has been simulated. The approved fresh completion run is 41344983607, input archive unchanged from b32d291. The earlier partial run 41339621278 remains preserved.

## Coverage checklist

| Location / route | Actual result |
|---|---|
| Full Trico / Trico-Marana / Marana route | 11.155 km; all 5,579 samples at 2 m spacing active at 6.25 m |
| Full Avra route, including North Trico and Avra Valley Road | 21.104 km; all 10,554 samples active at 6.25 m |
| Los Robles / North Trico | -111.30426, 32.43882; native face 240753; active 6.25 m |
| Brawley / Avra Valley | -111.29459, 32.39322; native face 267134; active 6.25 m |
| Trico-Marana / Santa Cruz | -111.27985, 32.45369; native face 283056; active 6.25 m |
| Other selected-route crossing records | All six active at 6.25 m; all nine selected-route records covered |
| Continuous 100 m road buffer, including endpoint approaches | Exact polygon difference against active 6.25 m cell footprints: zero uncovered area |
| Continuous 500 m road surroundings | Exact polygon difference against cells no coarser than 12.5 m: zero uncovered area |
| Retained 1 m terrain inside 500 m surroundings | 32,838,218 pixel centers checked; zero missing/nonfinite pixels |

These are actual native-cell and raster checks, not an inference from planned buffers. No missing selected-route geometry was demonstrated, so no unnecessary v3 mesh was created. Native cells extend across land and depressions, not only mapped watercourses. Spatial rainfall and infiltration apply across the active mask. Outside the fine corridors the model uses coarser cells, up to 100 m.

## Unmarked low spots

`terrain-low-point-candidates.geojson` contains 24 bare-earth profile minima along the two routes; 14 lie more than 50 m from any of the 60 mapped crossing records. Every candidate is in an active 6.25 m cell. `road-profiles.csv` retains all sampled elevations, coordinates and native face IDs, so screening thresholds can be changed without acquiring terrain or rerunning the solver.

The reproducible screening uses SciPy peak prominence on the negative terrain profile: 0.25 m minimum prominence and 26 m separation. These are inventory-screening choices, not flood thresholds or claimed measurement accuracy. Chainage follows the GeoJSON vertex order and is not the app crossing `km` field. The road alignment may differ from pavement center; bare-earth terrain under a bridge is not its deck. Some large minima may be bridge removal or other terrain features. Do not render them as confirmed flooded road dips.

## Remaining limits and outside coverage

The model includes 28 of the application's 60 crossing records. The other 32 remain outside: all 28 `pr-gates` crossings and four of six `pr-ina` crossings. The seven `pr-twinpeaks` crossings and two included `pr-ina` crossings are only 100 m. Incidental overlap with other routes does not mean their complete approaches have been audited. The selected routes are `trico` and `avra`; this is not all southern Arizona or every app route.

The 1 m terrain feeds approximately 1.04 m subgrid sampling within 6.25 m cells. Fine subgrid elevation/storage/conveyance is not a separate 1 m flow solution. Narrow ditches, curbs or sub-meter features may not survive sampling or terrain acquisition. There are no explicit underground culvert-opening or bridge-deck structure inputs in this case. Existing public layers do not establish those missing dimensions. A dry exposed drainage depression can be represented by terrain even if no river map names it; an underground pipe cannot be inferred from a bare-earth surface.

The bridge registry preserves sourced identity, available inventory dimensions and documented history. Current deck/soffit heights remain unknown. This does not require full bridge engineering: a defensible measured or explicitly estimated deck/approach height in the same datum would support hobbyist comparison. No generic bridge penalty, historic Cortaro mark used as a current threshold, or bare-earth center pixel treated as deck height is introduced.

## Reproduce and consume

Run `python tools/sfincs/audit_road_coverage.py` in the existing prepared environment. It reads retained rasters and native geometry only; no source refresh or solver execution.

Artifacts: `tools/sfincs/data/road-dip-refinement/coverage-audit-v2/coverage.json`, `road-profiles.csv`, and `terrain-low-point-candidates.geojson`. The report includes every crossing's coordinates, native face and resolution. Existing source acquisition dates, vertical datum and hashes remain in `connected-v2/fine-terrain-manifest.json` and `context-terrain-manifest.json`.

A changed route, documented missing drainage connection, or new structure data should produce a separately versioned model. Prior output must remain attached to its original mesh and forcing.
