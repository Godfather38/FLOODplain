// FLOODplain adaptation: measured source terrain and native wet-support boundary.
// R = bed above local base, G = native zs above base, B = valid wet support.
uniform sampler2D u_terrainTexture;
uniform vec3 u_terrainSize;
vec4 junctionField(vec3 position){return texture2D(u_terrainTexture,position.xz/u_terrainSize.xz);}
// FLOODplain: the saved run's own reconstructed depth-averaged cell velocity.
// R = east m/s, G = north m/s, B = 1 where the reconstruction is available.
// Derived from the run's internal unit discharges; never a native point speed.
uniform sampler2D u_sourceFlowTexture;
vec4 junctionSourceFlow(vec3 position){return texture2D(u_sourceFlowTexture,position.xz/u_terrainSize.xz);}
// FLOODplain: the native perimeter as a PRESCRIBED FLUX boundary.
//
// An earlier attempt made the box edge partially absorbing by giving the ghost
// cell a fraction of the interior pressure. Nothing in the source prescribes
// that pressure drop, and a low edge-particle count does not show that no head
// was manufactured, so that was withdrawn. What the saved run does prescribe is
// a signed unit-width discharge on each perimeter edge. Dividing it by the
// run's own water depth on that face gives a depth-averaged normal velocity —
// the same declared reconstruction used everywhere else — and imposing THAT on
// the face is a boundary condition the source actually supports.
//
// A prescribed-velocity face is a no-flux face for the pressure solve: exactly
// the Neumann treatment a wall already gets, so junctionSolid is unchanged and
// the pressure stencil is untouched. The imposed value is written after the
// projection, so the solver cannot undo it.
//
// R = imposed east m/s, G = imposed north m/s, B = 1 where the saved run
// prescribes this face. An edge whose q is zero prescribes zero: a wet edge
// with no discharge gets a still face, never an invented current. Off-hour
// frames have no snapshot, so u_perimeterFluxStrength stays 0 and this is the
// upstream closed box.
uniform sampler2D u_perimeterFluxTexture;
uniform float u_perimeterFluxStrength;

bool junctionSolid(vec3 cell,vec3 resolution){
    if(any(lessThan(cell,vec3(0.)))||any(greaterThanEqual(cell,resolution)))return true;
    vec3 p=(cell+.5)/resolution*u_terrainSize;
    vec4 field=junctionField(p);
    return field.b<.5||(cell.y+1.0)/resolution.y*u_terrainSize.y<=field.r;
}
// The prescribed face velocity for this cell, or B=0 when the source says
// nothing about it.
vec4 junctionPerimeterFlux(vec3 cell,vec3 resolution){
    if(u_perimeterFluxStrength<=0.)return vec4(0.);
    // A staggered positive boundary face has index == resolution. It is a
    // valid face even though it is not an interior cell. Sample its adjacent
    // interior water cell; floor/lid and faces beyond the box stay closed.
    if(cell.y<0.||cell.y>=resolution.y||cell.x<0.||cell.x>resolution.x||
       cell.z<0.||cell.z>resolution.z)return vec4(0.);
    vec3 inside=min(cell,resolution-vec3(1.));
    if(junctionSolid(inside,resolution))return vec4(0.);
    vec3 p=(inside+.5)/resolution*u_terrainSize;
    if(p.y>junctionField(p).g)return vec4(0.);
    return texture2D(u_perimeterFluxTexture,p.xz/u_terrainSize.xz);
}
vec3 junctionBoundaryVelocity(vec3 cell,vec3 velocity,vec3 resolution){
    bool here=junctionSolid(cell,resolution);
    if(here||junctionSolid(cell-vec3(1.,0.,0.),resolution))velocity.x=0.;
    if(here||junctionSolid(cell-vec3(0.,1.,0.),resolution))velocity.y=0.;
    if(here||junctionSolid(cell-vec3(0.,0.,1.),resolution))velocity.z=0.;
    // Imposed last, so the projection cannot wipe the source's own flux. Only
    // the two horizontal components: the vertical stays the solver's, and the
    // face must be live water, not inside the ground.
    vec4 flux=junctionPerimeterFlux(cell,resolution);
    if(flux.b>.5){
        // Solver axes: x east, z NORTH. Each staggered component has its own
        // valid face range; corner lattice entries are not physical faces.
        // The z component carries north directly: the field builds z from
        // latitude and readPositions reads it back as north unchanged, so
        // negating here imposed the saved run's flux in the wrong direction.
        if(cell.z<resolution.z)velocity.x=flux.r;
        if(cell.x<resolution.x)velocity.z=flux.g;
    }
    return velocity;
}
