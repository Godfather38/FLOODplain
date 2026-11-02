# The Brawley upstream-gauge correction

Update, November 2, 2026: the reported case below now rates 2, not 3. A county Proceed with Caution alone is a 2, and upstream gauges do not count as agreeing with it. See `BARRICADES-AND-ROAD-HEIGHT.md`.

## Focused production release

User authorization, verbatim: **deploy**.

Prepared from production `351d84d`, applying only the scoring, county evidence and test
changes from experimental commit `3985ebb`. No experimental renderer, model output,
accessibility/onboarding assets or other cumulative UX changes were imported. Existing
production bridge thresholds, units and route weighting are unchanged. The alert-service
bundle is regenerated from these production sources through the existing build.

Production validation: **149 tests pass, 0 fail**; actual browser fixture checks at
360 x 844 and 390 x 844 pass, including eastbound caution, update time and expanded
1,160 / 817 cfs source evidence. The original 257-test count below describes the larger
experimental branch, not the production suite. Experimental screenshots and preview
references below remain on `experiment/brawley-upstream-evidence`.

The following sections preserve the experiment's scope and evidence before deployment
was subsequently authorized.

Experimental branch `experiment/brawley-upstream-evidence`, started from `2461a8d`
(accessible-colors-onboarding). No main merge or production deployment.

## The original requests, word for word

> WHy is the way several mile upstream gauge counted at brawley? COunty says go they're right. Clearly somethiung isnt mapped.

> Change it man seperate thread for that bug nounty

> Speak english. Humanize all instructions. Do not limit or change output from my request. Always include my original request, verbatim.

> Get these done in my usage limit. Start handing things off to claude a lot more.

> Hurry on fhat ull put it on fast mode

> Alwyas provide clear checklists of each objective and whats included, update it with every request and change where you jump on shit

## Completion checklist

- [x] Isolated branch from 2461a8d; existing sessions untouched.
- [x] Claude subscription implementation and coordinator review.
- [x] Upstream alerts retained without an unsupported severe road rating.
- [x] County caution, direction, source update and closure override preserved.
- [x] Missing/stale/invalid evidence remains unknown; bridge rules, feet and Silverbell preserved.
- [x] 257 passing tests, executed baseline comparison, and phone verification.
- [x] Historical experimental review page and non-sensitive captures prepared.
- [ ] Merge or deploy: outside this task's authorized scope.

## What was wrong

The Brawley Wash dip on Avra Valley Rd was rated from two gauges that sit a long way up
the wash:

| Sensor | What it is | Straight-line distance from the dip |
|---|---|---|
| USGS 09487000 | Brawley Wash near Three Points | about 22.1 mi |
| Pima ALERT 6443 | Brawley Wash at Milewide Rd | about 10.4 mi |

The old rule in `checkWash` took whichever of the two was bigger and, at 500 cfs or more,
said **"a flood is coming down the wash toward this crossing"** — danger, 5 of 5, Severe.
Nothing in that rule knew how long the water takes to get here, how much of it soaks into
the sand bed on the way, or how deep it would be on the pavement. There is no rating curve
for this road anywhere in the project. The app's own HAND notes already say as much
(`public/hand-model.js`: "Wash sources are remote (Three Points and Milewide, 10 to 25 miles
off), so only a river gauge counts here").

At the time the owner reported it (Nov 1, 2026, 20:04 Arizona) the gauges read 1,160 cfs at
Three Points and 817 cfs at Milewide, and the county's own barricade point at the crossing —
"Avra Valley Rd west of the Brawley Wash", about 305 ft away — said **Proceed with Caution,
eastbound, updated 11:48 AM**. The app said Severe. The county was the one standing at the
road. A separate county point 843 m down the road reads Open; it is outside the 450 m match
radius and says nothing about this crossing either way.

## What changed

1. **An upstream reading is an upstream alert, not a road condition.** At a dip, a wash
   sensor returns `watch` ("some water around") with `upstream: true`, and the honest
   sentence: how much, in which sensor, at what time, how far away, and that whether it
   reaches this crossing, when, and how deep **is not established**. A reading at or above
   `WASH.bigFlowCfs` (500) or rising fast is still flagged — `upstreamAlert: 'big-flow'` — so
   the big number is never hidden. It just no longer asserts a flood at the pavement.
2. **The county stays prominent and independent.** Its status leads the crossing when it is
   the strongest thing we have, and its own words now include which way it applies to and
   when it was last touched: *"County says Proceed with Caution: Avra Valley Rd west of the
   Brawley Wash, eastbound (updated 11/01/26, 11:48)"*. `Direction` is requested from the
   county layer and carried through; "All Directions" is left off as noise.
3. **That county line is now the summary, not a sentence about the level.** The crossing
   screen used to put "Water likely at or near the road." under the number, which is a claim
   about depth that no source here makes. `crossingLead` leads with the county's own status,
   direction and update time, followed by *"That is the county reporting this road, not a
   measurement of how deep the water is."* An upstream-only watch leads with the reading and
   says nothing about getting through — in particular it never says "Usually passable".
4. **A crossing nothing reports says so.** A dip whose only flow sensors are up the wash has
   nothing watching the pavement. Where the county has no readable barricade point there
   either, a `road-status` check (level `unknown`, `roadStatus: 'unknown'`) is added: *nothing
   reports this crossing itself.* It appears whatever the upstream sensors say — running,
   dry, stale or missing — because a quiet reading miles upstream is not a dry road. It
   changes no number and keeps the crossing off "clear".
5. **Only words the county actually uses are read.** `checkClosures` used to treat any status
   it did not recognize, including an empty one, as Open. A missing or unrecognized status is
   now `unknown` with the raw text shown, and only an explicit "Open" reads as Open. One
   unreadable point among Open ones makes the group unknown, never all-Open. An actual
   closure or caution still wins over everything.
6. **Readings that cannot be true are not used.** A county ALERT reading stamped in the
   future (rain or stream) is rejected, and a USGS entry is only used if its number is finite
   and not negative and its own timestamp is in the past — a `fresh` flag alone is not a
   reading. Each reading keeps its source timestamp (`observedAt`, plus `time`) and shows its
   own observation time, so both the 1,160 cfs and the 817 cfs readings can be inspected with
   when each was taken.
7. **No invented cutoff and no invented sensor.** Distances are shown because they are facts
   worth reading, never used as a threshold. No travel time or delay is guessed. There is no
   rule for a sensor "at the crossing": an earlier draft of this work added one, and it was
   removed — even a reading taken at the same spot would not show water across the pavement
   without a documented flow-to-road relation, and no such sensor is configured anyway.

**The local evidence this crossing has** is unchanged and all still live: a county barricade
point within `CLOSURE_RADIUS_M` (450 m) with its status, direction and time; rain in inches at
the nearby county gauges; NWS warnings; and the HAND model's own row, labeled as a model.
None of them measures water depth on the pavement, and the `road-status` row says that
plainly.

Files: `public/logic.js` (`checkWash`, `checkRain`, `checkClosures`, `rateFailurePoint`,
`recommend`, new `crossingLead`), `public/config.js` (`WASH`), `public/engine.js` and
`public/app.js` (both ask the county layer for `Direction` and carry it; the browser fetches
that layer itself, so engine.js alone was not enough — a live phone check caught that, and
there is now a test for it), `public/app.js` (the summary uses `crossingLead`; the sources are
labeled "Wash flow upstream" and "This crossing itself"), `tools/build_gas.mjs` (`WASH`
reaches the Apps Script bundle, so the text alerts use the same corrected rules).

## The preview

`public/ux-preview/brawley-upstream-checks.json` is the crossing screen for this case, before
and after: the summary line, every source row with its level, sentence and detail, the route
numbers and what is still unknown. The "after" half is compared field by field against the
live engine by the test below, so it cannot drift from what the app actually shows. The
"before" half is the output of the rule as it stood at `2461a8d`. No browser was opened in
this pass, so there is no rendered image here — the strings are the preview.
`public/preview/brawley/` is the coordinator's rendered phone check and is theirs to
regenerate; nothing in this pass writes to it.

## Before and after, by the numbers

Point = the crossing's own 1-5; route = the Avra Valley Rd route's 1-5. "Clear" is the
app's "nothing against it" flag.

| Case | Inputs | Before | After |
|---|---|---|---|
| **A. The reported case** | County Proceed with Caution at the dip; 1,160 cfs Three Points; 817 cfs Milewide; rain quiet | wash **danger**, point **5/5 Severe**, route **5/5**, summary "Water likely at or near the road." | wash **watch** (big-flow alert), point **3/5 Moderate**, route **3/5**, summary is the county's status, direction and time |
| **B. Same flow, no county report** | 4,350 cfs Three Points; no county point; no rain reading | wash danger, point **5/5**, not clear | wash watch (big-flow alert), point **2/5 Minor**, **not clear**, road-status row added |
| **C. County closure** | County Closed at the dip + 1,160 cfs | point **5/5**, not clear | point **5/5**, not clear, upstream alert still listed |
| **D. Dry wash, nothing else** | 0 cfs both sensors; no county point; no rain | point 1/5, "Brawley Wash upstream is dry", **route could read clear** | point **1/5** and still "dry upstream", but **not clear**: nothing reports the road |
| **E. Rain on the crossing itself** | 0.8" in 1 h at Avra Valley Air Park | point **5/5** | unchanged — **5/5** |
| **F. Los Robles bridge** (same two gauges) | 1,160 cfs | wash check unknown/context, route (Trico) 1/5 | unchanged, plus the distance and reading times in the wording |
| **G. County point with no status** | Status field empty at the dip | read as **Open**, counted as evidence | **unknown**, raw text shown, road-status row added, not clear |

Ranking: `brawley-dip` is on the Avra Valley Rd route only, so that is the only route number
that moves. In case A the recommended route is Trico-Marana (1/5) before and after, because
it does not cross this dip. What changes is that Avra Valley Rd is now 3 instead of 5, so it
can rank ahead of a route that is genuinely at 4 or 5 for its own reasons. The phone text
changes from "Avra Valley Rd 5" to "Avra Valley Rd 3" and no longer carries the flood claim.

Other traced effects:

- The HAND model can now add to this crossing where it previously could not. `applyHand`
  skips a point that is already `danger`; at caution or watch it may raise the level or add
  half a point, labeled as the model's own row. That is a separately labeled prediction, not
  a gauge reading.
- `goodSigns` behaves as before: with the wash at watch, "Brawley Wash upstream is dry" is
  withheld, so no false reassurance.
- `recommend`'s new upstream rule also catches the Los Robles bridge, which shares these
  gauges — but that bridge already blocked "clear" through unknown clearance, so no route's
  clear flag changes because of it.
- The Avra Valley Rd route can no longer read "clear" on a quiet day, because the Brawley dip
  now always carries either a county report or the road-status unknown row. Its **number is
  unchanged** (1/5 on a quiet day): the convention that every route always shows a number
  stands. The one way Brawley reads clear is a readable county barricade point at the
  crossing — that is a report from the road, though only as fresh as its own timestamp.
- Checked on the Brawley dip by itself, not just inside the full route list, so that another
  crossing's unknowns cannot be what makes the route unclear.

## Does the same rule touch anything else?

Exactly two wash assignments exist in the whole configuration, and they are listings, not
verified relationships:

| Crossing | Kind | Sensors listed for it |
|---|---|---|
| `brawley-dip` | dip | ALERT 6443 (Milewide), USGS 09487000 (Three Points) |
| `losrobles-bridge` | bridge | ALERT 6443 (Milewide), USGS 09487000 (Three Points) |

The bridge already treated those gauges as context, so the change in rating behaviour is
confined to the Brawley dip today, and the new `road-status` row is scoped to a dip with wash
sensors — which is that one crossing. The corrected wash rule is general, so any dip later
given a wash gauge gets an upstream alert rather than an automatic Severe.

Two changes do reach beyond those crossings, deliberately, and each has its own test: county
statuses that cannot be read are no longer reported as Open anywhere, and ALERT readings
stamped in the future are no longer used anywhere. Both make the app say less than it used
to, never more.

Nothing else was relaxed. The other dips and flats are still rated from rain in inches at
the county gauges, the county's barricade points and NWS warnings, exactly as before —
case E above is the regression check for that. The river bridges, the bridge height policy,
the Silverbell cap and the Ina flat-dip cap are untouched.

## What is still unknown, and what would fix it

- **How much of an upstream flow reaches this road, and when.** Still not known. No rating
  curve, no travel time, no channel-loss figure for this crossing exists. The app now says
  so instead of guessing, and unknown is never reported as safe.
- **There is no sensor at the dip.** That is the real fix, and it is still open: ask Flood
  Control for an ALERT stream sensor at the crossing (docs/PERMISSION.md, failure point 2 in
  docs/FAILURE-POINTS.md). A sensor there would not, on its own, settle this either: without
  a documented relation between what it reads and water across the pavement, a same-site cfs
  number still would not give a depth on the road. That relation would have to be written
  down before any rule treated it as one. This pass deliberately has no code for it.
- **500 cfs is still a round number.** It no longer decides anything about the pavement; it
  only decides when a reading is called a big flow. It is not derived from anything measured
  at this road.
- **Straight-line miles are not channel miles.** The water travels farther than the number
  shown, through sand that takes some of it. The distance is context for the reader, nothing
  more.
- **The county's status is as old as its timestamp.** On Nov 1 the reading was 20:04 and the
  county's note was 11:48. We show both and do not revalidate either.
- **The watch cap is a decision, not a measurement.** An upstream alert on its own never goes
  above "some water around". If the owner's own driving shows that a big flow at Milewide
  does put water on this dip within a few hours, that is local knowledge worth recording, and
  the cap should be revisited with it written down — it cannot be inferred from the feeds.
- **Pre-existing, not touched here:** `BRIDGE_POLICY` is still missing from the Apps Script
  bundle's config list in `tools/build_gas.mjs`. The service does not fetch bridge evidence,
  so bridge height comparison stays "unavailable" there either way. Worth a separate look.

## Checks run

`npm test` (which is `node --test test/*.test.js`): **257 tests, 257 pass, 0 fail**. The
baseline at `2461a8d` was 229 of 229 passing, so there are no pre-existing failures to
separate out; the other 28 are the new file. That file,
`test/brawley-upstream-evidence.test.js`, covers: the Nov 1 county-plus-cfs case before and
after; the readings still being shown with their distances and their own observation times;
the 843 m Open point not matching; the route number and the clear flag; the readable phone
text; the summary leading with the county's status, direction and time; an upstream-only
watch never saying "Usually passable"; a quiet crossing not being called dry; the Brawley dip
checked **alone** so no other crossing's unknowns can mask it, never clear on a dry, stale,
missing or running wash; the one case that can read clear (a readable county point at the
crossing); closure override; the local evidence paths that do rate this road (county closure,
county caution, rain over the crossing, NWS); heavy rain still Severe; rising fast upstream;
missing and unrecognized county statuses as unknown; mixed unreadable-and-Open not reported
as Open; future-dated ALERT rain and stream readings refused; a `fresh` flag with a bad
number or a future time refused; maintenance and negative values; the Los Robles bridge; the
preview file matching the engine; and both county-fetch paths asking for `Direction`.

A live phone check of the first pass was run from outside this clone at 20:27
(`public/preview/brawley/`, the coordinator's file, not written or edited here): it rendered
the corrected crossing screen at 390 px — 3, Moderate, the county row leading, the upstream
row with its distance and its "not established" sentence — and failed on the missing
"eastbound". `public/app.js` requests and carries `Direction` now (its map was fixed in the
first pass; the recorded failure predates that), and the summary line is this pass's change.
The coordinator subsequently regenerated and inspected the actual browser screen at
390 x 844 and 360 x 844. Both pass: county caution, eastbound and update time appear in
the summary; no horizontal page overflow or JavaScript errors occurred. Expanding the
upstream row shows both 1,160 and 817 cfs readings and their observation times. The
historical review page also passes its phone-width check. These are controlled regression
fixtures, not current conditions or a physical-device certification. Evidence and captures:
`public/preview/brawley/phone-verification.json`, `phone-390.png`, `phone-360.png`,
`phone-upstream-details.png`, and `review-page.png`.

The coordinator independently reran the complete suite: **257 pass, 0 fail**. A separate
execution of the original `2461a8d` logic and revised logic confirms 5 -> 3 for Brawley,
closure override 5, and unchanged route order in the controlled case. See
`public/preview/brawley/before-after-verification.json`. Other rain/flow inputs in this
comparison are controlled values; this is not a complete historical weather reconstruction.

Two existing cases were rewritten rather than deleted, each with a comment pointing here:
`test/logic.test.js` ("wash: upstream flow is an upstream alert at a dip…") and
`test/bridge-flow-decision.test.js` (the at-grade Brawley case, which was written to check
that the bridge work left the dip alone — it still checks that, and now also that the dip is
never called clear while water runs upstream). `test/readiness.test.js` follows the new
`checkWash(snapshot, flows, failurePoint, …)` argument order.

`apps-script/WashWatch.gs` is regenerated by the bundle test, so it shows up as changed; it
is generated from the sources above, not edited by hand.

## Not done, on purpose

No solver run, merge to `main`, production deployment or credentials read. Code and
non-sensitive regression captures are prepared for the authorized experimental branch.
`public/preview/brawley/index.html` presents the historical case separately from the app's
current-feed view.
