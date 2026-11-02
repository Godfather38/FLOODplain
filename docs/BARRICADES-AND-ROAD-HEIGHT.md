# Barricades and road height in ratings

- A county Closed point on a route counts anywhere along it: within 40 m of the line, on a road the route uses. It rates the route 5, using the county's words.
- Proceed with Caution alone rates 2. Local rain, a local river reading, a weather-service alert or modeled water over the road brings it back to 3 or more. Distant sensors never do: upstream wash gauges (Milewide, Three Points), creek gauges and basin rain stay listed as alerts, capped at 2 on their own, as `BRAWLEY-UPSTREAM-EVIDENCE.md` sets out. Closed is never softened.
- The HAND check compares modeled water with road height above the stream bed, from `public/inundation/road-heights.json`, where that height is known. It is known at 6 of 25 supported crossings, including Brawley. The rest are listed as unresolved because the stream bed height is not consistent near them, and they keep the older fixed 1 m level.
- Rebuild the heights with `tools/road_heights/hand_road_heights.py` on branch `experiment/road-heights`.
