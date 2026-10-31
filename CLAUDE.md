# Working on FLOODplain

## How the owner wants to work (read first)
- **One continuous conversation.** Every message adds to the same task. A new message, an interruption, or a stopped tool call is not a reset. Earlier instructions stay in force until the owner changes them.
- **Avoid recency bias.** Recency bias is an AI giving too much weight to the most recent input over earlier context. Don't let the latest message, hook or reminder push out what was already asked. Before acting, re-read the open requests from earlier messages. Before stopping, check that none were dropped.
- **A new feature request doesn't cancel earlier instructions.** When the owner asks for something new, it joins the open list; it doesn't replace it. Earlier requirements keep applying to the new work: neutral wording, plain language, work on main, publish it yourself, finish anything still pending. Keep a running list of open requests and check every one before saying you're done.
  - What went wrong (Oct 31, 2026): the owner reported the map clutter and the "every route 2/5" problem back to back. I stopped work on the first when the second arrived. Then I treated "recency bias is not a feature" (a note on my behavior) as a new app feature, and changed the scoring nobody asked about. Both were the same mistake: the newest message pushed out what had already been said.
- **Short replies point back.** "BOTH", "go", "run it": read them against what was just offered or asked. Don't invent a new meaning.
- **Do it, don't hand over devops.** Commit, push and publish yourself. Work on `main`. If something truly needs the owner's click (a setting no tool can change), give one link and one sentence, nothing more.
- **Plain language.** Define terms and don't assume jargon. When asked for something copy-pastable, give just a code block.
- **Neutral, not overcautious.** Show the evidence and an honest rating. Don't inflate risk, and don't call anything "safe".
- **Ask for local knowledge instead of guessing.** The owner drives these roads; their report beats map data.
- **The repo is public.** Never commit the owner's home address. Routes start at W El Tiro Rd & N Trico Rd.

## Project facts
- The static app is in `public/`. It's published by `.github/workflows/pages.yml` to https://godfather38.github.io/FLOODplain/.
- GitHub Pages only deploys from the repo's **default branch**, which is still `ccr-ae06b197-a01a6o`. To publish: `git push origin main && git push origin main:ccr-ae06b197-a01a6o`. Once the default branch is `main`, pushing `main` is enough.
- Pima ALERT rain/stream data is copied every ~10 min to the `data` branch by `.github/workflows/alert-snapshot.yml`.
- Tests: `npm test`. The plain-language failure points are in `docs/FAILURE-POINTS.md`; the permission emails are in `docs/PERMISSION.md`.
