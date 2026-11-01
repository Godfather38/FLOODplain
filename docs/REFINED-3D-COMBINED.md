# Combined refined 3D integration

Experimental only; production2D remains ea27bb3. Combines7e683c5 terrain streaming with6578ef9 pan-stability sources and the release click/drag guard. Conflict resolution preserves one active overview, latest pending viewport, typed spatial indexes, scratch reuse, vector cache limits, DPR limits, cancellation and texture cleanup. Adds terrain cancellation and selected-popup restoration rather than replacing the stabilized lifecycle.

The compact manifest stays partial with21frames17:00–22:00UTC. Terrain artifacts remain in the original package directory; the compact reader permits only the explicit sibling terrain directory and verifies each artifact checksum. Terrain identity uses compactSource.geometry.sha256, retaining the original exact geometry binding; frame identity still uses compact geometry hash. bind-refined-terrain.mjs --write verifies the original manifest and terrain index before updating publication checksum. Re-running read-only gives the same checksum a11c8bb480747d141e616d9a36041020c9d92a4e4fa797a8ed527e8bc1abf56b.

Synthetic regression checks cover compact-to-original terrain binding, cancellation, budgets, partial data and bounded overview. Actual whole-app browser verification is recorded below when complete; upstream screenshots are renderer-owner evidence, not this integration's own verification.
