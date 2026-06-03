// tests/city/instanced-ad-panels.test.ts — Smoke tests for the instanced
// ad panel system (Tasks 16-17).

import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { InstancedAdPanels } from '@/city/components/buildings/adPanelsInstanced';
import {
  AdPanelTextureArray,
  PANEL_TEX_SIZE,
} from '@/city/components/buildings/adPanelTextureArray';
import { BLOOM } from '@/state/stores/settings/effects';
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
      size: 1024,
      lines: 0,
      binary: true,
      created: '',
      modified: '',
      git: { created: null, modified: null },
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
        size: 1,
        lines: 0,
        binary: true,
        created: '',
        modified: '',
        git: { created: null, modified: null },
      },
    });
    const b2 = fakeMediaBuilding({
      file: {
        path: 'b.jpg',
        name: 'b.jpg',
        type: NodeKind.File,
        fullPath: '/b.jpg',
        extension: '.jpg',
        size: 1,
        lines: 0,
        binary: true,
        created: '',
        modified: '',
        git: { created: null, modified: null },
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
          size: 1,
          lines: 0,
          binary: true,
          created: '',
          modified: '',
          git: { created: null, modified: null },
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
        size: 1,
        lines: 0,
        binary: true,
        created: '',
        modified: '',
        git: { created: null, modified: null },
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
        git: { created: null, modified: null },
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
          size: 2000,
          lines: 0,
          binary: true,
          created: '',
          modified: '',
          git: { created: null, modified: null },
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

describe('InstancedAdPanels emission refresh', () => {
  it('refresh() pushes BLOOM.AD_EMISSION into uEmissionBoost uniform', () => {
    const ads = new InstancedAdPanels(4);
    BLOOM.value = { ...BLOOM.value, AD_EMISSION: 2.5 };
    ads.refresh();
    const mat = ads.mesh.material as unknown as { uniforms: { uEmissionBoost: { value: number } } };
    expect(mat.uniforms.uEmissionBoost.value).toBeCloseTo(2.5);
  });
});
