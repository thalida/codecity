// decorationGolden.bench.test.ts — bit-identical guard for the decoration-pass
// perf work. Digests the full output of placeTrees, placeFireflies, and the
// tree renderer's instance matrix/color buffers for deterministic inputs, and
// compares against the captured baseline. Any drift fails, so the
// memoization/compute-once/slim-payload changes can prove output is unchanged.

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import { placeTrees } from '@/city/components/trees/treePlacement';
import { createTreeRenderer } from '@/city/components/trees/treeRenderer';
import { placeFireflies } from '@/city/components/fireflies/firefliesPlacement';
import { NodeKind } from '@/types';
import type { CityBbox, CommitEntry } from '@/types';

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function mkFile(name: string, path: string, rng: () => number): any {
  return {
    name,
    type: NodeKind.File,
    path: `${path}/${name}`,
    extension: '.c',
    size: 200 + Math.floor(rng() * 40000),
    lines: 5 + Math.floor(rng() * 1500),
  };
}
function mkDir(name: string, children: any[], path: string): any {
  const descendants_count =
    children.length + children.reduce((a, c) => a + (c.descendants_count || 0), 0);
  return {
    name,
    type: NodeKind.Directory,
    path,
    children_count: children.length,
    descendants_count,
    children,
  };
}
function genDir(name: string, path: string, budget: number, depth: number, rng: () => number): any {
  if (budget <= 8 || depth >= 6) {
    return mkDir(
      name,
      Array.from({ length: budget }, (_, i) => mkFile(`f${i}.c`, path, rng)),
      path
    );
  }
  const children: any[] = [mkFile('a.c', path, rng)];
  let remaining = budget - 1;
  const nSub = 2 + Math.floor(rng() * 5);
  for (let i = 0; i < nSub && remaining > 0; i++) {
    const share =
      i === nSub - 1 ? remaining : Math.max(1, Math.round(remaining / (nSub - i) / (i + 1)));
    remaining -= share;
    children.push(genDir(`d${i}`, `${path}/d${i}`, share, depth + 1, rng));
  }
  return mkDir(name, children, path);
}
function bboxOf(layout: ReturnType<typeof layoutCity>): CityBbox {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const b of layout.buildings) {
    minX = Math.min(minX, b.x - b.w / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    minY = Math.min(minY, b.y - b.d / 2);
    maxY = Math.max(maxY, b.y + b.d / 2);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    depth: maxY - minY,
  };
}
// Several authors per commit so author-color memoization is exercised, with
// repetition so distinct authors << orbs (the case memoization optimizes).
const AUTHORS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
function genCommits(n: number, rng: () => number): CommitEntry[] {
  const out: CommitEntry[] = [];
  const base = Date.UTC(2016, 2, 1);
  for (let i = 0; i < n; i++) {
    const day = Math.floor((i / n) * 2000) + Math.floor(rng() * 4);
    const date = new Date(base + day * 86400000).toISOString().slice(0, 10);
    const a = AUTHORS[i % AUTHORS.length];
    const authors = i % 5 === 0 ? [a, AUTHORS[(i + 2) % AUTHORS.length]] : [a];
    out.push({
      date,
      files: 1 + Math.floor(rng() * 200),
      sha: `${i.toString(16).padStart(8, '0')}beef`.repeat(4).slice(0, 40),
      authors,
      subject: 'x',
      same_day_total: 1 + Math.floor(rng() * 12),
    });
  }
  return out;
}

function makeHasher() {
  let h = 2166136261 >>> 0;
  const num = (v: number) => {
    const s = Math.round(v * 1e4).toString();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 124;
    h = Math.imul(h, 16777619) >>> 0;
  };
  const arr = (a: ArrayLike<number>) => {
    for (let i = 0; i < a.length; i++) num(a[i]);
  };
  return { num, arr, hex: () => (h >>> 0).toString(16) };
}

// Captured before the decoration-pass perf work.
const EXPECTED = '12k:trees43000:orbs51600:74166740';

describe('decoration golden (bit-identical guard)', () => {
  it('placeTrees + placeFireflies + renderer buffers match baseline', () => {
    const rng = makeRng(0xc0ffee);
    const tree = genDir('root', 'root', 12000, 0, rng);
    const layout = layoutCity({ tree });
    const bbox = bboxOf(layout);
    const commits = genCommits(43000, makeRng(7));
    const busyness = { avg: 3, busy: 6 };

    const placements = placeTrees(layout as any, bbox, {
      commitCount: 43000,
      islandGeoOverride: null,
    });
    const orbs = placeFireflies(placements, commits);
    const renderer = createTreeRenderer(placements, commits, busyness);

    const hasher = makeHasher();
    for (const p of placements) {
      hasher.num(p.x);
      hasher.num(p.y);
      hasher.num(p.seed);
      hasher.num(p.commitIndex);
    }
    for (const o of orbs) {
      hasher.num(o.treeX);
      hasher.num(o.treeZ);
      hasher.num(o.height);
      hasher.num(o.orbitRadius);
      hasher.num(o.orbitStartAngle);
      hasher.num(o.orbitTilt);
      hasher.num(o.phase);
      hasher.num(o.pulsePhase);
      hasher.num(o.scale);
      hasher.num(o.commitIndex);
      hasher.arr(o.rgb);
      hasher.arr(o.lightRgb);
    }
    for (const child of renderer.group.children) {
      const mesh = child as THREE.InstancedMesh;
      if (mesh.instanceMatrix) hasher.arr(mesh.instanceMatrix.array);
      if (mesh.instanceColor) hasher.arr(mesh.instanceColor.array);
    }
    renderer.dispose();

    const digest = `12k:trees${placements.length}:orbs${orbs.length}:${hasher.hex()}`;
    expect(digest).toEqual(EXPECTED);
  });
});
