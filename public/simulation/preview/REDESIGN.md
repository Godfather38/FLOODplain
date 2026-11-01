# Map-first redesign review

Implemented on experiment/avra-radar-runoff. Existing Leaflet/OSM, routes, favorites, closures, source checks and navigation retained. One nonmodal sheet on phones, one side pane on desktop. Default map has Routes / Time / Map options, zoom and Locate. Model choices and 3D remain secondary.

Time: explicit hourly Start/End, 6h / 12h / full presets, Apply/Cancel. Fifteen timestamps span14elapsed hours. Applied range constrains frame navigation; it is not maximum inundation. Frame changes retain viewport. Exact-time unavailable HAND is not carried forward.

Observed verification: 390x844 and360x800 default page dimensions matched viewport without page scrolling;320px reflow inspected. Actual GitHack map and live feeds loaded. Six-hour range applied and scrubbed to4PM, next disabled at endpoint; choosing12h then Cancel retained6h. Desktop side pane inspected. Recent USGS Cortaro request returned93provisional discharge observations; output times and cfs shown separately from simulation. Focused cache tests covered null/empty readings, cache reuse and429retention without timestamp renewal.

Screenshots redesign-phone390.png, redesign-range360.png and redesign-desktop.png were captured from f44f729. Subsequent small changes prioritize live flood-warning notice, retain it on return from replay, and adapt fit padding to left desktop panel.

Recent observations use explicit UTC24h intervals on modern USGS continuous API, on-demand loading,15min browser cache, in-flight coalescing, bounded same-endpoint cursor pagination and visible retained-data failures. Today filters in America/Phoenix. No new credentials. Shared authenticated backend may be needed for broader traffic; anonymous API limits remain. Existing5min live refresh and no-overlap guard retained; same-screen refresh no longer resets viewport. No new production schedules, AppsScript triggers, default-branch changes or solver automation.

Evidence sources: https://api.waterdata.usgs.gov/docs/ogcapi/migration/ ; researched layout brief from Android adaptive layouts, Apple Maps HIG and NN/g progressive disclosure. No comprehensive accessibility certification claim. Location prompt not exercised. Older history deferred. Simulation remains frozen2026inputs.
