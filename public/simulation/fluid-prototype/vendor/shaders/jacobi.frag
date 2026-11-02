precision highp float;

varying vec2 v_coordinates;

uniform vec3 u_gridResolution;

uniform sampler2D u_pressureTexture;
uniform sampler2D u_divergenceTexture;
uniform sampler2D u_markerTexture;

// FLOODplain: world metres per grid cell on each axis.
uniform vec3 u_cellSize;

void main () {
    vec3 centerCoords = get3DFragCoord(u_gridResolution) / u_gridResolution;

    vec3 ci=floor(get3DFragCoord(u_gridResolution));
    if(junctionSolid(ci,u_gridResolution)){gl_FragColor=vec4(0.0);return;}
    // pressure = 0 in air cells.
    float fluidCell = texture3DNearest(u_markerTexture, centerCoords, u_gridResolution).x;
    if (fluidCell == 0.0) discard; // This is an air cell.

    vec3 delta = 1.0 / u_gridResolution;

    float divergenceCenter = texture3DNearest(u_divergenceTexture, centerCoords, u_gridResolution).r;

    float left = texture3DNearest(u_pressureTexture, centerCoords + vec3(-delta.x, 0.0, 0.0), u_gridResolution).r;
    float right = texture3DNearest(u_pressureTexture, centerCoords + vec3(delta.x, 0.0, 0.0), u_gridResolution).r;
    float bottom = texture3DNearest(u_pressureTexture, centerCoords + vec3(0.0, -delta.y, 0.0), u_gridResolution).r;
    float top = texture3DNearest(u_pressureTexture, centerCoords + vec3(0.0, delta.y, 0.0), u_gridResolution).r;
    float back = texture3DNearest(u_pressureTexture, centerCoords + vec3(0.0, 0.0, -delta.z), u_gridResolution).r;
    float front = texture3DNearest(u_pressureTexture, centerCoords + vec3(0.0, 0.0, delta.z), u_gridResolution).r;

    float center=texture3DNearest(u_pressureTexture,centerCoords,u_gridResolution).r;
    // A wall reflects the centre pressure: no flux across it. A face where the
    // source prescribes a velocity is ALSO a no-flux face for the pressure
    // solve — the flux through it is already fixed — so it gets the same
    // treatment and this stencil is exactly upstream's.
    if(junctionSolid(ci+vec3(-1.,0.,0.),u_gridResolution))left=center;
    if(junctionSolid(ci+vec3(1.,0.,0.),u_gridResolution))right=center;
    if(junctionSolid(ci+vec3(0.,-1.,0.),u_gridResolution))bottom=center;
    if(junctionSolid(ci+vec3(0.,1.,0.),u_gridResolution))top=center;
    if(junctionSolid(ci+vec3(0.,0.,-1.),u_gridResolution))back=center;
    if(junctionSolid(ci+vec3(0.,0.,1.),u_gridResolution))front=center;
    // FLOODplain: the Poisson stencil has to be weighted by the real cell size
    // on each axis. Upstream averaged six neighbours equally, which is the
    // isotropic unit-cube case; on this 32:1 shallow grid that mixed a 2.94 m
    // horizontal step with a 0.093 m vertical one as if they were the same
    // distance. Weighting by 1/h^2 per axis makes the vertical direction
    // dominate the pressure, which is what a shallow sheet of water does.
    vec3 w = 1.0 / (u_cellSize * u_cellSize);
    float newPressure = ((left + right) * w.x + (bottom + top) * w.y + (back + front) * w.z
                         - divergenceCenter) / (2.0 * (w.x + w.y + w.z));


    gl_FragColor = vec4(newPressure, 0.0, 0.0, 0.0);

}
