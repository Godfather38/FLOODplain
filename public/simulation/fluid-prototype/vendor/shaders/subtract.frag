precision highp float;

varying vec2 v_coordinates;

uniform vec3 u_gridResolution;

uniform sampler2D u_pressureTexture;
uniform sampler2D u_velocityTexture;
uniform sampler2D u_markerTexture;

// FLOODplain: world metres per grid cell on each axis.
uniform vec3 u_cellSize;

void main () {
    vec3 cellIndex = floor(get3DFragCoord(u_gridResolution + 1.0));

    float left = texture3DNearest(u_pressureTexture, (cellIndex + vec3(-1.0, 0.0, 0.0) + 0.5) / u_gridResolution, u_gridResolution).r;
    float right = texture3DNearest(u_pressureTexture, (cellIndex + 0.5) / u_gridResolution, u_gridResolution).r;

    float bottom = texture3DNearest(u_pressureTexture, (cellIndex + vec3(0.0, -1.0, 0.0) + 0.5) / u_gridResolution, u_gridResolution).r;
    float top = texture3DNearest(u_pressureTexture, (cellIndex + 0.5) / u_gridResolution, u_gridResolution).r;

    float back = texture3DNearest(u_pressureTexture, (cellIndex + vec3(0.0, 0.0, -1.0) + 0.5) / u_gridResolution, u_gridResolution).r;
    float front = texture3DNearest(u_pressureTexture, (cellIndex + 0.5) / u_gridResolution, u_gridResolution).r;


    // Computes gradient of pressure. FLOODplain: per-axis world cell size, to
    // match the divergence and Poisson operators. Dividing by 1.0 applied a
    // 2.94 m pressure difference as if it spanned one metre horizontally and a
    // 0.093 m one as if it spanned one metre vertically, so the correction that
    // removes divergence was itself the wrong shape.
    vec3 gradient = vec3((right - left) / u_cellSize.x,
                         (top - bottom) / u_cellSize.y,
                         (front - back) / u_cellSize.z);

    vec3 currentVelocity = texture2D(u_velocityTexture, v_coordinates).rgb;

    vec3 newVelocity = currentVelocity - gradient;

    newVelocity = junctionBoundaryVelocity(cellIndex,newVelocity,u_gridResolution);
    gl_FragColor = vec4(newVelocity, 0.0);
}
