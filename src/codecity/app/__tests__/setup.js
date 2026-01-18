// Babylon.js mock setup for Vitest
// Provides lightweight mocks for all Babylon.js classes used in the app

import { vi } from 'vitest';

// Helper to create chainable mock objects
function createMockMesh(name = 'mesh') {
    return {
        name,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scaling: { x: 1, y: 1, z: 1 },
        material: null,
        metadata: null,
        actionManager: null,
        receiveShadows: false,
        dispose: vi.fn(),
    };
}

function createMockMaterial(name = 'material') {
    return {
        name,
        diffuseColor: null,
        specularColor: null,
        diffuseTexture: null,
        backFaceCulling: true,
        hasAlpha: false,
    };
}

// Mock BABYLON global
const BABYLON = {
    // Core classes
    Vector3: class Vector3 {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        static Distance(a, b) {
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dz = a.z - b.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
    },

    Color3: class Color3 {
        constructor(r = 0, g = 0, b = 0) {
            this.r = r;
            this.g = g;
            this.b = b;
        }
    },

    Color4: class Color4 {
        constructor(r = 0, g = 0, b = 0, a = 1) {
            this.r = r;
            this.g = g;
            this.b = b;
            this.a = a;
        }
    },

    // Engine and Scene
    Engine: class Engine {
        constructor(canvas, antialias, options) {
            this.canvas = canvas;
            this.antialias = antialias;
            this.options = options;
            this.resize = vi.fn();
            this.runRenderLoop = vi.fn((fn) => {
                this._renderLoop = fn;
            });
        }
    },

    Scene: class Scene {
        constructor(engine) {
            this.engine = engine;
            this.clearColor = null;
            this.onPointerDown = null;
            this.meshes = [];
            this.pick = vi.fn(() => ({ hit: false, pickedMesh: null, pickedPoint: null }));
            this.render = vi.fn();
        }
    },

    // Camera
    ArcRotateCamera: class ArcRotateCamera {
        constructor(name, alpha, beta, radius, target, scene) {
            this.name = name;
            this.alpha = alpha;
            this.beta = beta;
            this.radius = radius;
            this.target = target;
            this.scene = scene;
            this.position = new BABYLON.Vector3();
            this.lowerRadiusLimit = 0;
            this.upperRadiusLimit = Infinity;
            this.lowerBetaLimit = 0;
            this.upperBetaLimit = Math.PI;
            this.attachControl = vi.fn();
        }
    },

    // Lights
    HemisphericLight: class HemisphericLight {
        constructor(name, direction, scene) {
            this.name = name;
            this.direction = direction;
            this.scene = scene;
            this.intensity = 1;
            this.groundColor = null;
        }
    },

    DirectionalLight: class DirectionalLight {
        constructor(name, direction, scene) {
            this.name = name;
            this.direction = direction;
            this.scene = scene;
            this.position = new BABYLON.Vector3();
            this.intensity = 1;
        }
    },

    // Shadow
    ShadowGenerator: class ShadowGenerator {
        constructor(mapSize, light) {
            this.mapSize = mapSize;
            this.light = light;
            this.useBlurExponentialShadowMap = false;
            this.blurKernel = 0;
            this.addShadowCaster = vi.fn();
        }
    },

    // Materials
    StandardMaterial: class StandardMaterial {
        constructor(name, scene) {
            return createMockMaterial(name);
        }
    },

    DynamicTexture: class DynamicTexture {
        constructor(name, options, scene) {
            this.name = name;
            this.options = options;
            this.scene = scene;
            this.hasAlpha = false;
            this._context = {
                fillStyle: '',
                font: '',
                textAlign: '',
                textBaseline: '',
                clearRect: vi.fn(),
                fillRect: vi.fn(),
                fillText: vi.fn(),
            };
        }
        getContext() {
            return this._context;
        }
        update() {}
    },

    // Mesh builders
    MeshBuilder: {
        CreateBox: vi.fn((name, options, scene) => createMockMesh(name)),
        CreateGround: vi.fn((name, options, scene) => createMockMesh(name)),
        CreateCylinder: vi.fn((name, options, scene) => createMockMesh(name)),
        CreatePlane: vi.fn((name, options, scene) => createMockMesh(name)),
    },

    // Actions
    ActionManager: class ActionManager {
        constructor(scene) {
            this.scene = scene;
            this.actions = [];
            this.registerAction = vi.fn((action) => {
                this.actions.push(action);
                return action;
            });
        }
        static OnPickTrigger = 1;
        static OnPointerOverTrigger = 2;
        static OnPointerOutTrigger = 3;
    },

    ExecuteCodeAction: class ExecuteCodeAction {
        constructor(trigger, func) {
            this.trigger = trigger;
            this.func = func;
        }
    },

    // GUI namespace
    GUI: {
        AdvancedDynamicTexture: {
            CreateFullscreenUI: vi.fn((name) => ({
                name,
                addControl: vi.fn(),
                dispose: vi.fn(),
            })),
        },
        TextBlock: class TextBlock {
            constructor() {
                this.text = '';
                this.color = '';
                this.fontSize = 0;
                this.outlineWidth = 0;
                this.outlineColor = '';
            }
        },
        Rectangle: class Rectangle {
            constructor() {
                this.width = '';
                this.height = '';
                this.cornerRadius = 0;
                this.color = '';
                this.background = '';
                this.alpha = 1;
                this._children = [];
                this.linkWithMesh = vi.fn();
                this.linkOffsetY = 0;
                this.dispose = vi.fn();
            }
            addControl(control) {
                this._children.push(control);
            }
        },
    },
};

// Expose BABYLON globally
globalThis.BABYLON = BABYLON;

// Mock DOM elements for inspector tests
function setupDomMocks() {
    // Create mock elements that inspector.js expects
    const mockElements = {
        'renderCanvas': {
            style: { cursor: '' },
            addEventListener: vi.fn(),
            setPointerCapture: vi.fn(),
            releasePointerCapture: vi.fn(),
            getContext: vi.fn(() => ({})),
        },
        'loading-overlay': {
            classList: {
                add: vi.fn(),
                remove: vi.fn(),
            },
        },
        'inspector': {
            classList: {
                add: vi.fn(),
                remove: vi.fn(),
                contains: vi.fn(() => false),
            },
            contains: vi.fn(() => false),
        },
        'inspector-close': {
            addEventListener: vi.fn(),
        },
        'btn-open-editor': {
            addEventListener: vi.fn(),
        },
        'btn-view-remote': {
            addEventListener: vi.fn(),
            style: { display: '' },
        },
        'inspector-title': { textContent: '' },
        'inspector-path': { textContent: '' },
        'inspector-loc': { textContent: '' },
        'inspector-avg-line': { textContent: '' },
        'inspector-language': { textContent: '' },
        'inspector-created': { textContent: '' },
        'inspector-modified': { textContent: '' },
    };

    document.getElementById = vi.fn((id) => mockElements[id] || null);
}

setupDomMocks();

// Mock window.location for inspector URL tests
Object.defineProperty(window, 'location', {
    value: {
        protocol: 'http:',
        host: 'localhost:8000',
        search: '',
    },
    writable: true,
});

// Mock window.open
window.open = vi.fn();

// Export for direct use in tests
export { BABYLON, createMockMesh, createMockMaterial, setupDomMocks };
