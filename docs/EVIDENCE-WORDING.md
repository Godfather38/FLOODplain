# How the app words its evidence

Three different things get called "data" on these screens, and only one of them is a look at the
road. Saying which is which is the whole job of this wording.

| Kind | What it means | Example on screen |
|---|---|---|
| **Observed** | Someone looked at this road. Only the county's barricade points do this. | "County says Proceed with Caution: Avra Valley Rd west of the Brawley Wash" |
| **Remote** | An instrument reading somewhere else: river gauges, wash flow sensors, rain gauges. | "2 river gauges reporting" |
| **Model** | A number computed from readings taken elsewhere. Never an observation. | "Flood model: about 1.4 ft above the stream bed" |
| **Official** | A weather-service product for the area, not for this crossing. | "NWS Flash Flood Warning in effect" |
| **Missing** | An input we expect did not arrive, or arrived too old to use. | "Expected but not reporting: rain here" |
| **Stale** | It arrived, it is just out of date. | "Reporting, but out of date: flood model" |
| **Unsupported** | This source was never built to cover this place. Not an outage. | "No coverage here: flood model" |

Every check carries its kind in `evidence`. `evidenceState()` in `public/logic.js` adds them up for
one crossing, and `gaugePhrases()` names the gauges by kind so a rain gauge is never read as a
river gauge. The crossing screen prints one line from this under "What each source says":

> Built from 2 river gauges, a model estimate. None of these is a reading at this crossing.

## The bug this fixed

Sanders Rd river bridge showed **"No live readings right now"** while two river gauges were
reporting and the flood model had an estimate for it. The cause: a river bridge's check is rated by
comparing modelled water with the roadway height, and no roadway height exists for that structure,
so the check came back `unknown`. With every check `unknown`, `rateFailurePoint` printed "no live
readings". That conflated three separate things:

- **no rating** (nothing could be scored from what arrived),
- **no local gauge** (nothing sits at this crossing, which is normal and permanent),
- **no readings** (the feeds went quiet, which is an outage).

Now the summary row is written from what actually answered. It only says "No live readings right
now" when nothing did. Otherwise it leads with the evidence: "2 river gauges reporting plus a model
estimate, nothing measuring this road itself."

## Rules this wording keeps

- **The numbers do not move.** None of this touches `riskScore`, `routeScore` or `recommend`. A
  crossing nothing measures still never reads as clear, and a route still never reads as clear on
  inference alone.
- **Absence of a local gauge never erases remote evidence.** A reporting gauge counts as a good
  sign on a route even where no bridge-height comparison exists for the structure it sits near.
- **Inference is never dressed as observation.** Remote readings and model estimates are named as
  what they are. Only the county's own report is described as a report from the road.
- **A model estimate is not attributed to the gauges beside it.** The link between the gauges we
  list and the model's own inputs is not recorded, so it is always just "a model estimate".
- **Ungauged is not broken.** A place the model does not cover reads as coverage, not as a failure,
  and the readings that did arrive are still named.
- **One safety line, not many.** The home screen carries it; no other screen repeats it.

## The safety line

> FLOODplain says plainly what the gauges, county reports and models show right now. It cannot see
> the road in front of you, so your own eyes and your own judgement come first: if a crossing feels
> wrong, don't take it, whatever this app says. If water is over the road, turn around, don't drown.

It is deliberately the only disclaimer in the interface. Everywhere else the app states what the
evidence indicates and which route is the best-supported choice. The acknowledgement for simulated
and modelled water is separate and stays as `docs/SIMULATED-CONTENT.md` describes it.

`test/evidence-wording.test.js` pins all of the above, state by state.
