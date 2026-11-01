# FLOODplain development ownership and product guardrails

For the 2D release, follow docs/2D-DRAFT-CHECKLIST.md. Do not redefine completion to fit a smaller implementation.

- This stream owns the full 2D geographic renderer, native-cell shading and usable map UX. Preserve the full pannable SFINCS water map, HAND / SFINCS / Combined, depth picking/legend, time/range controls and original safety home.
- Missing current SFINCS output is a simulation dependency to coordinate and complete, not permission to ship HAND-only, marker-only or frozen-replay-only as the finished 2D draft.
- 3D model visualization and geometry/SFINCS simulation are separate workstreams. Neither justifies reducing 2D features or making its interface denser.
- Keep last-successful model output visibly dated during refresh/failure. Never relabel old output as current; never invent depths from gauge readings.
- Current official closures and observations retain precedence. Do not clear hazards with model absence or unknown coverage.
- Reuse existing proven components and performance fixes. Verify actual pan/time/mode/navigation interaction, not merely HTTP success.
- No production merge/deployment without specific approval. Preserve Twilio/compliance/notifications work.

Current user authorization permits uploading non-sensitive FLOODplain code, model inputs, simulation results and generated app assets to public Godfather38/FLOODplain experimental branches without merging main or deploying the published app.

The 2D release defaults to the original approximately 29,685-cell faster/lower-resolution SFINCS model. “Coarse” means this existing model. The new approximately 398k-cell refinement is optional, never a completion dependency. Do not redo existing visuals/layout/model while connecting the original fast model.
