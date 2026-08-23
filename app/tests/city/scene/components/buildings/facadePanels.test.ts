import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { InstancedFacadePanels } from '@/city/scene/components/buildings/facadePanels';
import {
  FacadePanelTextureArray,
  MAX_PAGES,
  PANEL_TEX_SIZE,
} from '@/city/scene/components/buildings/facadePanelTextureArray';
import { BLOOM } from '@/city/session/settings/effects';
import { BUILDINGS } from '@/city/session/settings/buildings';
import { NodeKind } from '@/types';
import { BuildingOrient } from '@/city/scene/types';
import type { Building } from '@/city/scene/types';
import { TEST_SOURCE } from '../../../../_helpers/manifestFixtures';
import { makeBundle } from '../../../../_helpers/scrub';
import type { TimelineBundle } from '@/types';
import { makeSession } from '../../../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

// Only the fields registerMediaBuilding reads.
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

describe('InstancedFacadePanels', () => {
  it('registerMediaBuilding returns layer 0 and 4 panel slots for the first building', () => {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    const b = fakeMediaBuilding();

    const reg = ads.registerMediaBuilding(b);

    expect(reg).not.toBeNull();
    expect(reg!.layer).toBe(0);
    expect(reg!.panelSlots).toHaveLength(4);
    // Slots should be contiguous starting at 0.
    expect(reg!.panelSlots).toEqual([0, 1, 2, 3]);
  });

  it('registerMediaBuilding increments layer for each new building', () => {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);

    const b1 = fakeMediaBuilding({
      file: {
        path: 'a.png',
        name: 'a.png',
        type: NodeKind.File,
        extension: '.png',
        mediaKind: 'image',
        size: 1,
        lines: 0,
        binary: true,
        dirty: false,
        created: '',
        modified: '',
      },
    });
    const b2 = fakeMediaBuilding({
      file: {
        path: 'b.jpg',
        name: 'b.jpg',
        type: NodeKind.File,
        extension: '.jpg',
        mediaKind: 'image',
        size: 1,
        lines: 0,
        binary: true,
        dirty: false,
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
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);

    for (let i = 0; i < 4; i++) {
      const b = fakeMediaBuilding({
        file: {
          path: `img${i}.png`,
          name: `img${i}.png`,
          type: NodeKind.File,
          extension: '.png',
          mediaKind: 'image',
          size: 1,
          lines: 0,
          binary: true,
          dirty: false,
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
        extension: '.png',
        mediaKind: 'image',
        size: 1,
        lines: 0,
        binary: true,
        dirty: false,
        created: '',
        modified: '',
      },
    });
    const reg = ads.registerMediaBuilding(overflow);
    expect(reg).toBeNull();
  });

  it('registerMediaBuilding returns null for a non-media building', () => {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    const b = fakeMediaBuilding({
      file: {
        path: 'main.ts',
        name: 'main.ts',
        type: NodeKind.File,
        extension: '.ts',
        size: 500,
        lines: 100,
        binary: false,
        dirty: false,
        created: '',
        modified: '',
      },
    });

    const reg = ads.registerMediaBuilding(b);
    expect(reg).toBeNull();
  });

  it('mesh.count grows to reflect the total number of registered panel slots', () => {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);

    expect(ads.mesh.count).toBe(0);

    ads.registerMediaBuilding(fakeMediaBuilding());
    expect(ads.mesh.count).toBe(4); // 1 building × 4 faces

    ads.registerMediaBuilding(
      fakeMediaBuilding({
        file: {
          path: 'b.mp4',
          name: 'b.mp4',
          type: NodeKind.File,
          extension: '.mp4',
          mediaKind: 'video',
          size: 2000,
          lines: 0,
          binary: true,
          dirty: false,
          created: '',
          modified: '',
        },
      })
    );
    expect(ads.mesh.count).toBe(8); // 2 buildings × 4 faces
  });

  it('mesh has meshKind=adPanel in userData', () => {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    expect(ads.mesh.userData.meshKind).toBe('facadePanel');
  });

  it('ad panels are not pickable (raycast is a no-op)', () => {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    const intersects: THREE.Intersection[] = [];
    // The override ignores every argument, so a null raycaster is fine.
    ads.mesh.raycast(null as unknown as THREE.Raycaster, intersects);
    expect(intersects).toHaveLength(0);
  });
});

// A binary "data" building (binary=true, NOT media) — gets a fingerprint panel.
function fakeBinaryBuilding(overrides: Partial<Building> = {}): Building {
  return {
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? 6,
    d: overrides.d ?? 6,
    h: overrides.h ?? 4,
    color: overrides.color ?? '#3355ff',
    orient: overrides.orient ?? BuildingOrient.South,
    floors: overrides.floors ?? 1,
    createdAge: overrides.createdAge ?? 0,
    modifiedAge: overrides.modifiedAge ?? 0,
    file: overrides.file ?? {
      path: 'app.db',
      name: 'app.db',
      type: NodeKind.File,
      extension: '.db',
      mediaKind: null,
      size: 50000,
      lines: 0,
      binary: true,
      dirty: false,
      created: '',
      modified: '',
      binaryType: 'SQLite database',
    },
  } as Building;
}

describe('InstancedFacadePanels — binary fingerprint panels', () => {
  it('registerBinaryBuilding returns a layer + 4 slots for a data building', () => {
    const panels = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    const reg = panels.registerBinaryBuilding(fakeBinaryBuilding());
    expect(reg).not.toBeNull();
    expect(reg!.layer).toBe(0);
    expect(reg!.panelSlots).toEqual([0, 1, 2, 3]);
  });

  it('registerBinaryBuilding returns null for a code (non-binary) building', () => {
    const panels = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    const code = fakeBinaryBuilding({
      file: {
        path: 'main.ts',
        name: 'main.ts',
        type: NodeKind.File,
        extension: '.ts',
        mediaKind: null,
        size: 500,
        lines: 100,
        binary: false,
        dirty: false,
        created: '',
        modified: '',
      },
    });
    expect(panels.registerBinaryBuilding(code)).toBeNull();
  });

  it('registerBinaryBuilding returns null for a media building (media renders as a billboard, not data)', () => {
    const panels = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    // media file is binary=true too, but isDataBuilding excludes it.
    expect(panels.registerBinaryBuilding(fakeMediaBuilding())).toBeNull();
  });

  it('media and binary buildings share one instance (mesh.count spans both)', () => {
    const panels = new InstancedFacadePanels(8, TEST_SOURCE, session.timeline, session.config);
    panels.registerMediaBuilding(fakeMediaBuilding());
    panels.registerBinaryBuilding(fakeBinaryBuilding());
    expect(panels.mesh.count).toBe(8); // 2 buildings × 4 faces
  });

  it('schedules a streamed load for an on-screen binary building via updateLOD', () => {
    const started: string[] = [];
    const panels = new InstancedFacadePanels(8, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: (b) => started.push(b.file!.path),
    });
    panels.registerBinaryBuilding(fakeBinaryBuilding({ x: 0, y: 0, w: 12, d: 12, h: 8 }));
    const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
    cam.position.set(0, 30, 40);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    panels.updateLOD(cam, 800);
    expect(started).toContain('app.db');
  });
});

describe('FacadePanelTextureArray storage', () => {
  // Regression: pre-allocating PANEL_TEX_SIZE² x 4 x capacity on the CPU was
  // ~3.81 GB on a media-heavy repo. Layers upload one at a time.
  it('does not pre-allocate a contiguous CPU buffer for any page', () => {
    const arr = new FacadePanelTextureArray(4000);
    for (const tex of arr.textures) {
      expect(tex.image.data).toBeNull();
    }
  });

  it('keeps PANEL_TEX_SIZE small enough that even thousands of layers fit in GPU memory', () => {
    // 128² × 4 × 4000 ≈ 244 MB — comfortably under V8 / WebGL limits.
    // If this constant ever creeps up, recompute the worst-case allocation.
    expect(PANEL_TEX_SIZE).toBeLessThanOrEqual(128);
  });

  // Regression: one DataArrayTexture is capped at MAX_ARRAY_TEXTURE_LAYERS
  // (spec minimum 256), so a ~3.9k capacity failed texStorage3D. Now paged.
  it('pages capacity across multiple DataArrayTextures when it exceeds the per-page limit', () => {
    // No WebGL2 here, so the detect falls back to 256: 1000 layers is 4 pages.
    const arr = new FacadePanelTextureArray(1000);
    expect(arr.textures.length).toBeGreaterThan(1);
    const totalDepth = arr.textures.reduce((sum, tex) => sum + (tex.image.depth ?? 0), 0);
    expect(totalDepth).toBe(1000);
  });

  it('pads shaderTextures to MAX_PAGES for the fixed-size shader sampler array', () => {
    const arr = new FacadePanelTextureArray(1);
    // Always MAX_PAGES long however few are in use: uPanelArrays is declared at
    // MAX_PAGES and every slot needs a bound sampler.
    expect(arr.shaderTextures.length).toBe(8);
  });
});

describe('InstancedFacadePanels distance LOD (updateLOD)', () => {
  // The no-op onStartLoad keeps updateLOD from firing real image loads during
  // visibility-only tests.
  function adsAtOrigin(): InstancedFacadePanels {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: () => {},
    });
    ads.registerMediaBuilding(fakeMediaBuilding({ x: 0, y: 0, w: 12, d: 12, h: 24 }));
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
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
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

describe('InstancedFacadePanels visibility-gated loading', () => {
  const VIEWPORT_H = 800;
  function mediaAt(path: string, x: number, y: number): Building {
    return fakeMediaBuilding({
      x,
      y,
      w: 12,
      d: 12,
      h: 24,
      file: {
        path,
        name: path,
        type: NodeKind.File,
        extension: '.png',
        mediaKind: 'image',
        size: 1,
        lines: 0,
        binary: true,
        dirty: false,
        created: '',
        modified: '',
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
    const ads = new InstancedFacadePanels(64, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: (b) => started.push(b.file!.path),
    });
    ads.registerMediaBuilding(mediaAt('a.png', 0, 0));
    ads.registerMediaBuilding(mediaAt('b.png', 5, 5));
    expect(started).toEqual([]);
  });

  it('starts loads only for panels inside the camera frustum', () => {
    const started: string[] = [];
    const ads = new InstancedFacadePanels(64, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: (b) => started.push(b.file!.path),
    });
    ads.registerMediaBuilding(mediaAt('near.png', 0, 0)); // at origin, in view
    ads.registerMediaBuilding(mediaAt('far.png', 8000, 8000)); // far off to the side
    // Camera close above origin, looking down — origin is framed, far is not.
    ads.updateLOD(cameraAt(0, 30, 40), VIEWPORT_H);
    expect(started).toContain('near.png');
    expect(started).not.toContain('far.png');
  });

  it('loads a big building at the frustum edge whose CENTER is off-frame', () => {
    const started: string[] = [];
    const ads = new InstancedFacadePanels(64, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: (b) => started.push(b.file!.path),
    });
    // x=15 is past the frustum's right plane (~11 wide here), so the centre is
    // off-frame while the bounding sphere still crosses in.
    ads.registerMediaBuilding(mediaAt('edge.png', 15, -10));
    const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
    cam.position.set(0, 20, 5);
    cam.lookAt(0, 20, -100);
    cam.updateMatrixWorld(true);

    // Sanity: the center point alone is NOT in the frustum (x=15 fails the right
    // plane regardless of height) — the old containsPoint path would skip it.
    const proj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(proj);
    expect(frustum.containsPoint(new THREE.Vector3(15, 20, -10))).toBe(false);

    ads.updateLOD(cam, VIEWPORT_H);
    expect(started).toContain('edge.png'); // sphere test rescues it
  });

  it('spreads starts across frames via a per-frame budget', () => {
    const started: string[] = [];
    const ads = new InstancedFacadePanels(64, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: (b) => started.push(b.file!.path),
    });
    // 12 clustered media buildings, all in view.
    for (let i = 0; i < 12; i++)
      ads.registerMediaBuilding(mediaAt(`m${i}.png`, (i % 4) - 2, Math.floor(i / 4) - 1));
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

  it('culls (and does not load) small background panels while a foreground panel is close', () => {
    const started: string[] = [];
    const ads = new InstancedFacadePanels(64, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: (b) => started.push(b.file!.path),
    });
    ads.registerMediaBuilding(mediaAt('close.png', 0, 350)); // slots 0-3, near camera
    ads.registerMediaBuilding(mediaAt('background.png', 0, -4000)); // slots 4-7, far but in view
    // Camera on the +z axis looking toward -z: both buildings are centred in
    // the frustum, but 'background' is ~90x farther → sub-pixel.
    const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
    cam.position.set(0, 0, 400);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);

    ads.updateLOD(cam, VIEWPORT_H);

    // Foreground loads; background does not.
    expect(started).toContain('close.png');
    expect(started).not.toContain('background.png');

    // Measure the X-axis column directly: Matrix4.decompose returns a bogus
    // [1,1,1] for an all-zero matrix, so it cannot detect the collapse.
    const m = new THREE.Matrix4();
    const xAxisLen = (slot: number): number => {
      ads.mesh.getMatrixAt(slot, m);
      const e = m.elements;
      return Math.hypot(e[0], e[1], e[2]);
    };
    expect(xAxisLen(4)).toBeLessThan(1e-6); // background collapsed
    expect(xAxisLen(0)).toBeGreaterThan(0.1); // foreground at real size
  });

  it('does not start loads while zoomed out (mesh hidden — nothing visible to load)', () => {
    const started: string[] = [];
    const ads = new InstancedFacadePanels(64, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: (b) => started.push(b.file!.path),
    });
    ads.registerMediaBuilding(mediaAt('a.png', 0, 0));
    ads.updateLOD(cameraAt(0, 40000, 50000), VIEWPORT_H); // way out → mesh hidden
    expect(ads.mesh.visible).toBe(false);
    expect(started).toEqual([]);
  });
});

describe('InstancedFacadePanels emission + tint refresh', () => {
  it('refresh() pushes per-kind emission + the data tint into the uniforms', () => {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    BLOOM.value = { ...BLOOM.value, ENABLED: true };
    BUILDINGS.value = {
      ...BUILDINGS.value,
      MEDIA_EMISSION: 2.5,
      DATA_EMISSION: 1.5,
      DATA_COLOR: '#00ff00',
    };
    ads.refresh();
    const mat = ads.mesh.material as unknown as {
      uniforms: {
        uMediaEmission: { value: number };
        uDataEmission: { value: number };
        uDataTint: { value: { g: number } };
      };
    };
    expect(mat.uniforms.uMediaEmission.value).toBeCloseTo(2.5);
    expect(mat.uniforms.uDataEmission.value).toBeCloseTo(1.5);
    expect(mat.uniforms.uDataTint.value.g).toBeCloseTo(1); // #00ff00 → green
  });
});

describe('sampleLayer page dispatch', () => {
  // WebGL2 forbids a non-constant sampler-array index, so the shader must
  // dispatch with literal indices. vitest cannot compile GLSL: guard the shape.
  it('dispatches over the sampler array with constant indices', () => {
    const ads = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config);
    const mat = ads.mesh.material as unknown as {
      defines: Record<string, unknown>;
      fragmentShader: string;
    };
    expect(mat.defines.FACADE_PANEL_MAX_PAGES).toBe(MAX_PAGES);
    expect(mat.fragmentShader).toContain('if (page == 0) return texture(uPanelArrays[0], p);');
    expect(mat.fragmentShader).toContain('#if FACADE_PANEL_MAX_PAGES > 0');
    // Regression guard: a dynamic sampler index won't compile in WebGL2.
    expect(mat.fragmentShader).not.toContain('uPanelArrays[i]');
  });

  it('picks per-kind emission + tint from vIsData (jsdom cannot compile GLSL)', () => {
    const mat = new InstancedFacadePanels(4, TEST_SOURCE, session.timeline, session.config).mesh
      .material as unknown as {
      fragmentShader: string;
    };
    expect(mat.fragmentShader).toContain('vIsData > 0.5');
    expect(mat.fragmentShader).toContain('uDataTint');
    expect(mat.fragmentShader).toContain('uDataEmission');
    expect(mat.fragmentShader).toContain('uMediaEmission');
  });
});

describe('InstancedFacadePanels version re-arm (Timeline scrub)', () => {
  const CAM = (() => {
    const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
    cam.position.set(0, 30, 40);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
  })();

  // media.png: no blob at commit 0, added at 1, replaced at 2.
  const BUNDLE = makeBundle({
    commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
    deltas: [
      { sha: 'a', changes: [] },
      { sha: 'b', changes: [{ path: 'media.png', sha: 'blob1' }] },
      { sha: 'c', changes: [{ path: 'media.png', sha: 'blob2' }] },
    ],
    blobLines: { blob1: 0, blob2: 0 },
  } as unknown as Partial<TimelineBundle>);

  function scrubTo(commit: number): void {
    session.timeline.setScrubPos(commit);
    session.timeline.settledCommit.value = commit;
  }

  function panelsWatching(started: string[]): InstancedFacadePanels {
    const panels = new InstancedFacadePanels(8, TEST_SOURCE, session.timeline, session.config, {
      onStartLoad: (b) =>
        started.push(session.timeline.scrubbedBlobShaFor(b.file!.path) ?? 'working-tree'),
    });
    panels.registerMediaBuilding(
      fakeMediaBuilding({ x: 0, y: 0, w: 12, d: 12, h: 8, file: MEDIA_FILE })
    );
    return panels;
  }

  const MEDIA_FILE = {
    path: 'media.png',
    name: 'media.png',
    type: NodeKind.File,
    extension: '.png',
    mediaKind: 'image',
    size: 1024,
    lines: 0,
    binary: true,
    created: '',
    modified: '2026-01-01T00:00:00Z',
  } as unknown as Building['file'];

  beforeEach(() => {
    session.timeline.bundle.value = BUNDLE;
    session.timeline.mode.value = true;
    scrubTo(0);
  });

  afterEach(() => {
    session.timeline.mode.value = false;
    session.timeline.bundle.value = null;
    scrubTo(0);
  });

  it('asks again for a file that only gains a blob at a later commit', () => {
    const started: string[] = [];
    const panels = panelsWatching(started);

    // Parked where the file has no blob: the real loader bails here, and the
    // panel used to stay marked as loaded for the rest of the session.
    panels.updateLOD(CAM, 800);
    expect(started).toEqual(['working-tree']);

    scrubTo(1);
    panels.updateLOD(CAM, 800);
    expect(started).toEqual(['working-tree', 'blob1']);
  });

  it('re-loads when the scrub moves to a commit holding a different blob', () => {
    const started: string[] = [];
    const panels = panelsWatching(started);

    scrubTo(1);
    panels.updateLOD(CAM, 800);
    scrubTo(2);
    panels.updateLOD(CAM, 800);

    expect(started).toEqual(['blob1', 'blob2']);
  });

  it('does not re-load when the commit changed but the blob did not', () => {
    const started: string[] = [];
    const panels = panelsWatching(started);

    scrubTo(1);
    panels.updateLOD(CAM, 800);
    // Commit 1 -> 1 is the same version; a repaint must not refetch it.
    panels.updateLOD(CAM, 800);

    expect(started).toEqual(['blob1']);
  });

  it('goes back to the working tree when Timeline is switched off', () => {
    const started: string[] = [];
    const panels = panelsWatching(started);

    scrubTo(2);
    panels.updateLOD(CAM, 800);
    session.timeline.mode.value = false;
    panels.updateLOD(CAM, 800);

    expect(started).toEqual(['blob2', 'working-tree']);
  });
});
