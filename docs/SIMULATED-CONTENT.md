# Simulated and modeled content

SFINCS runs, the 3D simulation and HAND estimates are part of the live app, where the map design puts them. The Map opens with simulated water showing. The Model, Case, Time and 3D controls are in the map tools, the 2-hour simulated outlook button is under the map, and road-height comparisons are part of the map and route scores. The separate HAND extent page remains at its existing URL, but is not the route from the main app to predicted road water.

Simulated or modeled water is identified by two things only:

1. **One dismissible acknowledgement.** `public/model-acknowledgement.js` shows it when someone first opens simulated or modeled content. Each device sees it once per browser session, whichever kind comes first. Anything new that shows simulated or modeled water calls `showAcknowledgement(kind)`.
2. **The wording already on screen.** Titles, panel text and status lines say simulated, modeled or estimated.

| Kind | Notice title |
|---|---|
| `savedRun` | This water is from a saved run |
| `simulated` | This water is simulated (3D) |
| `estimate` | This water is a model estimate (HAND) |

SFINCS also predicts water over the road along every route, and that prediction counts in the route ratings. See `SFINCS-ROUTE-PREDICTION.md`. Being simulated is never a reason to keep model water out of the routes.

Don't add permanent banners, tags or labels for this. Don't hide, gate or remove simulator features or data either: the owner decides how the app is used. Keep the tone neutral: don't call anything "safe", and don't inflate risk.

`test/model-acknowledgement.test.js` checks the notice, the wording, and that the simulator controls stay where the design puts them.
