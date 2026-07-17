// tests/city/components/buildings/adPanels.test.ts — Smoke tests for the instanced
// ad panel system (introduced in the #21 cell-render migration).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InstancedAdPanels } from '@/city/components/buildings/adPanels';
import {
  AdPanelTextureArray,
  MAX_PAGES,
  PANEL_TEX_SIZE,
} from '@/city/components/buildings/adPanelTextureArray';
import { BLOOM } from '@/state/stores/settings/effects';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { BuildingOrient, NodeKind } from '@/types/index';
import type { Building } from '@/types/index';

// ---------------------------------------------------------------------------
// Minimal Building fixture — only the fields read by registerMediaBuilding.
// ---------------------------------------------------------------------------

function fakeMediaBuilding(overrides: Partial<Building> = {}): Building {
  return {
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? 4,
    d: overrides.d ?? 4,
    h: overrides.h ?? 8,
    color: overrides.color ?? '#ff00ff',
    orient: overrides.orient ?? BuildingOrient.South,
    floors: overrides.floors ?? 2,
    createdAge: overrides.createdAge ?? 0,
    modifiedAge: overrides.modifiedAge ?? 0,
    file: overrides.file ?? {
      path: 'photo.png',
      name: 'photo.png',
      type: NodeKind.File,
      fullPath: '/abs/photo.png',
      extension: '.png',
      mediaKind: 'image',
      size: 1024,
      lines: 0,
      binary: true,
      created: '',
      modified: '',
    },
  } as Building;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstancedAdPanels', () => {
  it('registerMediaBuilding returns layer 0 and 4 panel slots for the first building', () => {
    const ads = new InstancedAdPanels(4);
    const b = fakeMediaBuilding();

    const reg = ads.registerMediaBuilding(b);

    expect(reg).not.toBeNull();
    expect(reg!.layer).toBe(0);
    expect(reg!.panelSlots).toHaveLength(4);
    // Slots should be contiguous starting at 0.
    expect(reg!.panelSlots).toEqual([0, 1, 2, 3]);
  });

  it('registerMediaBuilding increments layer for each new building', () => {
    const ads = new InstancedAdPanels(4);

    const b1 = fakeMediaBuilding({
      file: {
        path: 'a.png',
        name: 'a.png',
        type: NodeKind.File,
        fullPath: '/a.png',
        extension: '.png',
        mediaKind: 'image',
        size: 1,
        lines: 0,
        binary: true,
        created: '',
        modified: '',
      },
    });
    const b2 = fakeMediaBuilding({
      file: {
        path: 'b.jpg',
        name: 'b.jpg',
        type: NodeKind.File,
        fullPath: '/b.jpg',
        extension: '.jpg',
        mediaKind: 'image',
        size: 1,
        lines: 0,
        binary: true,
        created: '',
        modified: '',
      },
    });

    const reg1 = ads.registerMediaBuilding(b1);
    const reg2 = ads.registerMediaBuilding(b2);

    expect(reg1!.layer).toBe(0);
    expect(reg2!.layer).toBe(1);
    // Slots should follow: building1 gets [0,1,2,3], building2 gets [4,5,6,7].
    expect(reg1!.panelSlots).toEqual([0, 1, 2, 3]);
    expect(reg2!.panelSlots).toEqual([4, 5, 6, 7]);
  });

  it('registerMediaBuilding returns null on capacity overflow (5th building when capacity=4)', () => {
    const ads = new InstancedAdPanels(4);

    for (let i = 0; i < 4; i++) {
      const b = fakeMediaBuilding({
        file: {
          path: `img${i}.png`,
          name: `img${i}.png`,
          type: NodeKind.File,
          fullPath: `/img${i}.png`,
          extension: '.png',
          mediaKind: 'image',
          size: 1,
          lines: 0,
          binary: true,
          created: '',
          modified: '',
        },
      });
      const reg = ads.registerMediaBuilding(b);
      expect(reg).not.toBeNull();
    }

    // 5th building — capacity exhausted.
    const overflow = fakeMediaBuilding({
      file: {
        path: 'overflow.png',
        name: 'overflow.png',
        type: NodeKind.File,
        fullPath: '/overflow.png',
        extension: '.png',
        mediaKind: 'image',
        size: 1,
        lines: 0,
        binary: true,
        created: '',
        modified: '',
      },
    });
    const reg = ads.registerMediaBuilding(overflow);
    expect(reg).toBeNull();
  });

  it('registerMediaBuilding returns null for a non-media building', () => {
    const ads = new InstancedAdPanels(4);
    const b = fakeMediaBuilding({
      file: {
        path: 'main.ts',
        name: 'main.ts',
        type: NodeKind.File,
        fullPath: '/main.ts',
        extension: '.ts',
        size: 500,
        lines: 100,
        binary: false,
        created: '',
        modified: '',
      },
    });

    const reg = ads.registerMediaBuilding(b);
    expect(reg).toBeNull();
  });

  it('mesh.count grows to reflect the total number of registered panel slots', () => {
    const ads = new InstancedAdPanels(4);

    expect(ads.mesh.count).toBe(0);

    ads.registerMediaBuilding(fakeMediaBuilding());
    expect(ads.mesh.count).toBe(4); // 1 building × 4 faces

    ads.registerMediaBuilding(
      fakeMediaBuilding({
        file: {
          path: 'b.mp4',
          name: 'b.mp4',
          type: NodeKind.File,
          fullPath: '/b.mp4',
          extension: '.mp4',
          mediaKind: 'video',
          size: 2000,
          lines: 0,
          binary: true,
          created: '',
          modified: '',
        },
      })
    );
    expect(ads.mesh.count).toBe(8); // 2 buildings × 4 faces
  });

  it('mesh has meshKind=adPanel in userData', () => {
    const ads = new InstancedAdPanels(4);
    expect(ads.mesh.userData.meshKind).toBe('adPanel');
  });

  it('ad panels are not pickable (raycast is a no-op)', () => {
    const ads = new InstancedAdPanels(4);
    // raycast should be overridden to a no-op function.
    const intersects: THREE.Intersection[] = [];
    // Call raycast — should not throw and should leave intersects empty.
    // We pass null as raycaster since the override ignores all arguments.
    ads.mesh.raycast(null as unknown as THREE.Raycaster, intersects);
    expect(intersects).toHaveLength(0);
  });

  it('dispose does not throw', () => {
    const ads = new InstancedAdPanels(4);
    ads.registerMediaBuilding(fakeMediaBuilding());
    expect(() => ads.dispose()).not.toThrow();
  });
});

describe('AdPanelTextureArray storage', () => {
  // Regression: a media-heavy repo (Infisical: 2,604 media files →
  // adCapacity ≈ 3,906) previously triggered V8 `RangeError: Array buffer
  // allocation failed` because the constructor pre-allocated
  // PANEL_TEX_SIZE² × 4 × capacity bytes on the CPU. With the old 512px
  // size that was ~3.81 GB. The texture data is uploaded layer-by-layer
  // via the renderer; the contiguous CPU buffer is never needed.
  it('does not pre-allocate a contiguous CPU buffer for any page', () => {
    const arr = new AdPanelTextureArray(4000);
    for (const tex of arr.textures) {
      expect(tex.image.data).toBeNull();
    }
  });

  it('keeps PANEL_TEX_SIZE small enough that even thousands of layers fit in GPU memory', () => {
    // 128² × 4 × 4000 ≈ 244 MB — comfortably under V8 / WebGL limits.
    // If this constant ever creeps up, recompute the worst-case allocation.
    expect(PANEL_TEX_SIZE).toBeLessThanOrEqual(128);
  });

  // Regression: a single DataArrayTexture's depth is capped at the
  // hardware's MAX_ARRAY_TEXTURE_LAYERS (typical: 2048; spec minimum:
  // 256). Infisical's ~3.9k capacity exceeded that on the user's GPU,
  // causing texStorage3D to fail. AdPanelTextureArray now pages across
  // multiple DataArrayTextures so every requested layer is renderable.
  it('pages capacity across multiple DataArrayTextures when it exceeds the per-page limit', () => {
    // In the test env, _detectMaxArrayLayers falls back to 256 (no
    // WebGL2 context). Requesting 1000 layers should produce
    // ceil(1000 / 256) = 4 pages.
    const arr = new AdPanelTextureArray(1000);
    expect(arr.textures.length).toBeGreaterThan(1);
    const totalDepth = arr.textures.reduce((sum, tex) => sum + (tex.image.depth ?? 0), 0);
    expect(totalDepth).toBe(1000);
  });

  it('pads shaderTextures to MAX_PAGES for the fixed-size shader sampler array', () => {
    const arr = new AdPanelTextureArray(1);
    // shaderTextures must be exactly MAX_PAGES long regardless of how
    // many pages are actually in use — the shader's uPanelArrays uniform
    // is declared at MAX_PAGES and every slot needs a bound sampler.
    expect(arr.shaderTextures.length).toBe(8);
  });
});

describe('InstancedAdPanels distance LOD (updateLOD)', () => {
  // A large media building at the origin. viewportHeightPx fixed at 800. A
  // no-op onStartLoad keeps updateLOD's visibility logic from firing real
  // image loads (fetch/decode) during these visibility-only tests.
  function adsAtOrigin(): InstancedAdPanels {
    const ads = new InstancedAdPanels(4, { onStartLoad: () => {} });
    ads.registerMediaBuilding(
      fakeMediaBuilding({ x: 0, y: 0, w: 12, d: 12, h: 24 })
    );
    return ads;
  }
  const VIEWPORT_H = 800;

  function cameraAt(x: number, y: number, z: number): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
    cam.position.set(x, y, z);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
  }

  it('keeps panels visible when the camera is close (panels project large)', () => {
    const ads = adsAtOrigin();
    ads.updateLOD(cameraAt(0, 30, 40), VIEWPORT_H);
    expect(ads.mesh.visible).toBe(true);
  });

  it('hides panels when zoomed far out (panels project sub-pixel) — kills overdraw', () => {
    const ads = adsAtOrigin();
    ads.updateLOD(cameraAt(0, 4000, 5000), VIEWPORT_H);
    expect(ads.mesh.visible).toBe(false);
  });

  it('re-shows panels when the camera zooms back in', () => {
    const ads = adsAtOrigin();
    ads.updateLOD(cameraAt(0, 4000, 5000), VIEWPORT_H);
    expect(ads.mesh.visible).toBe(false);
    ads.updateLOD(cameraAt(0, 30, 40), VIEWPORT_H);
    expect(ads.mesh.visible).toBe(true);
  });

  it('is a no-op with no registered panels (nothing to draw either way)', () => {
    const ads = new InstancedAdPanels(4);
    expect(() => ads.updateLOD(cameraAt(0, 5000, 5000), VIEWPORT_H)).not.toThrow();
  });

  it('does not toggle visibility when the viewport height is unknown (0)', () => {
    const ads = adsAtOrigin();
    // A close camera would normally show; a 0 viewport must leave state untouched.
    ads.mesh.visible = false;
    ads.updateLOD(cameraAt(0, 30, 40), 0);
    expect(ads.mesh.visible).toBe(false);
  });
});

describe('InstancedAdPanels visibility-gated loading', () => {
  const VIEWPORT_H = 800;
  function mediaAt(path: string, x: number, y: number): Building {
    return fakeMediaBuilding({
      x, y, w: 12, d: 12, h: 24,
      file: {
        path, name: path, type: NodeKind.File, fullPath: `/${path}`, extension: '.png',
        mediaKind: 'image', size: 1, lines: 0, binary: true, created: '', modified: '',
      },
    });
  }
  function cameraAt(x: number, y: number, z: number): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
    cam.position.set(x, y, z);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
  }

  it('registerMediaBuilding does NOT start a load on its own (no eager burst)', () => {
    const started: string[] = [];
    const ads = new InstancedAdPanels(64, { onStartLoad: (b) => started.push(b.file!.path) });
    ads.registerMediaBuilding(mediaAt('a.png', 0, 0));
    ads.registerMediaBuilding(mediaAt('b.png', 5, 5));
    expect(started).toEqual([]);
  });

  it('starts loads only for panels inside the camera frustum', () => {
    const started: string[] = [];
    const ads = new InstancedAdPanels(64, { onStartLoad: (b) => started.push(b.file!.path) });
    ads.registerMediaBuilding(mediaAt('near.png', 0, 0)); // at origin, in view
    ads.registerMediaBuilding(mediaAt('far.png', 8000, 8000)); // far off to the side
    // Camera close above origin, looking down — origin is framed, far is not.
    ads.updateLOD(cameraAt(0, 30, 40), VIEWPORT_H);
    expect(started).toContain('near.png');
    expect(started).not.toContain('far.png');
  });

  it('spreads starts across frames via a per-frame budget', () => {
    const started: string[] = [];
    const ads = new InstancedAdPanels(64, { onStartLoad: (b) => started.push(b.file!.path) });
    // 12 clustered media buildings, all in view.
    for (let i = 0; i < 12; i++) ads.registerMediaBuilding(mediaAt(`m${i}.png`, (i % 4) - 2, Math.floor(i / 4) - 1));
    const cam = cameraAt(0, 40, 40);
    ads.updateLOD(cam, VIEWPORT_H);
    const afterFrame1 = started.length;
    expect(afterFrame1).toBeGreaterThan(0);
    expect(afterFrame1).toBeLessThan(12); // budgeted — not all at once
    // Subsequent frames drain the rest, and nothing is started twice.
    for (let f = 0; f < 12; f++) ads.updateLOD(cam, VIEWPORT_H);
    expect(started.length).toBe(12);
    expect(new Set(started).size).toBe(12);
  });

  it('does not start loads while zoomed out (mesh hidden — nothing visible to load)', () => {
    const started: string[] = [];
    const ads = new InstancedAdPanels(64, { onStartLoad: (b) => started.push(b.file!.path) });
    ads.registerMediaBuilding(mediaAt('a.png', 0, 0));
    ads.updateLOD(cameraAt(0, 40000, 50000), VIEWPORT_H); // way out → mesh hidden
    expect(ads.mesh.visible).toBe(false);
    expect(started).toEqual([]);
  });
});

describe('InstancedAdPanels emission refresh', () => {
  it('refresh() pushes BUILDINGS.AD_EMISSION into uEmissionBoost uniform', () => {
    const ads = new InstancedAdPanels(4);
    BLOOM.value = { ...BLOOM.value, ENABLED: true };
    BUILDINGS.value = { ...BUILDINGS.value, AD_EMISSION: 2.5 };
    ads.refresh();
    const mat = ads.mesh.material as unknown as { uniforms: { uEmissionBoost: { value: number } } };
    expect(mat.uniforms.uEmissionBoost.value).toBeCloseTo(2.5);
  });
});

describe('sampleLayer page dispatch', () => {
  // The page count lives in exactly one place (MAX_PAGES → the
  // AD_PANEL_MAX_PAGES #define). GLSL ES 3.00 / WebGL2 forbids indexing a
  // sampler array with a non-constant expression, so the shader MUST
  // dispatch with constant indices (`uPanelArrays[0]`, `[1]`, …) gated by
  // `#if AD_PANEL_MAX_PAGES > N` — never a runtime/loop index, which fails
  // to compile on real drivers (vitest can't compile GLSL, so guard the
  // source shape here).
  it('dispatches over the sampler array with constant indices', () => {
    const ads = new InstancedAdPanels(4);
    const mat = ads.mesh.material as unknown as {
      defines: Record<string, unknown>;
      fragmentShader: string;
    };
    expect(mat.defines.AD_PANEL_MAX_PAGES).toBe(MAX_PAGES);
    expect(mat.fragmentShader).toContain('if (page == 0) return texture(uPanelArrays[0], p);');
    expect(mat.fragmentShader).toContain('#if AD_PANEL_MAX_PAGES > 0');
    // Regression guard: a dynamic sampler index won't compile in WebGL2.
    expect(mat.fragmentShader).not.toContain('uPanelArrays[i]');
  });
});
