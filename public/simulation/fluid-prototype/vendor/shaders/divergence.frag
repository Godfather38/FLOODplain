precision highp float;

varying vec2 v_coordinates;

uniform sampler2D u_velocityTexture;
uniform sampler2D u_markerTexture;
uniform sampler2D u_weightTexture;

uniform vec3 u_gridResolution;

uniform float u_maxDensity;

// FLOODplain: world metres per grid cell on each axis, and the stated time the
// crowding correction is relaxed over.
uniform vec3 u_cellSize;
uniform float u_densityRelaxSeconds;

void main () {
    vec3 cellIndex = floor(get3DFragCoord(u_gridResolution));

    if(junctionSolid(cellIndex,u_gridResolution)){gl_FragColor=vec4(0.0);return;}
    // divergence = 0 in air cells.
    float fluidCell = texture3DNearest(u_markerTexture, (cellIndex + 0.5) / u_gridResolution, u_gridResolution).x;
    if (fluidCell == 0.0) discard;


    float leftX = texture3DNearest(u_velocityTexture, (cellIndex + 0.5) / (u_gridResolution + 1.0), u_gridResolution + 1.0).x;
    float rightX = texture3DNearest(u_velocityTexture, (cellIndex + vec3(1.0, 0.0, 0.0) + 0.5) / (u_gridResolution + 1.0), u_gridResolution + 1.0).x;

    float bottomY = texture3DNearest(u_velocityTexture, (cellIndex + 0.5) / (u_gridResolution + 1.0), u_gridResolution + 1.0).y;
    float topY = texture3DNearest(u_velocityTexture, (cellIndex + vec3(0.0, 1.0, 0.0) + 0.5) / (u_gridResolution + 1.0), u_gridResolution + 1.0).y;

    float backZ = texture3DNearest(u_velocityTexture, (cellIndex + 0.5) / (u_gridResolution + 1.0), u_gridResolution + 1.0).z;
    float frontZ = texture3DNearest(u_velocityTexture, (cellIndex + vec3(0.0, 0.0, 1.0) + 0.5) / (u_gridResolution + 1.0), u_gridResolution + 1.0).z;

    // FLOODplain: velocity is world metres per second — advect.frag integrates
    // world positions with it — so the divergence must be divided by the real
    // cell size on each axis. Upstream divided by 1.0, which is only correct on
    // a cube of unit world size. This grid is a shallow-water grid: about
    // 2.94 m across and 0.093 m tall, a 32:1 aspect, so dividing by 1.0 weighed
    // the vertical term about 11 times too little and the horizontal terms
    // about 3 times too much.
    float divergence = (rightX - leftX) / u_cellSize.x
                     + (topY - bottomY) / u_cellSize.y
                     + (frontZ - backZ) / u_cellSize.z;

    float density = texture3DNearest(u_weightTexture, (cellIndex + 0.5) / (u_gridResolution + 1.0), u_gridResolution + 1.0).a;
    // Volume conservation. Divergence is now a rate (1/s), so the density
    // excess is read as "relax this crowding over one second". That is the same
    // number as upstream, now with a stated unit rather than an implied one.
    divergence -= max((density - u_maxDensity) / u_densityRelaxSeconds, 0.0);

    gl_FragColor = vec4(divergence, 0.0, 0.0, 0.0);
}
