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
     * Initialize the Babylon.js engine and scene
     */
    async init() {
        // Create Babylon.js engine
        this.engine = new BABYLON.Engine(this.canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true
        });

        // Create scene
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.08, 1);

        // Setup camera
        this.setupCamera();

        // Setup lights
        this.setupLights();

        // Create ground plane
        this.createGround();

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
        });

        // Load city from URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const repoPath = urlParams.get('repo');

        if (repoPath) {
            await this.loadCity(repoPath);
            this.connectWebSocket(repoPath);
        } else {
            this.hideLoading();
        }
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
     * @param {string} repoPath - Path to the repository
     */
    async loadCity(repoPath) {
        try {
            this.showLoading();

            const response = await fetch(`/api/city?repo_path=${encodeURIComponent(repoPath)}`);

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
     * @param {string} repoPath - Path to the repository
     */
    connectWebSocket(repoPath) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws?repo_path=${encodeURIComponent(repoPath)}`;

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
