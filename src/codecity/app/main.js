// CodeCity Main Application
// Babylon.js 3D City Visualization

import { CityRenderer } from './city-renderer.js';
import { Inspector } from './inspector.js';

/**
 * CodeCityApp - Main application class for the 3D code city visualization
 */
class CodeCityApp {
    constructor() {
        this.canvas = document.getElementById('renderCanvas');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.engine = null;
        this.scene = null;
        this.camera = null;
        this.cityRenderer = null;
        this.inspector = null;
        this.websocket = null;
    }

    /**
     * Create and configure the Babylon.js scene
     * @returns {BABYLON.Scene} The configured scene
     */
    createScene() {
        const scene = new BABYLON.Scene(this.engine);
        scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.08, 1);
        return scene;
    }

    /**
     * Initialize the Babylon.js engine and scene
     */
    async init() {
        // Create Babylon.js engine
        this.engine = new BABYLON.Engine(this.canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true
        });

        // Create scene
        this.scene = this.createScene();

        // Setup camera
        this.setupCamera();

        // Setup lights
        this.setupLights();

        // Initialize city renderer
        this.cityRenderer = new CityRenderer(this.scene);

        // Initialize inspector
        this.inspector = new Inspector();

        // Handle window resize
        window.addEventListener('resize', () => {
            this.engine.resize();
        });

        // Start render loop
        this.engine.runRenderLoop(() => {
            this.scene.render();

            // Update label visibility based on camera distance
            if (this.cityRenderer && this.camera) {
                this.cityRenderer.updateLabelVisibility(this.camera);
            }
        });

        // Load city - use URL parameter if provided, otherwise API uses server default
        const urlParams = new URLSearchParams(window.location.search);
        const repoPath = urlParams.get('repo');

        // Always try to load city - API will use app.state.repo_path as default
        await this.loadCity(repoPath);
        this.connectWebSocket(repoPath);
    }

    /**
     * Setup ArcRotateCamera for orbiting around the city
     */
    setupCamera() {
        // ArcRotateCamera: alpha (horizontal), beta (vertical), radius, target
        this.camera = new BABYLON.ArcRotateCamera(
            'camera',
            -Math.PI / 2,  // alpha: horizontal angle
            Math.PI / 3,   // beta: vertical angle (60 degrees from top)
            50,            // radius: distance from target
            new BABYLON.Vector3(0, 0, 0),  // target: center of scene
            this.scene
        );

        // Camera limits
        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 200;
        this.camera.lowerBetaLimit = 0.1;
        this.camera.upperBetaLimit = Math.PI / 2 - 0.1;

        // Camera controls
        this.camera.attachControl(this.canvas, true);
        this.camera.wheelPrecision = 10;
        this.camera.panningSensibility = 100;

        // WASD keyboard controls for moving around
        this.setupKeyboardControls();
    }

    /**
     * Setup WASD keyboard controls for camera movement
     */
    setupKeyboardControls() {
        const keys = { w: false, a: false, s: false, d: false, q: false, e: false };
        const moveSpeed = 0.5;

        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (key in keys) keys[key] = true;
        });

        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (key in keys) keys[key] = false;
        });

        // Update camera target based on keys each frame
        this.scene.registerBeforeRender(() => {
            if (!this.camera) return;

            // Calculate forward and right vectors based on camera angle
            const forward = new BABYLON.Vector3(
                Math.sin(this.camera.alpha),
                0,
                Math.cos(this.camera.alpha)
            );
            const right = new BABYLON.Vector3(
                Math.sin(this.camera.alpha + Math.PI / 2),
                0,
                Math.cos(this.camera.alpha + Math.PI / 2)
            );

            // Move camera target
            if (keys.w) this.camera.target.addInPlace(forward.scale(moveSpeed));
            if (keys.s) this.camera.target.addInPlace(forward.scale(-moveSpeed));
            if (keys.a) this.camera.target.addInPlace(right.scale(-moveSpeed));
            if (keys.d) this.camera.target.addInPlace(right.scale(moveSpeed));
            if (keys.q) this.camera.target.y -= moveSpeed;
            if (keys.e) this.camera.target.y += moveSpeed;
        });
    }

    /**
     * Setup hemisphere and directional lights
     */
    setupLights() {
        // Hemisphere light for ambient lighting
        const hemisphereLight = new BABYLON.HemisphericLight(
            'hemisphereLight',
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        hemisphereLight.intensity = 0.6;
        hemisphereLight.groundColor = new BABYLON.Color3(0.1, 0.1, 0.15);

        // Directional light for shadows
        const directionalLight = new BABYLON.DirectionalLight(
            'directionalLight',
            new BABYLON.Vector3(-1, -2, -1),
            this.scene
        );
        directionalLight.position = new BABYLON.Vector3(20, 40, 20);
        directionalLight.intensity = 0.8;

        // Shadow generator
        const shadowGenerator = new BABYLON.ShadowGenerator(1024, directionalLight);
        shadowGenerator.useBlurExponentialShadowMap = true;
        shadowGenerator.blurKernel = 32;

        // Store shadow generator for city renderer
        this.shadowGenerator = shadowGenerator;
    }

    /**
     * Create dark ground plane
     */
    createGround() {
        const ground = BABYLON.MeshBuilder.CreateGround(
            'ground',
            { width: 200, height: 200 },
            this.scene
        );

        const groundMaterial = new BABYLON.StandardMaterial('groundMaterial', this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.1);
        groundMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        ground.material = groundMaterial;
        ground.receiveShadows = true;
    }

    /**
     * Load city data from API
     * @param {string|null} repoPath - Path to the repository (optional, server uses default)
     */
    async loadCity(repoPath) {
        try {
            this.showLoading();

            // Build URL - only add repo_path param if provided
            const url = repoPath
                ? `/api/city?repo_path=${encodeURIComponent(repoPath)}`
                : '/api/city';

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to load city: ${response.statusText}`);
            }

            const cityData = await response.json();

            // Render the city
            await this.cityRenderer.render(cityData, this.shadowGenerator);

            // Setup click handling for inspector
            this.setupClickHandling();

            this.hideLoading();
        } catch (error) {
            console.error('Error loading city:', error);
            this.hideLoading();
        }
    }

    /**
     * Connect WebSocket for live updates
     * @param {string|null} repoPath - Path to the repository (optional, server uses default)
     */
    connectWebSocket(repoPath) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Build URL - only add repo_path param if provided
        const wsUrl = repoPath
            ? `${protocol}//${window.location.host}/ws?repo_path=${encodeURIComponent(repoPath)}`
            : `${protocol}//${window.location.host}/ws`;

        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = () => {
            console.log('WebSocket connected');
        };

        this.websocket.onmessage = (event) => {
            try {
                const update = JSON.parse(event.data);
                this.handleLiveUpdate(update);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        this.websocket.onclose = () => {
            console.log('WebSocket disconnected');
            // Attempt to reconnect after 5 seconds
            setTimeout(() => this.connectWebSocket(repoPath), 5000);
        };

        this.websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    /**
     * Handle live updates from WebSocket
     * @param {Object} update - Update data from server
     */
    handleLiveUpdate(update) {
        if (update.type === 'file_changed') {
            this.cityRenderer.updateBuilding(update.file_path, update.metrics);
        } else if (update.type === 'file_added') {
            this.cityRenderer.addBuilding(update.file_path, update.metrics);
        } else if (update.type === 'file_deleted') {
            this.cityRenderer.removeBuilding(update.file_path);
        }
    }

    /**
     * Setup click handling for building selection
     */
    setupClickHandling() {
        this.scene.onPointerDown = (evt, pickResult) => {
            if (pickResult.hit && pickResult.pickedMesh) {
                const mesh = pickResult.pickedMesh;
                if (mesh.metadata && mesh.metadata.fileData) {
                    this.inspector.show(mesh.metadata.fileData);
                }
            }
        };
    }

    /**
     * Show loading overlay
     */
    showLoading() {
        this.loadingOverlay.classList.remove('hidden');
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new CodeCityApp();
    app.init().catch(console.error);
});
