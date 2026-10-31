# Game plan: remaining failure points

The prototype (`public/`) rates 4 routes from 4 USGS gauges. **[FAILURE-POINTS.md](FAILURE-POINTS.md)** explains each blind spot in plain words, along with what to do about it each morning.

## Coverage today
| Route | Gauged | Blind spots |
|---|---|---|
| Trico → Trico-Marana | Santa Cruz at Trico Rd (09486520) | Los Robles Wash bridge on Trico Rd |
| Avra Valley Rd | Santa Cruz at Avra Valley Rd (09486509), Brawley Wash ~15 mi upstream (09487000) | **Brawley Wash dip + 2 unnamed crossings with no bridge in the map data** |
| Silverbell → Sanders north | Santa Cruz at Sanders Rd (09486515) | Los Robles Wash bridge; Silverbell drainage washouts (shallow) |
| Silverbell → Sanders south | Santa Cruz at Avra Valley Rd (09486509) | Los Robles Wash bridge; Silverbell washouts |

The stretch from home to El Tiro & Trico has no mapped crossings.

## Steps
1. **Go live and verify the gauges.** Deploy to Pages, then confirm in a real browser that:
   - the USGS API allows cross-origin requests from the page;
   - each of the 4 sites currently reports discharge (00060) and/or stage (00065). Some Arizona gauges are seasonal.

   Get a free USGS API key.
2. **Calibrate thresholds** (`highCfs` in `config.js`):
   - Pull USGS peak flows for the known events: the 2014 Trico overtopping, the Avra Valley Rd bridge closure, and the storm that closed every NW Santa Cruz bridge.
   - Set "trouble" flows from those peaks.
   - Measure the Brawley lag: how many hours from Three Points to Avra Valley Rd.
3. **Los Robles Wash bridge on Trico Rd: the biggest single point of failure.** 3 of the 4 routes cross it, and only Avra Valley Rd avoids it. It has no gauge. Options:
   - a Pima ALERT stream sensor, if one exists nearby (needs data access from RFCD);
   - sensor site #1, mounted on the bridge (county right-of-way, so it needs the permission email).
4. **Brawley Wash dip on Avra Valley Rd.**
   - Check the 2 unnamed crossings on the ground: bridge or dip?
   - The dip is sensor site #2, on a post beside the road on private land with the owner's OK.
5. **Rain over the valley itself.** Storms that never reach Three Points can still flood the local crossings. Pima ALERT rain gauges are the answer. Email RFCD for a data feed or permission to use their map's data.
6. **Silverbell washouts.** Shallow, so low priority. Add a one-tap "Silverbell washed out" note you or family can set, shown to the others.
7. **Morning delivery.** A scheduled check that sends the verdict to your phone before you leave, instead of you having to open the page.
