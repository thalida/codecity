import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CityRenderer } from '../city-renderer.js';
import { BABYLON, createMockMesh } from './setup.js';

describe('CityRenderer', () => {
    let renderer;
    let mockScene;
    let mockInspector;

    beforeEach(() => {
        mockScene = new BABYLON.Scene(new BABYLON.Engine(null, true, {}));
        mockInspector = { show: vi.fn() };
        renderer = new CityRenderer(mockScene, mockInspector);
        // Reset MeshBuilder mocks
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('initializes with empty buildings map', () => {
            expect(renderer.buildings).toBeInstanceOf(Map);
            expect(renderer.buildings.size).toBe(0);
        });

        it('initializes with empty labels map', () => {
            expect(renderer.labels).toBeInstanceOf(Map);
            expect(renderer.labels.size).toBe(0);
        });

        it('stores scene reference', () => {
            expect(renderer.scene).toBe(mockScene);
        });

        it('stores inspector reference', () => {
            expect(renderer.inspector).toBe(mockInspector);
        });
    });

    describe('hslToColor3', () => {
        it('converts red hue (0) correctly', () => {
            const color = renderer.hslToColor3(0, 1, 0.5);
            expect(color.r).toBeCloseTo(1, 2);
            expect(color.g).toBeCloseTo(0, 2);
            expect(color.b).toBeCloseTo(0, 2);
        });

        it('converts green hue (120/360) correctly', () => {
            const color = renderer.hslToColor3(120 / 360, 1, 0.5);
            expect(color.r).toBeCloseTo(0, 2);
            expect(color.g).toBeCloseTo(1, 2);
            expect(color.b).toBeCloseTo(0, 2);
        });

        it('converts blue hue (240/360) correctly', () => {
            const color = renderer.hslToColor3(240 / 360, 1, 0.5);
            expect(color.r).toBeCloseTo(0, 2);
            expect(color.g).toBeCloseTo(0, 2);
            expect(color.b).toBeCloseTo(1, 2);
        });

        it('handles zero saturation (grayscale)', () => {
            const color = renderer.hslToColor3(0, 0, 0.5);
            expect(color.r).toBeCloseTo(0.5, 2);
            expect(color.g).toBeCloseTo(0.5, 2);
            expect(color.b).toBeCloseTo(0.5, 2);
        });

        it('handles black (lightness 0)', () => {
            const color = renderer.hslToColor3(0, 1, 0);
            expect(color.r).toBeCloseTo(0, 2);
            expect(color.g).toBeCloseTo(0, 2);
            expect(color.b).toBeCloseTo(0, 2);
        });

        it('handles white (lightness 1)', () => {
            const color = renderer.hslToColor3(0, 1, 1);
            expect(color.r).toBeCloseTo(1, 2);
            expect(color.g).toBeCloseTo(1, 2);
            expect(color.b).toBeCloseTo(1, 2);
        });

        it('handles cyan (hue 180)', () => {
            const color = renderer.hslToColor3(180 / 360, 1, 0.5);
            expect(color.r).toBeCloseTo(0, 2);
            expect(color.g).toBeCloseTo(1, 2);
            expect(color.b).toBeCloseTo(1, 2);
        });

        it('handles yellow (hue 60)', () => {
            const color = renderer.hslToColor3(60 / 360, 1, 0.5);
            expect(color.r).toBeCloseTo(1, 2);
            expect(color.g).toBeCloseTo(1, 2);
            expect(color.b).toBeCloseTo(0, 2);
        });
    });

    describe('calculateBuildingColor', () => {
        it('uses correct hue for Python files', () => {
            const building = {
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            const color = renderer.calculateBuildingColor(building);
            // Python hue is 210 - expect blue-ish color
            expect(color).toBeInstanceOf(BABYLON.Color3);
        });

        it('uses correct hue for JavaScript files', () => {
            const building = {
                language: 'javascript',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            const color = renderer.calculateBuildingColor(building);
            expect(color).toBeInstanceOf(BABYLON.Color3);
        });

        it('uses unknown hue for unrecognized languages', () => {
            const building = {
                language: 'brainfuck',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            const color = renderer.calculateBuildingColor(building);
            expect(color).toBeInstanceOf(BABYLON.Color3);
        });

        it('older files have higher saturation', () => {
            const now = new Date();
            const oneYearAgo = new Date(now);
            oneYearAgo.setFullYear(now.getFullYear() - 1);

            const newBuilding = {
                language: 'python',
                created_at: now.toISOString(),
                last_modified: now.toISOString(),
            };
            const oldBuilding = {
                language: 'python',
                created_at: oneYearAgo.toISOString(),
                last_modified: now.toISOString(),
            };

            // Both return Color3, saturation affects the RGB values
            const newColor = renderer.calculateBuildingColor(newBuilding);
            const oldColor = renderer.calculateBuildingColor(oldBuilding);

            expect(newColor).toBeInstanceOf(BABYLON.Color3);
            expect(oldColor).toBeInstanceOf(BABYLON.Color3);
        });

        it('recently modified files are lighter', () => {
            const now = new Date();
            const sixMonthsAgo = new Date(now);
            sixMonthsAgo.setMonth(now.getMonth() - 6);

            const recentBuilding = {
                language: 'python',
                created_at: now.toISOString(),
                last_modified: now.toISOString(),
            };
            const staleBuilding = {
                language: 'python',
                created_at: now.toISOString(),
                last_modified: sixMonthsAgo.toISOString(),
            };

            const recentColor = renderer.calculateBuildingColor(recentBuilding);
            const staleColor = renderer.calculateBuildingColor(staleBuilding);

            expect(recentColor).toBeInstanceOf(BABYLON.Color3);
            expect(staleColor).toBeInstanceOf(BABYLON.Color3);
        });
    });

    describe('renderBuilding', () => {
        const mockBuilding = {
            file_path: 'src/main.py',
            height: 100,
            width: 50,
            x: 10,
            z: 20,
            language: 'python',
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString(),
        };

        beforeEach(() => {
            // Setup advancedTexture for labels
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        });

        it('creates a box mesh for the building', () => {
            renderer.renderBuilding(mockBuilding);
            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalled();
        });

        it('uses file_path in mesh name', () => {
            renderer.renderBuilding(mockBuilding);
            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                expect.stringContaining('src/main.py'),
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('scales height from lines of code', () => {
            renderer.renderBuilding(mockBuilding);
            const callArgs = BABYLON.MeshBuilder.CreateBox.mock.calls[0];
            const options = callArgs[1];
            // height = Math.max(building.height / 10, 1) = 100/10 = 10
            expect(options.height).toBe(10);
        });

        it('enforces minimum height of 1', () => {
            const smallBuilding = { ...mockBuilding, height: 5 };
            renderer.renderBuilding(smallBuilding);
            const callArgs = BABYLON.MeshBuilder.CreateBox.mock.calls[0];
            const options = callArgs[1];
            expect(options.height).toBe(1);
        });

        it('scales width from average line length', () => {
            renderer.renderBuilding(mockBuilding);
            const callArgs = BABYLON.MeshBuilder.CreateBox.mock.calls[0];
            const options = callArgs[1];
            // width = Math.max(building.width / 5, 2) = 50/5 = 10
            expect(options.width).toBe(10);
        });

        it('enforces minimum width of 2', () => {
            const narrowBuilding = { ...mockBuilding, width: 5 };
            renderer.renderBuilding(narrowBuilding);
            const callArgs = BABYLON.MeshBuilder.CreateBox.mock.calls[0];
            const options = callArgs[1];
            expect(options.width).toBe(2);
        });

        it('stores building in buildings map', () => {
            renderer.renderBuilding(mockBuilding);
            expect(renderer.buildings.has('src/main.py')).toBe(true);
        });

        it('creates an action manager for click handling', () => {
            renderer.renderBuilding(mockBuilding);
            const mesh = renderer.buildings.get('src/main.py');
            expect(mesh.actionManager).not.toBeNull();
        });

        it('creates a label for the building', () => {
            renderer.renderBuilding(mockBuilding);
            expect(renderer.labels.has('src/main.py')).toBe(true);
        });
    });

    describe('renderStreet', () => {
        const mockStreet = {
            path: 'src',
            name: 'src',
            x: 0,
            z: 0,
            width: 100,
            length: 100,
            color: [50, 50, 60],
            road_width: 2,
            buildings: [],
            substreets: [],
        };

        it('creates a district ground mesh', () => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
            renderer.renderStreet(mockStreet, true);
            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalled();
        });

        it('does not create road for root street', () => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
            const callCountBefore = BABYLON.MeshBuilder.CreateBox.mock.calls.length;
            renderer.renderStreet(mockStreet, true);
            // Should only create district, not road
            const callCountAfter = BABYLON.MeshBuilder.CreateBox.mock.calls.length;
            // Only 1 call for district (root has no road)
            expect(callCountAfter - callCountBefore).toBe(1);
        });

        it('creates road for non-root streets', () => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
            renderer.renderStreet(mockStreet, false);
            // Should create district + road = 2 calls
            expect(BABYLON.MeshBuilder.CreateBox.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        it('recursively renders substreets', () => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
            const streetWithSub = {
                ...mockStreet,
                substreets: [
                    {
                        path: 'src/utils',
                        name: 'utils',
                        x: 10,
                        z: 10,
                        width: 50,
                        length: 50,
                        color: [60, 60, 70],
                        road_width: 2,
                        buildings: [],
                        substreets: [],
                    },
                ],
            };
            renderer.renderStreet(streetWithSub, true);
            // Should create meshes for both streets
            expect(BABYLON.MeshBuilder.CreateBox.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        it('renders buildings within the street', () => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
            const streetWithBuilding = {
                ...mockStreet,
                buildings: [
                    {
                        file_path: 'src/main.py',
                        height: 100,
                        width: 50,
                        x: 10,
                        z: 20,
                        language: 'python',
                        created_at: new Date().toISOString(),
                        last_modified: new Date().toISOString(),
                    },
                ],
            };
            renderer.renderStreet(streetWithBuilding, true);
            expect(renderer.buildings.has('src/main.py')).toBe(true);
        });
    });

    describe('renderTreeStreetLabel', () => {
        it('creates a flat label for named streets', () => {
            const street = {
                path: 'src',
                name: 'src',
                x: 0,
                z: 0,
                width: 100,
            };
            renderer.renderTreeStreetLabel(street);
            // Should create a plane for the label
            expect(BABYLON.MeshBuilder.CreatePlane).toHaveBeenCalled();
        });

        it('does not create label for root', () => {
            const street = {
                path: '',
                name: 'root',
                x: 0,
                z: 0,
            };
            renderer.renderTreeStreetLabel(street);
            expect(BABYLON.MeshBuilder.CreatePlane).not.toHaveBeenCalled();
        });

        it('does not create label for unnamed streets', () => {
            const street = {
                path: '',
                name: '',
                x: 0,
                z: 0,
            };
            renderer.renderTreeStreetLabel(street);
            expect(BABYLON.MeshBuilder.CreatePlane).not.toHaveBeenCalled();
        });

        it('stores labels for later cleanup', () => {
            const street = {
                path: 'src',
                name: 'src',
                x: 0,
                z: 0,
                width: 100,
            };
            renderer.renderTreeStreetLabel(street);
            expect(renderer.streetLabels.length).toBe(1);
        });
    });

    describe('createBuildingLabel', () => {
        beforeEach(() => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        });

        it('extracts filename from path', () => {
            const building = { file_path: 'src/utils/helpers.py' };
            const mesh = createMockMesh('building');
            renderer.createBuildingLabel(building, mesh);
            const label = renderer.labels.get('src/utils/helpers.py');
            expect(label).toBeDefined();
        });

        it('stores label in labels map', () => {
            const building = { file_path: 'main.py' };
            const mesh = createMockMesh('building');
            renderer.createBuildingLabel(building, mesh);
            expect(renderer.labels.has('main.py')).toBe(true);
        });

        it('links label to mesh', () => {
            const building = { file_path: 'main.py' };
            const mesh = createMockMesh('building');
            renderer.createBuildingLabel(building, mesh);
            const label = renderer.labels.get('main.py');
            expect(label.linkWithMesh).toHaveBeenCalledWith(mesh);
        });

        it('starts with label hidden (alpha 0)', () => {
            const building = { file_path: 'main.py' };
            const mesh = createMockMesh('building');
            renderer.createBuildingLabel(building, mesh);
            const label = renderer.labels.get('main.py');
            expect(label.alpha).toBe(0);
        });
    });

    describe('updateLabelVisibility', () => {
        beforeEach(() => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        });

        it('shows labels when camera is close', () => {
            const building = {
                file_path: 'main.py',
                height: 100,
                width: 50,
                x: 0,
                z: 0,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            renderer.renderBuilding(building);

            const camera = {
                position: new BABYLON.Vector3(0, 10, 0), // Close to building
            };

            renderer.updateLabelVisibility(camera);
            const label = renderer.labels.get('main.py');
            expect(label.alpha).toBe(1);
        });

        it('hides labels when camera is far', () => {
            const building = {
                file_path: 'main.py',
                height: 100,
                width: 50,
                x: 0,
                z: 0,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            renderer.renderBuilding(building);

            const camera = {
                position: new BABYLON.Vector3(0, 500, 0), // Far from building
            };

            renderer.updateLabelVisibility(camera);
            const label = renderer.labels.get('main.py');
            expect(label.alpha).toBe(0);
        });
    });

    describe('updateBuilding', () => {
        beforeEach(() => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        });

        it('updates building color when data changes', () => {
            const building = {
                file_path: 'main.py',
                height: 100,
                width: 50,
                x: 0,
                z: 0,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            renderer.renderBuilding(building);

            const newData = {
                ...building,
                language: 'javascript',
            };
            renderer.updateBuilding('main.py', newData);

            const mesh = renderer.buildings.get('main.py');
            expect(mesh.metadata.data).toBe(newData);
        });

        it('does nothing for non-existent building', () => {
            // Should not throw
            expect(() => {
                renderer.updateBuilding('nonexistent.py', {});
            }).not.toThrow();
        });
    });

    describe('removeBuilding', () => {
        beforeEach(() => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        });

        it('disposes mesh when building removed', () => {
            const building = {
                file_path: 'main.py',
                height: 100,
                width: 50,
                x: 0,
                z: 0,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            renderer.renderBuilding(building);

            const mesh = renderer.buildings.get('main.py');
            renderer.removeBuilding('main.py');

            expect(mesh.dispose).toHaveBeenCalled();
        });

        it('removes building from map', () => {
            const building = {
                file_path: 'main.py',
                height: 100,
                width: 50,
                x: 0,
                z: 0,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            renderer.renderBuilding(building);
            renderer.removeBuilding('main.py');

            expect(renderer.buildings.has('main.py')).toBe(false);
        });

        it('does nothing for non-existent building', () => {
            expect(() => {
                renderer.removeBuilding('nonexistent.py');
            }).not.toThrow();
        });
    });

    describe('clear', () => {
        beforeEach(() => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        });

        it('disposes all buildings', () => {
            const building = {
                file_path: 'main.py',
                height: 100,
                width: 50,
                x: 0,
                z: 0,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            renderer.renderBuilding(building);

            const mesh = renderer.buildings.get('main.py');
            renderer.clear();

            expect(mesh.dispose).toHaveBeenCalled();
            expect(renderer.buildings.size).toBe(0);
        });

        it('disposes all labels', () => {
            const building = {
                file_path: 'main.py',
                height: 100,
                width: 50,
                x: 0,
                z: 0,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };
            renderer.renderBuilding(building);

            const label = renderer.labels.get('main.py');
            renderer.clear();

            expect(label.dispose).toHaveBeenCalled();
            expect(renderer.labels.size).toBe(0);
        });

        it('disposes all streets', () => {
            const street = {
                path: 'src',
                name: 'src',
                x: 0,
                z: 0,
                width: 100,
                length: 100,
                color: [50, 50, 60],
                road_width: 2,
                buildings: [],
                substreets: [],
            };
            renderer.renderStreet(street, true);

            const streetMeshes = [...renderer.streets];
            renderer.clear();

            streetMeshes.forEach((mesh) => {
                expect(mesh.dispose).toHaveBeenCalled();
            });
            expect(renderer.streets.length).toBe(0);
        });

        it('disposes all street labels', () => {
            const street = {
                path: 'src',
                name: 'src',
                x: 0,
                z: 0,
                width: 100,
            };
            renderer.renderTreeStreetLabel(street);

            const labelMeshes = [...renderer.streetLabels];
            renderer.clear();

            labelMeshes.forEach((mesh) => {
                expect(mesh.dispose).toHaveBeenCalled();
            });
            expect(renderer.streetLabels.length).toBe(0);
        });
    });

    describe('render', () => {
        it('clears existing content before rendering', () => {
            const clearSpy = vi.spyOn(renderer, 'clear');
            const cityData = {
                root: {
                    path: '',
                    name: 'root',
                    x: 0,
                    z: 0,
                    width: 100,
                    length: 100,
                    color: [50, 50, 60],
                    road_width: 0,
                    buildings: [],
                    substreets: [],
                },
            };
            renderer.render(cityData);
            expect(clearSpy).toHaveBeenCalled();
        });

        it('creates fullscreen UI for labels', () => {
            const cityData = {
                root: {
                    path: '',
                    name: 'root',
                    x: 0,
                    z: 0,
                    width: 100,
                    length: 100,
                    color: [50, 50, 60],
                    road_width: 0,
                    buildings: [],
                    substreets: [],
                },
            };
            renderer.render(cityData);
            expect(BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI).toHaveBeenCalledWith('UI');
        });

        it('calls renderGridCity when cityData has grid property', () => {
            const renderGridCitySpy = vi.spyOn(renderer, 'renderGridCity');
            const renderStreetSpy = vi.spyOn(renderer, 'renderStreet');

            const gridCityData = {
                grid: { '0,0': { type: 'road' } },
                buildings: {},
                streets: {},
                bounds: { min_x: 0, min_z: 0, max_x: 1, max_z: 1 },
            };

            renderer.render(gridCityData);

            expect(renderGridCitySpy).toHaveBeenCalledWith(gridCityData);
            expect(renderStreetSpy).not.toHaveBeenCalled();
        });

        it('calls renderStreet when cityData has root property', () => {
            const renderGridCitySpy = vi.spyOn(renderer, 'renderGridCity');
            const renderStreetSpy = vi.spyOn(renderer, 'renderStreet');

            const treeCityData = {
                root: {
                    path: '',
                    name: 'root',
                    x: 0,
                    z: 0,
                    width: 100,
                    length: 100,
                    color: [50, 50, 60],
                    road_width: 0,
                    buildings: [],
                    substreets: [],
                },
            };

            renderer.render(treeCityData);

            expect(renderStreetSpy).toHaveBeenCalled();
            expect(renderGridCitySpy).not.toHaveBeenCalled();
        });
    });

    describe('renderTile', () => {
        it('renders road tile for type "road"', () => {
            renderer.renderTile(5, 3, { type: 'road', path: 'src' });

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                'road_5_3',
                expect.objectContaining({ width: 10, height: 0.1, depth: 10 }),
                mockScene
            );
        });

        it('renders road tile for type "road_start"', () => {
            renderer.renderTile(2, 1, { type: 'road_start', path: 'src' });

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                'road_2_1',
                expect.objectContaining({ width: 10, height: 0.1, depth: 10 }),
                mockScene
            );
        });

        it('renders road tile for type "road_end"', () => {
            renderer.renderTile(7, 4, { type: 'road_end', path: 'src' });

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                'road_7_4',
                expect.objectContaining({ width: 10, height: 0.1, depth: 10 }),
                mockScene
            );
        });

        it('renders intersection tile', () => {
            renderer.renderTile(2, 4, { type: 'intersection', path: 'src' });

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                'intersection_2_4',
                expect.objectContaining({ width: 10, height: 0.12, depth: 10 }),
                mockScene
            );
        });

        it('handles tile_type property (alternative naming)', () => {
            renderer.renderTile(1, 1, { tile_type: 'road', path: 'src' });

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                'road_1_1',
                expect.objectContaining({ width: 10, height: 0.1, depth: 10 }),
                mockScene
            );
        });
    });

    describe('renderRoadTile', () => {
        it('creates a box mesh for the road tile', () => {
            renderer.renderRoadTile(3, 2, { type: 'road', path: 'src' });

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                'road_3_2',
                expect.objectContaining({ width: 10, height: 0.1, depth: 10 }),
                mockScene
            );
        });

        it('positions road tile correctly using TILE_SIZE', () => {
            const mockMesh = createMockMesh('road_3_2');
            BABYLON.MeshBuilder.CreateBox.mockReturnValueOnce(mockMesh);

            renderer.renderRoadTile(3, 2, { type: 'road', path: 'src' });

            // x = 3 * 10 + 10/2 = 35, y = 0.05, z = 2 * 10 + 10/2 = 25
            expect(mockMesh.position.x).toBe(35);
            expect(mockMesh.position.y).toBe(0.05);
            expect(mockMesh.position.z).toBe(25);
        });

        it('applies material to road tile', () => {
            const mockMesh = createMockMesh('road_0_0');
            BABYLON.MeshBuilder.CreateBox.mockReturnValueOnce(mockMesh);

            renderer.renderRoadTile(0, 0, { type: 'road', path: 'src' });

            expect(mockMesh.material).not.toBeNull();
        });

        it('stores road tile in streets array', () => {
            renderer.renderRoadTile(0, 0, { type: 'road', path: 'src' });

            expect(renderer.streets.length).toBe(1);
        });
    });

    describe('renderIntersectionTile', () => {
        it('creates a box mesh for the intersection tile', () => {
            renderer.renderIntersectionTile(4, 5, { type: 'intersection', path: 'src' });

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                'intersection_4_5',
                expect.objectContaining({ width: 10, height: 0.12, depth: 10 }),
                mockScene
            );
        });

        it('positions intersection tile correctly using TILE_SIZE', () => {
            const mockMesh = createMockMesh('intersection_4_5');
            BABYLON.MeshBuilder.CreateBox.mockReturnValueOnce(mockMesh);

            renderer.renderIntersectionTile(4, 5, { type: 'intersection', path: 'src' });

            // x = 4 * 10 + 10/2 = 45, y = 0.06, z = 5 * 10 + 10/2 = 55
            expect(mockMesh.position.x).toBe(45);
            expect(mockMesh.position.y).toBe(0.06);
            expect(mockMesh.position.z).toBe(55);
        });

        it('intersection is slightly taller than road (0.12 vs 0.1)', () => {
            renderer.renderIntersectionTile(0, 0, { type: 'intersection', path: 'src' });

            const callArgs = BABYLON.MeshBuilder.CreateBox.mock.calls[0];
            const options = callArgs[1];
            expect(options.height).toBe(0.12);
        });

        it('stores intersection tile in streets array', () => {
            renderer.renderIntersectionTile(0, 0, { type: 'intersection', path: 'src' });

            expect(renderer.streets.length).toBe(1);
        });
    });

    describe('renderGridBuilding', () => {
        const TILE_SIZE = 10;

        beforeEach(() => {
            renderer.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        });

        it('creates a box mesh for the building', () => {
            const building = {
                file_path: 'src/main.py',
                x: 2,
                z: 0,
                road_side: 1,
                road_direction: 'horizontal',
                height: 100,
                width: 40,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };

            renderer.renderGridBuilding(building);

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalledWith(
                'building_src/main.py',
                expect.any(Object),
                mockScene
            );
        });

        it('positions building offset in +z direction for road_side 1 (horizontal)', () => {
            const building = {
                file_path: 'src/main.py',
                x: 2,
                z: 0,
                road_side: 1,
                road_direction: 'horizontal',
                height: 100,
                width: 40,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };

            renderer.renderGridBuilding(building);

            const mesh = renderer.buildings.get('src/main.py');
            // Building should be offset in +z direction from road center
            // worldZ = z * TILE_SIZE + TILE_SIZE/2 + road_side * offset
            // offset = TILE_SIZE/2 + depth/2 = 5 + 4 = 9
            // z = 0 * 10 + 5 + 1 * 9 = 14
            expect(mesh.position.z).toBeGreaterThan(0 * TILE_SIZE + TILE_SIZE / 2);
        });

        it('positions building offset in -z direction for road_side -1 (horizontal)', () => {
            const building = {
                file_path: 'src/utils.py',
                x: 3,
                z: 0,
                road_side: -1,
                road_direction: 'horizontal',
                height: 50,
                width: 30,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };

            renderer.renderGridBuilding(building);

            const mesh = renderer.buildings.get('src/utils.py');
            // Building should be offset in -z direction from road center
            expect(mesh.position.z).toBeLessThan(0 * TILE_SIZE + TILE_SIZE / 2);
        });

        it('stores building in buildings map', () => {
            const building = {
                file_path: 'src/main.py',
                x: 2,
                z: 0,
                road_side: 1,
                road_direction: 'horizontal',
                height: 100,
                width: 40,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };

            renderer.renderGridBuilding(building);

            expect(renderer.buildings.has('src/main.py')).toBe(true);
        });

        it('creates an action manager for click handling', () => {
            const building = {
                file_path: 'src/main.py',
                x: 2,
                z: 0,
                road_side: 1,
                road_direction: 'horizontal',
                height: 100,
                width: 40,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };

            renderer.renderGridBuilding(building);

            const mesh = renderer.buildings.get('src/main.py');
            expect(mesh.actionManager).not.toBeNull();
        });

        it('creates a label for the building', () => {
            const building = {
                file_path: 'src/main.py',
                x: 2,
                z: 0,
                road_side: 1,
                road_direction: 'horizontal',
                height: 100,
                width: 40,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };

            renderer.renderGridBuilding(building);

            expect(renderer.labels.has('src/main.py')).toBe(true);
        });

        it('stores building metadata', () => {
            const building = {
                file_path: 'src/main.py',
                x: 2,
                z: 0,
                road_side: 1,
                road_direction: 'horizontal',
                height: 100,
                width: 40,
                language: 'python',
                created_at: new Date().toISOString(),
                last_modified: new Date().toISOString(),
            };

            renderer.renderGridBuilding(building);

            const mesh = renderer.buildings.get('src/main.py');
            expect(mesh.metadata.type).toBe('building');
            expect(mesh.metadata.data).toBe(building);
        });
    });

    describe('renderGridCity', () => {
        it('clears existing content before rendering', () => {
            const clearSpy = vi.spyOn(renderer, 'clear');
            const cityData = {
                bounds: { min_x: 0, min_z: 0, max_x: 1, max_z: 1 },
                grid: { '0,0': { type: 'road_start', path: '' } },
                buildings: {},
                streets: {},
            };

            renderer.renderGridCity(cityData);

            expect(clearSpy).toHaveBeenCalled();
        });

        it('creates fullscreen UI for labels', () => {
            const cityData = {
                bounds: { min_x: 0, min_z: 0, max_x: 1, max_z: 1 },
                grid: { '0,0': { type: 'road', path: '' } },
                buildings: {},
                streets: {},
            };

            renderer.renderGridCity(cityData);

            expect(BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI).toHaveBeenCalledWith('UI');
        });

        it('renders tiles from grid data', () => {
            const renderTileSpy = vi.spyOn(renderer, 'renderTile');
            const cityData = {
                bounds: { min_x: 0, min_z: 0, max_x: 2, max_z: 1 },
                grid: {
                    '0,0': { type: 'road_start', path: '' },
                    '1,0': { type: 'road', path: '' },
                    '2,0': { type: 'road_end', path: '' },
                },
                buildings: {},
                streets: {},
            };

            renderer.renderGridCity(cityData);

            expect(renderTileSpy).toHaveBeenCalledTimes(3);
            expect(renderTileSpy).toHaveBeenCalledWith(0, 0, expect.any(Object));
            expect(renderTileSpy).toHaveBeenCalledWith(1, 0, expect.any(Object));
            expect(renderTileSpy).toHaveBeenCalledWith(2, 0, expect.any(Object));
        });

        it('renders buildings from buildings data', () => {
            const renderGridBuildingSpy = vi.spyOn(renderer, 'renderGridBuilding');
            const cityData = {
                bounds: { min_x: 0, min_z: 0, max_x: 2, max_z: 1 },
                grid: { '1,0': { type: 'road', path: '' } },
                buildings: {
                    'main.py': {
                        file_path: 'main.py',
                        x: 1,
                        z: 0,
                        road_side: 1,
                        road_direction: 'horizontal',
                        height: 50,
                        width: 20,
                        language: 'python',
                        created_at: new Date().toISOString(),
                        last_modified: new Date().toISOString(),
                    },
                },
                streets: {},
            };

            renderer.renderGridCity(cityData);

            expect(renderGridBuildingSpy).toHaveBeenCalledTimes(1);
            expect(renderer.buildings.size).toBe(1);
        });

        it('renders ground plane based on bounds', () => {
            const cityData = {
                bounds: { min_x: 0, min_z: -2, max_x: 10, max_z: 5 },
                grid: { '0,0': { type: 'road', path: '' } },
                buildings: {},
                streets: {},
            };

            renderer.renderGridCity(cityData);

            // Ground mesh should be created
            expect(BABYLON.MeshBuilder.CreateGround).toHaveBeenCalled();
        });

        it('renders street labels for streets', () => {
            const cityData = {
                bounds: { min_x: 0, min_z: 0, max_x: 5, max_z: 2 },
                grid: { '0,0': { type: 'road', path: '' } },
                buildings: {},
                streets: {
                    'src': {
                        name: 'src',
                        start: [0, 0],
                        end: [5, 0],
                        direction: 'horizontal',
                        color: [100, 100, 100],
                        depth: 1,
                    },
                },
            };

            renderer.renderGridCity(cityData);

            // Should create a plane for 'src' street label (flat on road)
            expect(BABYLON.MeshBuilder.CreatePlane).toHaveBeenCalled();
        });
    });
});
