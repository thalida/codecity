// MapLibre mock setup for Vitest

import { vi } from 'vitest';

// Mock maplibre-gl as global (loaded via CDN in browser)
class MockMap {
    constructor(options) {
        this.options = options;
        this.on = vi.fn((event, callback) => {
            // Immediately fire 'load' event
            if (event === 'load') {
                setTimeout(() => callback(), 0);
            }
        });
        this.off = vi.fn();
        this.addSource = vi.fn();
        this.addLayer = vi.fn();
        this.getSource = vi.fn(() => null);
        this.getLayer = vi.fn(() => null);
        this.removeSource = vi.fn();
        this.removeLayer = vi.fn();
        this.setStyle = vi.fn();
        this.getCanvas = vi.fn(() => ({ style: { cursor: '' } }));
        this.fitBounds = vi.fn();
        this.addControl = vi.fn();
    }
}

class MockNavigationControl {
    constructor(options) {
        this.options = options;
    }
}

class MockScaleControl {
    constructor(options) {
        this.options = options;
    }
}

// Expose maplibregl globally (as it would be from CDN)
globalThis.maplibregl = {
    Map: MockMap,
    NavigationControl: MockNavigationControl,
    ScaleControl: MockScaleControl,
};

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

export { MockMap, MockNavigationControl, MockScaleControl };
