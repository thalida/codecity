// src/codecity/app/city-renderer.js

// Size of each grid tile in world units
const TILE_SIZE = 10;

// Building height limits for lowpoly city feel
const MAX_BUILDING_HEIGHT = 15;
const MIN_BUILDING_HEIGHT = 1;
const HEIGHT_SCALE = 20; // Divide LOC by this to get height

// Building width/depth limits
const MAX_BUILDING_WIDTH = 6;
const MIN_BUILDING_WIDTH = 2;
const WIDTH_SCALE = 10; // Divide avg line length by this

// Google Maps-inspired color palette
const COLORS = {
    ground: { r: 0.82, g: 0.89, b: 0.78 },      // Light green grass #d2e3c8
    road: { r: 0.96, g: 0.96, b: 0.96 },         // Light gray road #f5f5f5
    intersection: { r: 0.92, g: 0.92, b: 0.92 }, // Slightly darker intersection
    roadLabel: '#555555',                         // Dark gray for road labels
};

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
        this.streetLabels = []; // Flat street name labels on roads
        this.labels = new Map();  // file_path -> label (building labels)
        this.advancedTexture = null;
    }

    render(cityData) {
        // Detect layout type and render accordingly
        if (cityData.grid && Object.keys(cityData.grid).length > 0) {
            // Grid-based connected streets layout
            this.renderGridCity(cityData);
        } else if (cityData.root) {
            // Original tree-based district layout
            this.clear();
            this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
            this.renderStreet(cityData.root, true);
        }
    }

    clear() {
        for (const label of this.labels.values()) {
            label.dispose();
        }
        this.labels.clear();

        if (this.advancedTexture) {
            this.advancedTexture.dispose();
            this.advancedTexture = null;
        }

        for (const mesh of this.buildings.values()) {
            mesh.dispose();
        }
        this.buildings.clear();

        for (const mesh of this.streets) {
            mesh.dispose();
        }
        this.streets = [];

        for (const label of this.streetLabels) {
            label.dispose();
        }
        this.streetLabels = [];
    }

    renderStreet(street, isRoot = false) {
        // Render district ground (colored plate)
        if (street.width > 0 && street.length > 0 && street.color) {
            const districtMesh = BABYLON.MeshBuilder.CreateBox(
                `district_${street.path}`,
                {
                    width: street.width,
                    height: 0.1,
                    depth: street.length,
                },
                this.scene
            );
            districtMesh.position.x = street.x + street.width / 2;
            districtMesh.position.y = 0.05;
            districtMesh.position.z = street.z + street.length / 2;

            const districtMat = new BABYLON.StandardMaterial(`districtMat_${street.path}`, this.scene);
            // Convert RGB 0-255 to 0-1
            districtMat.diffuseColor = new BABYLON.Color3(
                street.color[0] / 255,
                street.color[1] / 255,
                street.color[2] / 255
            );
            districtMat.specularColor = new BABYLON.Color3(0, 0, 0);
            districtMesh.material = districtMat;

            this.streets.push(districtMesh);
        }

        // Render road at district boundary
        if (street.road_width > 0 && street.width > 0 && !isRoot) {
            const roadMesh = BABYLON.MeshBuilder.CreateBox(
                `road_${street.path}`,
                {
                    width: street.width + street.road_width * 2,
                    height: 0.12,
                    depth: street.road_width,
                },
                this.scene
            );
            roadMesh.position.x = street.x + street.width / 2;
            roadMesh.position.y = 0.06;
            roadMesh.position.z = street.z - street.road_width / 2;

            const roadMat = new BABYLON.StandardMaterial(`roadMat_${street.path}`, this.scene);
            roadMat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.14);
            roadMat.specularColor = new BABYLON.Color3(0, 0, 0);
            roadMesh.material = roadMat;

            this.streets.push(roadMesh);
        }

        // Render buildings
        for (const building of street.buildings) {
            this.renderBuilding(building);
        }

        // Render flat street label (map-style)
        this.renderTreeStreetLabel(street);

        // Render sub-streets
        for (const substreet of street.substreets) {
            this.renderStreet(substreet, false);
        }
    }

    renderTreeStreetLabel(street) {
        // Render street name as flat text along the road (for tree-based layout)
        if (!street.name || street.name === 'root') return;

        // Calculate center of the street for label placement
        const centerX = street.x + street.width / 2;
        const centerZ = street.z - 1; // Just above the road

        const labelWidth = Math.max(street.name.length * 0.8, 4);
        const labelHeight = 1.5;

        const label = BABYLON.MeshBuilder.CreatePlane(
            `streetLabel_${street.path}`,
            { width: labelWidth, height: labelHeight },
            this.scene
        );

        label.position.x = centerX;
        label.position.y = 0.15;
        label.position.z = centerZ;
        label.rotation.x = Math.PI / 2; // Lie flat

        // Create dynamic texture for the street name
        const textureWidth = 512;
        const textureHeight = 96;
        const texture = new BABYLON.DynamicTexture(
            `streetLabelTexture_${street.path}`,
            { width: textureWidth, height: textureHeight },
            this.scene
        );
        texture.hasAlpha = true;

        const ctx = texture.getContext();
        ctx.clearRect(0, 0, textureWidth, textureHeight);
        ctx.font = 'bold 48px Arial';
        ctx.fillStyle = COLORS.roadLabel;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(street.name.toUpperCase(), textureWidth / 2, textureHeight / 2);
        texture.update();

        const material = new BABYLON.StandardMaterial(`streetLabelMat_${street.path}`, this.scene);
        material.diffuseTexture = texture;
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        material.emissiveTexture = texture;
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        label.material = material;

        this.streetLabels.push(label);
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
        material.specularColor = new BABYLON.Color3(0, 0, 0);  // No specular for flat look
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

        // Hover shows label
        mesh.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPointerOverTrigger,
                () => {
                    const label = this.labels.get(building.file_path);
                    if (label) label.alpha = 1;
                }
            )
        );
        mesh.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPointerOutTrigger,
                () => {
                    // Let distance-based visibility take over
                }
            )
        );

        this.buildings.set(building.file_path, mesh);
        this.createBuildingLabel(building, mesh);
    }

    createBuildingLabel(building, mesh) {
        const filename = building.file_path.split('/').pop();

        const label = new BABYLON.GUI.TextBlock();
        label.text = filename;
        label.color = 'white';
        label.fontSize = 14;
        label.outlineWidth = 2;
        label.outlineColor = 'black';

        const rect = new BABYLON.GUI.Rectangle();
        rect.width = '150px';
        rect.height = '30px';
        rect.cornerRadius = 4;
        rect.color = 'transparent';
        rect.background = 'transparent';
        rect.alpha = 0;  // Start hidden
        rect.addControl(label);

        this.advancedTexture.addControl(rect);
        rect.linkWithMesh(mesh);
        rect.linkOffsetY = -40;

        this.labels.set(building.file_path, rect);
    }

    updateLabelVisibility(camera) {
        const cameraPos = camera.position;

        for (const [filePath, label] of this.labels) {
            const mesh = this.buildings.get(filePath);
            if (!mesh) continue;

            const distance = BABYLON.Vector3.Distance(cameraPos, mesh.position);
            const buildingHeight = mesh.scaling?.y || 1;

            // Larger buildings visible from farther away
            const fadeStart = 40 + buildingHeight * 3;
            const fadeEnd = 25 + buildingHeight * 3;

            if (distance < fadeEnd) {
                label.alpha = 1;
            } else if (distance < fadeStart) {
                label.alpha = (fadeStart - distance) / (fadeStart - fadeEnd);
            } else {
                label.alpha = 0;
            }
        }
    }

    calculateBuildingColor(building) {
        // Hue from language
        const hue = LANGUAGE_HUES[building.language] || LANGUAGE_HUES.unknown;

        // For map-like lowpoly feel: softer, more pastel colors
        // Lower saturation for a cleaner look
        const createdDate = new Date(building.created_at);
        const now = new Date();
        const ageInDays = (now - createdDate) / (1000 * 60 * 60 * 24);
        const saturation = Math.min(0.25 + (ageInDays / 365) * 0.25, 0.5);

        // Higher lightness for pastel look, slight variation based on modification
        const modifiedDate = new Date(building.last_modified);
        const daysSinceModified = (now - modifiedDate) / (1000 * 60 * 60 * 24);
        const lightness = Math.max(0.75 - (daysSinceModified / 180) * 0.15, 0.6);

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

    renderTile(x, z, tile) {
        const tileType = tile.tile_type || tile.type;

        switch (tileType) {
            case 'road':
            case 'road_start':
            case 'road_end':
                this.renderRoadTile(x, z);
                break;
            case 'intersection':
                this.renderIntersectionTile(x, z);
                break;
        }
    }

    renderRoadTile(x, z) {
        const mesh = BABYLON.MeshBuilder.CreateBox(
            `road_${x}_${z}`,
            { width: TILE_SIZE, height: 0.1, depth: TILE_SIZE },
            this.scene
        );
        mesh.position.x = x * TILE_SIZE + TILE_SIZE / 2;
        mesh.position.y = 0.05;
        mesh.position.z = z * TILE_SIZE + TILE_SIZE / 2;

        const material = new BABYLON.StandardMaterial(`roadMat_${x}_${z}`, this.scene);
        material.diffuseColor = new BABYLON.Color3(COLORS.road.r, COLORS.road.g, COLORS.road.b);
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        mesh.material = material;

        this.streets.push(mesh);
    }

    renderIntersectionTile(x, z) {
        const mesh = BABYLON.MeshBuilder.CreateBox(
            `intersection_${x}_${z}`,
            { width: TILE_SIZE, height: 0.12, depth: TILE_SIZE },
            this.scene
        );
        mesh.position.x = x * TILE_SIZE + TILE_SIZE / 2;
        mesh.position.y = 0.06;
        mesh.position.z = z * TILE_SIZE + TILE_SIZE / 2;

        const material = new BABYLON.StandardMaterial(`intersectionMat_${x}_${z}`, this.scene);
        material.diffuseColor = new BABYLON.Color3(
            COLORS.intersection.r, COLORS.intersection.g, COLORS.intersection.b
        );
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        mesh.material = material;

        this.streets.push(mesh);
    }

    renderGridBuilding(building) {
        // Scale and cap building dimensions for lowpoly city feel
        const rawHeight = building.height / HEIGHT_SCALE;
        const height = Math.min(Math.max(rawHeight, MIN_BUILDING_HEIGHT), MAX_BUILDING_HEIGHT);

        // Buildings must fit within a tile with margin to prevent overlap
        const maxBuildingSize = TILE_SIZE * 0.7; // 70% of tile size max
        const rawWidth = building.width / WIDTH_SCALE;
        const width = Math.min(Math.max(rawWidth, MIN_BUILDING_WIDTH), Math.min(MAX_BUILDING_WIDTH, maxBuildingSize));
        const depth = Math.min(width, maxBuildingSize);

        const mesh = BABYLON.MeshBuilder.CreateBox(
            `building_${building.file_path}`,
            { width, height, depth },
            this.scene
        );

        // Calculate world position from grid position
        const worldX = building.x * TILE_SIZE + TILE_SIZE / 2;
        const worldZ = building.z * TILE_SIZE + TILE_SIZE / 2;

        // Offset from road based on which side, with gap between road and building
        const roadGap = 0.5; // Small gap between road edge and building
        const offset = building.road_side * (TILE_SIZE / 2 + depth / 2 + roadGap);

        if (building.road_direction === 'horizontal') {
            mesh.position.x = worldX;
            mesh.position.z = worldZ + offset;
        } else {
            // For vertical roads, offset in x direction
            mesh.position.x = worldX + offset;
            mesh.position.z = worldZ;
        }

        mesh.position.y = height / 2;

        // Create material with HSL color
        const material = new BABYLON.StandardMaterial(`mat_${building.file_path}`, this.scene);
        const color = this.calculateBuildingColor(building);
        material.diffuseColor = color;
        material.specularColor = new BABYLON.Color3(0, 0, 0);
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

        // Hover shows label
        mesh.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPointerOverTrigger,
                () => {
                    const label = this.labels.get(building.file_path);
                    if (label) label.alpha = 1;
                }
            )
        );
        mesh.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPointerOutTrigger,
                () => {
                    // Let distance-based visibility take over
                }
            )
        );

        this.buildings.set(building.file_path, mesh);
        this.createBuildingLabel(building, mesh);
    }

    renderGridCity(cityData) {
        this.clear();
        this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');

        // Render ground plane based on bounds
        this.renderGroundPlane(cityData.bounds);

        // Render all tiles
        for (const [coords, tile] of Object.entries(cityData.grid)) {
            const [x, z] = coords.split(',').map(Number);
            this.renderTile(x, z, tile);
        }

        // Render all buildings
        for (const building of Object.values(cityData.buildings)) {
            this.renderGridBuilding(building);
        }

        // Render street labels (flat on road like map apps)
        for (const [path, street] of Object.entries(cityData.streets)) {
            if (path && street.start) {
                this.renderStreetLabel(street);
            }
        }
    }

    renderGroundPlane(bounds) {
        const padding = 5; // Extra tiles of padding around the city
        const width = (bounds.max_x - bounds.min_x + padding * 2) * TILE_SIZE;
        const depth = (bounds.max_z - bounds.min_z + padding * 2) * TILE_SIZE;
        const centerX = ((bounds.min_x + bounds.max_x) / 2) * TILE_SIZE + TILE_SIZE / 2;
        const centerZ = ((bounds.min_z + bounds.max_z) / 2) * TILE_SIZE + TILE_SIZE / 2;

        const ground = BABYLON.MeshBuilder.CreateGround(
            'ground',
            { width, height: depth },
            this.scene
        );
        ground.position.x = centerX;
        ground.position.z = centerZ;

        const material = new BABYLON.StandardMaterial('groundMat', this.scene);
        material.diffuseColor = new BABYLON.Color3(COLORS.ground.r, COLORS.ground.g, COLORS.ground.b);
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        ground.material = material;
    }

    renderStreetLabel(street) {
        // Render street name as flat text along the road (like Google Maps)
        if (!street.name || street.name === 'root') return;

        const [startX, startZ] = street.start;
        const [endX, endZ] = street.end;

        // Calculate center of the street
        const centerX = ((startX + endX) / 2) * TILE_SIZE + TILE_SIZE / 2;
        const centerZ = ((startZ + endZ) / 2) * TILE_SIZE + TILE_SIZE / 2;

        // Determine street direction and rotation
        const isHorizontal = street.direction === 'horizontal';

        // Create a plane for the street label that lies flat on the road
        const labelWidth = Math.max(street.name.length * 0.8, 4);
        const labelHeight = 1.5;

        const label = BABYLON.MeshBuilder.CreatePlane(
            `streetLabel_${street.name}`,
            { width: labelWidth, height: labelHeight },
            this.scene
        );

        // Position flat on the road surface, slightly above to avoid z-fighting
        label.position.x = centerX;
        label.position.y = 0.15;
        label.position.z = centerZ;

        // Rotate to lie flat on ground and align with road direction
        label.rotation.x = Math.PI / 2; // Lie flat
        if (!isHorizontal) {
            label.rotation.z = Math.PI / 2; // Rotate for vertical streets
        }

        // Create dynamic texture for the street name
        const textureWidth = 512;
        const textureHeight = 96;
        const texture = new BABYLON.DynamicTexture(
            `streetLabelTexture_${street.name}`,
            { width: textureWidth, height: textureHeight },
            this.scene
        );
        texture.hasAlpha = true;

        const ctx = texture.getContext();
        ctx.clearRect(0, 0, textureWidth, textureHeight);
        ctx.font = 'bold 48px Arial';
        ctx.fillStyle = COLORS.roadLabel;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(street.name.toUpperCase(), textureWidth / 2, textureHeight / 2);
        texture.update();

        const material = new BABYLON.StandardMaterial(`streetLabelMat_${street.name}`, this.scene);
        material.diffuseTexture = texture;
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        material.emissiveTexture = texture; // Make it visible without lighting
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        label.material = material;

        this.streetLabels.push(label);
    }
}
