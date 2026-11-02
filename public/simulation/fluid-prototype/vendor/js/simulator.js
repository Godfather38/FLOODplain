'use strict'

var Simulator = (function() {

    /** Simulation grid dimensions and resolution.
     * All particles are in the world position space ([0, 0, 0], [GRID_WIDTH, GRID_HEIGHT, GRID_DEPTH]).
     * When doing most grid operations, we transform positions from world position space into the grid position space ([0, 0, 0], [GRID_RESOLUTION_X, GRID_RESOLUTION_Y, GRID_RESOLUTION_Z])
     * In grid space, cell boundaries are simply at integer values.
     *
     * We emulate 3D textures with tiled 2d textures.
     * So, the z slices of a 3d texture are laid out along the x axis.
     * The 2d dimensions of a 3d texture are therefore [width * depth, height].
     *
     * We use a staggered MAC grid, and this means
     * velocity grid width = grid width + 1
     * velocity grid height = grid height + 1 
     * velocity grid depth = grid depth + 1
     * A scalar for cell [i, j, k] is positionally located at [i + 0.5, j + 0.5, k + 0.5].
     * x velocity for cell [i, j, k] is positionally located at [i, j + 0.5, k + 0.5].
     * y velocity for cell [i, j, k] is positionally located at [i + 0.5, j, k + 0.5].
     * z velocity for cell [i, j, k] is positionally located at [i + 0.5, j + 0.5, k].
     *
     * The boundaries are the boundaries of the grid.
     * A grid cell can either be fluid, air (these are tracked by markTexture) or is a wall (implicit by position).
     */

    function Simulator(wgl, onLoaded, onError) {
        this.wgl = wgl;

        this.particlesWidth = 0;
        this.particlesHeight = 0;

        this.gridWidth = 0;
        this.gridHeight = 0;
        this.gridDepth = 0;

        this.gridResolutionX = 0;
        this.gridResolutionY = 0;
        this.gridResolutionZ = 0;

        this.particleDensity = 0;

        this.velocityTextureWidth = 0;
        this.velocityTextureHeight = 0;

        this.scalarTextureWidth = 0;
        this.scalarTextureHeight = 0;


        this.halfFloatExt = this.wgl.getExtension('OES_texture_half_float');
        this.wgl.getExtension('OES_texture_half_float_linear');

        this.simulationNumberType = this.halfFloatExt.HALF_FLOAT_OES;


        // Simulation parameters.

        this.flipness = 0.99; // 0 is full PIC, 1 is full FLIP.
        this.frameNumber = 0; // Used for motion randomness.

        // Simulation objects (most are filled in by reset).

        this.quadVertexBuffer = wgl.createBuffer();
        wgl.bufferData(this.quadVertexBuffer, wgl.ARRAY_BUFFER, new Float32Array([-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]), wgl.STATIC_DRAW);

        this.simulationFramebuffer = wgl.createFramebuffer();
        this.particleVertexBuffer = wgl.createBuffer();


        this.particlePositionTexture = wgl.createTexture();
        this.particlePositionTextureTemp = wgl.createTexture();


        this.particleVelocityTexture = wgl.createTexture();
        this.particleVelocityTextureTemp = wgl.createTexture();

        this.particleRandomTexture = wgl.createTexture(); // Contains a random normalized direction for each particle.

        // Creates simulation textures.

        this.velocityTexture = wgl.createTexture();
        this.tempVelocityTexture = wgl.createTexture();
        this.originalVelocityTexture = wgl.createTexture();
        this.weightTexture = wgl.createTexture();

        this.markerTexture = wgl.createTexture(); // Marks fluid/air, 1 if fluid, 0 if air.
        this.divergenceTexture = wgl.createTexture();
        this.pressureTexture = wgl.createTexture();
        this.tempSimulationTexture = wgl.createTexture();

        // Load programs.


        this.ready = wgl.createProgramsFromFiles({
            transferToGridProgram: {
                vertexShader: 'shaders/transfertogrid.vert',
                fragmentShader: ['shaders/shared.frag', 'shaders/transfertogrid.frag'],
                attributeLocations: {
                    'a_textureCoordinates': 0
                }
            },
            normalizeGridProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: 'shaders/normalizegrid.frag',
                attributeLocations: {
                    'a_position': 0
                }
            },
            markProgram: {
                vertexShader: 'shaders/mark.vert',
                fragmentShader: 'shaders/mark.frag',
                attributeLocations: {
                    'a_textureCoordinates': 0
                }
            },
            addForceProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                // FLOODplain: terrain.frag also carries the source-derived flow
                // field sampler used by the horizontal forcing below.
                fragmentShader: ['shaders/shared.frag', 'shaders/terrain.frag', 'shaders/addforce.frag'],
                attributeLocations: {
                    'a_position': 0
                }
            },
            enforceBoundariesProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: ['shaders/shared.frag', 'shaders/terrain.frag', 'shaders/enforceboundaries.frag'],
                attributeLocations: {
                    'a_textureCoordinates': 0
                }
            },
            extendVelocityProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: 'shaders/extendvelocity.frag',
                attributeLocations: {
                    'a_textureCoordinates': 0
                }
            },
            transferToParticlesProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: ['shaders/shared.frag', 'shaders/transfertoparticles.frag'],
                attributeLocations: {
                    'a_position': 0
                }
            },
            divergenceProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: ['shaders/shared.frag', 'shaders/terrain.frag', 'shaders/divergence.frag'],
                attributeLocations: {
                    'a_position': 0
                }
            },
            jacobiProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: ['shaders/shared.frag', 'shaders/terrain.frag', 'shaders/jacobi.frag'],
                attributeLocations: {
                    'a_position': 0
                }
            },
            subtractProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: ['shaders/shared.frag', 'shaders/terrain.frag', 'shaders/subtract.frag'],
                attributeLocations: {
                    'a_position': 0
                }
            },
            advectProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: ['shaders/shared.frag', 'shaders/terrain.frag', 'shaders/advect.frag'],
                attributeLocations: {
                    'a_position': 0
                }
            },
            copyProgram: {
                vertexShader: 'shaders/fullscreen.vert',
                fragmentShader: 'shaders/duplicate.frag',
                attributeLocations: {
                    'a_position': 0
                }
            }
        }, (function(programs) {
            for (var programName in programs) {
                this[programName] = programs[programName];
            }

            onLoaded();
        }).bind(this), onError);
    }


    /** Expects an array of [x, y, z] particle positions.
     * gridSize and gridResolution are both [x, y, z].
     * particleDensity is particles per simulation grid cell.
     */
    Simulator.prototype.reset = function(particlesWidth, particlesHeight, particlePositions, gridSize, gridResolution, particleDensity) {
        var wgl = this.wgl;
        this.frameNumber = 0;

        this.particlesWidth = particlesWidth;
        this.particlesHeight = particlesHeight;

        this.gridWidth = gridSize[0];
        this.gridHeight = gridSize[1];
        this.gridDepth = gridSize[2];

        this.gridResolutionX = gridResolution[0];
        this.gridResolutionY = gridResolution[1];
        this.gridResolutionZ = gridResolution[2];

        this.particleDensity = particleDensity;

        this.velocityTextureWidth = (this.gridResolutionX + 1) * (this.gridResolutionZ + 1);
        this.velocityTextureHeight = (this.gridResolutionY + 1);

        this.scalarTextureWidth = this.gridResolutionX * this.gridResolutionZ;
        this.scalarTextureHeight = this.gridResolutionY;

        // Creates particle data.

        var particleCount = this.particlesWidth * this.particlesHeight;

        // Fills particle vertex buffer containing the relevant texture coordinates.
        var particleTextureCoordinates = new Float32Array(this.particlesWidth * this.particlesHeight * 2);
        for (var y = 0; y < this.particlesHeight; ++y) {
            for (var x = 0; x < this.particlesWidth; ++x) {
                particleTextureCoordinates[(y * this.particlesWidth + x) * 2] = (x + 0.5) / this.particlesWidth;
                particleTextureCoordinates[(y * this.particlesWidth + x) * 2 + 1] = (y + 0.5) / this.particlesHeight;
            }
        }

        wgl.bufferData(this.particleVertexBuffer, wgl.ARRAY_BUFFER, particleTextureCoordinates, wgl.STATIC_DRAW);

        // Generate initial particle positions amd create particle position texture for them.
        var particlePositionsData = new Float32Array(this.particlesWidth * this.particlesHeight * 4);
        var particleRandoms = new Float32Array(this.particlesWidth * this.particlesHeight * 4);
        for (var i = 0; i < this.particlesWidth * this.particlesHeight; ++i) {
            particlePositionsData[i * 4] = particlePositions[i][0];
            particlePositionsData[i * 4 + 1] = particlePositions[i][1];
            particlePositionsData[i * 4 + 2] = particlePositions[i][2];
            particlePositionsData[i * 4 + 3] = 0.0;

            var theta = Math.random() * 2.0 * Math.PI;
            var u = Math.random() * 2.0 - 1.0;
            particleRandoms[i * 4] = Math.sqrt(1.0 - u * u) * Math.cos(theta);
            particleRandoms[i * 4 + 1] = Math.sqrt(1.0 - u * u) * Math.sin(theta);
            particleRandoms[i * 4 + 2] = u;
            particleRandoms[i * 4 + 3] = 0.0;
        }

        wgl.rebuildTexture(this.particlePositionTexture, wgl.RGBA, wgl.FLOAT, this.particlesWidth, this.particlesHeight, particlePositionsData, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST);
        wgl.rebuildTexture(this.particlePositionTextureTemp, wgl.RGBA, wgl.FLOAT, this.particlesWidth, this.particlesHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST);


        wgl.rebuildTexture(this.particleVelocityTexture, wgl.RGBA, this.simulationNumberType, this.particlesWidth, this.particlesHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST);
        wgl.rebuildTexture(this.particleVelocityTextureTemp, wgl.RGBA, this.simulationNumberType, this.particlesWidth, this.particlesHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST);

        wgl.rebuildTexture(this.particleRandomTexture, wgl.RGBA, wgl.FLOAT, this.particlesWidth, this.particlesHeight, particleRandoms, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST); //contains a random normalized direction for each particle

        // Create simulation textures.

        wgl.rebuildTexture(this.velocityTexture, wgl.RGBA, this.simulationNumberType, this.velocityTextureWidth, this.velocityTextureHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR);
        wgl.rebuildTexture(this.tempVelocityTexture, wgl.RGBA, this.simulationNumberType, this.velocityTextureWidth, this.velocityTextureHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR);
        wgl.rebuildTexture(this.originalVelocityTexture, wgl.RGBA, this.simulationNumberType, this.velocityTextureWidth, this.velocityTextureHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR);
        wgl.rebuildTexture(this.weightTexture, wgl.RGBA, this.simulationNumberType, this.velocityTextureWidth, this.velocityTextureHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR);

        wgl.rebuildTexture(this.markerTexture, wgl.RGBA, wgl.UNSIGNED_BYTE, this.scalarTextureWidth, this.scalarTextureHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR); //marks fluid/air, 1 if fluid, 0 if air
        wgl.rebuildTexture(this.divergenceTexture, wgl.RGBA, this.simulationNumberType, this.scalarTextureWidth, this.scalarTextureHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR);
        wgl.rebuildTexture(this.pressureTexture, wgl.RGBA, this.simulationNumberType, this.scalarTextureWidth, this.scalarTextureHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR);
        wgl.rebuildTexture(this.tempSimulationTexture, wgl.RGBA, this.simulationNumberType, this.scalarTextureWidth, this.scalarTextureHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR);


    }

    function swap(object, a, b) {
        var temp = object[a];
        object[a] = object[b];
        object[b] = temp;
    }

    /**
     * We need to call reset() with correct parameters before simulating.
     * mouseVelocity, mouseRayOrigin, mouseRayDirection are all expected to be arrays of 3 values.
     */
    Simulator.prototype.simulate = function(timeStep, mouseVelocity, mouseRayOrigin, mouseRayDirection) {
        if (timeStep === 0.0) return;

        this.frameNumber += 1;

        var wgl = this.wgl;

        // FLOODplain: world metres per grid cell on each axis. Velocity is in
        // world metres per second (advect.frag integrates world positions with
        // it), so the divergence, Poisson and gradient operators below all need
        // the real spacing. Upstream assumed one world unit per cell, which is
        // wrong by up to 32x on this shallow-water grid.
        var cellSize = [
            this.gridWidth / this.gridResolutionX,
            this.gridHeight / this.gridResolutionY,
            this.gridDepth / this.gridResolutionZ];

        /**
         * The simulation process:
         * 1. Transfer particle velocities to velocity grid.
         * 2. Save this velocity grid.
         * 3. Solve velocity grid for non divergence.
         * 4. Update particle velocities with new velocity grid.
         * 5. Advect particles through the grid velocity field.
         */

        // 1. Transfer particle velocities to grid.

        /**
         * We transfer particle velocities to the grid in two steps.
         * During the first step, we accumulate weight * velocity into tempVelocityTexture and then weight into weightTexture.
         * During the second step: velocityTexture = tempVelocityTexture / weightTexture.
         */

        // We accumulate into velocityWeightTexture and then divide into velocityTexture.

        var transferToGridDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.velocityTextureWidth, this.velocityTextureHeight)

            .vertexAttribPointer(this.particleVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)

            .useProgram(this.transferToGridProgram)
            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ)
            .uniform3f('u_gridSize', this.gridWidth, this.gridHeight, this.gridDepth)
            .uniformTexture('u_positionTexture', 0, wgl.TEXTURE_2D, this.particlePositionTexture)
            .uniformTexture('u_velocityTexture', 1, wgl.TEXTURE_2D, this.particleVelocityTexture)

            .enable(wgl.BLEND)
            .blendEquation(wgl.FUNC_ADD)
            .blendFuncSeparate(wgl.ONE, wgl.ONE, wgl.ONE, wgl.ONE);


        // Accumulates weight.
        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.weightTexture, 0);

        wgl.clear(
            wgl.createClearState().bindFramebuffer(this.simulationFramebuffer).clearColor(0, 0, 0, 0),
            wgl.COLOR_BUFFER_BIT);

        transferToGridDrawState.uniform1i('u_accumulate', 0)

        // Each particle gets splatted layer by layer from z - (SPLAT_SIZE - 1) / 2 to z + (SPLAT_SIZE - 1) / 2.
        var SPLAT_DEPTH = 5;

        for (var z = -(SPLAT_DEPTH - 1) / 2; z <= (SPLAT_DEPTH - 1) / 2; ++z) {
            transferToGridDrawState.uniform1f('u_zOffset', z);
            wgl.drawArrays(transferToGridDrawState, wgl.POINTS, 0, this.particlesWidth * this.particlesHeight);
        }

        // Accumulates (weight * velocity).
        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.tempVelocityTexture, 0);
        wgl.clear(
            wgl.createClearState().bindFramebuffer(this.simulationFramebuffer),
            wgl.COLOR_BUFFER_BIT);

        transferToGridDrawState.uniform1i('u_accumulate', 1)

        for (var z = -(SPLAT_DEPTH - 1) / 2; z <= (SPLAT_DEPTH - 1) / 2; ++z) {
            transferToGridDrawState.uniform1f('u_zOffset', z);
            wgl.drawArrays(transferToGridDrawState, wgl.POINTS, 0, this.particlesWidth * this.particlesHeight);
        }


        // We divide sum(weight * velocity) by sum(weight) (the two accumulated quantities from before).

        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.velocityTexture, 0);

        var normalizeDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.velocityTextureWidth, this.velocityTextureHeight)

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)

            .useProgram(this.normalizeGridProgram)
            .uniformTexture('u_weightTexture', 0, wgl.TEXTURE_2D, this.weightTexture)
            .uniformTexture('u_accumulatedVelocityTexture', 1, wgl.TEXTURE_2D, this.tempVelocityTexture)

        wgl.drawArrays(normalizeDrawState, wgl.TRIANGLE_STRIP, 0, 4);


        // Marks cells with fluid.

        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.markerTexture, 0);
        wgl.clear(
            wgl.createClearState().bindFramebuffer(this.simulationFramebuffer),
            wgl.COLOR_BUFFER_BIT);

        var markDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.scalarTextureWidth, this.scalarTextureHeight)

            .vertexAttribPointer(this.particleVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)

            .useProgram(this.markProgram)
            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ)
            .uniform3f('u_gridSize', this.gridWidth, this.gridHeight, this.gridDepth)
            .uniformTexture('u_positionTexture', 0, wgl.TEXTURE_2D, this.particlePositionTexture);

        wgl.drawArrays(markDrawState, wgl.POINTS, 0, this.particlesWidth * this.particlesHeight);

        // Saves original velocity grid.

        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.originalVelocityTexture, 0);

        var copyDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.velocityTextureWidth, this.velocityTextureHeight)

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)

            .useProgram(this.copyProgram)
            .uniformTexture('u_texture', 0, wgl.TEXTURE_2D, this.velocityTexture)

        wgl.drawArrays(copyDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        // Adds forces to velocity grid.

        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.tempVelocityTexture, 0);

        var addForceDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.velocityTextureWidth, this.velocityTextureHeight)

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)

            .useProgram(this.addForceProgram)
            .uniformTexture('u_velocityTexture', 0, wgl.TEXTURE_2D, this.velocityTexture)

            .uniform1f('u_timeStep', timeStep)

            .uniform3f('u_mouseVelocity', mouseVelocity[0], mouseVelocity[1], mouseVelocity[2])

            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ)
            .uniform3f('u_gridSize', this.gridWidth, this.gridHeight, this.gridDepth)

            .uniform3f('u_mouseRayOrigin', mouseRayOrigin[0], mouseRayOrigin[1], mouseRayOrigin[2])
            .uniform3f('u_mouseRayDirection', mouseRayDirection[0], mouseRayDirection[1], mouseRayDirection[2])

            // FLOODplain: source-derived horizontal forcing. Strength 0 (the
            // default) leaves this stage exactly as upstream.
            .uniformTexture('u_terrainTexture', 3, wgl.TEXTURE_2D, this.terrainTexture)
            .uniformTexture('u_sourceFlowTexture', 4, wgl.TEXTURE_2D, this.sourceFlowTexture || this.terrainTexture)
            .uniform3f('u_terrainSize', this.gridWidth, this.gridHeight, this.gridDepth)
            // FLOODplain: 0 is upstream's closed box. Above 0 the faces of the
            // native perimeter cells carry the velocity the saved run's own
            // signed discharge prescribes. A zero-discharge edge prescribes a
            // still face; an off-hour frame has no snapshot and stays at 0.
            .uniformTexture('u_perimeterFluxTexture', 5, wgl.TEXTURE_2D, this.perimeterFluxTexture || this.terrainTexture)
            .uniform1f('u_perimeterFluxStrength', this.perimeterFluxStrength || 0.0)
            .uniform1f('u_sourceFlowStrength', this.sourceFlowStrength || 0.0)


        wgl.drawArrays(addForceDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        swap(this, 'velocityTexture', 'tempVelocityTexture');

        // Enforces boundary velocity conditions.

        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.tempVelocityTexture, 0);

        var enforceBoundariesDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.velocityTextureWidth, this.velocityTextureHeight)

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)

            .useProgram(this.enforceBoundariesProgram)
            .uniformTexture('u_terrainTexture', 3, wgl.TEXTURE_2D, this.terrainTexture)
            .uniform3f('u_terrainSize', this.gridWidth, this.gridHeight, this.gridDepth)
            // FLOODplain: 0 is upstream's closed box. Above 0 the faces of the
            // native perimeter cells carry the velocity the saved run's own
            // signed discharge prescribes. A zero-discharge edge prescribes a
            // still face; an off-hour frame has no snapshot and stays at 0.
            .uniformTexture('u_perimeterFluxTexture', 5, wgl.TEXTURE_2D, this.perimeterFluxTexture || this.terrainTexture)
            .uniform1f('u_perimeterFluxStrength', this.perimeterFluxStrength || 0.0)
            .uniformTexture('u_velocityTexture', 0, wgl.TEXTURE_2D, this.velocityTexture)
            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ);

        wgl.drawArrays(enforceBoundariesDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        swap(this, 'velocityTexture', 'tempVelocityTexture');

        // Updates velocityTexture for non divergence.

        // Computes divergence for pressure projection.

        var divergenceDrawState = wgl.createDrawState()

            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.scalarTextureWidth, this.scalarTextureHeight)

            .useProgram(this.divergenceProgram)
            .uniformTexture('u_terrainTexture', 3, wgl.TEXTURE_2D, this.terrainTexture)
            .uniform3f('u_terrainSize', this.gridWidth, this.gridHeight, this.gridDepth)
            // FLOODplain: 0 is upstream's closed box. Above 0 the faces of the
            // native perimeter cells carry the velocity the saved run's own
            // signed discharge prescribes. A zero-discharge edge prescribes a
            // still face; an off-hour frame has no snapshot and stays at 0.
            .uniformTexture('u_perimeterFluxTexture', 5, wgl.TEXTURE_2D, this.perimeterFluxTexture || this.terrainTexture)
            .uniform1f('u_perimeterFluxStrength', this.perimeterFluxStrength || 0.0)
            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ)
            .uniformTexture('u_velocityTexture', 0, wgl.TEXTURE_2D, this.velocityTexture)
            .uniformTexture('u_markerTexture', 1, wgl.TEXTURE_2D, this.markerTexture)
            .uniformTexture('u_weightTexture', 2, wgl.TEXTURE_2D, this.weightTexture)

            .uniform1f('u_maxDensity', this.particleDensity)

            // FLOODplain: real world metres per cell, so the projection
            // operators are dimensionally correct on an anisotropic grid.
            .uniform3f('u_cellSize', cellSize[0], cellSize[1], cellSize[2])
            .uniform1f('u_densityRelaxSeconds', this.densityRelaxSeconds || 1.0)

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, false, 0, 0)

        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.divergenceTexture, 0);
        wgl.clear(
            wgl.createClearState().bindFramebuffer(this.simulationFramebuffer),
            wgl.COLOR_BUFFER_BIT);

        wgl.drawArrays(divergenceDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        // Compute pressure via jacobi iteration.

        var jacobiDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.scalarTextureWidth, this.scalarTextureHeight)

            .useProgram(this.jacobiProgram)
            .uniformTexture('u_terrainTexture', 3, wgl.TEXTURE_2D, this.terrainTexture)
            .uniform3f('u_terrainSize', this.gridWidth, this.gridHeight, this.gridDepth)
            // FLOODplain: 0 is upstream's closed box. Above 0 the faces of the
            // native perimeter cells carry the velocity the saved run's own
            // signed discharge prescribes. A zero-discharge edge prescribes a
            // still face; an off-hour frame has no snapshot and stays at 0.
            .uniformTexture('u_perimeterFluxTexture', 5, wgl.TEXTURE_2D, this.perimeterFluxTexture || this.terrainTexture)
            .uniform1f('u_perimeterFluxStrength', this.perimeterFluxStrength || 0.0)
            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ)
            .uniformTexture('u_divergenceTexture', 1, wgl.TEXTURE_2D, this.divergenceTexture)
            .uniformTexture('u_markerTexture', 2, wgl.TEXTURE_2D, this.markerTexture)
            .uniform3f('u_cellSize', cellSize[0], cellSize[1], cellSize[2])

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, false, 0, 0)


        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.pressureTexture, 0);
        wgl.clear(
            wgl.createClearState().bindFramebuffer(this.simulationFramebuffer),
            wgl.COLOR_BUFFER_BIT);

        var PRESSURE_JACOBI_ITERATIONS = this.pressureIterations || 24;
        for (var i = 0; i < PRESSURE_JACOBI_ITERATIONS; ++i) {
            wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.tempSimulationTexture, 0);
            jacobiDrawState.uniformTexture('u_pressureTexture', 0, wgl.TEXTURE_2D, this.pressureTexture);

            wgl.drawArrays(jacobiDrawState, wgl.TRIANGLE_STRIP, 0, 4);

            swap(this, 'pressureTexture', 'tempSimulationTexture');
        }


        // Subtracts pressure gradient from velocity.

        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.tempVelocityTexture, 0);

        var subtractDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.velocityTextureWidth, this.velocityTextureHeight)

            .useProgram(this.subtractProgram)
            .uniformTexture('u_terrainTexture', 3, wgl.TEXTURE_2D, this.terrainTexture)
            .uniform3f('u_terrainSize', this.gridWidth, this.gridHeight, this.gridDepth)
            // FLOODplain: 0 is upstream's closed box. Above 0 the faces of the
            // native perimeter cells carry the velocity the saved run's own
            // signed discharge prescribes. A zero-discharge edge prescribes a
            // still face; an off-hour frame has no snapshot and stays at 0.
            .uniformTexture('u_perimeterFluxTexture', 5, wgl.TEXTURE_2D, this.perimeterFluxTexture || this.terrainTexture)
            .uniform1f('u_perimeterFluxStrength', this.perimeterFluxStrength || 0.0)
            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ)
            .uniformTexture('u_pressureTexture', 0, wgl.TEXTURE_2D, this.pressureTexture)
            .uniformTexture('u_velocityTexture', 1, wgl.TEXTURE_2D, this.velocityTexture)
            .uniformTexture('u_markerTexture', 2, wgl.TEXTURE_2D, this.markerTexture)
            .uniform3f('u_cellSize', cellSize[0], cellSize[1], cellSize[2])

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, false, 0, 0)

        wgl.drawArrays(subtractDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        swap(this, 'velocityTexture', 'tempVelocityTexture');

        // Transfers velocities back to particles.

        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.particleVelocityTextureTemp, 0);

        var transferToParticlesDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.particlesWidth, this.particlesHeight)

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)

            .useProgram(this.transferToParticlesProgram)
            .uniformTexture('u_particlePositionTexture', 0, wgl.TEXTURE_2D, this.particlePositionTexture)
            .uniformTexture('u_particleVelocityTexture', 1, wgl.TEXTURE_2D, this.particleVelocityTexture)
            .uniformTexture('u_gridVelocityTexture', 2, wgl.TEXTURE_2D, this.velocityTexture)
            .uniformTexture('u_originalGridVelocityTexture', 3, wgl.TEXTURE_2D, this.originalVelocityTexture)
            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ)
            .uniform3f('u_gridSize', this.gridWidth, this.gridHeight, this.gridDepth)

            .uniform1f('u_flipness', this.flipness)

        wgl.drawArrays(transferToParticlesDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        swap(this, 'particleVelocityTextureTemp', 'particleVelocityTexture');

        // Advects particle positions with velocity grid using RK2.


        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.particlePositionTextureTemp, 0);
        wgl.clear(
            wgl.createClearState().bindFramebuffer(this.simulationFramebuffer),
            wgl.COLOR_BUFFER_BIT);

        var advectDrawState = wgl.createDrawState()
            .bindFramebuffer(this.simulationFramebuffer)
            .viewport(0, 0, this.particlesWidth, this.particlesHeight)

            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)

            .useProgram(this.advectProgram)
            .uniformTexture('u_terrainTexture', 3, wgl.TEXTURE_2D, this.terrainTexture)
            .uniform3f('u_terrainSize', this.gridWidth, this.gridHeight, this.gridDepth)
            // FLOODplain: 0 is upstream's closed box. Above 0 the faces of the
            // native perimeter cells carry the velocity the saved run's own
            // signed discharge prescribes. A zero-discharge edge prescribes a
            // still face; an off-hour frame has no snapshot and stays at 0.
            .uniformTexture('u_perimeterFluxTexture', 5, wgl.TEXTURE_2D, this.perimeterFluxTexture || this.terrainTexture)
            .uniform1f('u_perimeterFluxStrength', this.perimeterFluxStrength || 0.0)
            .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, this.particlePositionTexture)
            .uniformTexture('u_randomsTexture', 1, wgl.TEXTURE_2D, this.particleRandomTexture)
            .uniformTexture('u_velocityGrid', 2, wgl.TEXTURE_2D, this.velocityTexture)
            .uniform3f('u_gridResolution', this.gridResolutionX, this.gridResolutionY, this.gridResolutionZ)
            .uniform3f('u_gridSize', this.gridWidth, this.gridHeight, this.gridDepth)
            .uniform1f('u_timeStep', timeStep)
            .uniform1f('u_frameNumber', this.frameNumber)
            .uniform2f('u_particlesResolution', this.particlesWidth, this.particlesHeight);

        wgl.drawArrays(advectDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        swap(this, 'particlePositionTextureTemp', 'particlePositionTexture');
    }

    return Simulator;
}());

export default Simulator;
