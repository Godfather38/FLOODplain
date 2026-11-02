# Barricades and road height in ratings

- A county Closed point on a route counts anywhere along it: within 40 m of the line, on a road the route uses. It rates the route 5, using the county's words.
- Proceed with Caution alone rates 2. Local rain, a local river reading, a weather-service alert or modeled water over the road brings it back to 3 or more. Distant sensors never do: upstream wash gauges (Milewide, Three Points), creek gauges and basin rain stay listed as alerts, capped at 2 on their own, as `BRAWLEY-UPSTREAM-EVIDENCE.md` sets out. Closed is never softened.
- The HAND check compares modeled water with road height above the stream bed, from `public/inundation/road-heights.json`, where that height is known. It is known at 6 of 25 supported crossings, including Brawley. The rest are listed as unresolved because the stream bed height is not consistent near them, and they keep the older fixed 1 m level.
- Rebuild the heights with `tools/road_heights/hand_road_heights.py` on branch `experiment/road-heights`.

## Confirming a closure is on a route

TransView (Pima Association of Governments) publishes closures and construction with geometry. The site's own page methods `Map.aspx/GetData` and `Map.aspx/GetConstructionEvents` return it. They are undocumented and block browsers, so the alert service reads them and serves `?feed=roadevents`. If the feed fails, nothing changes in the ratings.

- Lines: a closure in effect now counts when it overlaps the route by at least 30 m, within 12 m of the line. A street crossing the route overlaps by only about 24 m.
- Points: a closure counts when it is within 40 m of the line and its headline names a road the route uses.
- Lane closures and seal coating do not count as closures. Only `Road Closed` and `*_ROAD_CLOSED` entries do. Date ranges and daily hours apply.
- County barricades: the location wording names the leg, as in "Trico Rd south of Trico Marana Rd". The barricade counts when the route runs at least 100 m that way from it. A barricade on the far leg of an intersection where the route turns does not count. Wording with no north, south, east or west of still counts if it is on the line and named road.
- The county's reason field is not shown. It read Flooding for the Trico closure on November 2, 2026, which the owner confirmed was utility work. The county publishes points, not the extent of a closure, so the far end of a closed stretch is not known.
