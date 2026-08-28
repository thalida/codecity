// city/components/fireflies/fireflies.ts — Fireflies subsystem orchestrator.
// Thin assembly from TreePlacement[] + commits to a renderer lifecycle
// handle (orbs + orbit rings). The persistent component door is ./index.ts.

import * as THREE from 'three';
import type { CitySettingsStore } from '@/city/settings/store';
import { placeFireflies, type FireflyPlacement } from './firefliesPlacement';
import { createFireflyRenderer, type FireflyRenderer } from './firefliesRenderer';
import { createOrbitRings } from './orbitRings';
import { createFirefliesScrub } from './firefliesScrub';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import type { CommitEntry, RepoStats } from '@/city/types/manifest';

/** createFireflyAssembly's handle: the renderer plus sha-based hover/select
 *  so callers never manage the sha→index map. */
export interface Fireflies {
  group: FireflyRenderer['group'];
  setTime: FireflyRenderer['setTime'];
  /** Highlight fireflies for the commit with this sha. Pass null to clear. */
  setHoveredCommit(sha: string | null): void;
  /** Select-highlight fireflies for the commit with this sha. Pass null to clear. */
  setSelectedCommit(sha: string | null): void;
  /** Timeline scrub gate: hide orbs whose commitIndex is past maxCommitIndex. Null restores all. */
  setScrubCommit(maxCommitIndex: number | null): void;
  /** The date the scrub sits on, which sizes the orbs and their orbits.
   *  Null (Live) restores the sizes the field was built with. */
  setScrubNow(nowMs: number | null): void;
  /** Update LineMaterial resolution uniform on canvas resize. */
  onResize(width: number, height: number): void;
  refresh: FireflyRenderer['refresh'];
  dispose: FireflyRenderer['dispose'];
}

export function createFireflyAssembly(
  settings: CitySettingsStore,
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  stats: RepoStats | null | undefined,
  scannedAt?: string | null,
  /** Drawing-buffer canvas — the orbs' point sizes scale to its device-pixel
   *  height. Optional for tests. */
  canvas?: HTMLCanvasElement
): Fireflies {
  const parent = new THREE.Group();
  parent.name = 'fireflies-system';

  // Master config gate. When disabled, return an empty parent group so the
  // caller's group is still safe to add/dispose.
  if (!settings.FIREFLIES.ENABLED) {
    const stub = createFireflyRenderer(settings, []);
    return {
      group: parent,
      setTime: stub.setTime.bind(stub),
      setHoveredCommit() {},
      setSelectedCommit() {},
      setScrubCommit() {},
      setScrubNow() {},
      onResize() {},
      refresh: stub.refresh.bind(stub),
      dispose: stub.dispose.bind(stub),
    };
  }
  const orbs: FireflyPlacement[] = placeFireflies(
    settings,
    placements,
    commits ?? [],
    stats,
    scannedAt
  );
  const rings = createOrbitRings(orbs, settings);
  const renderer = createFireflyRenderer(settings, orbs, canvas);
  const scrub = createFirefliesScrub(settings, orbs, commits, stats, scannedAt);
  // Both arrive per frame, from the same controller, and both feed one resize.
  let _scrubCommit: number | null = null;
  let _scrubNow: number | null = null;

  function resize(): void {
    if (scrub.resize(_scrubCommit, _scrubNow)) renderer.uploadSizes();
  }

  // Rings render first so orbs (additive) composite on top.
  parent.add(rings.group);
  parent.add(renderer.group);

  // Build sha → commitIndex map once at construction time.
  const shaToIndex = new Map<string, number>();
  (commits ?? []).forEach((c, i) => shaToIndex.set(c.sha, i));

  return {
    group: parent,
    setTime(seconds: number) {
      renderer.setTime(seconds);
      // Piggyback the ring rainbow chase on setTime; rings.update wants
      // milliseconds (the treeOutlineRenderer convention).
      rings.update(seconds * 1000);
    },
    setHoveredCommit(sha: string | null) {
      const idx = sha === null ? null : (shaToIndex.get(sha) ?? null);
      renderer.setHoveredCommit(idx);
      rings.setHoveredCommit(idx);
    },
    setSelectedCommit(sha: string | null) {
      const idx = sha === null ? null : (shaToIndex.get(sha) ?? null);
      renderer.setSelectedCommit(idx);
      rings.setSelectedCommit(idx);
    },
    setScrubCommit(maxCommitIndex: number | null) {
      renderer.setScrubCommit(maxCommitIndex);
      _scrubCommit = maxCommitIndex;
      resize();
    },
    setScrubNow(nowMs: number | null) {
      _scrubNow = nowMs;
      resize();
    },
    onResize(width: number, height: number) {
      rings.onResize(width, height);
    },
    refresh() {
      renderer.refresh();
      rings.refresh();
    },
    dispose() {
      rings.dispose();
      renderer.dispose();
    },
  };
}
