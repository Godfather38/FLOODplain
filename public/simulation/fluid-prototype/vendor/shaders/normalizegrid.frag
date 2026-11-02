//this does the divide in the weighted sum

precision highp float;

varying vec2 v_coordinates;

uniform sampler2D u_accumulatedVelocityTexture;
uniform sampler2D u_weightTexture;

void main () {
    vec3 accumulatedVelocity = texture2D(u_accumulatedVelocityTexture, v_coordinates).rgb;
    vec3 weight = texture2D(u_weightTexture, v_coordinates).rgb;

    float xV = 0.0;
    if (weight.x > 0.0) {
        xV = accumulatedVelocity.x / weight.x;
    }

    float yV = 0.0;
    if (weight.y > 0.0) {
        yV = accumulatedVelocity.y / weight.y;
    }

    float zV = 0.0;
    if (weight.z > 0.0) {
        zV = accumulatedVelocity.z / weight.z;
    }

    gl_FragColor = vec4(xV, yV, zV, 0.0);
}
