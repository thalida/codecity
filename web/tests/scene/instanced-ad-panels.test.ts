// tests/scene/instanced-ad-panels.test.ts — Smoke tests for the instanced
// ad panel system (Tasks 16-17).

import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { InstancedAdPanels } from '@/scene/instanced/adPanelsInstanced.js';
import { BuildingOrient, NodeKind } from '@/types/index.js';
import type { Building } from '@/types/index.js';

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
      git: null,
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

    const b1 = fakeMediaBuilding({ file: { path: 'a.png', name: 'a.png', type: NodeKind.File, fullPath: '/a.png', extension: '.png', size: 1, lines: 0, binary: true, created: '', modified: '', git: null } });
    const b2 = fakeMediaBuilding({ file: { path: 'b.jpg', name: 'b.jpg', type: NodeKind.File, fullPath: '/b.jpg', extension: '.jpg', size: 1, lines: 0, binary: true, created: '', modified: '', git: null } });

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
          git: null,
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
        git: null,
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
        git: null,
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

    ads.registerMediaBuilding(fakeMediaBuilding({
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
        git: null,
      },
    }));
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
