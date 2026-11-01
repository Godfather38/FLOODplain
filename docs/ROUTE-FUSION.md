# Combined route decision

Open the main app, let its current observations load, then choose **Combined route decision — observations + models**. The same-tab session handoff contains the existing rated crossings, source checks, area and observation time. The experimental page provides ranked routes, recommendation wording, per-crossing/source details and a downloadable decision record. It does not change SMS or production routing.

`public/simulation/route-fusion.js` exposes `fuseRoutes(snapshot,evidence,options)`, `handEvidence(export)` and `sfincsEvidence(run,time)`. This consumes original rules rather than reimplementing their sensor thresholds. HAND exports use the existing `hand_inundation_estimate` contract inspected on branch `experiment/hand-inundation` at `6a0c56a`; Trico-Marana and Sanders IDs map to existing failure points. The UI accepts those JSON exports without merging or duplicating HAND code. Automatic HAND calculation is not installed on this branch yet.

Precedence:

1. Existing county CLOSED checks exclude the route, including when other inputs suggest dry conditions. Existing observed danger is never reduced.
2. Original route levels are the baseline. A crossing with only missing/no-reading checks remains unknown in this combined view; a missing model does not manufacture coverage.
3. A current HAND forecast estimate with wet cells near a mapped crossing raises concern to caution. It indicates neighborhood water, not a confirmed road intersection, bridge-deck depth or closure. Disagreement with low original concern is visible.
4. Current model evidence must have usable status, a valid time between one hour ago and 24 hours ahead, and an issuance/view age no older than 24 hours. Stale, unsupported, historical and scenario inputs are retained as context. The original snapshot must be no more than ten minutes old for a recommendation.
5. Recommend the lowest-concern nonclosed, below-danger route with usable original observations, then shorter travel time. Otherwise return an explicit insufficient-data/no-recommendation state. No numerical averaging, probability of safety, or depth-to-passability conversion occurs.

SFINCS adapter uses the nearest exported cell within 150 m of each configured crossing and retains its full provenance. This is a proximity screen, not a surveyed road intersection. The available run is historical 2014 output and therefore cannot alter a present-day recommendation. The UI exposes it as context with model limitations; a future current forecast provider needs an explicit forecast contract rather than relabeling a historical scenario.

No HAND branch merge, new solver, main deployment or live message sending is involved. Shared-file integration overlaps now include `public/app.js` (one session handoff line), `public/index.html` (one route-link insertion), and the forecast navigation link. Preserve the existing HAND nav/engine additions if merged later.
