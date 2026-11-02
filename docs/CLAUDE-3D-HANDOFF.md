# Claude handoff: the integrated 3D flood layer

## Read the user's words first — verbatim

> Meanwhile- I want to hand the 3d map part over to claude. I want baked geometry based on a mix of satelite and the existing scans in the 3d, 3d should be more of a layer less isolate with physics sim (pretty fluid dynamics model with graphics that read accurately to the needs of users) not this- kinda 90's lookin thing. Spend polygons wisely. A few well defined places with good textures like the dips and bridges. I10. Gauges can have an icon. And we shouldn't hide the risk colors and we need a visual disign pass on all colors for informativeness and accuracy, on the whole app to make it old people friendly/novice mobile user etc etc. Make an onboarding process you can opt in to for how to use it. Divide these tasks, you rake everything backend and UX, lets make a plan for how to divvy it up. I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river. Claude makes a physX demo- you shape the rest and maybe delegate some things to claude. Plan step right now for how to divvy these and break them into fastest deliverable units.

> Lets do it. Physx was not a literal technology piece just the style of visuals I'm going for lol.

> Not phys x quality- i was thinking way less particles and way bloopier and more stylized. Almost cartoon.

> And show it traveling, direction and animation are critical

> Speak english. Humanize all instructions. Do not limit or change output from my request. Always include my original request, verbatim.

Additional direct corrections, also verbatim:

> I did not want a few dinky models

> I wanted a fluid particle sim

> Fuck you. Game graphics prototypes and shit should be ripped. Not generic 90s looking bullshit

> And if you find good OSSW use it, I do want it to look like cartoonish, never stop building just because I correct you or make a request, also the actual design should be a la google maps. Structures where they belong. Interstate highway modeled. Roads on our routes modeled. No bullshit.

> Do not make isolated anything

> One fucking junction

> FLuid sim based on the fucking data

> I want to hand the 3d map part over to claude. I want baked geometry based on a mix of satelite and the existing scans in the 3d, 3d should be more of a layer less isolate with physics sim (pretty fluid dynamics model with graphics that read accurately to the needs of users) not this- kinda 90's lookin thing. Spend polygons wisely.
>
> Cute looking simulation that shows you where the water is in a 3d, semi accurate, pre baked geometry of the area

## What you own

Build the finished 3D map layer and its fluid presentation in the existing FLOODplain app. Start with the one actual Brawley/Avra Valley Road junction, not a separate tank demo, detached viewer or unrelated scene. This first junction proves the integrated method; it does not erase the wider requested roads, I-10, dips, bridges, gauges and structures. Use established open-source graphics/physics implementations when useful and preserve licenses. PhysX itself is not required.

Aim for a polished, soft cartoon-like miniature geographic scene, with coherent water, visible travel and convincing fluid interaction. Water must read first; geography supplies location and scale. Retain a quantitative depth legend and exact source cell/time values. Risk colors belong to route/crossing assessments and must remain visible and distinct. Do not present a handful of extruded boxes or a colored surface as completion of the fluid-particle request.

The backend/solver owner retains hydraulic data, coverage, gauges and route tracking. The UX owner retains safety screens, accessible colors, hit targets and opt-in onboarding. Preserve those changes; do not replace their app with a new project. You own visual geometry treatment, materials/textures, particle rendering and efficient integrated scene behavior. Coordinate any shared UI change rather than overwriting it.

## Working repository and entry point

Repository: https://github.com/Godfather38/FLOODplain . Current working branch is `experiment/zoom-geography-detail`, based on upgraded app 532d85b, with coarse terrain binding repair 254825e, high-zoom geography 615465f and reusable structure geometry 0f8e6ae. See the current branch HEAD for this handoff's asset commit. The accessible UI checkpoint d30386e is a separate additive branch; tests already verified the terrain repair with its exact files served read-only. Preserve subsequent UX changes during parent integration.

The actual app is `public/index.html?case=refined#/map`. `tools/simulation/geographic-view-source.js` owns the geographic renderer; build it with `node tools/simulation/build-geographic-view.mjs`. Do not hand-edit the compiled public bundle. Three.js is pinned at0.170.0; Maptalks supplies the same geographic camera. There is no independent OrbitControls camera. The flat map is the default; 3D assets and physics load only on explicit 3D use. Shared time, range, viewport, route and selection must survive switches. Read `docs/SHARED-MAP-STATE.md`, `docs/SCENE-DATA-CONTRACT.md`, `docs/3D-VISUAL-ACCEPTANCE.md` and repository AGENTS.md.

## Actual Brawley assets already prepared

- `public/simulation/data/scene-contract/brawley-scene.json`: 2,628 exact native faces and57 native15-minute frames. Centre[-111.29459,32.39322], EPSG:4326 longitude/latitude; elevations are NAVD88 metres. Frozen Nov1–2 output, not current weather. Source run refined-full-41344983607. Internal lengths stay metric; display feet.
- Two `terrain-tile-944-7167/7168-lod0.json.gz` files in the same package: actual source terrain triangles with native face IDs. Retained partial-run headers have an exact geometry-equivalence certificate binding them to the completed run. Preserve it.
- `public/simulation/data/brawley-baked/brawley-ground-road.glb`: reusable baked source terrain and bounded actual road centreline geometry, not a viewer.10,574 terrain triangles plus86 road/marking triangles; about1.02MB. glTF axes: x east, y up, z south; base elevation603mNAVD88; centre in bake-report.json. Retain transform metadata when placing it in the map. `terrain-face-ids.json` maps terrain triangles back to native faces. Source elevations are not artistically exaggerated.
- `usgs-naip-reference.jpg` and `imagery-provenance.json`: one1024px georeferenced USGS/USDA NAIP orthophoto, about259KB, obtained through the official National Map service. It is aerial imagery, not satellite imagery. Exact extent and provider attribution are recorded; acquisition date is unknown. Use it to guide road edges, wash placement, vegetation masses and texture baking. Do not infer surveyed height or bridge clearance from imagery. A prettier texture must not obscure water or risk colors.
- `tools/simulation/geographic-structures.js`: bounded three-mesh building/road foundation using actual feature footprints, holes and tagged heights. Caller supplies geographic projection and ground elevation. It does not invent heights for missing buildings or bridge clearance. Road widths are cartographic class defaults, not measured widths. Bake trims the road to verified terrain support rather than assigning unknown terrain height zero.
- `tools/simulation/bake-brawley-ground.mjs` rebuilds the GLB from checked terrain assets and actual road data; `prepare-brawley-imagery.mjs` fetches only the bounded official reference. Existing scans remain the elevation source. No new terrain download or solver run is required.

OpenFreeMap vector geography is already drawn from real data. It supplies mapped road hierarchy, bridges/tunnels, buildings where tagged, water/washes and useful names. Data zoom stops at14; zoom18 is overzoom, not new geographic accuracy. The two inspected local tiles each have one building and no house numbers. No contour layer is supplied. Do not invent structures merely to fill the scene. Existing attribution must remain.

## Fluid foundation and the critical data boundary

The reusable fluid foundation adapts the MIT PIC/FLIP browser implementation from `jizhouxu/3d-fluid-simulation` pinned at `7d6640693745591ff37eadd4276cde3ecba51ac4`. It is intended as a reusable computation module in the same map, without its original tank UI/camera/presets. The tested foundation is committed as6072b68. The module is `public/simulation/fluid-prototype/junction-fluid.js`; its browser evidence is `verification.json` beside it. It has no independent camera or UI. It has not yet been connected to the visible map layer; that remaining integration is part of your task. Preserve its MIT license. The requested initial budget is roughly2,048 particles, with mobile reduction and explicit teardown.

The published native model contains water volume, mean depth and native water-surface elevation, but no local velocity vector. Use the actual terrain and source water state to initialize and constrain fluid particles. Do not substitute a remote gauge, NWM discharge or terrain slope and call it a native velocity. Additional pressure/gravity/advection computed by the visual fluid simulation is simulation-derived motion, not verified SFINCS velocity. Communicate that distinction plainly without burying the interface in engineering prose. Never create unsupported wet cells or flow through missing/dry barriers to make the animation prettier. When the model frame changes, reseed/reconcile with that frame and preserve its source time and selection.

The source contract explains the distinction between mean cell depth and native water elevation. Do not form a surface by adding mean terrain to mean depth. Clip native water against supported source terrain; retain unknowns. Direction and motion remain part of the requested output—this limitation is a requirement for a truthful implementation, not permission to drop the animation.

## Spend polygons and GPU work where they matter

Use the baked junction mesh and a small number of batched road/structure meshes. Concentrate detail on the dip/road edges/channel and recognizable structures. Keep distant geography coarse. Use small shared textures or an atlas; no unbounded per-cell geometry or new global asset download on flat-map entry. Preserve existing cancellation, cache limits, capped phone pixel ratio and disposal. Honor reduced motion while keeping static depth/extent legible. Do not conceal water with terrain due to an incorrect transform or render order.

Deliver the effect through the existing camera and shared map lifecycle. Show the actual junction in context, the water changing with the selected native frame, and readable risk markers. Provide before/after images at the same geographic view, an animation clip or measured particle motion, native-value checks, mobile-width checks and repeated pan/mode cleanup evidence. Software-GPU tests are not physical-device performance proof.

## Current handoff/approval state

The user selected: “I’ll sign in to Claude Code; prepare the repository handoff.” Claude Code2.1.233 is installed at C:\Users\Marshall\.local\bin\claude.exe. The last `claude auth status` reported loggedIn=false. This document is prepared repository input; Claude has not been launched and no prompt has been sent. Do not claim otherwise. The coordinator will confirm the available signed-in route and current send authorization before starting external execution. No main merge or production deployment is authorized here.

## Direct loading and verified foundation status

`public/simulation/brawley-scene-loader.js` exports `loadBrawleyScene({signal})`, a lazy checksum-checked loader returning `{scene,terrainTiles,roads}`. Call it only when entering the junction 3D layer, then pass its actual values to the fluid module. No new standalone page is created.

The baked GLB successfully parses with the installed Three GLTFLoader:3 meshes,10,660 triangles, all finite vertex values. All11 scene/structure tests pass. The fluid module browser check uses2,048 particles seeded from native frame0 in a160m square:60 steps moved2,013 particles (maximum0.237m), with zero tested bed or missing-support violations and no JS/shader errors. Frame20 changes source-supported wet volume from351.91 to445.04m³; reset is deterministic and disposal is verified. SwiftShader measured about31–36ms per step after warmup with32KB particle readback per step; this is not real-device performance. The final visible integrated layer and Claude artwork are still outstanding.

Fluid API: `await createJunctionFluid({scene,terrainTiles,frameIndex,maxParticles:2048,extentMeters:[160,160]})`; then `initializeFrame(index)`, `step(dt)`, `dispose()`. Read `positions` (east,north,NAVD88), computed illustrative `velocities`, `nativeCellIndices`, `count`, `radiusM`, `sourceTime`, and `stats`. See `docs/fluid-prototype-contract.md`. Convert positions into the GLB reference using `[east, zNAVD88-603, -north]`, or use the existing map projection/altitude callbacks for geographic placement. No independent camera is provided or wanted.
