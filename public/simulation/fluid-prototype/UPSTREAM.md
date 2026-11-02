# PIC/FLIP solver origin

Source: https://github.com/jizhouxu/3d-fluid-simulation

Pinned revision: `7d6640693745591ff37eadd4276cde3ecba51ac4`.

License: MIT, copyright 2017 Jizhou Xu. Full notice is retained in `vendor/LICENSE`.

Copied only `js/simulator.js`, `js/wrappedgl.js`, and the solver's required GLSL programs. No upstream editor, scene presets, camera, visible renderer, application UI, runtime dependency, or executable is included.

FLOODplain adaptations:

- Shader paths resolve relative to the vendored module, so existing-map integration does not depend on the document URL.
- Solver construction exposes its shader-loading promise.
- Actual source-triangle terrain and native wet support become a bound height/support texture.
- Terrain-solid cells and closed support boundaries participate in pressure projection, velocity boundary enforcement, and particle collision.
- Gravity is 9.81 local metres/s². Pointer forces receive zero input. Random advection forcing is disabled.
- Pressure iterations are bounded at 24; PIC/FLIP blend is 0.88.
- Parent module seeds from the selected native frame, reads back at most 4,096 particles (default 2,048), and owns lifecycle cleanup.

The original solver algorithm remains particle-to-MAC-grid transfer, force application, boundary enforcement, divergence, Jacobi pressure solve, pressure-gradient subtraction, PIC/FLIP transfer back to particles, and RK2 particle advection. This is actual numerical particle simulation, not particles following a precomputed decorative path.

The adaptation is an illustrative local refinement, not a validated hydrodynamic replacement for SFINCS. No claim of native or measured local velocity is made.
