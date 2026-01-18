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
        this.signposts = [];
    }

    render(cityData) {
        this.clear();
        this.renderStreet(cityData.root, true);
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

        for (const signpost of this.signposts) {
            signpost.dispose();
        }
        this.signposts = [];
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

        // Render signpost
        this.renderSignpost(street);

        // Render sub-streets
        for (const substreet of street.substreets) {
            this.renderStreet(substreet, false);
        }
    }

    renderSignpost(street) {
        if (!street.name || street.name === 'root') return;

        // Create post
        const post = BABYLON.MeshBuilder.CreateCylinder(
            `signpost_post_${street.path}`,
            { height: 3, diameter: 0.2 },
            this.scene
        );
        post.position.x = street.x + 1;
        post.position.y = 1.5;
        post.position.z = street.z - 1;

        const postMat = new BABYLON.StandardMaterial(`signpostMat_${street.path}`, this.scene);
        postMat.diffuseColor = new BABYLON.Color3(0.3, 0.25, 0.2);
        postMat.specularColor = new BABYLON.Color3(0, 0, 0);
        post.material = postMat;

        // Create sign plane with text
        const sign = BABYLON.MeshBuilder.CreatePlane(
            `signpost_sign_${street.path}`,
            { width: Math.max(street.name.length * 0.4, 2), height: 0.8 },
            this.scene
        );
        sign.position.x = street.x + 1 + Math.max(street.name.length * 0.2, 1);
        sign.position.y = 2.8;
        sign.position.z = street.z - 1;
        sign.rotation.y = Math.PI / 2;

        // Create dynamic texture for text
        const textureWidth = Math.max(street.name.length * 40, 128);
        const texture = new BABYLON.DynamicTexture(
            `signTexture_${street.path}`,
            { width: textureWidth, height: 64 },
            this.scene
        );
        texture.hasAlpha = true;

        const ctx = texture.getContext();
        ctx.fillStyle = 'rgba(40, 40, 45, 0.9)';
        ctx.fillRect(0, 0, textureWidth, 64);
        ctx.font = 'bold 32px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(street.name, textureWidth / 2, 44);
        texture.update();

        const signMat = new BABYLON.StandardMaterial(`signMat_${street.path}`, this.scene);
        signMat.diffuseTexture = texture;
        signMat.specularColor = new BABYLON.Color3(0, 0, 0);
        signMat.backFaceCulling = false;
        sign.material = signMat;

        this.signposts.push(post);
        this.signposts.push(sign);
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
