// src/codecity/app/__tests__/city-map.test.js
// maplibregl is mocked globally in setup.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CityMap } from '../city-map.js';

// Mock GeoJSON data for tests
const mockGeoJSON = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[0, 0], [10, 10]],
            },
            properties: { layer: 'streets' },
        },
    ],
};

describe('CityMap', () => {
    let mockContainer;

    beforeEach(() => {
        mockContainer = document.createElement('div');
        mockContainer.id = 'map';
        vi.clearAllMocks();

        // Mock fetch for init tests
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockGeoJSON),
            })
        );
    });

    describe('constructor', () => {
        it('stores container reference', () => {
            const cityMap = new CityMap(mockContainer);
            expect(cityMap.container).toBe(mockContainer);
        });

        it('defaults theme to default', () => {
            const cityMap = new CityMap(mockContainer);
            expect(cityMap.theme).toBe('default');
        });

        it('accepts custom theme option', () => {
            const cityMap = new CityMap(mockContainer, { theme: 'dark' });
            expect(cityMap.theme).toBe('dark');
        });
    });

    describe('calculateBounds', () => {
        it('calculates bounds from geojson features', () => {
            const cityMap = new CityMap(mockContainer);
            const geojson = {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [[0, 0], [100, 50]],
                        },
                    },
                    {
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[10, 10], [20, 10], [20, 60], [10, 60], [10, 10]]],
                        },
                    },
                ],
            };

            const bounds = cityMap.calculateBounds(geojson);
            expect(bounds).toEqual([[0, 0], [100, 60]]);
        });
    });

    describe('init', () => {
        it('creates map with renderWorldCopies disabled', async () => {
            const cityMap = new CityMap(mockContainer);
            await cityMap.init('/api/city.geojson');

            // Check that Map was created with renderWorldCopies: false
            // The MockMap stores constructor options in this.options
            expect(cityMap.map.options.renderWorldCopies).toBe(false);
        });
    });

    describe('setTheme', () => {
        it('updates theme property', async () => {
            const cityMap = new CityMap(mockContainer);
            await cityMap.init('/api/city.geojson');

            // Wait for the load event to fire
            await new Promise(resolve => setTimeout(resolve, 10));

            cityMap.setTheme('dark');
            expect(cityMap.theme).toBe('dark');
        });
    });
});
