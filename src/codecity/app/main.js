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
     * Setup camera with Google Maps-like controls
     * - Left click + drag: Pan the map
     * - Right click + drag: Rotate view
     * - Scroll wheel: Zoom in/out
     */
    setupCamera() {
        // ArcRotateCamera looking down at the city (like a map view)
        this.camera = new BABYLON.ArcRotateCamera(
            'camera',
            -Math.PI / 2,  // alpha: horizontal angle (looking north)
            Math.PI / 4,   // beta: 45 degrees from top (tilted view)
            80,            // radius: distance from target
            new BABYLON.Vector3(0, 0, 0),  // target: center of scene
            this.scene
        );

        // Zoom limits
        this.camera.lowerRadiusLimit = 10;
        this.camera.upperRadiusLimit = 1000;

        // Angle limits - keep camera above ground, allow more top-down view
        this.camera.lowerBetaLimit = 0.1;  // Almost top-down
        this.camera.upperBetaLimit = Math.PI / 2.5;  // Not too horizontal

        // DO NOT attach default controls - we use fully custom controls
        // this.camera.attachControl() would add default rotate-on-drag behavior

        // Setup Google Maps-like controls (fully custom)
        this.setupMapControls();
    }

    /**
     * Setup Google Maps-like mouse controls
     */
    setupMapControls() {
        let isDragging = false;
        let isRotating = false;
        let lastX = 0;
        let lastY = 0;

        // Use pointer events for better cross-browser support
        // They work with both mouse and touch

        this.canvas.addEventListener('pointerdown', (e) => {
            // Capture pointer to receive events outside canvas
            this.canvas.setPointerCapture(e.pointerId);

            if (e.button === 0) {
                // Left click = pan
                isDragging = true;
                this.canvas.style.cursor = 'grabbing';
            } else if (e.button === 2) {
                // Right click = rotate
                isRotating = true;
                this.canvas.style.cursor = 'move';
            }
            lastX = e.clientX;
            lastY = e.clientY;
        });

        this.canvas.addEventListener('pointermove', (e) => {
            if (!isDragging && !isRotating) return;

            const deltaX = e.clientX - lastX;
            const deltaY = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;

            if (isDragging) {
                // Pan: move camera target so it feels like dragging the ground
                // When you drag left, the world should move left (target moves right)
                const panSpeed = this.camera.radius * 0.003;

                // Get the camera's forward and right vectors projected onto ground plane
                // Alpha is the horizontal rotation angle
                // For ArcRotateCamera: alpha=0 means looking along +X, alpha=PI/2 means looking along +Z
                const rightX = Math.sin(this.camera.alpha);
                const rightZ = -Math.cos(this.camera.alpha);
                const forwardX = Math.cos(this.camera.alpha);
                const forwardZ = Math.sin(this.camera.alpha);

                // Move target opposite to drag direction (grab and drag behavior)
                // deltaX > 0 means dragging right, so move target left (negative right direction)
                // deltaY > 0 means dragging down, so move target forward (into screen)
                this.camera.target.x += (-deltaX * rightX + deltaY * forwardX) * panSpeed;
                this.camera.target.z += (-deltaX * rightZ + deltaY * forwardZ) * panSpeed;
            } else if (isRotating) {
                // Rotate: change camera angles
                const rotateSpeed = 0.005;
                this.camera.alpha -= deltaX * rotateSpeed;
                this.camera.beta -= deltaY * rotateSpeed;

                // Clamp beta to limits
                this.camera.beta = Math.max(this.camera.lowerBetaLimit,
                    Math.min(this.camera.upperBetaLimit, this.camera.beta));
            }
        });

        this.canvas.addEventListener('pointerup', (e) => {
            this.canvas.releasePointerCapture(e.pointerId);
            isDragging = false;
            isRotating = false;
            this.canvas.style.cursor = 'grab';
        });

        this.canvas.addEventListener('pointercancel', (e) => {
            this.canvas.releasePointerCapture(e.pointerId);
            isDragging = false;
            isRotating = false;
            this.canvas.style.cursor = 'grab';
        });

        // Default cursor
        this.canvas.style.cursor = 'grab';

        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Scroll wheel - zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSpeed = 0.001;
            const delta = e.deltaY * zoomSpeed * this.camera.radius;

            this.camera.radius += delta;
            this.camera.radius = Math.max(this.camera.lowerRadiusLimit,
                Math.min(this.camera.upperRadiusLimit, this.camera.radius));
        }, { passive: false });
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
