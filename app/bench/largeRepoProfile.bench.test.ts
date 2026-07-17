// largeRepoProfile.bench.test.ts — per-phase profiler for the manifest→city
// apply pipeline at scale. Issue #75: a Linux-scale repo (~80k files / 100k+
// commits) hangs on render, and PostHog (image-heavy, not huge) lags on load.
// These two workloads stress different phases, so we time each phase for both
// and let the numbers pick the fix order — no guessing.
//
// Phases timed (mirrors the real apply order in city/state + the components):
//   1. layoutCity            — the worker's compute (sync here; jsdom has no Worker)
//   2. structuredClone       — the worker postMessage payload cost (full vs slim)
//   3. bbox                   — the state/index.ts computed (street rects + footprints)
//   4. buildCellsFromLayout   — buildings assembly (spatial grid + per-cell InstancedMesh)
//   5. ad-panel registration  — media/billboard synchronous CPU cost (per media building)
//   6. street labels          — one canvas + measureText + CanvasTexture per street
//   7. picker raycast         — a pointer-move pick against every building instance
//
// Which numbers to trust: phases 1–5 and 7 are pure JS / three math and
// translate directly to the browser. Phase 6 is NOT representative in absolute
// terms — jsdom's `canvas` backend (node-canvas/Cairo, CPU) rasterizes
// measureText/strokeText/fillText ~100x slower than a browser's GPU canvas, so
// its ms is inflated. The machine-independent part of the label phase (the
// geometry/mesh allocation) is small (~17ms for 24k planes measured
// separately); the real browser cost is the texture COUNT (no cache, no LOD),
// not the per-canvas time this bench reports.
//
// Not timed here (already covered): the decoration pass lives in
// treeDecorationProfile.bench; async image decode + GPU texture upload need a
// real browser/GPU and can't run in jsdom — reasoned about in the issue instead.
//
// Diagnostic driver, not a perf gate — no absolute-timing assertions.

import { describe, it } from 'vitest';
import * as THREE from 'three';
import { layoutCity } from '@/city/layout/algorithm.js';
import { rectOfStreet } from '@/city/layout/rect';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { InstancedAdPanels } from '@/city/components/buildings/adPanels';
import { createStreetLabels } from '@/city/components/streets/streetLabels';
import { isMediaFile } from '@/city/utils/mediaKind';
import { NodeKind } from '@/types';
import type { Building, CityLayout } from '@/types';
import { makeRng, genWeightedTree } from '../tests/_helpers/layoutTreeFixtures';
import { commitStats, fileStats } from '../tests/_helpers/statsFixtures';

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

// bbox: faithful copy of the state/index.ts computed (street rects + building
// footprints + Y height). Mirrored here so the bench times the exact work
// without constructing a full CityState/layoutClient. Halo omitted (default 0).
function computeBbox(layout: CityLayout): THREE.Box3 {
  const box = new THREE.Box3();
  for (const s of layout.streets) {
    const r = rectOfStreet(s);
    box.expandByPoint(new THREE.Vector3(r.x - r.w / 2, 0, r.y - r.d / 2));
    box.expandByPoint(new THREE.Vector3(r.x + r.w / 2, 0, r.y + r.d / 2));
  }
  for (const b of layout.buildings) {
    box.expandByPoint(new THREE.Vector3(b.x - b.w / 2, 0, b.y - b.d / 2));
    box.expandByPoint(new THREE.Vector3(b.x + b.w / 2, b.h, b.y + b.d / 2));
  }
  return box;
}

// Build a media-stripped shallow clone of the buildings so buildCellsFromLayout
// measures pure cell assembly without firing the async fetch/decode path (which
// isolates media registration into its own timed region below).
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
  labelMs: number;
  labelCount: number;
  pickMs: number;
  pickCasts: number;
}

function profile(label: string, fileBudget: number, mediaFraction: number): PhaseResult {
  const rng = makeRng(0xc0ffee);
  const tree = genWeightedTree('root', 'root', fileBudget, 0, rng);
  const files = countFiles(tree);
  const media = mediaFraction > 0 ? tagMediaFiles(tree, mediaFraction, makeRng(0xbeef)) : 0;
  // Commit-count only shapes the decoration pass (trees/fireflies), which is
  // profiled by treeDecorationProfile.bench; here we exercise the layout +
  // buildings + media + picker phases, so commits aren't needed for stats.
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
      x: s.x, y: s.y, length: s.length, width: s.width, orientation: s.orientation, isRoot: s.isRoot,
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
  const cellOut = buildCellsFromLayout(bounds, plainBuildings);
  const ta1 = performance.now();

  // ── 5. media ad-panel registration (synchronous CPU: matrix build + attr writes) ──
  let mediaRegMs = 0;
  const mediaBuildings = layout.buildings.filter((b) => isMediaFile(b.file));
  if (mediaBuildings.length > 0) {
    const adCapacity = Math.max(64, Math.ceil(mediaBuildings.length * 1.5));
    const tm0 = performance.now();
    const ads = new InstancedAdPanels(adCapacity);
    for (const b of mediaBuildings) ads.registerMediaBuilding(b);
    const tm1 = performance.now();
    mediaRegMs = tm1 - tm0;
    ads.dispose();
  }

  // ── 6. street-label textures (one canvas + measureText + texture per street) ──
  const tl0 = performance.now();
  let labelCount = 0;
  for (const s of layout.streets) labelCount += createStreetLabels(s).length;
  const tl1 = performance.now();

  // ── 7. picker raycast against every building instance ──
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
  const tp0 = performance.now();
  for (let i = 0; i < CASTS; i++) {
    pointer.x = (i / CASTS) * 1.6 - 0.8;
    pointer.y = ((i * 7) % CASTS) / CASTS - 0.5;
    raycaster.setFromCamera(pointer, camera);
    raycaster.intersectObjects(pickables, false);
  }
  const tp1 = performance.now();

  // Free the assembled meshes' JS-side arrays promptly between cases.
  cellOut.sceneRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });

  return {
    label, files, buildings: layout.buildings.length, streets: layout.streets.length, media,
    layoutMs: t1 - t0, cloneFullMs: tc1 - tc0, cloneSlimMs: tc3 - tc2, bboxMs: tb1 - tb0,
    assemblyMs: ta1 - ta0, mediaRegMs, labelMs: tl1 - tl0, labelCount,
    pickMs: tp1 - tp0, pickCasts: CASTS,
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
      row('6 street labels (jsdom-inflated)', r.labelMs, `${r.labelCount} label planes`),
      row('7 picker raycast', r.pickMs, `${r.pickCasts} casts → ${(r.pickMs / r.pickCasts).toFixed(2)}ms/cast`),
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
