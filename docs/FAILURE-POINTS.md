# Failure points, in plain words

A **failure point** is a spot where water can block or endanger your drive while the app has no way to see it, or can see it but can't tell how bad it is.

## Words used here
- **Gauge:** a USGS measuring station beside a river or wash. Every 15–60 minutes it reports how much water is flowing past.
- **cfs (cubic feet per second):** how much water is moving past a gauge. 0 means dry. 1 cfs is about 7.5 gallons every second, roughly a few garden hoses. A flash flood on the Santa Cruz can run thousands of cfs.
- **Upstream:** the direction the water comes *from*. Brawley Wash flows north, from Three Points toward Avra Valley Rd and then Trico Rd. Upstream observations provide regional context; whether, when and how much water reaches a particular road is not measured by that remote gauge.
- **Bridge:** the road goes over the wash and the water passes underneath. It's only a problem when water gets near the road surface or the county closes it.
- **Dip (low-water crossing):** the road goes down *through* the wash bed. When the wash runs, water flows across the road. This is where people drown.
- **"No bridge in the map data":** OpenStreetMap, the free map I routed on, doesn't mark a bridge there. It's probably a dip, but it could be a bridge nobody has marked yet.

## The failure points
Distances come from the map data and are approximate.

### 1. Los Robles Wash bridge on Trico Rd
- **Where:** on Trico Rd, about 0.4 mi south of Silverbell Rd, between El Tiro Rd and Silverbell Rd. Los Robles Wash is what Brawley Wash becomes north of Avra Valley Rd.
- **Who uses it:** the Trico route and both Silverbell routes. **Only the Avra Valley Rd route avoids it**, because it goes south on Trico from El Tiro.
- **What the app can't see:** no gauge sits at this bridge. The app uses remote readings from Three Points and the county stream sensor at Milewide Road, not a sensor on this bridge. Rain that falls on Avra Valley itself can fill the wash here without that gauge ever showing it.
- **Why it matters:** it's a bridge, so it's not a drowning spot. But if it gets closed, 3 of your 4 routes are gone at once.
- **What you do:** after rain in the valley, look at it as you approach. If water is near the road deck or there's a barricade, turn around. Go back south on Trico to Avra Valley Rd, and only if failure points 2–3 are clear.

### 2. Brawley Wash crossing on Avra Valley Rd
- **Where:** about 0.55 mi east of Trico Rd (0.45 mi west of Garvey Rd).
- **Who uses it:** only the Avra Valley Rd route.
- **What the app can't see:** the map shows no bridge, so it's probably a dip. The nearest gauge is about 20 miles upstream at Three Points. Water seen there takes hours to arrive, and rain that falls closer gives no warning at all.
- **Why it matters:** this is the most dangerous point on your routes. It's a likely dip on a wash with a history of closures and rescues.
- **What you do:**
  - If the app says Brawley Wash is flowing, **don't take Avra Valley Rd**.
  - If it rained in Avra Valley in the last ~12 hours, **assume this crossing could be running even if the app says clear**. Take Silverbell instead. "Silverbell → Sanders south" rejoins Avra Valley Rd east of this crossing.

### 3. Two more wash dips on Avra Valley Rd (confirmed dips by driving them)
- **Where:** (a) about 0.4 mi west of El Paso Gas Rd; (b) about 0.65 mi west of Sanders Rd (0.55 mi east of Clayton Rd). Old county closure lists name Avra Valley Rd "on either side of Trico Rd and El Paso Gas Rd," which fits these spots.
- **Who uses them:** only the Avra Valley Rd route. Both Silverbell routes reach Avra Valley Rd at Sanders, east of them.
- **What the app can't see:** no gauge on either wash. The app judges them from rain in inches at the nearby county rain gauges (Avra Valley Air Park, Picture Rocks, Trico Rd north of Manville), plus the county's barricade status at "Avra Valley Rd west of El Paso Gas Rd" and "east of Clayton Rd".
- **What you do:** follow the app's rating, and look before you cross.

### 4. Rain falling on the valley itself
- **Now covered by county rain gauges.** The app reads inches of rain in the last 1, 3, 6 and 24 hours at Avra Valley Air Park, Picture Rocks, Trico Rd north of Manville, and Brawley Wash at Milewide Rd and Three Points.
- **Rain thresholds for the dips:**
  - **Some:** 0.15" in 1 hour, 0.3" in 3 hours, or 0.5" in 6 hours.
  - **Elevated:** 0.4" in 1 hour or 0.6" in 3 hours.
  - **High:** 0.75" in 1 hour or 1.25" in 3 hours.
- **Check:** these are starting values, checked against Oct 31, 2026, when 0.20" fell over 6 hours and the roads were fine. Tell me when the app's rating doesn't match what you see, and I'll adjust them.

### 5. The Santa Cruz River bridges (Trico-Marana, Sanders Rd, Avra Valley Rd)
- **Correction:** the gauges named for the Avra Valley Rd and Sanders Rd bridges don't report anymore. The Sanders Rd gauge stopped in 1993. The app uses the live gauges at **Cortaro Rd** (upstream of all three bridges) and **Trico Rd** (just past the Trico-Marana bridge), plus Rillito Creek and Cañada del Oro, which reach the river hours ahead.
- **What "normal" is:** about 30–40 cfs every day. That's treated wastewater, not rain.
- **The levels:**
  - **Some:** 300 cfs.
  - **Elevated:** 3,000 cfs.
  - **High:** 10,000 cfs. In Sept 2014, when the Trico bridge was overtopped, Cortaro hit 21,200 cfs and Trico Rd hit 12,000.
- **The county's barricade status** at the Trico-Marana bridge is shown too. Sanders Rd is a Town of Marana road, so there's no county status for it.

### 6. Silverbell Rd drainage washouts
- **Where:** along Silverbell Rd between Trico Rd and Sanders Rd. The road is paved but drains badly.
- **What the app can't see:** water and mud sitting on the road itself, with no wash involved. Per you, it's shallow, not dangerous.
- **What you do:** expect it after rain, slow down, and allow extra minutes.

### 7. A reading is old or unavailable
- **What happens:** river/wash flow older than three hours is excluded by the app; rain has a separate historical-reading policy. The route still receives a number based on available evidence, so a low number is not confirmation from a sensor at the crossing.
- **County reporting:** unchanged ALERT sensors can report only every 12 hours. An old timestamp alone does not prove a broken sensor. See [the source audit](SENSOR-AUDIT.md) and the county map for source context.

## The morning routine
1. Open the page. The big box names the lowest-risk route and its rating.
2. Under each spot you'll see the evidence side by side: the county's barricade status (with when it was last updated), rain in inches, and river or wash flow. Weigh them yourself. A county "Open" from weeks ago means less than an inch of rain an hour ago.
3. **Low:** no sign of water. **Some:** rain or flow nearby; usually passable, so look as you go. **Elevated:** water likely at or near the road; cross only if you can see it's fine. **High:** the county closed it, or a flood is running. **Unknown:** missing data, which is not the same as safe.
4. Tap **Open in Google Maps**. It opens Google Maps with stops that force the chosen roads.
5. Any time: **if you see water across the road, don't drive into it.**

## What fixes each one
| Failure point | Fix | Who |
|---|---|---|
| 1 Los Robles bridge | Ask Flood Control for an ALERT stream sensor; else a sensor on the bridge (DOT permit). See PERMISSION.md | You |
| 2 Brawley dip | Same ask to Flood Control; else a post on a neighbor's land beside it | You |
| 3 More Avra Valley Rd dips | Confirmed dips. A sensor, or a county ALERT gauge (see PERMISSION.md) | You + county |
| 4 Valley rain | Done: county rain gauges in inches | Done (tune thresholds over time) |
| 5 Bridge closure levels | Done: set from USGS flood peaks (2014) | Done |
| 6 Silverbell washouts | A "washed out" button you or family can tap so the others see it | Me |
| 7 Old or unavailable readings | Excluded/identified by source policy; route still numbered | See source audit |
