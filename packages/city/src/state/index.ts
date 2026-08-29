// city/state/index.ts — what a city is currently showing, and the async
// pipeline that advances it. Per instance, never a module singleton.
//
// Plain values with an explicit publication, not a dependency graph. An apply
// swaps the manifest and layout, recomputes what is derived from them, and THEN
// says so — once, in a known order. A component asks to hear about the kind of
// change it redraws for, which is a shorter list than "everything it read":
//
//   structure  a non-reuse apply: new geometry, so the bbox, root street, gem
//              anchor and world bounds are all fresh
//   apply      any apply: manifest, layout and tree placements are fresh
//   published  the components have rebuilt off the above; the city is the one
//              on screen now
import * as THREE from 'three';
import { BuildStage } from '../types/build';
import type { CityEmitter } from './events';
import { getWorldBounds, type WorldBounds } from '../utils/floorBounds';
import { nextPaint } from '../utils/nextPaint';
import type { TreePlacement } from '../components/trees/treePlacement';
import type { TreePlacementClient } from '../components/trees/treePlacementClient';
import { gemAnchorXZ } from '../components/gem/anchor';
import { buildIconAtlas } from '../components/buildings/atlas';
import type { createLayoutClient } from '../layout';
import { layoutConfigFrom } from '../layout/config';
import type { CitySettingsStore } from '../settings/store';
import type { CityResources } from '../render/resources';
import { Building } from '../types/building';
import { Manifest } from '../types/manifest';
import { CityBbox, CityLayout } from '../types/scene';
import { Street, StreetAxis } from '../types/street';

/** The kinds of change a component can redraw for. See the header. */
export type CityChange = 'structure' | 'apply' | 'published';

export interface CityState {
  readonly manifest: Manifest | null;
  // Full layout (positions + per-building dims), reassigned EVERY apply — feeds
  // the dims-dependent rebuilds (buildings/footprint/trees) + the bbox computed.
  readonly layout: CityLayout | null;
  // World bbox (street rects + building footprints + footprint halo). Off
  // structureRevision → frozen on a reuse apply; the cameraRig framing tracks it.
  readonly bbox: THREE.Box3 | null;
  // Placement-space view of bbox (CityLayout's XY = world XZ); for tree placement.
  readonly sceneBbox: CityBbox | null;
  // City vertical extent (bbox.max.y - min.y); feeds worldBounds.
  readonly cityHeight: number;
  // Island floor sizing. Computed off sceneBbox + cityHeight (frozen on reuse),
  // null until the first apply.
  readonly latestWorldBounds: WorldBounds | null;
  // Where the trees stand, from the build's placement stage. The trees and
  // fireflies components render off it; null when trees are switched off.
  readonly treePlacements: TreePlacement[] | null;
  readonly rootStreet: Street | null;
  readonly gemWorldPos: THREE.Vector3 | null;
  // Tallest building (by height) for the camera start-framing height-fit. From
  // layout data, not the async building meshes (see the computed).
  readonly tallestBuilding: Building | null;
  // { street dir.path → Street }. The fader, pathLine, picker and debug API
  // resolve a street by directory here rather than through the component.
  readonly streetsByDirMap: Record<string, Street>;
  /** Hear about one kind of change. Returns the unsubscribe.
   *
   *  NOT called immediately, unlike the settings and picker subscriptions:
   *  those report state, and this reports a transition. Firing at construction
   *  would claim a publish that has not happened. */
  on(kind: CityChange, listener: () => void): () => void;
  // Compute the layout off-thread, then set the source signals. leadingStages
  // are stages the CALLER already ran, so the readout counts them (Timeline).
  applyManifest(newManifest: Manifest, leadingStages?: readonly BuildStage[]): Promise<void>;
  // The stages applyManifest would run for this manifest. For a caller that
  // opens the readout on work of its own first.
  buildStagesFor(newManifest: Manifest): BuildStage[];
  // Forces the next apply onto the non-reuse path (rebuild for the same layout signature).
  invalidateLayoutCache(): void;
}

/** The world bbox for a layout: street rects, building footprints and roofs, plus
 *  the halo. Pure, so the build can measure a layout it has not published yet. */
function cityBbox(l: CityLayout, halo: number): THREE.Box3 {
  const box = new THREE.Box3();
  // Inlined rather than expandByPoint per point: ~190k points at Linux scale,
  // ~2.4x faster and allocation-free. The +Inf start still detects empty.
  const min = box.min;
  const max = box.max;
  for (const s of l.streets) {
    // rectOfStreet's orientation swap, inlined.
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
  // Empty fallback (no streets) — applied BEFORE the building expansion so a
  // building-only layout still gets the floor box.
  if (box.isEmpty()) {
    box.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
  }
  // Buildings render via a separate instanced mesh — expand to each footprint
  // (y=0) + roof height (y=b.h) so framing covers the FULL visible city.
  for (const b of l.buildings) {
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
  // Expand XZ by the halo so the bbox covers the asphalt slab wrapping the city
  // (footprint rects are inflated by HALO_WIDTH). Y stays bounded by height.
  if (halo > 0) {
    box.min.x -= halo;
    box.min.z -= halo;
    box.max.x += halo;
    box.max.z += halo;
  }
  return box;
}

/** Placement-space view of a world bbox (CityLayout's XY axis == world XZ). */
function sceneBboxOf(b: THREE.Box3): CityBbox {
  return {
    minX: b.min.x,
    maxX: b.max.x,
    minY: b.min.z,
    maxY: b.max.z,
    cx: (b.min.x + b.max.x) / 2,
    cy: (b.min.z + b.max.z) / 2,
    width: b.max.x - b.min.x,
    depth: b.max.z - b.min.z,
  };
}

export function createCityState(
  layoutClient: ReturnType<typeof createLayoutClient>,
  treePlacementClient: TreePlacementClient,
  resources: CityResources,
  settings: CitySettingsStore,
  events: CityEmitter
): CityState {
  let manifest: Manifest | null = null;
  let layout: CityLayout | null = null;
  let treePlacements: TreePlacement[] | null = null;

  // Derived, recomputed at the two points below rather than on read: the
  // per-frame readers (framing, picking, the fader) ask for these constantly.
  let bbox: THREE.Box3 | null = null;
  let sceneBbox: CityBbox | null = null;
  let cityHeight = 0;
  let latestWorldBounds: WorldBounds | null = null;
  let rootStreet: Street | null = null;
  let gemWorldPos: THREE.Vector3 | null = null;
  let tallestBuilding: Building | null = null;
  let streetsByDirMap: Record<string, Street> = {};

  const listeners = new Map<CityChange, Set<() => void>>();

  function on(kind: CityChange, listener: () => void): () => void {
    let set = listeners.get(kind);
    if (!set) {
      set = new Set();
      listeners.set(kind, set);
    }
    set.add(listener);
    return () => void set.delete(listener);
  }

  function _tell(kind: CityChange): void {
    // Over a copy: a listener that unsubscribes itself (armOnFirstTick's
    // teardown) would otherwise mutate the set mid-iteration.
    for (const listener of [...(listeners.get(kind) ?? [])]) listener();
  }

  /** Halo width, or 0 when off. A footprint halo widens the world bbox, so a
   *  FOOTPRINT save has to refit the geometry derived from it. */
  function _halo(): number {
    const f = settings.FOOTPRINT;
    return f.ENABLED && f.HALO_WIDTH > 0 ? f.HALO_WIDTH : 0;
  }

  /** Everything the GEOMETRY implies. Recomputed on a non-reuse apply, and on a
   *  halo change, which moves the bbox without moving a building. */
  function _recomputeStructure(): void {
    bbox = layout ? cityBbox(layout, _halo()) : null;
    sceneBbox = bbox ? sceneBboxOf(bbox) : null;
    cityHeight = bbox ? bbox.max.y - bbox.min.y : 0;
    latestWorldBounds = sceneBbox ? getWorldBounds(sceneBbox, settings.WORLD, cityHeight) : null;
    // The root-of-repo street, which gets the gem.
    rootStreet = (layout?.streets ?? []).filter((s) => s.isRoot)[0] || null;
    // The floor-level anchor at its open end. gemAnchorXZ is the one source of
    // that geometry, shared with the gem mesh and tree placement.
    gemWorldPos = rootStreet
      ? new THREE.Vector3(gemAnchorXZ(rootStreet).x, 0, gemAnchorXZ(rootStreet).y)
      : null;
    streetsByDirMap = {};
    for (const street of layout?.streets ?? []) {
      if (street.dir?.path != null) streetsByDirMap[street.dir.path] = street;
    }
  }

  /** What the LAYOUT implies, on every apply: a reuse turns placeholder heights
   *  real, and framing must not wait on the async building meshes. */
  function _recomputeLayout(): void {
    let tallest: Building | null = null;
    for (const b of layout?.buildings ?? []) {
      if (!tallest || b.h > tallest.h) tallest = b;
    }
    tallestBuilding = tallest;
  }

  // A halo change moves the world bbox, so the island and the framing have to
  // refit even though no building moved.
  settings.on('FOOTPRINT', () => {
    if (!layout) return;
    _recomputeStructure();
    _tell('structure');
  });

  // Closure privates: the sig the atlas last built for (lagging a throw, so it
  // retries), a one-shot non-reuse flag, and the supersession generation.
  let lastAtlasTreeSig: string | null = null;
  let invalidated = false;
  let generation = 0;

  // The stages an apply of this manifest would run, so a caller doing work of
  // its own beforehand can show the whole plan rather than a growing one.
  function buildStagesFor(newManifest: Manifest): BuildStage[] {
    const buildsAtlas = (newManifest.structure_signature ?? '') !== lastAtlasTreeSig;
    return [
      ...(buildsAtlas ? [BuildStage.Icons] : []),
      BuildStage.Layout,
      BuildStage.Assemble,
      // The trees component ends a build: enabled, it decorates; off, it settles
      // straight to idle and this stage never comes.
      ...(settings.TREES.ENABLED ? [BuildStage.Decorate] : []),
    ];
  }

  async function applyManifest(
    newManifest: Manifest,
    leadingStages: readonly BuildStage[] = []
  ): Promise<void> {
    const myGeneration = ++generation;

    // Structure only (no mtime/size), so it holds across skeleton and final.
    // Gates the atlas alone; layout reuse keys on layout_signature instead.
    const treeSig = newManifest.structure_signature ?? '';
    const buildsAtlas = treeSig !== lastAtlasTreeSig;

    // Reuse only when the PACKER's inputs are unchanged (layout_signature adds
    // per-file size): a content edit re-packs, a dates-only change reuses.
    const prev = manifest;
    const prevLayoutSig =
      prev && 'layout_signature' in prev ? (prev as Manifest).layout_signature : '';
    const shouldReuse =
      !invalidated && prevLayoutSig !== '' && newManifest.layout_signature === prevLayoutSig;
    invalidated = false;

    // The readout's denominator, decided before the first stage starts: a
    // fixed count would promise a stage this apply is not going to run.
    const own = buildStagesFor(newManifest);
    events.emit('build:start', { stages: [...leadingStages, ...own] });
    events.emit('build:stage', { stage: own[0] });
    // The manifest fan-out and the atlas walk below run before anything can
    // repaint, so the row would name them only once they were over.
    await nextPaint();
    if (myGeneration !== generation) return;

    // Ahead of the layout signal firing the reactive buildings rebuild, so the
    // cells bake the right roof UVs.
    if (buildsAtlas) {
      try {
        const atlas = await buildIconAtlas(newManifest);
        if (myGeneration !== generation) return; // superseded mid-build
        lastAtlasTreeSig = treeSig;
        resources.buildings.setIconAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    events.emit('build:stage', { stage: BuildStage.Layout });
    const reusedLayout = shouldReuse ? layout : null;
    let newLayout: CityLayout;
    // Full envelope, not `.tree`: the worker contract stays typed against
    // Manifest. 'superseded' means a newer apply owns the swap.
    try {
      newLayout = await layoutClient.compute(
        newManifest,
        layoutConfigFrom(settings),
        reusedLayout,
        (percent) => {
          // A superseded apply's worker keeps posting until it is told to stop;
          // its percent must not walk over the live build's readout.
          if (myGeneration === generation) events.emit('build:progress', { percent });
        }
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'superseded') return;
      throw err;
    }
    if (myGeneration !== generation) return;

    // The batch below holds the main thread for seconds on a big repo: hand the
    // browser a frame first, so the row naming that work paints before it.
    events.emit('build:stage', { stage: BuildStage.Assemble });
    await nextPaint();
    if (myGeneration !== generation) return;

    // Placed against the finished layout, so the scan belongs to the build, not
    // to the component that draws them: the batch below publishes a whole city.
    let newPlacements: TreePlacement[] | null = null;
    if (settings.TREES.ENABLED) {
      events.emit('build:stage', { stage: BuildStage.Decorate });
      const newBbox = cityBbox(newLayout, _halo());
      try {
        newPlacements = await treePlacementClient.compute(
          newLayout,
          sceneBboxOf(newBbox),
          newManifest.commits?.length ?? 0,
          newBbox.max.y - newBbox.min.y,
          {
            TREES: settings.TREES,
            FOOTPRINT: settings.FOOTPRINT,
            WORLD: settings.WORLD,
            ISLAND: settings.ISLAND,
          }
        );
      } catch (err) {
        if (err instanceof Error && err.message === 'superseded') return;
        throw err;
      }
      if (myGeneration !== generation) return;
    }

    // Swap the values, derive what follows from them, and only then tell
    // anyone — in that order, so a listener never reads half a city. Structure
    // first: the geometry consumers (island, gem, framing) have to be right
    // before the ones that draw on top of it.
    manifest = newManifest;
    layout = newLayout;
    treePlacements = newPlacements;
    _recomputeLayout();
    if (!shouldReuse) {
      _recomputeStructure();
      _tell('structure');
    }
    _tell('apply');
    // AFTER those, so this reads the meshes the components just built. Idle is
    // the composer's to set: the rebuilds are async and unheld here.
    _tell('published');
  }

  // A config-only Save calls this so the next apply of the same manifest takes
  // the non-reuse path and the scenic effects rebuild. Touches no signals.
  function invalidateLayoutCache(): void {
    invalidated = true;
  }

  // Getters, not a snapshot: an apply replaces these, and a component holding
  // `cityState` has to see the current one.
  return {
    get manifest() {
      return manifest;
    },
    get layout() {
      return layout;
    },
    get bbox() {
      return bbox;
    },
    get sceneBbox() {
      return sceneBbox;
    },
    get cityHeight() {
      return cityHeight;
    },
    get latestWorldBounds() {
      return latestWorldBounds;
    },
    get treePlacements() {
      return treePlacements;
    },
    get rootStreet() {
      return rootStreet;
    },
    get gemWorldPos() {
      return gemWorldPos;
    },
    get tallestBuilding() {
      return tallestBuilding;
    },
    get streetsByDirMap() {
      return streetsByDirMap;
    },
    on,
    applyManifest,
    buildStagesFor,
    invalidateLayoutCache,
  };
}
