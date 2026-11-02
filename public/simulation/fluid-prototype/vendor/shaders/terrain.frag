// FLOODplain adaptation: measured source terrain and native wet-support boundary.
// R = bed above local base, G = native zs above base, B = valid wet support.
uniform sampler2D u_terrainTexture;
uniform vec3 u_terrainSize;
vec4 junctionField(vec3 position){return texture2D(u_terrainTexture,position.xz/u_terrainSize.xz);}
bool junctionSolid(vec3 cell,vec3 resolution){
    if(any(lessThan(cell,vec3(0.)))||any(greaterThanEqual(cell,resolution)))return true;
    vec3 p=(cell+.5)/resolution*u_terrainSize;
    vec4 field=junctionField(p);
    return field.b<.5||(cell.y+1.0)/resolution.y*u_terrainSize.y<=field.r;
}
vec3 junctionBoundaryVelocity(vec3 cell,vec3 velocity,vec3 resolution){
    bool here=junctionSolid(cell,resolution);
    if(here||junctionSolid(cell-vec3(1.,0.,0.),resolution))velocity.x=0.;
    if(here||junctionSolid(cell-vec3(0.,1.,0.),resolution))velocity.y=0.;
    if(here||junctionSolid(cell-vec3(0.,0.,1.),resolution))velocity.z=0.;
    return velocity;
}
