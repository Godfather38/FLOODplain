# Failure points, in plain words

A **failure point** is a spot where water can block or endanger your drive while the app has no way to see it, or can see it but can't tell how bad it is.

## Words used here
- **Gauge:** a USGS measuring station beside a river or wash. Every 15–60 minutes it reports how much water is flowing past.
- **cfs (cubic feet per second):** how much water is moving past a gauge. 0 means dry. 1 cfs is about 7.5 gallons every second, roughly a few garden hoses. A flash flood on the Santa Cruz can run thousands of cfs.
- **Upstream:** the direction the water comes *from*. Brawley Wash flows north, from Three Points toward Avra Valley Rd and then Trico Rd. Water seen at an upstream gauge reaches the road later.
- **Bridge:** the road goes over the wash and the water passes underneath. It's only a problem when water gets near the road surface or the county closes it.
- **Dip (low-water crossing):** the road goes down *through* the wash bed. When the wash runs, water flows across the road. This is where people drown.
- **"No bridge in the map data":** OpenStreetMap, the free map I routed on, doesn't mark a bridge there. It's probably a dip, but it could be a bridge nobody has marked yet.

## The failure points
Distances come from the map data and are approximate.

### 1. Los Robles Wash bridge on Trico Rd
- **Where:** on Trico Rd, about 0.4 mi south of Silverbell Rd, between El Tiro Rd and Silverbell Rd. Los Robles Wash is what Brawley Wash becomes north of Avra Valley Rd.
- **Who uses it:** the Trico route and both Silverbell routes. **Only the Avra Valley Rd route avoids it**, because it goes south on Trico from El Tiro.
- **What the app can't see:** no gauge sits at this bridge. The only gauge on this wash is at Three Points, about 20 miles south. Rain that falls on Avra Valley itself can fill the wash here without that gauge ever showing it.
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

### 3. Two unnamed wash crossings on Avra Valley Rd
- **Where:** (a) about 0.4 mi west of El Paso Gas Rd; (b) about 0.65 mi west of Sanders Rd (0.55 mi east of Clayton Rd). Old county closure lists name Avra Valley Rd "on either side of Trico Rd and El Paso Gas Rd," which fits these spots.
- **Who uses them:** only the Avra Valley Rd route. Both Silverbell routes reach Avra Valley Rd at Sanders, east of them.
- **What the app can't see:** no gauge on either wash, and we don't know whether they're bridges or dips.
- **What you do:** treat them like failure point 2. Next time you drive past, tell me whether each one is a bridge or a dip, and I'll update the map.

### 4. Rain falling on the valley itself
- **Who it affects:** every route, especially the small washes.
- **What the app can't see:** the 4 gauges only measure water that has already collected in the Santa Cruz River or in Brawley Wash at Three Points. A storm parked over Avra Valley can flood the small crossings first, before any gauge shows anything.
- **What you do:** until the county's rain gauges are wired in (next step), check the **Pima ALERT map** link on the page after any storm. It shows how much rain fell where.

### 5. The Santa Cruz River bridges (Trico-Marana, Sanders Rd, Avra Valley Rd)
- **What the app CAN see:** each bridge has its own gauge, so the app knows when the river is running under it.
- **What it can't tell:** how much flow gets each bridge closed. Nobody has set that level yet. So when water is under a bridge, the app says "Water under bridge" (blue), or "Caution" (orange) if it's rising fast, but it never says "Avoid" for these bridges yet.
- **What you do:** if the app shows water under the bridge on your chosen route, check the **Pima road closures** link before leaving. In one past storm the county closed *every* Santa Cruz bridge in this area for hours.

### 6. Silverbell Rd drainage washouts
- **Where:** along Silverbell Rd between Trico Rd and Sanders Rd. The road is paved but drains badly.
- **What the app can't see:** water and mud sitting on the road itself, with no wash involved. Per you, it's shallow, not dangerous.
- **What you do:** expect it after rain, slow down, and allow extra minutes.

### 7. A gauge stops reporting
- **What happens:** gauges break, lose radio contact, or shut down for the season. Once a gauge has been silent for 3 hours, the app marks it **gray, "No data"**, and never treats that as clear.
- **What you do:** gray means *unknown*, not safe. Use the ALERT map and closures links.

## The morning routine
1. Open the page. The big box names a route.
2. **Green, "Clear":** the gauges see no water at the crossings they cover. Before you go, ask yourself: *did it rain in the valley overnight?* If yes, skip Avra Valley Rd (failure points 2–3) and glance at the ALERT map (failure point 4).
3. **Blue, "Water under bridge":** the river is running under a bridge on that route. Check the closures link (failure point 5).
4. **Orange or red:** take the route it suggests instead, or wait.
5. **Gray:** the gauges can't tell. Use the ALERT map and closures links.
6. Any time: **if you see water across the road, don't drive into it.**

## What fixes each one
| Failure point | Fix | Who |
|---|---|---|
| 1 Los Robles bridge | A sensor on the bridge (needs county permission), or a county ALERT stream gauge if one exists nearby | You + me |
| 2 Brawley dip | A sensor on a post beside the crossing, on a willing neighbor's land | You + me |
| 3 Unnamed crossings | You look at them once, then I update the map | You |
| 4 Valley rain | Wire in the county's ALERT rain gauges (needs network access, see the chat) | Me |
| 5 Bridge closure levels | Look up past flood peaks at each gauge and set the flow where the bridge closed | Me |
| 6 Silverbell washouts | A "washed out" button you or family can tap so the others see it | Me |
| 7 Dead gauge | Already handled (shows gray) | Done |
