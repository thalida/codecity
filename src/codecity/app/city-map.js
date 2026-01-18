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
        });

        this.map.on('load', () => {
            this.map.addSource('city', {
                type: 'geojson',
                data: this.cityData,
            });
            this.addLayers();
            this.addNavigationControls();
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

        // Buildings (flat for now, will add extrusion later)
        this.map.addLayer({
            id: 'buildings',
            type: 'fill',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'buildings'],
            paint: {
                'fill-color': '#888888',
                'fill-outline-color': '#333333',
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
