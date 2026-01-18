# JavaScript Testing Infrastructure Design

## Overview

Add proper JavaScript unit tests using Vitest, replacing Python tests that used static source analysis to verify JS code patterns.

## Project Structure

```
src/codecity/app/
├── __tests__/                    # Vitest test directory
│   ├── setup.js                  # Global test setup, Babylon.js mocks
│   ├── city-renderer.test.js     # ~20-25 tests
│   ├── main.test.js              # ~15-20 tests
│   └── inspector.test.js         # ~8-10 tests
├── vitest.config.js              # Vitest configuration
├── package.json                  # Node dependencies (vitest, jsdom)
└── (existing JS files)
```

## Dependencies

- `vitest` - test runner (fast, ESM-native)
- `jsdom` - DOM environment for tests

## Babylon.js Mock Strategy

Create lightweight `BABYLON` global mock in `setup.js` that stubs all used classes:
- Vector3, Color3, Color4
- Scene, Engine
- ArcRotateCamera
- MeshBuilder (CreateBox, CreateGround, CreateCylinder, CreatePlane)
- StandardMaterial
- ActionManager, ExecuteCodeAction
- HemisphericLight, DirectionalLight
- ShadowGenerator
- DynamicTexture
- GUI.AdvancedDynamicTexture, GUI.TextBlock, GUI.Rectangle

Mocks track calls and return chainable objects to verify code calls Babylon correctly.

## Test Coverage

### city-renderer.test.js

**Color system:**
- `languageToHue()` - all 21 languages map to correct hue values
- `hslToRgb()` - pure function edge cases (0°, 180°, 360°, various S/L)
- `getBuildingColor()` - HSL from language, file age, modification recency

**Building rendering:**
- `renderBuilding()` - dimensions (height=LOC, width=avg line), position, material, metadata
- `updateBuilding()` - mesh properties update
- `removeBuilding()` - mesh disposal

**Street/district rendering:**
- `renderStreet()` - floor plate bounds and color
- `renderRoad()` - boundary lines at correct positions
- `renderSignpost()` - cylinder + plane with text

**Labels:**
- `createBuildingLabel()` - GUI TextBlock created and linked
- `updateLabelVisibility()` - show/hide based on camera distance

**Actions:**
- ActionManager setup with correct triggers
- Click handler passes correct building data

### main.test.js

**Camera setup:**
- `setupCamera()` - ArcRotateCamera position, zoom limits, angle limits

**Pointer events:**
- `onPointerDown()` - left click=pan, right click=rotate, Ctrl+left=rotate
- `onPointerMove()` - pan updates camera.target, rotate updates alpha/beta
- `onPointerUp()` - drag state cleared, pointer capture released
- `onPointerCancel()` - interrupted gestures handled

**Zoom:**
- `onWheel()` - scroll changes radius, respects limits, zooms toward cursor

**Cursor feedback:**
- 'grab' on idle, 'grabbing' during drag

**Context menu:**
- Right-click suppressed (preventDefault)

**WebSocket:**
- `connectWebSocket()` - correct URL
- `handleLiveUpdate()` - file_changed/added/deleted dispatch correctly

**Loading overlay:**
- `hideLoadingOverlay()` - overlay hidden after load

### inspector.test.js

**Show/hide:**
- `show(buildingData)` - panel visible, fields populated
- `hide()` - panel hidden

**Data formatting:**
- Date formatting
- Filename extraction from path

**Buttons:**
- Editor button - VS Code URL generated
- Remote URL button - show/hide based on config
- Close button - calls hide()

**Edge cases:**
- Missing optional fields
- Very long paths

## Justfile Changes

```just
test:
    uv run pytest
    npm --prefix src/codecity/app test

test-js:
    npm --prefix src/codecity/app test
```

## Python Test Cleanup

**Remove:**
- `src/codecity/app/tests/test_camera_controls.py` - replaced by JS tests

**Keep:**
- `src/codecity/app/tests/test_builder.py` - tests Python build process, not JS functionality

## Implementation Order

1. Add `package.json` with dependencies
2. Add `vitest.config.js`
3. Add `__tests__/setup.js` with Babylon.js mocks
4. Add `__tests__/city-renderer.test.js`
5. Add `__tests__/main.test.js`
6. Add `__tests__/inspector.test.js`
7. Update `justfile`
8. Delete `test_camera_controls.py`
9. Run `just test` to verify everything passes
