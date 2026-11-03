# Reliability and backend

## Feeds

The app makes one request to the alert service, `?feed=all`, for gauges, rain, TransView events and driver reports. Each has its own fallback:

| Feed | If the service or source fails |
|---|---|
| USGS gauges | Direct USGS requests per gauge, then saved readings |
| Rain and stream | The GitHub `data` branch copy, which is often hours old because GitHub's scheduler runs late |
| TransView closures | The service's last answer, then the phone's, for up to 6 hours |
| County closures, weather alerts | Read directly by the phone |
| Forecasts for the flood model | One shared copy, `?feed=forecasts`, cached 15 minutes, then direct NOAA requests |

A real second host for the service would remove the remaining single point of failure. That needs an account, such as Cloudflare, and is not set up.

## Knowing when something breaks

- The service records each source's health on every check, readable at `?feed=health`.
- It emails the owner once when a source has been down 30 minutes, and once when it recovers.
- `.github/workflows/service-check.yml` checks from outside about every 2 hours when GitHub's scheduler runs. A failed run emails the repo owner. This is what notices the service itself being down.
- Phones report failed feeds, as counts only, to the `feed_failures` tab of the private sheet.

## Instant closure alerts

Push subscribers can opt in on the Alerts screen. The service compares closures on each area's routes on every check, about every 4 minutes, and pushes when one appears or clears.

- A failed feed is never announced as a reopening.
- The first check sets a baseline and sends nothing.
- At most 12 pushes per area per day.
- Push only. Texts stay on people's chosen schedule, because they consented to a fixed number of messages.

## Driver reports

One tap on a crossing screen: water over road, or no water. They show for 6 hours beside the rating and never change it. There are only two fixed answers, so there is no free text to moderate. Each phone can report a crossing once every 30 minutes, and the service caps reports at 400 a day. A person could still submit a false report, so the screen says they are from drivers and not checked.

## Offline

`public/sw.js` stores the app's own files and always tries the network first, so nobody gets an old version while they have signal. The last check is kept on the phone for 24 hours and shows at once on opening, with its "Checked" time. Map tiles and model data aren't stored, so the map background may be blank with no signal.

## Testing

- `npm test` runs unit tests and no longer rewrites `apps-script/WashWatch.gs`.
- `npm run test:browser` runs `e2e/smoke.mjs` in a real browser against the same files a deploy publishes, with outside services faked. It runs on every push and must pass before a deploy. `E2E_CHROME=1` uses installed Chrome locally.

## Why modules aren't bundled

Many modules find their data with `import.meta.url`, which bundling would break. `tools/add-preloads.mjs` lists the startup modules in the deployed `index.html` so browsers fetch them together instead.
