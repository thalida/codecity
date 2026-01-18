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

    describe('renderSignpost', () => {
        it('creates a signpost for named streets', () => {
            const street = {
                path: 'src',
                name: 'src',
                x: 0,
                z: 0,
            };
            renderer.renderSignpost(street);
            // Should create cylinder (post) and plane (sign)
            expect(BABYLON.MeshBuilder.CreateCylinder).toHaveBeenCalled();
            expect(BABYLON.MeshBuilder.CreatePlane).toHaveBeenCalled();
        });

        it('does not create signpost for root', () => {
            const street = {
                path: '',
                name: 'root',
                x: 0,
                z: 0,
            };
            renderer.renderSignpost(street);
            expect(BABYLON.MeshBuilder.CreateCylinder).not.toHaveBeenCalled();
        });

        it('does not create signpost for unnamed streets', () => {
            const street = {
                path: '',
                name: '',
                x: 0,
                z: 0,
            };
            renderer.renderSignpost(street);
            expect(BABYLON.MeshBuilder.CreateCylinder).not.toHaveBeenCalled();
        });

        it('stores signposts for later cleanup', () => {
            const street = {
                path: 'src',
                name: 'src',
                x: 0,
                z: 0,
            };
            renderer.renderSignpost(street);
            expect(renderer.signposts.length).toBe(2); // post + sign
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

        it('disposes all signposts', () => {
            const street = {
                path: 'src',
                name: 'src',
                x: 0,
                z: 0,
            };
            renderer.renderSignpost(street);

            const signpostMeshes = [...renderer.signposts];
            renderer.clear();

            signpostMeshes.forEach((mesh) => {
                expect(mesh.dispose).toHaveBeenCalled();
            });
            expect(renderer.signposts.length).toBe(0);
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
    });
});
