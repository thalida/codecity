// city/state/index.ts — the per-city manifest-bound store: signals plus the
// async pipeline that advances them. Per-instance, not a module singleton.
// manifest/layout are SOURCE signals reassigned every apply, the revisions are
// change counters, the rest are computed. Components rebuild off them.
import { signal, computed, batch, type Signal, type ReadonlySignal } from '@preact/signals';
import * as THREE from 'three';
import { FOOTPRINT } from '@/state/settings/fields/footprint';
import { TREES } from '@/state/settings/fields/trees';
import { beginBuild, enterBuildStage, setBuildStagePercent } from '@/state/stores/build';
import { BuildStage } from '@/constants/buildStages';
import { StreetAxis } from '@/types';
import type { Building, CityBbox, CityLayout, Manifest, Street } from '@/types';
import { getWorldBounds, type WorldBounds } from '../utils/floorBounds';
import { nextPaint } from '../utils/nextPaint';
import type { TreePlacement } from '../components/trees/treePlacement';
import { gemAnchorXZ } from '@/city/components/gem/anchor';
import { buildIconAtlas } from '../components/buildings/atlas';
import { setIconAtlas } from '../components/buildings/material';
import type { createLayoutClient } from '../layout';

export interface CityState {
  manifest: Signal<Manifest | null>;
  // Full layout (positions + per-building dims), reassigned EVERY apply — feeds
  // the dims-dependent rebuilds (buildings/footprint/trees) + the bbox computed.
  layout: Signal<CityLayout | null>;
  // World bbox (street rects + building footprints + footprint halo). Off
  // structureRevision → frozen on a reuse apply; the cameraRig framing tracks it.
  readonly bbox: ReadonlySignal<THREE.Box3 | null>;
  // Placement-space view of bbox (CityLayout's XY = world XZ); for tree placement.
  readonly sceneBbox: ReadonlySignal<CityBbox | null>;
  // City vertical extent (bbox.max.y - min.y); feeds worldBounds.
  readonly cityHeight: ReadonlySignal<number>;
  // Island floor sizing. Computed off sceneBbox + cityHeight (frozen on reuse),
  // null until the first apply.
  readonly latestWorldBounds: ReadonlySignal<WorldBounds | null>;
  // Deferred tree-placement results: trees writes (null at rebuild start, the
  // array once the off-thread scan resolves); fireflies reacts off it.
  treePlacements: Signal<TreePlacement[] | null>;
  readonly rootStreet: ReadonlySignal<Street | null>;
  readonly gemWorldPos: ReadonlySignal<THREE.Vector3 | null>;
  // Tallest building (by height) for the camera start-framing height-fit. From
  // layout data, not the async building meshes (see the computed).
  readonly tallestBuilding: ReadonlySignal<Building | null>;
  // { street dir.path → Street }. The fader, pathLine, picker and debug API
  // resolve a street by directory here rather than through the component.
  readonly streetsByDirMap: ReadonlySignal<Record<string, Street>>;
  // Change counters, tracked while the data is peeked: structureRevision on a
  // non-reuse apply only, cityRevision on every apply, decoration on tree swaps.
  structureRevision: Signal<number>;
  cityRevision: Signal<number>;
  decorationRevision: Signal<number>;
  // Compute the layout off-thread, then set the source signals. leadingStages
  // are stages the CALLER already ran, so the readout counts them (Timeline).
  applyManifest(newManifest: Manifest, leadingStages?: readonly BuildStage[]): Promise<void>;
  // The stages applyManifest would run for this manifest. For a caller that
  // opens the readout on work of its own first.
  buildStagesFor(newManifest: Manifest): BuildStage[];
  // Forces the next apply onto the non-reuse path (rebuild for the same layout signature).
  invalidateLayoutCache(): void;
}

export function createCityState(layoutClient: ReturnType<typeof createLayoutClient>): CityState {
  const manifest = signal<Manifest | null>(null);
  const layout = signal<CityLayout | null>(null);
  const treePlacements = signal<TreePlacement[] | null>(null);
  // Change-notification counters (see CityState for what each means + who tracks it).
  const structureRevision = signal(0);
  const cityRevision = signal(0);
  const decorationRevision = signal(0);

  // Halo width, or 0 when off. Dedupes to a number so bbox re-fires only when
  // the halo changes, not on every FOOTPRINT change (which would refit).
  const footprintHalo = computed<number>(() => {
    const f = FOOTPRINT.value;
    return f.ENABLED && f.HALO_WIDTH > 0 ? f.HALO_WIDTH : 0;
  });

  // World bbox. Tracks structureRevision and peeks layout, so a reuse apply
  // leaves it frozen and cameraRig/island skip on the memoized value.
  const bbox = computed<THREE.Box3 | null>(() => {
    void structureRevision.value;
    const l = layout.peek();
    if (!l) return null;
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
    const halo = footprintHalo.value;
    if (halo > 0) {
      box.min.x -= halo;
      box.min.z -= halo;
      box.max.x += halo;
      box.max.z += halo;
    }
    return box;
  });

  // Placement-space view of the world bbox (CityLayout's XY axis == world XZ).
  const sceneBbox = computed<CityBbox | null>(() => {
    const b = bbox.value;
    if (!b) return null;
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
  });
  const cityHeight = computed<number>(() => {
    const b = bbox.value;
    return b ? b.max.y - b.min.y : 0;
  });

  // Island floor sizing, off sceneBbox + cityHeight, so it re-fits only on a
  // structure change. null until the first apply.
  const latestWorldBounds = computed<WorldBounds | null>(() => {
    const sb = sceneBbox.value;
    return sb ? getWorldBounds(sb, cityHeight.value) : null;
  });

  // The root-of-repo street, which gets the gem. Ref-stable on a reuse apply,
  // so the gem and cameraRig skip.
  const rootStreet = computed<Street | null>(() => {
    void structureRevision.value;
    return (layout.peek()?.streets ?? []).filter((s) => s.isRoot)[0] || null;
  });

  // The floor-level anchor at the root street's open end. gemAnchorXZ is the
  // one source of that geometry, shared with the gem mesh and tree placement.
  const gemWorldPos = computed<THREE.Vector3 | null>(() => {
    const root = rootStreet.value;
    if (!root) return null;
    const a = gemAnchorXZ(root);
    return new THREE.Vector3(a.x, 0, a.y);
  });

  // Tracks `layout`, NOT structureRevision: a reuse apply turns placeholder
  // heights real, and framing must not wait on the async building meshes.
  const tallestBuilding = computed<Building | null>(() => {
    const l = layout.value;
    if (!l) return null;
    let tallest: Building | null = null;
    for (const b of l.buildings) {
      if (!tallest || b.h > tallest.h) tallest = b;
    }
    return tallest;
  });

  // { dir.path → Street }, straight off layout.streets. Ref-stable on a reuse
  // apply, recomputed on a structure change.
  const streetsByDirMap = computed<Record<string, Street>>(() => {
    void structureRevision.value;
    const map: Record<string, Street> = {};
    for (const s of layout.peek()?.streets ?? []) {
      if (s.dir?.path != null) map[s.dir.path] = s;
    }
    return map;
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
      ...(TREES.peek().ENABLED ? [BuildStage.Decorate] : []),
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
    const prev = manifest.peek();
    const prevLayoutSig =
      prev && 'layout_signature' in prev ? (prev as Manifest).layout_signature : '';
    const shouldReuse =
      !invalidated && prevLayoutSig !== '' && newManifest.layout_signature === prevLayoutSig;
    invalidated = false;

    // The readout's denominator, decided before the first stage starts: a
    // fixed count would promise a stage this apply is not going to run.
    const own = buildStagesFor(newManifest);
    beginBuild([...leadingStages, ...own]);
    enterBuildStage(own[0]);
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
        setIconAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    enterBuildStage(BuildStage.Layout);
    const reusedLayout = shouldReuse ? layout.peek() : null;
    let newLayout: CityLayout;
    // Full envelope, not `.tree`: the worker contract stays typed against
    // Manifest. 'superseded' means a newer apply owns the swap.
    try {
      newLayout = await layoutClient.compute(newManifest, reusedLayout, (percent) => {
        // A superseded apply's worker keeps posting until it is told to stop;
        // its percent must not walk over the live build's readout.
        if (myGeneration === generation) setBuildStagePercent(percent);
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'superseded') return;
      throw err;
    }
    if (myGeneration !== generation) return;

    // The batch below holds the main thread for seconds on a big repo: hand the
    // browser a frame first, so the row naming that work paints before it.
    enterBuildStage(BuildStage.Assemble);
    await nextPaint();
    if (myGeneration !== generation) return;

    // One batch so consumers settle once. layout is set before structureRevision
    // so structure consumers peek it fresh; a reuse apply leaves them frozen.
    batch(() => {
      manifest.value = newManifest;
      layout.value = newLayout;
      if (!shouldReuse) structureRevision.value++;
      cityRevision.value++;
    });
  }

  // A config-only Save calls this so the next apply of the same manifest takes
  // the non-reuse path and the scenic effects rebuild. Touches no signals.
  function invalidateLayoutCache(): void {
    invalidated = true;
  }

  return {
    manifest,
    layout,
    bbox,
    sceneBbox,
    cityHeight,
    latestWorldBounds,
    treePlacements,
    rootStreet,
    gemWorldPos,
    tallestBuilding,
    streetsByDirMap,
    structureRevision,
    cityRevision,
    decorationRevision,
    applyManifest,
    buildStagesFor,
    invalidateLayoutCache,
  };
}
