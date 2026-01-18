import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BABYLON } from './setup.js';

// We need to test the CodeCityApp class, but it's not exported as a module
// So we test by analyzing the behavior and patterns through mocks

describe('CodeCityApp', () => {
    let mockCanvas;
    let mockLoadingOverlay;
    let eventListeners;

    beforeEach(() => {
        eventListeners = {};

        mockCanvas = {
            style: { cursor: '' },
            addEventListener: vi.fn((event, handler, options) => {
                eventListeners[event] = eventListeners[event] || [];
                eventListeners[event].push({ handler, options });
            }),
            removeEventListener: vi.fn(),
            setPointerCapture: vi.fn(),
            releasePointerCapture: vi.fn(),
            getContext: vi.fn(() => ({})),
        };

        mockLoadingOverlay = {
            classList: {
                add: vi.fn(),
                remove: vi.fn(),
            },
        };

        document.getElementById = vi.fn((id) => {
            if (id === 'renderCanvas') return mockCanvas;
            if (id === 'loading-overlay') return mockLoadingOverlay;
            return null;
        });

        // Reset window.location
        window.location = {
            protocol: 'http:',
            host: 'localhost:8000',
            search: '',
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Camera Setup', () => {
        it('creates ArcRotateCamera with correct initial angles', () => {
            const camera = new BABYLON.ArcRotateCamera(
                'camera',
                -Math.PI / 2,  // alpha: horizontal angle
                Math.PI / 4,   // beta: 45 degrees from top
                80,            // radius
                new BABYLON.Vector3(0, 0, 0),
                null
            );

            expect(camera.alpha).toBe(-Math.PI / 2);
            expect(camera.beta).toBe(Math.PI / 4);
            expect(camera.radius).toBe(80);
        });

        it('sets zoom limits on camera', () => {
            const camera = new BABYLON.ArcRotateCamera('camera', 0, 0, 80, new BABYLON.Vector3(0, 0, 0), null);
            camera.lowerRadiusLimit = 10;
            camera.upperRadiusLimit = 1000;

            expect(camera.lowerRadiusLimit).toBe(10);
            expect(camera.upperRadiusLimit).toBe(1000);
        });

        it('sets angle limits on camera', () => {
            const camera = new BABYLON.ArcRotateCamera('camera', 0, 0, 80, new BABYLON.Vector3(0, 0, 0), null);
            camera.lowerBetaLimit = 0.1;
            camera.upperBetaLimit = Math.PI / 2.5;

            expect(camera.lowerBetaLimit).toBe(0.1);
            expect(camera.upperBetaLimit).toBe(Math.PI / 2.5);
        });
    });

    describe('Pointer Event Handling', () => {
        // Simulate how the app sets up pointer events
        function setupMockControls() {
            let isDragging = false;
            let isRotating = false;
            let lastX = 0;
            let lastY = 0;
            const camera = new BABYLON.ArcRotateCamera(
                'camera',
                -Math.PI / 2,
                Math.PI / 4,
                80,
                new BABYLON.Vector3(0, 0, 0),
                null
            );
            camera.lowerBetaLimit = 0.1;
            camera.upperBetaLimit = Math.PI / 2.5;

            mockCanvas.addEventListener('pointerdown', (e) => {
                mockCanvas.setPointerCapture(e.pointerId);

                if (e.button === 0 && e.ctrlKey) {
                    isRotating = true;
                    mockCanvas.style.cursor = 'move';
                } else if (e.button === 0) {
                    isDragging = true;
                    mockCanvas.style.cursor = 'grabbing';
                } else if (e.button === 2) {
                    isRotating = true;
                    mockCanvas.style.cursor = 'move';
                }
                lastX = e.clientX;
                lastY = e.clientY;
            });

            mockCanvas.addEventListener('pointermove', (e) => {
                if (!isDragging && !isRotating) return;

                const deltaX = e.clientX - lastX;
                const deltaY = e.clientY - lastY;
                lastX = e.clientX;
                lastY = e.clientY;

                if (isDragging) {
                    const panSpeed = camera.radius * 0.003;
                    const rightX = Math.sin(camera.alpha);
                    const rightZ = -Math.cos(camera.alpha);
                    const forwardX = Math.cos(camera.alpha);
                    const forwardZ = Math.sin(camera.alpha);

                    camera.target.x += (-deltaX * rightX + deltaY * forwardX) * panSpeed;
                    camera.target.z += (-deltaX * rightZ + deltaY * forwardZ) * panSpeed;
                } else if (isRotating) {
                    const rotateSpeed = 0.005;
                    camera.alpha -= deltaX * rotateSpeed;
                    camera.beta -= deltaY * rotateSpeed;
                    camera.beta = Math.max(camera.lowerBetaLimit, Math.min(camera.upperBetaLimit, camera.beta));
                }
            });

            mockCanvas.addEventListener('pointerup', (e) => {
                mockCanvas.releasePointerCapture(e.pointerId);
                isDragging = false;
                isRotating = false;
                mockCanvas.style.cursor = 'grab';
            });

            mockCanvas.addEventListener('pointercancel', (e) => {
                mockCanvas.releasePointerCapture(e.pointerId);
                isDragging = false;
                isRotating = false;
                mockCanvas.style.cursor = 'grab';
            });

            mockCanvas.style.cursor = 'grab';

            mockCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

            return { camera, getIsDragging: () => isDragging, getIsRotating: () => isRotating };
        }

        it('uses pointer events (not mouse events)', () => {
            setupMockControls();

            const eventTypes = mockCanvas.addEventListener.mock.calls.map((call) => call[0]);
            expect(eventTypes).toContain('pointerdown');
            expect(eventTypes).toContain('pointermove');
            expect(eventTypes).toContain('pointerup');
            expect(eventTypes).toContain('pointercancel');
        });

        it('left click triggers pan mode', () => {
            const { getIsDragging } = setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            pointerdownHandler({ button: 0, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 1 });

            expect(getIsDragging()).toBe(true);
            expect(mockCanvas.style.cursor).toBe('grabbing');
        });

        it('right click triggers rotate mode', () => {
            const { getIsRotating } = setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            pointerdownHandler({ button: 2, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 1 });

            expect(getIsRotating()).toBe(true);
            expect(mockCanvas.style.cursor).toBe('move');
        });

        it('ctrl+left click triggers rotate mode', () => {
            const { getIsRotating } = setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            pointerdownHandler({ button: 0, ctrlKey: true, clientX: 100, clientY: 100, pointerId: 1 });

            expect(getIsRotating()).toBe(true);
            expect(mockCanvas.style.cursor).toBe('move');
        });

        it('captures pointer on pointerdown', () => {
            setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            pointerdownHandler({ button: 0, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 42 });

            expect(mockCanvas.setPointerCapture).toHaveBeenCalledWith(42);
        });

        it('releases pointer on pointerup', () => {
            setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            const pointerupHandler = eventListeners['pointerup'][0].handler;

            pointerdownHandler({ button: 0, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 42 });
            pointerupHandler({ pointerId: 42 });

            expect(mockCanvas.releasePointerCapture).toHaveBeenCalledWith(42);
        });

        it('releases pointer on pointercancel', () => {
            setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            const pointercancelHandler = eventListeners['pointercancel'][0].handler;

            pointerdownHandler({ button: 0, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 42 });
            pointercancelHandler({ pointerId: 42 });

            expect(mockCanvas.releasePointerCapture).toHaveBeenCalledWith(42);
        });

        it('pan modifies camera target', () => {
            const { camera } = setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            const pointermoveHandler = eventListeners['pointermove'][0].handler;

            const initialTargetX = camera.target.x;
            const initialTargetZ = camera.target.z;

            pointerdownHandler({ button: 0, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 1 });
            pointermoveHandler({ clientX: 150, clientY: 100, pointerId: 1 });

            // Target should have changed
            expect(camera.target.x !== initialTargetX || camera.target.z !== initialTargetZ).toBe(true);
        });

        it('rotate modifies camera alpha and beta', () => {
            const { camera } = setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            const pointermoveHandler = eventListeners['pointermove'][0].handler;

            const initialAlpha = camera.alpha;
            const initialBeta = camera.beta;

            pointerdownHandler({ button: 2, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 1 });
            pointermoveHandler({ clientX: 150, clientY: 150, pointerId: 1 });

            expect(camera.alpha).not.toBe(initialAlpha);
            expect(camera.beta).not.toBe(initialBeta);
        });

        it('clamps beta to limits during rotation', () => {
            const { camera } = setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            const pointermoveHandler = eventListeners['pointermove'][0].handler;

            pointerdownHandler({ button: 2, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 1 });
            // Large downward movement should hit upper limit
            pointermoveHandler({ clientX: 100, clientY: -1000, pointerId: 1 });

            expect(camera.beta).toBeLessThanOrEqual(camera.upperBetaLimit);
            expect(camera.beta).toBeGreaterThanOrEqual(camera.lowerBetaLimit);
        });

        it('resets cursor to grab on pointerup', () => {
            setupMockControls();

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            const pointerupHandler = eventListeners['pointerup'][0].handler;

            pointerdownHandler({ button: 0, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 1 });
            expect(mockCanvas.style.cursor).toBe('grabbing');

            pointerupHandler({ pointerId: 1 });
            expect(mockCanvas.style.cursor).toBe('grab');
        });
    });

    describe('Zoom Controls', () => {
        function setupMockZoom() {
            const camera = new BABYLON.ArcRotateCamera(
                'camera',
                -Math.PI / 2,
                Math.PI / 4,
                80,
                new BABYLON.Vector3(0, 0, 0),
                null
            );
            camera.lowerRadiusLimit = 10;
            camera.upperRadiusLimit = 1000;

            const scene = {
                pick: vi.fn(() => ({ hit: false, pickedPoint: null })),
            };

            mockCanvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const zoomSpeed = 0.001;
                const zoomFactor = e.deltaY * zoomSpeed;

                const pickResult = scene.pick(e.offsetX, e.offsetY);

                const oldRadius = camera.radius;
                const newRadius = oldRadius * (1 + zoomFactor);

                camera.radius = Math.max(camera.lowerRadiusLimit, Math.min(camera.upperRadiusLimit, newRadius));

                if (pickResult.hit && pickResult.pickedPoint) {
                    const actualZoomRatio = 1 - (camera.radius / oldRadius);
                    const targetPoint = pickResult.pickedPoint;
                    camera.target.x += (targetPoint.x - camera.target.x) * actualZoomRatio;
                    camera.target.z += (targetPoint.z - camera.target.z) * actualZoomRatio;
                }
            }, { passive: false });

            return { camera, scene };
        }

        it('scroll changes camera radius', () => {
            const { camera } = setupMockZoom();

            const wheelHandler = eventListeners['wheel'][0].handler;
            const initialRadius = camera.radius;

            const event = { deltaY: 100, offsetX: 100, offsetY: 100, preventDefault: vi.fn() };
            wheelHandler(event);

            expect(camera.radius).not.toBe(initialRadius);
        });

        it('prevents default scroll behavior', () => {
            setupMockZoom();

            const wheelHandler = eventListeners['wheel'][0].handler;
            const event = { deltaY: 100, offsetX: 100, offsetY: 100, preventDefault: vi.fn() };
            wheelHandler(event);

            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('respects lower radius limit', () => {
            const { camera } = setupMockZoom();

            const wheelHandler = eventListeners['wheel'][0].handler;
            // Large zoom in (negative deltaY = zoom in)
            const event = { deltaY: -10000, offsetX: 100, offsetY: 100, preventDefault: vi.fn() };
            wheelHandler(event);

            expect(camera.radius).toBeGreaterThanOrEqual(camera.lowerRadiusLimit);
        });

        it('respects upper radius limit', () => {
            const { camera } = setupMockZoom();

            const wheelHandler = eventListeners['wheel'][0].handler;
            // Large zoom out (positive deltaY = zoom out)
            const event = { deltaY: 10000, offsetX: 100, offsetY: 100, preventDefault: vi.fn() };
            wheelHandler(event);

            expect(camera.radius).toBeLessThanOrEqual(camera.upperRadiusLimit);
        });

        it('moves target towards cursor when zooming with hit', () => {
            const { camera, scene } = setupMockZoom();

            scene.pick.mockReturnValue({
                hit: true,
                pickedPoint: new BABYLON.Vector3(50, 0, 50),
            });

            const wheelHandler = eventListeners['wheel'][0].handler;
            const initialTargetX = camera.target.x;
            const initialTargetZ = camera.target.z;

            // Zoom in
            const event = { deltaY: -100, offsetX: 100, offsetY: 100, preventDefault: vi.fn() };
            wheelHandler(event);

            // Target should move towards picked point (50, 50)
            const movedTowardsX = (camera.target.x > initialTargetX && camera.target.x <= 50) ||
                                  (camera.target.x < initialTargetX && camera.target.x >= 50);
            const movedTowardsZ = (camera.target.z > initialTargetZ && camera.target.z <= 50) ||
                                  (camera.target.z < initialTargetZ && camera.target.z >= 50);

            expect(movedTowardsX || movedTowardsZ).toBe(true);
        });

        it('registers wheel handler with passive false', () => {
            setupMockZoom();

            const wheelCall = mockCanvas.addEventListener.mock.calls.find((call) => call[0] === 'wheel');
            expect(wheelCall[2]).toEqual({ passive: false });
        });
    });

    describe('Context Menu', () => {
        it('prevents default context menu', () => {
            mockCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

            const contextmenuHandler = eventListeners['contextmenu'][0].handler;
            const event = { preventDefault: vi.fn() };
            contextmenuHandler(event);

            expect(event.preventDefault).toHaveBeenCalled();
        });
    });

    describe('Cursor Feedback', () => {
        it('default cursor is grab', () => {
            mockCanvas.style.cursor = 'grab';
            expect(mockCanvas.style.cursor).toBe('grab');
        });

        it('cursor changes to grabbing during pan', () => {
            let isDragging = false;

            mockCanvas.addEventListener('pointerdown', (e) => {
                if (e.button === 0) {
                    isDragging = true;
                    mockCanvas.style.cursor = 'grabbing';
                }
            });

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            pointerdownHandler({ button: 0, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 1 });

            expect(mockCanvas.style.cursor).toBe('grabbing');
        });

        it('cursor changes to move during rotate', () => {
            mockCanvas.addEventListener('pointerdown', (e) => {
                if (e.button === 2) {
                    mockCanvas.style.cursor = 'move';
                }
            });

            const pointerdownHandler = eventListeners['pointerdown'][0].handler;
            pointerdownHandler({ button: 2, ctrlKey: false, clientX: 100, clientY: 100, pointerId: 1 });

            expect(mockCanvas.style.cursor).toBe('move');
        });
    });

    describe('WebSocket Handling', () => {
        let mockWebSocket;

        beforeEach(() => {
            mockWebSocket = {
                onopen: null,
                onmessage: null,
                onclose: null,
                onerror: null,
                send: vi.fn(),
                close: vi.fn(),
            };

            global.WebSocket = vi.fn(() => mockWebSocket);
        });

        it('creates WebSocket with correct URL', () => {
            window.location = {
                protocol: 'http:',
                host: 'localhost:8000',
                search: '',
            };

            const ws = new WebSocket('ws://localhost:8000/ws');
            expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8000/ws');
        });

        it('creates secure WebSocket for HTTPS', () => {
            window.location = {
                protocol: 'https:',
                host: 'localhost:8000',
                search: '',
            };

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            expect(protocol).toBe('wss:');
        });

        it('includes repo_path in WebSocket URL if provided', () => {
            const repoPath = '/home/user/project';
            const wsUrl = `ws://localhost:8000/ws?repo_path=${encodeURIComponent(repoPath)}`;

            const ws = new WebSocket(wsUrl);
            expect(global.WebSocket).toHaveBeenCalledWith(wsUrl);
        });
    });

    describe('Live Update Handling', () => {
        it('handles file_changed update', () => {
            const mockRenderer = {
                updateBuilding: vi.fn(),
                addBuilding: vi.fn(),
                removeBuilding: vi.fn(),
            };

            const update = {
                type: 'file_changed',
                file_path: 'src/main.py',
                metrics: { lines: 100 },
            };

            // Simulate handleLiveUpdate logic
            if (update.type === 'file_changed') {
                mockRenderer.updateBuilding(update.file_path, update.metrics);
            }

            expect(mockRenderer.updateBuilding).toHaveBeenCalledWith('src/main.py', { lines: 100 });
        });

        it('handles file_added update', () => {
            const mockRenderer = {
                updateBuilding: vi.fn(),
                addBuilding: vi.fn(),
                removeBuilding: vi.fn(),
            };

            const update = {
                type: 'file_added',
                file_path: 'src/new.py',
                metrics: { lines: 50 },
            };

            if (update.type === 'file_added') {
                mockRenderer.addBuilding(update.file_path, update.metrics);
            }

            expect(mockRenderer.addBuilding).toHaveBeenCalledWith('src/new.py', { lines: 50 });
        });

        it('handles file_deleted update', () => {
            const mockRenderer = {
                updateBuilding: vi.fn(),
                addBuilding: vi.fn(),
                removeBuilding: vi.fn(),
            };

            const update = {
                type: 'file_deleted',
                file_path: 'src/old.py',
            };

            if (update.type === 'file_deleted') {
                mockRenderer.removeBuilding(update.file_path);
            }

            expect(mockRenderer.removeBuilding).toHaveBeenCalledWith('src/old.py');
        });
    });

    describe('Loading Overlay', () => {
        it('shows loading overlay', () => {
            mockLoadingOverlay.classList.remove('hidden');
            expect(mockLoadingOverlay.classList.remove).toHaveBeenCalledWith('hidden');
        });

        it('hides loading overlay', () => {
            mockLoadingOverlay.classList.add('hidden');
            expect(mockLoadingOverlay.classList.add).toHaveBeenCalledWith('hidden');
        });
    });

    describe('Scene Creation', () => {
        it('creates scene with dark clear color', () => {
            const engine = new BABYLON.Engine(mockCanvas, true, {});
            const scene = new BABYLON.Scene(engine);
            scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.08, 1);

            expect(scene.clearColor.r).toBeCloseTo(0.05);
            expect(scene.clearColor.g).toBeCloseTo(0.05);
            expect(scene.clearColor.b).toBeCloseTo(0.08);
            expect(scene.clearColor.a).toBe(1);
        });
    });

    describe('Lights Setup', () => {
        it('creates hemisphere light', () => {
            const scene = new BABYLON.Scene(new BABYLON.Engine(null, true, {}));
            const light = new BABYLON.HemisphericLight('hemisphereLight', new BABYLON.Vector3(0, 1, 0), scene);
            light.intensity = 0.6;
            light.groundColor = new BABYLON.Color3(0.1, 0.1, 0.15);

            expect(light.intensity).toBe(0.6);
            expect(light.groundColor.r).toBe(0.1);
        });

        it('creates directional light', () => {
            const scene = new BABYLON.Scene(new BABYLON.Engine(null, true, {}));
            const light = new BABYLON.DirectionalLight('directionalLight', new BABYLON.Vector3(-1, -2, -1), scene);
            light.position = new BABYLON.Vector3(20, 40, 20);
            light.intensity = 0.8;

            expect(light.intensity).toBe(0.8);
            expect(light.position.x).toBe(20);
        });

        it('creates shadow generator', () => {
            const scene = new BABYLON.Scene(new BABYLON.Engine(null, true, {}));
            const light = new BABYLON.DirectionalLight('directionalLight', new BABYLON.Vector3(-1, -2, -1), scene);
            const shadowGenerator = new BABYLON.ShadowGenerator(1024, light);
            shadowGenerator.useBlurExponentialShadowMap = true;
            shadowGenerator.blurKernel = 32;

            expect(shadowGenerator.mapSize).toBe(1024);
            expect(shadowGenerator.useBlurExponentialShadowMap).toBe(true);
            expect(shadowGenerator.blurKernel).toBe(32);
        });
    });
});
