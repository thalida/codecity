// MapLibre mock setup for Vitest

import { vi } from 'vitest';

// Mock maplibre-gl
const mockMap = {
    on: vi.fn(),
    off: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => null),
    getLayer: vi.fn(() => null),
    removeSource: vi.fn(),
    removeLayer: vi.fn(),
    setStyle: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
    fitBounds: vi.fn(),
    addControl: vi.fn(),
};

class MockMap {
    constructor(options) {
        this.options = options;
        Object.assign(this, mockMap);
        // Simulate 'load' event
        setTimeout(() => {
            const loadCallback = this.on.mock.calls.find(call => call[0] === 'load');
            if (loadCallback) {
                loadCallback[1]();
            }
        }, 0);
    }
}

class MockNavigationControl {
    constructor(options) {
        this.options = options;
    }
}

vi.mock('maplibre-gl', () => ({
    Map: MockMap,
    NavigationControl: MockNavigationControl,
}));

// Mock fetch for API calls
global.fetch = vi.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
            type: 'FeatureCollection',
            features: [],
        }),
    })
);

// Mock window.location
Object.defineProperty(window, 'location', {
    value: {
        protocol: 'http:',
        host: 'localhost:8000',
        search: '',
    },
    writable: true,
});

export { mockMap, MockMap, MockNavigationControl };
