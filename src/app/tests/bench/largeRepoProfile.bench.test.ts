// Per-phase profiler for the manifest → city apply pipeline at scale. What each
// phase measures, and which numbers are browser-representative, is in the
// README beside this file. Diagnostic driver: no timing assertions.

import { describe, it } from 'vitest';
import * as THREE from 'three';
import { ObjectBVH } from 'three-mesh-bvh';
import { layoutCity } from '@/city/layout/algorithm.js';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { InstancedFacadePanels } from '@/city/components/buildings/facadePanels';
import { createStreetLabels } from '@/city/components/streets/streetLabels';
import { isMediaFile } from '@/utils/fileKind';
import { NodeKind, StreetAxis } from '@/types';
import type { Building, CityLayout } from '@/types';
import { makeRng, genWeightedTree } from '../_helpers/layoutTreeFixtures';
import { commitStats, fileStats } from '../_helpers/statsFixtures';
import { TEST_SOURCE } from '../_helpers/manifestFixtures';

function countFiles(node: any): number {
  let n = 0;
  const walk = (x: any) => {
    if (x.type === NodeKind.File) n++;
    else for (const c of x.children ?? []) walk(c);
  };
  walk(node);
  return n;
}

// Tag a fraction of the tree's files as media images (posthog-style): sets the
// backend-shipped mediaKind + intrinsic dimensions the ad-panel path reads.
function tagMediaFiles(node: any, fraction: number, rng: () => number): number {
  let tagged = 0;
  const walk = (x: any) => {
    if (x.type === NodeKind.File) {
      if (rng() < fraction) {
        x.mediaKind = 'image';
        x.media_width = 320 + Math.floor(rng() * 1600);
        x.media_height = 240 + Math.floor(rng() * 1200);
        tagged++;
      }
    } else for (const c of x.children ?? []) walk(c);
  };
  walk(node);
  return tagged;
}

// A copy of the state/index.ts computed, so the bench times that work without
// standing up a whole CityState. Halo omitted (default 0).
function computeBbox(layout: CityLayout): THREE.Box3 {
  const box = new THREE.Box3();
  const min = box.min;
  const max = box.max;
  for (const s of layout.streets) {
    const w = s.orientation === StreetAxis.X ? s.length : s.width;
    const d = s.orientation === StreetAxis.X ? s.width : s.length;
    const x0 = s.x - w / 2;
    const x1 = s.x + w / 2;
    const z0 = s.y - d / 2;
    const z1 = s.y + d / 2;
    if (x0 < min.x) min.x = x0;
    if (x1 > max.x) max.x = x1;
    if (z0 < min.z) min.z = z0;
    if (z1 > max.z) max.z = z1;
    if (0 < min.y) min.y = 0;
    if (0 > max.y) max.y = 0;
  }
  for (const b of layout.buildings) {
    const x0 = b.x - b.w / 2;
    const x1 = b.x + b.w / 2;
    const z0 = b.y - b.d / 2;
    const z1 = b.y + b.d / 2;
    if (x0 < min.x) min.x = x0;
    if (x1 > max.x) max.x = x1;
    if (z0 < min.z) min.z = z0;
    if (z1 > max.z) max.z = z1;
    if (0 < min.y) min.y = 0;
    if (b.h < min.y) min.y = b.h;
    if (0 > max.y) max.y = 0;
    if (b.h > max.y) max.y = b.h;
  }
  return box;
}

// Media stripped, so this measures cell assembly without firing the async
// fetch/decode path: media gets its own timed region below.
function stripMedia(buildings: Building[]): Building[] {
  return buildings.map((b) => ({ ...b, file: { ...b.file, mediaKind: undefined } }) as Building);
}

function bboxToBounds(box: THREE.Box3) {
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}

interface PhaseResult {
  label: string;
  files: number;
  buildings: number;
  streets: number;
  media: number;
  layoutMs: number;
  cloneFullMs: number;
  cloneSlimMs: number;
  bboxMs: number;
  assemblyMs: number;
  mediaRegMs: number;
  drawnNoLod: number;
  drawnLodFar: number;
  visibleLodNear: boolean;
  labelMs: number;
  labelCount: number;
  pickMs: number;
  pickCasts: number;
  bvhBuildMs: number;
  bvhCastMs: number;
}

function profile(label: string, fileBudget: number, mediaFraction: number): PhaseResult {
  const rng = makeRng(0xc0ffee);
  const tree = genWeightedTree('root', 'root', fileBudget, 0, rng);
  const files = countFiles(tree);
  const media = mediaFraction > 0 ? tagMediaFiles(tree, mediaFraction, makeRng(0xbeef)) : 0;
  // Commit count only shapes the decoration pass, which treeDecorationProfile
  // owns; nothing here reads it.
  const stats = { ...commitStats([]), ...fileStats(tree) };

  // ── 1. layout compute ──
  const t0 = performance.now();
  const layout = layoutCity({ tree, stats } as any) as unknown as CityLayout;
  const t1 = performance.now();

  // ── 2. worker payload clone (full manifest-carrying layout vs geometry-only) ──
  const tc0 = performance.now();
  structuredClone(layout);
  const tc1 = performance.now();
  const slim = {
    streets: layout.streets.map((s: any) => ({
      x: s.x,
      y: s.y,
      length: s.length,
      width: s.width,
      orientation: s.orientation,
      isRoot: s.isRoot,
    })),
    buildings: layout.buildings.map((b: any) => ({ x: b.x, y: b.y, w: b.w, d: b.d, h: b.h })),
  };
  const tc2 = performance.now();
  structuredClone(slim);
  const tc3 = performance.now();

  // ── 3. bbox ──
  const tb0 = performance.now();
  const box = computeBbox(layout);
  const tb1 = performance.now();

  // ── 4. buildings assembly (media stripped so no async loads fire) ──
  const bounds = bboxToBounds(box);
  const plainBuildings = stripMedia(layout.buildings);
  const ta0 = performance.now();
  const cellOut = buildCellsFromLayout(bounds, plainBuildings, TEST_SOURCE);
  const ta1 = performance.now();

  // ── 5. media ad-panel registration ──
  // Also the "zoom out + rotate hangs" check: far out, LOD drops the overdraw.
  let mediaRegMs = 0;
  let drawnNoLod = 0;
  let drawnLodFar = 0;
  let visibleLodNear = false;
  const mediaBuildings = layout.buildings.filter((b) => isMediaFile(b.file));
  if (mediaBuildings.length > 0) {
    const adCapacity = Math.max(64, Math.ceil(mediaBuildings.length * 1.5));
    const tm0 = performance.now();
    // No-op loader: profile registration + LOD without firing real image loads.
    const ads = new InstancedFacadePanels(adCapacity, TEST_SOURCE, { onStartLoad: () => {} });
    for (const b of mediaBuildings) ads.registerMediaBuilding(b);
    const tm1 = performance.now();
    mediaRegMs = tm1 - tm0;

    drawnNoLod = ads.mesh.visible ? ads.mesh.count : 0; // today: all panels every frame
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1000;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const farCam = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
    farCam.position.set(cx, span * 6, cz + span * 6);
    farCam.lookAt(cx, 0, cz);
    farCam.updateMatrixWorld(true);
    ads.updateLOD(farCam, 900);
    drawnLodFar = ads.mesh.visible ? ads.mesh.count : 0; // with LOD: 0 when zoomed out
    const nearCam = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
    nearCam.position.set(cx, span * 0.05, cz + span * 0.05);
    nearCam.lookAt(cx, 0, cz);
    nearCam.updateMatrixWorld(true);
    ads.updateLOD(nearCam, 900);
    visibleLodNear = ads.mesh.visible;

    ads.dispose();
  }

  // ── 6. street-label textures (one canvas + measureText + texture per street) ──
  const tl0 = performance.now();
  let labelCount = 0;
  for (const s of layout.streets) labelCount += createStreetLabels(s).length;
  const tl1 = performance.now();

  // ── 7. picker raycast: THREE brute-force (old) vs ObjectBVH (now) ──
  const pickables: THREE.Object3D[] = [];
  for (const cell of cellOut.cells.values()) if (cell.detailMesh) pickables.push(cell.detailMesh);
  const camera = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
  const center = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1000;
  camera.position.set(center.x, span, center.z + span * 0.5);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const CASTS = 20;
  const aim = (i: number) => {
    pointer.x = (i / CASTS) * 1.6 - 0.8;
    pointer.y = ((i * 7) % CASTS) / CASTS - 0.5;
    raycaster.setFromCamera(pointer, camera);
  };
  const tp0 = performance.now();
  for (let i = 0; i < CASTS; i++) {
    aim(i);
    raycaster.intersectObjects(pickables, false);
  }
  const tp1 = performance.now();
  // ObjectBVH path (what the picker now uses).
  const tvb0 = performance.now();
  const objBvh = pickables.length > 0 ? new ObjectBVH(pickables) : null;
  const bvhBuildMs = performance.now() - tvb0;
  const tv0 = performance.now();
  for (let i = 0; i < CASTS; i++) {
    aim(i);
    objBvh?.raycast(raycaster, []);
  }
  const bvhCastMs = (performance.now() - tv0) / CASTS;

  // Free the assembled meshes' JS-side arrays promptly between cases.
  cellOut.sceneRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });

  return {
    label,
    files,
    buildings: layout.buildings.length,
    streets: layout.streets.length,
    media,
    layoutMs: t1 - t0,
    cloneFullMs: tc1 - tc0,
    cloneSlimMs: tc3 - tc2,
    bboxMs: tb1 - tb0,
    assemblyMs: ta1 - ta0,
    mediaRegMs,
    drawnNoLod,
    drawnLodFar,
    visibleLodNear,
    labelMs: tl1 - tl0,
    labelCount,
    pickMs: tp1 - tp0,
    pickCasts: CASTS,
    bvhBuildMs,
    bvhCastMs,
  };
}

function report(r: PhaseResult): void {
  const row = (name: string, ms: number, extra = '') =>
    `  ${name.padEnd(22)} ${ms.toFixed(1).padStart(8)}ms   ${extra}`;
  console.log(
    [
      `\n=== ${r.label}: ${r.files} files / ${r.buildings} bld / ${r.streets} streets / ${r.media} media ===`,
      row('1 layoutCity', r.layoutMs),
      row('2 clone FULL', r.cloneFullMs, '<-- worker postMessage out today'),
      row('  clone slim', r.cloneSlimMs, '(geometry-only payload)'),
      row('3 bbox', r.bboxMs),
      row('4 buildings assembly', r.assemblyMs),
      row('5 media registration', r.mediaRegMs, `${r.media} media buildings`),
      `  ${'  ad-panel LOD'.padEnd(22)} ${''.padStart(8)}     zoom-out draws ${r.drawnLodFar}/${r.drawnNoLod} instances (near visible=${r.visibleLodNear})`,
      row('6 street labels (jsdom-inflated)', r.labelMs, `${r.labelCount} label planes`),
      row(
        '7 picker raycast (core)',
        r.pickMs,
        `${(r.pickMs / r.pickCasts).toFixed(2)}ms/cast (brute force)`
      ),
      row(
        '  picker raycast (BVH)',
        r.bvhCastMs * r.pickCasts,
        `${r.bvhCastMs.toFixed(3)}ms/cast, build ${r.bvhBuildMs.toFixed(0)}ms`
      ),
    ].join('\n')
  );
}

describe('large-repo apply-phase profile', () => {
  it('raw scale — Linux-ish (80k files, no media)', () => {
    report(profile('raw-80k', 80_000, 0));
  }, 120_000);

  it('image-heavy — PostHog-ish (10k files, ~25% media)', () => {
    report(profile('media-10k', 10_000, 0.25));
  }, 120_000);
});
