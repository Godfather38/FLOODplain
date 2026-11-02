// Marks pixels with 1.0 if there's a particle.

precision highp float;

attribute vec2 a_textureCoordinates;

uniform sampler2D u_positionTexture;

uniform vec3 u_gridResolution;
uniform vec3 u_gridSize;

void main () {
    gl_PointSize = 1.0;

    // FLOODplain: the position texture's alpha is the particle ACTIVITY flag.
    // A slot emptied by native outflow must stop marking fluid, or the pressure
    // solve keeps treating it as water that is no longer there.
    vec4 stored = texture2D(u_positionTexture, a_textureCoordinates);
    if (stored.a < 0.5) {
        gl_PointSize = 0.0;
        gl_Position = vec4(-2.0, -2.0, -2.0, 1.0); // clipped
        return;
    }
    vec3 position = stored.rgb;
    position = (position / u_gridSize) * u_gridResolution;
    vec3 cellIndex = floor(position);

    vec2 textureCoordinates = vec2(
        cellIndex.z * u_gridResolution.x + cellIndex.x + 0.5,
        cellIndex.y + 0.5) / vec2(u_gridResolution.x * u_gridResolution.z, u_gridResolution.y
    );

    gl_Position = vec4(textureCoordinates * 2.0 - 1.0, 0.0, 1.0);
}
