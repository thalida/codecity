// src/codecity/app/city-renderer.js

// Language hue mapping (matches Python defaults.py)
const LANGUAGE_HUES = {
    python: 210,
    javascript: 50,
    typescript: 200,
    java: 30,
    go: 180,
    rust: 15,
    ruby: 0,
    php: 260,
    c: 220,
    cpp: 220,
    csharp: 270,
    swift: 25,
    kotlin: 280,
    html: 15,
    css: 200,
    json: 45,
    yaml: 120,
    markdown: 150,
    shell: 100,
    unknown: 0,
};

export class CityRenderer {
    constructor(scene, inspector) {
        this.scene = scene;
        this.inspector = inspector;
        this.buildings = new Map(); // file_path -> mesh
        this.streets = [];
    }

    render(cityData) {
        // Clear existing meshes
        this.clear();

        // Render streets and buildings recursively
        this.renderStreet(cityData.root);
    }

    clear() {
        for (const mesh of this.buildings.values()) {
            mesh.dispose();
        }
        this.buildings.clear();

        for (const mesh of this.streets) {
            mesh.dispose();
        }
        this.streets = [];
    }

    renderStreet(street) {
        // Render street as a flat plane
        if (street.width > 0 && street.length > 0) {
            const streetMesh = BABYLON.MeshBuilder.CreateBox(
                `street_${street.path}`,
                {
                    width: street.width,
                    height: 0.1,
                    depth: street.length,
                },
                this.scene
            );
            streetMesh.position.x = street.x + street.width / 2;
            streetMesh.position.y = 0.05;
            streetMesh.position.z = street.z + street.length / 2;

            const streetMat = new BABYLON.StandardMaterial(`streetMat_${street.path}`, this.scene);
            streetMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.25);
            streetMesh.material = streetMat;

            this.streets.push(streetMesh);
        }

        // Render buildings
        for (const building of street.buildings) {
            this.renderBuilding(building);
        }

        // Render sub-streets
        for (const substreet of street.substreets) {
            this.renderStreet(substreet);
        }
    }

    renderBuilding(building) {
        const height = Math.max(building.height / 10, 1); // Scale down, min 1
        const width = Math.max(building.width / 5, 2);    // Scale down, min 2
        const depth = width;

        const mesh = BABYLON.MeshBuilder.CreateBox(
            `building_${building.file_path}`,
            { width, height, depth },
            this.scene
        );

        mesh.position.x = building.x + width / 2;
        mesh.position.y = height / 2;
        mesh.position.z = building.z + depth / 2;

        // Create material with HSL color
        const material = new BABYLON.StandardMaterial(`mat_${building.file_path}`, this.scene);
        const color = this.calculateBuildingColor(building);
        material.diffuseColor = color;
        mesh.material = material;

        // Store building data in mesh metadata
        mesh.metadata = {
            type: 'building',
            data: building,
        };

        // Add click handler
        mesh.actionManager = new BABYLON.ActionManager(this.scene);
        mesh.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPickTrigger,
                () => this.inspector.show(building)
            )
        );

        this.buildings.set(building.file_path, mesh);
    }

    calculateBuildingColor(building) {
        // Hue from language
        const hue = LANGUAGE_HUES[building.language] || LANGUAGE_HUES.unknown;

        // Saturation from file age (older = more saturated)
        const createdDate = new Date(building.created_at);
        const now = new Date();
        const ageInDays = (now - createdDate) / (1000 * 60 * 60 * 24);
        const saturation = Math.min(0.3 + (ageInDays / 365) * 0.5, 0.8);

        // Lightness from last modified (more recent = lighter)
        const modifiedDate = new Date(building.last_modified);
        const daysSinceModified = (now - modifiedDate) / (1000 * 60 * 60 * 24);
        const lightness = Math.max(0.7 - (daysSinceModified / 180) * 0.3, 0.4);

        // Convert HSL to RGB
        return this.hslToColor3(hue / 360, saturation, lightness);
    }

    hslToColor3(h, s, l) {
        let r, g, b;

        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return new BABYLON.Color3(r, g, b);
    }

    updateBuilding(filePath, newData) {
        const mesh = this.buildings.get(filePath);
        if (mesh) {
            // Update mesh dimensions and color
            mesh.metadata.data = newData;
            const color = this.calculateBuildingColor(newData);
            mesh.material.diffuseColor = color;
        }
    }

    removeBuilding(filePath) {
        const mesh = this.buildings.get(filePath);
        if (mesh) {
            mesh.dispose();
            this.buildings.delete(filePath);
        }
    }
}
