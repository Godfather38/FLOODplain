# FLOODplain: scope

## Context
This is a personal tool for one person, and maybe their family: before leaving for work, check whether water is over the roads on the commute. Existing city tools only show closures, and they show them after the fact. The aim is to see water levels early and, if needed, add a few homemade sensors at low spots. It's a free public service: no money, no organization, no ongoing hosting bill.

## 1. Existing tools (use these first)
- **USGS WaterAlert** (free email/text when a stream gauge passes a level you pick). If a gauge sits near your trouble spot, this alone may solve the commute problem today, with no build.
- **USGS gauges** (stream height every 15 min) and **NWS gauges** (water.noaa.gov), which carry official flood stages (action/minor/moderate/major) and forecasts. The map pulls both.
- **FEMA flood zones**: a map overlay showing where flooding is expected.
- **Open designs to copy for hardware:** NYC's **FloodNet** is an open-source ultrasonic street-flood sensor, the same idea as yours, already proven. I'll base the build on it instead of inventing one.
- Many states and counties run their own flood-warning gauge networks (e.g. NC FIMAN, Harris County TX, Iowa IFIS). Once I know your city, I'll check whether yours has one and add it as a map layer.

## 2. Legality (plain version; general US info, not legal advice)
- **Your own property, or a friend's or family member's with their OK:** fine. Get the OK in writing, even a text.
- **City/county/state poles, bridges, guardrails, signs:** someone else owns them. Attaching without asking is encroachment, and they can remove it. Asking costs one email to public works or stormwater ("I'm a resident, I want to put a small battery water sensor here, it's free, you can have the data"). Many cities say yes. **Never** attach anything to traffic signals or signs.
- **Inside a creek or ditch channel:** don't put a new post in the water without checking. That can trigger state or federal waterway permits. Mounting on an existing structure *above* the water avoids this.
- **Radio:** WiFi and LoRa (915 MHz) are license-free with off-the-shelf certified modules.
- **Sharing with family or the public:** the map shows a clear "Turn Around, Don't Drown. This is a hobby sensor, not an official warning" banner.

## 3. Real-world constraints at a road low spot
- **Power:** battery plus a small solar panel. The ESP32 wakes, measures, sends, and sleeps.
- **Connectivity is the hard part.** WiFi only works if a willing neighbor's network reaches the spot. Otherwise LoRa needs a gateway (around $100 one-time, or free if The Things Network already covers the area). Cellular means a monthly fee, so it's out.
- **Cost:** about $50–70 per sensor (ESP32, JSN-SR04T waterproof ultrasonic sensor, enclosure, 18650 battery, 1W solar panel).

## 4. What gets built (pilot: 1–5 sensors)
- `public/index.html`, `public/app.js`, `public/style.css`: a static Leaflet map hosted free on **GitHub Pages**. Layers:
  - USGS and NWS gauges, colored by flood category, with rising/falling arrows. The browser calls the public APIs directly; the parsing logic is ported from `server/upstream.js`.
  - FEMA flood-zone overlay.
  - Your sensors.
  - **"My route"**: save home and work, and see the gauges and sensors near the route at a glance.
- Sensor data goes to **ThingSpeak's free tier**. It's non-commercial and allows one reading per 15 s, which is plenty. The map reads each public channel's JSON. Depth math from `server/levels.js`: `depth = baseline − distance`, plus warn/danger thresholds.
- `hardware/esp32-water-level/`: an Arduino sketch (deep sleep, a median of several pings, WiFi to ThingSpeak, with LoRa as a later option). The README covers parts, mounting, calibration, and the permission email template from section 2.
- `docs/SCOPE.md`: sections 1–3 above, so the reasoning lives in the repo.
- Delete `server/`, the SQLite code, and the `leaflet` npm dependency (Leaflet loads from a CDN on Pages).

## Open item
Add the city/county and commute route so local gauges and any county flood-warning network can be listed here.
