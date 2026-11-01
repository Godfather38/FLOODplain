# 3D visual ownership and completion checklist

Authoritative ownership correction, November 1, 2026. Read this before continuing the 3D workstream. This is durable repository guidance for future sessions, not a claim that global user memory was updated.

## Three independent owners

- **3D visualization:** this worker owns the attractive geographic terrain/water visualization of actual model results, its assets, performance and renderer integration contract.
- **2D release:** the UI owner owns the full 2D renderer, cell shading, interaction and release UX. Do not replace that product, reduce its scope, or pack more information into it to make this worker's task look complete.
- **Geometry and SFINCS:** the solver owner owns model geometry, simulation, coverage, native quantities and model refinement. Display detail cannot substitute for that work.

Shared modules require coordination before changes. Keep existing constructor/update/view/lifecycle interfaces and shared geographic state stable. The emergency pan fix 6578ef9 was support for the 2D owner, not completion of 3D and not a transfer of 2D ownership. No production change is authorized here.

## Failure point to prevent

Technical milestones were allowed to stand in for the full visual request while scope drifted into the 2D release. A working data adapter, source-bound terrain, correct depth picking, bounded geometry, or successful screenshot test is useful evidence, but none alone establishes an attractive completed 3D experience. Never narrow the user's goal or make the interface denser merely to declare completion. Report implementation, visual verification and outstanding acceptance separately.

## Full visual intent — still required

- [ ] Attractive, geographically recognizable terrain overview based on actual terrain and map features, with familiar roads/routes and readable geographic context.
- [ ] Contiguous terrain and water surfaces. The earlier voxel request does not justify large square swathes, independent block caps, gratuitous grid outlines or semi-opaque columns. Keep a raw computational grid diagnostic optional.
- [ ] Convincing animated water appearance: coherent material, lighting and restrained surface highlights, while native selected-frame water level remains fixed. Cosmetic animation must not imply simulated velocities or new physics.
- [ ] Native water surfaces intersect source-bound terrain; exact cell IDs, depth in metres/feet, datum, missing values and selected time stay truthful. Do not bridge dry barriers, missing cells or outside-domain gaps to make prettier water.
- [ ] Actual model results are visibly different at two native frames in the same geographic view; exact selected-cell values agree with source data.
- [ ] Same place, route, selection, time and range survive entry/exit and mode changes. This remains an alternate geographic view, never a detached analytics viewer.
- [ ] Flat-first product stays with the 2D owner. Explicit 3D entry loads bounded assets lazily; inactive work stops; cancellation, cleanup and fallback work.
- [ ] Useful whole-area overview and close terrain detail with bounded LOD; missing visible tiles must not be mistaken for dry/safe terrain. Avoid visual holes caused only by an arbitrary tile budget where a coarser complete view is feasible.
- [ ] Inspect integrated desktop and phone-size output for water quality, terrain continuity, road legibility, selection, time switching and geographic alignment. Record real-device limitations honestly.
- [ ] Parent/user visual review of the integrated result remains outstanding. Do not label the full visual goal complete based on module tests.

## Preserved evidence and next integration boundaries

Checkpoint 7e683c5 supplies source-bound streamed terrain and actual refined-frame picking; see ACTUAL-REFINED-3D-INTEGRATION.md. It is a technical checkpoint, not full visual acceptance. Its phone test omitted three of twelve visible tiles, which remains a visual-coverage issue to resolve rather than hide behind the performance budget.

That checkpoint binds the earlier JSON geometry artifact. The later compact package must receive an explicitly verified compatible terrain binding through coordinated package ownership; never silently accept a different geometry hash merely because cell counts match. Preserve the partial 21-frame interval and unavailable future hours.

Next 3D work must reconcile the current shared renderer with the 2D owner's release changes, review actual integrated visuals against every item above, then improve the specific outstanding terrain/water/LOD defects within 3D-owned files. Do not overwrite UI files or launch a solver run. The 2D release does not wait for completion of this separate visual workstream.
