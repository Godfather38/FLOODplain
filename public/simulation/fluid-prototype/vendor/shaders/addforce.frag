precision highp float;

varying vec2 v_coordinates;

uniform sampler2D u_velocityTexture;

uniform vec3 u_mouseVelocity;

uniform vec3 u_gridResolution;
uniform vec3 u_gridSize;

uniform vec3 u_mouseRayOrigin;
uniform vec3 u_mouseRayDirection;

uniform float u_timeStep;

// FLOODplain: how hard the source-derived horizontal field is held, per second.
// Zero switches the forcing off entirely, which is the upstream behaviour.
uniform float u_sourceFlowStrength;

float kernel (vec3 position, float radius) {
    vec3 worldPosition = (position / u_gridResolution) * u_gridSize;
    float distanceToMouseRay = length(cross(u_mouseRayDirection, worldPosition - u_mouseRayOrigin));
    float normalizedDistance = max(0.0, distanceToMouseRay / radius);
    return smoothstep(1.0, 0.9, normalizedDistance);
}

void main () {
    vec3 velocity = texture2D(u_velocityTexture, v_coordinates).rgb;
    vec3 newVelocity = velocity + vec3(0.0, -9.81 * u_timeStep, 0.0); //add gravity

    vec3 cellIndex = floor(get3DFragCoord(u_gridResolution + 1.0));
    vec3 xPosition = vec3(cellIndex.x, cellIndex.y + 0.5, cellIndex.z + 0.5);
    vec3 yPosition = vec3(cellIndex.x + 0.5, cellIndex.y, cellIndex.z + 0.5);
    vec3 zPosition = vec3(cellIndex.x + 0.5, cellIndex.y + 0.5, cellIndex.z);

    float mouseRadius = 5.0;
    vec3 kernelValues = vec3(kernel(xPosition, mouseRadius), kernel(yPosition, mouseRadius), kernel(zPosition, mouseRadius));

    newVelocity += u_mouseVelocity * kernelValues * 3.0 * smoothstep(0.0, 1.0 / 200.0, u_timeStep);

    // FLOODplain: hold the horizontal grid velocity toward the saved run's own
    // reconstructed depth-averaged cell velocity, where that reconstruction
    // exists. Seeding it once only let gravity and pressure wash it out within
    // a few seconds, so the water settled instead of travelling. This is a
    // relaxation, not an imposed value: the solver's own pressure response
    // still moves water around it, and nothing is driven where the source says
    // nothing. The vertical component is left entirely to gravity.
    if (u_sourceFlowStrength > 0.0) {
        vec3 xWorld = (xPosition / u_gridResolution) * u_gridSize;
        vec3 zWorld = (zPosition / u_gridResolution) * u_gridSize;
        vec4 xFlow = junctionSourceFlow(xWorld);
        vec4 zFlow = junctionSourceFlow(zWorld);
        float blend = clamp(u_sourceFlowStrength * u_timeStep, 0.0, 1.0);
        // Solver z increases NORTHWARD: the field builds z from latitude and
        // readPositions turns z back into north with no sign change. Negating
        // here re-applied the injection's sign error on every single step,
        // which is why the water never recovered its northward momentum.
        if (xFlow.b > 0.5) newVelocity.x = mix(newVelocity.x, xFlow.r, blend);
        if (zFlow.b > 0.5) newVelocity.z = mix(newVelocity.z, zFlow.g, blend);
    }

    gl_FragColor = vec4(newVelocity * 1.0, 0.0);
}
