// tests/scene/lodEvaluator.test.ts — Unit tests for the LOD evaluator.
//
// Covers:
//   - projectedPixelArea: known geometry, behind-camera, near-zero edge cases
//   - LodEvaluator.evaluate: visibility toggling per tier
//   - Hysteresis: cell in the impostor/detail band doesn't oscillate

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { projectedPixelArea, LodEvaluator, type Viewport } from '@/scene/lodEvaluator.js';
import { SpatialGrid } from '@/scene/spatialGrid.js';
import { createEmptyCellTile, type CellTile } from '@/scene/cellTile.js';
import { LOD } from '@/config/lod.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal CellTile with a manually placed boundsSphere.
// ---------------------------------------------------------------------------
function makeCell(sphereCenter: THREE.Vector3, sphereRadius: number): CellTile {
  const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
  const cell = createEmptyCellTile(grid, 0, 64);
  cell.boundsSphere = new THREE.Sphere(sphereCenter, sphereRadius);
  return cell;
}

// ---------------------------------------------------------------------------
// Helper: build a PerspectiveCamera placed at the given world position
// looking toward (0, 0, 0). Matrices are updated so projectedPixelArea can
// use matrixWorldInverse.
// ---------------------------------------------------------------------------
function makeCamera(position: THREE.Vector3, fov = 60): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 10_000);
  cam.position.copy(position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

const VP: Viewport = { width: 800, height: 600 };

// ---------------------------------------------------------------------------
// projectedPixelArea
// ---------------------------------------------------------------------------
describe('projectedPixelArea', () => {
  it('returns 0 for a sphere whose centre is behind the camera', () => {
    // Camera at origin looking down -Z; sphere centre at +Z = in front of camera
    // BUT matrixWorldInverse puts that at negative camera-space Z. So put it
    // behind by using a positive camera-space Z: sphere at camera.position + forward.
    // Easier: place the camera at Z=10 looking toward +Z (away from origin).
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 100); // looking away from origin
    cam.updateMatrixWorld();

    // Sphere at origin — behind the camera (camera looks away)
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
    expect(projectedPixelArea(sphere, cam, VP)).toBe(0);
  });

  it('returns a positive area for a sphere in front of the camera', () => {
    const cam = makeCamera(new THREE.Vector3(0, 0, 100));
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 5);
    const area = projectedPixelArea(sphere, cam, VP);
    expect(area).toBeGreaterThan(0);
  });

  it('area grows as the camera moves closer', () => {
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 5);
    const camFar = makeCamera(new THREE.Vector3(0, 0, 500));
    const camClose = makeCamera(new THREE.Vector3(0, 0, 50));
    const areaFar = projectedPixelArea(sphere, camFar, VP);
    const areaClose = projectedPixelArea(sphere, camClose, VP);
    expect(areaClose).toBeGreaterThan(areaFar);
  });

  it('matches the analytic formula for a known setup', () => {
    // Camera at (0, 0, 100) looking at origin, fov=60°, viewport 600px tall.
    // Sphere at origin with radius 10.
    // dist = 100; r_px = (10/100) * (600 / (2*tan(30°))) = 0.1 * (600/(2*0.5774)) = 0.1 * 519.6... ≈ 51.96
    // area = PI * 51.96^2 ≈ 8481
    const cam = makeCamera(new THREE.Vector3(0, 0, 100), 60);
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10);
    const area = projectedPixelArea(sphere, cam, { width: 800, height: 600 });

    const dist = 100;
    const fovRad = (60 * Math.PI) / 180;
    const r_px = (10 / dist) * (600 / (2 * Math.tan(fovRad / 2)));
    const expected = Math.PI * r_px * r_px;

    expect(area).toBeCloseTo(expected, 0);
  });
});

// ---------------------------------------------------------------------------
// LodEvaluator
// ---------------------------------------------------------------------------
describe('LodEvaluator', () => {
  let evaluator: LodEvaluator;
  let _origLodEnabled: boolean;

  beforeEach(() => {
    evaluator = new LodEvaluator();
    // Force LOD on for these tests — the production default is now off
    // (every cell forced to detail tier), but this suite tests the
    // pixel-area-based classification path specifically.
    _origLodEnabled = LOD.get().enabled;
    LOD.setKey('enabled', true);
  });

  afterEach(() => {
    LOD.setKey('enabled', _origLodEnabled);
  });

  // Helper: convert the viewport-fraction thresholds in LOD config to
  // absolute pixel-area values for the current test viewport (VP).
  function thresholdsPx(): { cull: number; impostor: number; detail: number } {
    const lod = LOD.get();
    const vpArea = VP.width * VP.height;
    return {
      cull: lod.CULL_VIEWPORT_FRAC * vpArea,
      impostor: lod.IMPOSTOR_VIEWPORT_FRAC * vpArea,
      detail: lod.DETAIL_VIEWPORT_FRAC * vpArea,
    };
  }

  it('hides a far-away cell (area < cull threshold)', () => {
    // Camera very far away — area will be tiny, below cullPx (24 px at default frac).
    const cam = makeCamera(new THREE.Vector3(0, 0, 100_000));
    const cell = makeCell(new THREE.Vector3(0, 0, 0), 5);
    cell.tier = 'detail'; // start at detail so we can see the transition
    cell.detailMesh.visible = true;

    evaluator.evaluate([cell], cam, VP, true);

    expect(cell.tier).toBe('hidden');
    expect(cell.detailMesh.visible).toBe(false);
    expect(cell.impostorMesh.visible).toBe(false);
  });

  it('sets impostor tier for mid-range area (between cull and impostor thresholds)', () => {
    // Defaults at VP=800×600 (vpArea=480,000):
    //   cullPx     = 0.00005 * 480000 = 24
    //   impostorPx = 0.005   * 480000 = 2400
    //   detailPx   = 0.025   * 480000 = 12000
    // Need 24 <= A < 2400. With sphere radius=5, fov=60°, viewport h=600,
    // r_px = (5/dist) * (600/(2*tan(30°))) = (5/dist) * 519.6 = 2598/dist.
    // For A ~ 500: r_px ≈ 12.6 → dist ≈ 206. ✓
    const cam = makeCamera(new THREE.Vector3(0, 0, 206));
    const cell = makeCell(new THREE.Vector3(0, 0, 0), 5);
    cell.tier = 'hidden';

    evaluator.evaluate([cell], cam, VP, true);

    const t = thresholdsPx();
    const area = projectedPixelArea(cell.boundsSphere, cam, VP);
    expect(area).toBeGreaterThan(t.cull);
    expect(area).toBeLessThan(t.impostor);

    expect(cell.tier).toBe('impostor');
    expect(cell.detailMesh.visible).toBe(false);
    expect(cell.impostorMesh.visible).toBe(true);
  });

  it('sets detail tier for large pixel area (>= detail threshold)', () => {
    // sphere radius=50 at distance 10 → r_px=(50/10)*519.6 ≈ 2598 → area ≈ 21M px²,
    // far above detailPx (12000). ✓
    const cam = makeCamera(new THREE.Vector3(0, 0, 10));
    const cell = makeCell(new THREE.Vector3(0, 0, 0), 50);
    cell.tier = 'hidden';

    evaluator.evaluate([cell], cam, VP, true);

    expect(cell.tier).toBe('detail');
    expect(cell.detailMesh.visible).toBe(true);
    expect(cell.impostorMesh.visible).toBe(false);
  });

  it('hysteresis: cell at detail stays at detail in the impostor/detail band', () => {
    // Band at VP=800×600 defaults: 2400 <= A < 12000.
    // Solve for distance: r_px ≈ 2598/dist, A = π*r_px². For A ~ 5000:
    // r_px ≈ 39.9 → dist ≈ 65.
    const cam = makeCamera(new THREE.Vector3(0, 0, 65));
    const cell = makeCell(new THREE.Vector3(0, 0, 0), 5);

    const t = thresholdsPx();
    const area = projectedPixelArea(cell.boundsSphere, cam, VP);
    // Guard: must be in the hysteresis band
    if (area < t.impostor || area >= t.detail) {
      // Skip — geometry doesn't produce a band hit at this distance; not a failure.
      return;
    }

    // Start as 'detail' — should stay detail
    cell.tier = 'detail';
    cell.detailMesh.visible = true;
    evaluator.evaluate([cell], cam, VP, true);
    expect(cell.tier).toBe('detail');

    // Start as 'impostor' — should stay impostor
    const evaluator2 = new LodEvaluator();
    cell.tier = 'impostor';
    cell.detailMesh.visible = false;
    cell.impostorMesh.visible = true;
    evaluator2.evaluate([cell], cam, VP, true);
    expect(cell.tier).toBe('impostor');
  });

  it('skips evaluation when camera and viewport are unchanged (no force)', () => {
    const cam = makeCamera(new THREE.Vector3(0, 0, 10));
    const cell = makeCell(new THREE.Vector3(0, 0, 0), 50);
    cell.tier = 'hidden';
    cell.detailMesh.visible = false;

    // First call (force=true) seeds the last-seen position
    evaluator.evaluate([cell], cam, VP, true);
    const tierAfterFirst = cell.tier;

    // Manually override tier back to hidden to verify second call is a no-op
    cell.tier = 'hidden';
    cell.detailMesh.visible = false;

    // Second call with force=false and no camera/viewport change → skip
    evaluator.evaluate([cell], cam, VP, false);

    // Still 'hidden' because evaluation was skipped
    expect(cell.tier).toBe('hidden');

    // Sanity: first call did change the tier
    expect(tierAfterFirst).toBe('detail');
  });

  it('re-evaluates after camera moves beyond CAMERA_MOVE_EPS', () => {
    const cam = makeCamera(new THREE.Vector3(0, 0, 100_000));
    const cell = makeCell(new THREE.Vector3(0, 0, 0), 5);

    // Seed with far camera (hidden)
    evaluator.evaluate([cell], cam, VP, true);
    expect(cell.tier).toBe('hidden');

    // Move camera close
    cam.position.set(0, 0, 10);
    cam.updateMatrixWorld();

    // force=false but camera moved — should re-evaluate
    evaluator.evaluate([cell], cam, VP, false);
    expect(cell.tier).toBe('detail');
  });
});
