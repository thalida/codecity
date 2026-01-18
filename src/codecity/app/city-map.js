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
            pitch: 45,
            bearing: -15,
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

    addLayers() {
        // Streets
        this.map.addLayer({
            id: 'streets',
            type: 'line',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'streets'],
            paint: {
                'line-color': '#ffffff',
                'line-width': 8,
            },
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
        });

        // Sidewalks
        this.map.addLayer({
            id: 'sidewalks',
            type: 'line',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'sidewalks'],
            paint: {
                'line-color': '#cccccc',
                'line-width': 2,
            },
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
        });

        // Footpaths (curved paths from buildings to sidewalks)
        this.map.addLayer({
            id: 'footpaths',
            type: 'line',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'footpaths'],
            paint: {
                'line-color': '#aaaaaa',
                'line-width': 1,
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
                'text-color': '#ffffff',
                'text-halo-color': '#000000',
                'text-halo-width': 2,
            },
        });

        // Buildings (3D extruded)
        this.map.addLayer({
            id: 'buildings',
            type: 'fill-extrusion',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'buildings'],
            paint: {
                'fill-extrusion-color': '#888888',
                'fill-extrusion-height': [
                    'interpolate',
                    ['linear'],
                    ['get', 'lines_of_code'],
                    0, 5,      // min height 5
                    100, 15,   // 100 LOC = 15 height
                    500, 50,   // 500 LOC = 50 height
                    1000, 80,  // 1000+ LOC = max 80 height
                ],
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0.9,
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
