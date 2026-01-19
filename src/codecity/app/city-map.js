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

        // Sidewalks (directly beside roads)
        this.map.addLayer({
            id: 'sidewalks',
            type: 'line',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'sidewalks'],
            paint: {
                'line-color': '#bbbbbb',
                'line-width': 3,
            },
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
        });

        // Footpaths (dotted curved lines from buildings to sidewalks)
        this.map.addLayer({
            id: 'footpaths',
            type: 'line',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'footpaths'],
            paint: {
                'line-color': '#999999',
                'line-width': 1.5,
                'line-dasharray': [2, 2],  // Dotted line pattern
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
                // Height based on lines of code (human scale)
                // Burj Khalifa (828m) = max height for largest files
                'fill-extrusion-height': [
                    'interpolate',
                    ['linear'],
                    ['get', 'lines_of_code'],
                    0, 3,        // min 3m (1 story)
                    50, 10,      // 50 LOC = 10m (3 stories)
                    100, 25,     // 100 LOC = 25m (8 stories)
                    300, 75,     // 300 LOC = 75m (25 stories)
                    500, 150,    // 500 LOC = 150m (50 stories)
                    1000, 300,   // 1000 LOC = 300m (100 stories)
                    3000, 500,   // 3000 LOC = 500m (One World Trade)
                    5000, 828,   // 5000+ LOC = 828m (Burj Khalifa max)
                ],
                'fill-extrusion-base': 0,
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

    setTheme(themeName) {
        this.theme = themeName;
        this.map.setStyle(`/styles/${themeName}.json`);
    }
}
