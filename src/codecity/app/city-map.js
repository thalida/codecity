// src/codecity/app/city-map.js
// maplibregl is loaded globally from CDN in index.html

export class CityMap {
    constructor(container, options = {}) {
        this.container = container;
        this.theme = options.theme || 'default';
        this.map = null;
        this.cityData = null;
    }

    async init(cityDataUrl) {
        // Fetch city data
        const response = await fetch(cityDataUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch city data: ${response.statusText}`);
        }
        this.cityData = await response.json();

        const bounds = this.calculateBounds(this.cityData);

        this.map = new maplibregl.Map({
            container: this.container,
            style: `/styles/${this.theme}.json`,
            bounds: bounds,
            fitBoundsOptions: { padding: 50 },
            pitch: 60,  // Higher pitch for better 3D view
            bearing: -17.6,
            antialias: true,
            renderWorldCopies: false,
        });

        // Wait for map to load before adding sources and layers
        await new Promise((resolve, reject) => {
            this.map.on('load', () => {
                try {
                    this.map.addSource('city', {
                        type: 'geojson',
                        data: this.cityData,
                    });
                    this.addLayers();
                    this.addNavigationControls();
                    this.addLighting();
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
            this.map.on('error', reject);
        });
    }

    calculateBounds(geojson) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        const processCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                minX = Math.min(minX, coords[0]);
                minY = Math.min(minY, coords[1]);
                maxX = Math.max(maxX, coords[0]);
                maxY = Math.max(maxY, coords[1]);
            } else {
                coords.forEach(processCoords);
            }
        };

        geojson.features.forEach((f) => processCoords(f.geometry.coordinates));
        return [[minX, minY], [maxX, maxY]];
    }

    addLighting() {
        // Add ambient and directional lighting for 3D effect
        this.map.setLight({
            anchor: 'viewport',
            color: '#ffffff',
            intensity: 0.4,
            position: [1.5, 90, 80],  // azimuth, polar angle, intensity
        });
    }

    addLayers() {
        // Grass background (render first, at bottom)
        this.map.addLayer({
            id: 'grass',
            type: 'fill',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'grass'],
            paint: {
                'fill-color': '#90EE90',  // Light green
                'fill-opacity': 0.6,
            },
        });

        // Streets with traffic-based coloring
        // Primary (high traffic) = yellow/gold, Secondary = white, Tertiary = light gray
        this.map.addLayer({
            id: 'streets',
            type: 'line',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'streets'],
            paint: {
                'line-color': [
                    'match',
                    ['get', 'road_class'],
                    'primary', '#f5c542',    // Yellow/gold for high traffic main streets
                    'secondary', '#ffffff',   // White for medium traffic
                    '#dddddd'                 // Light gray for low traffic
                ],
                'line-width': [
                    'match',
                    ['get', 'road_class'],
                    'primary', 14,
                    'secondary', 10,
                    6
                ],
            },
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
        });

        // Street labels
        this.map.addLayer({
            id: 'street-labels',
            type: 'symbol',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'streets'],
            layout: {
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Semibold'],
                'text-size': [
                    'match',
                    ['get', 'road_class'],
                    'primary', 14,
                    'secondary', 12,
                    10
                ],
                'text-anchor': 'center',
                'text-max-angle': 30,
            },
            paint: {
                'text-color': '#333333',
                'text-halo-color': '#ffffff',
                'text-halo-width': 2,
            },
        });

        // Buildings (3D extruded) - must be added last to render on top
        this.map.addLayer({
            id: 'buildings',
            type: 'fill-extrusion',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'buildings'],
            minzoom: 0,  // Render at all zoom levels
            paint: {
                // Color based on language or default gray
                'fill-extrusion-color': [
                    'match',
                    ['get', 'language'],
                    'python', '#3776ab',
                    'javascript', '#f7df1e',
                    'typescript', '#3178c6',
                    'rust', '#dea584',
                    'go', '#00add8',
                    'java', '#b07219',
                    'ruby', '#cc342d',
                    'cpp', '#f34b7d',
                    'c', '#555555',
                    'markdown', '#083fa1',
                    'json', '#292929',
                    'yaml', '#cb171e',
                    'toml', '#9c4221',
                    '#888888'  // Default gray
                ],
                // Height from pre-calculated properties
                'fill-extrusion-height': ['get', 'top_height'],
                'fill-extrusion-base': ['get', 'base_height'],
                'fill-extrusion-opacity': 0.95,
                // Add vertical gradient for depth
                'fill-extrusion-vertical-gradient': true,
            },
        });
    }

    addNavigationControls() {
        this.map.addControl(new maplibregl.NavigationControl());
        this.map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    }

    getBuildingTiers(filePath) {
        // Find all features (tiers) for this building from the GeoJSON data
        const tiers = this.cityData.features
            .filter(f => f.properties.layer === 'buildings' && f.properties.path === filePath)
            .map(f => ({
                tier: f.properties.tier,
                baseHeight: f.properties.base_height,
                topHeight: f.properties.top_height,
                // Use tier_width from GeoJSON properties (calculated in Python)
                width: f.properties.tier_width,
            }))
            .sort((a, b) => a.tier - b.tier);

        return tiers;
    }

    setTheme(themeName) {
        this.theme = themeName;
        this.map.setStyle(`/styles/${themeName}.json`);
    }
}
