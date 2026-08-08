// Per-frame building driver for Timeline mode: reads SCRUB_POS and writes every
// scrub-varying per-instance attribute, no re-pack (tween queue + fader dormant).

import * as THREE from 'three';

import { SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { getBuildingDimensions } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/stores/settings/buildings';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';
import { FadeDetail, NodeKind } from '@/types';
import type { Building, FileNode, RangeStat, Street } from '@/types';
import type { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { InstancedFacadePanels } from '@/city/components/buildings/facadePanels';
import type { createPicker } from '@/city/interaction/picker';
import { getBuildingColorForRecency } from '@/city/components/buildings/color';
import { BuildingKind } from '@/city/components/buildings/buildingKind';
import { isDataBuilding } from '@/utils/binaryKind';
import { isEmptyFile } from '@/utils/emptyKind';
import { resolveDirTarget, tierFor } from '@/city/components/buildings/fadeTiers';
import { getBuildingTiltAtAge, composeShearMatrix } from '@/city/components/buildings/tilt';
import { parentDirPath } from '@/city/utils/path';
import { streetChainForDirPath } from '@/city/layout/streetPath';
import { entryAt, lastModifiedIndexAt, linesAt, presenceAt, ruinStateAt } from './replay';
import type { PathTimeline } from './replay';

// Deleted building's ghost-ruin: low gray stub, blank facade. Height/opacity/
// gray come from the RUINS store; these two are fixed.
const RUIN_BASE_RECENCY = 0.5; // sample the building's hue at mid-recency before graying
const _RUIN_GRAY = new THREE.Color(0.3, 0.31, 0.34);

// Future (not-yet-created) building: an ultra-low tinted slab via the building
// mesh (NOT footprint plots), so it's independent of the footprint controls.
export const FUTURE_SLAB_FLOORS = 0.05;

// A future slab keeps its file's own hue, sampled at mid-recency (it has no real
// last-modified date yet), then pulled toward the future color by BUILDING_TINT.
const FUTURE_BASE_RECENCY = 0.5;

// Streets rendered as ruins; the picker rejects hits on them (buildings use
// iKind instead). Repopulated each update(), read by interaction/picker.ts.
export const RUINED_STREET_DIRS = new Set<string>();

// Streets not yet created at the scrub position; the picker rejects hits on a
// folder that doesn't exist yet.
export const FUTURE_STREET_DIRS = new Set<string>();

export interface ScrubControllerDeps {
  getBuildingIndex(): BuildingIndex | null;
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
  getFacadePanels(): InstancedFacadePanels | null;
  // The picker's selection/hover — drives the neighborhood fade cascade so a
  // hover dims the surrounding city here exactly as buildingFader does in Live.
  picker: Pick<ReturnType<typeof createPicker>, 'selection' | 'hover'>;
  timelines: Map<string, PathTimeline>;
  // Per-commit line range (backend-computed); height normalizes against
  // range[floor(pos)] to match Live-at-that-commit. heightCtx is byteStats only.
  commitLineRanges: RangeStat[];
  heightCtx: HeightContext;
  streets: {
    setStreetOpacity(street: Street, opacity: number, tint: number): void;
    setStreetLabelOpacity(street: Street, opacity: number): void;
  };
  // { street dir.path → Street } from the union layout, for resolving a building's street.
  streetsByDir: Record<string, Street>;
  footprints: {
    setBuildingFootprintOpacity(path: string, opacity: number, ruin?: boolean): void;
    setStreetFootprintOpacity(dirPath: string, opacity: number, ruin?: boolean): void;
  };
  trees: {
    setScrubCommit(maxCommitIndex: number | null): void;
  };
  fireflies: {
    setScrubCommit(maxCommitIndex: number | null): void;
  };
}

export function createScrubController(deps: ScrubControllerDeps) {
  // Pair each building with its timeline + FULL ancestor street chain: a
  // container street must stay visible while ANY descendant file is live.
  const entries: {
    b: Building;
    pt: PathTimeline;
    streets: Street[];
    createdIdx: number;
    finalIdx: number;
  }[] = [];
  const allStreets: Street[] = [];
  const index = deps.getBuildingIndex();
  if (index) {
    for (const b of index.byPath.values()) {
      const path = b.file?.path;
      if (!path) continue;
      const pt = deps.timelines.get(path);
      if (!pt) continue;
      const dir = parentDirPath(path);
      const streets = streetChainForDirPath(dir, deps.streetsByDir);
      // First interval's start is the commit index the path was created at (genesis, not resurrection).
      const createdIdx = pt.intervals.length ? pt.intervals[0].start : 0;
      // Last change index = the file's final (HEAD) modification.
      const finalIdx = pt.changes.length ? pt.changes[pt.changes.length - 1].i : 0;
      entries.push({ b, pt, streets, createdIdx, finalIdx });
    }
  }
  for (const street of Object.values(deps.streetsByDir)) allStreets.push(street);

  // Commit dates as ms, for date-based weathering (matches the live view's
  // date-normalized color/age, not a commit-index proxy). Precomputed once.
  const _commitMs = (TIMELINE_BUNDLE.peek()?.commits ?? []).map((c) => Date.parse(c.date) || 0);
  const _dateRanges = TIMELINE_BUNDLE.peek()?.commitDateRanges ?? [];

  // Scrub-relative modified ms: full-precision own date once past its final
  // change (HEAD weathering 1:1 with Live), else the day-precise commit date.
  const modifiedMsAt = (b: Building, pt: PathTimeline, finalIdx: number, pos: number): number => {
    const lmIdx = lastModifiedIndexAt(pt, pos);
    if (lmIdx >= finalIdx) {
      const full = Date.parse(b.file?.modified ?? '');
      if (!Number.isNaN(full)) return full;
    }
    return _commitMs[lmIdx] ?? 0;
  };
  // Creation is a fixed event: prefer the file's full-precision created date
  // (matches Live's createdAge), fall back to its genesis commit date.
  const createdMsFor = (b: Building, createdIdx: number): number => {
    const full = Date.parse(b.file?.created ?? '');
    return Number.isNaN(full) ? (_commitMs[createdIdx] ?? 0) : full;
  };

  const _m = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _scale = new THREE.Vector3();
  const _color = new THREE.Color();
  const _futureColor = new THREE.Color();

  // Everything `update` reads once per frame.
  interface ScrubFrame {
    pos: number;
    lineStats: RangeStat;
    ruinsOn: boolean;
    ruinBuildingOpacity: number;
    ruinHeight: number;
    ruinGrayMix: number;
    futureOn: boolean;
    futureBuildingOpacity: number;
    futureHeight: number;
    futureTint: number;
    minMod: number;
    minCreated: number;
    modSpread: number;
    createdSpread: number;
    bldgTargetFile: FileNode | null;
    dirTarget: ReturnType<typeof resolveDirTarget>;
    hoverFile: FileNode | null;
    fadeCfg: ReturnType<typeof BUILDINGS.peek>;
  }

  function readScrubFrame(pos: number): ScrubFrame {
    // Height range for this commit → matches Live-at-that-commit. Degenerate {0,0} → {1,1}.
    const ri = Math.max(0, Math.min(deps.commitLineRanges.length - 1, Math.floor(pos)));
    const r = deps.commitLineRanges[ri];

    const floorHeight = BUILDING_DIMENSIONS.peek().FLOOR_HEIGHT;
    const ruins = RUINS.peek();
    const bp = BLUEPRINTS.peek();
    _futureColor.set(bp.BUILDING_COLOR);

    // Backend-replayed date ranges over the present set, like heights use
    // commitLineRanges. At HEAD the present set == live, so weathering matches.
    const dateRange = _dateRanges[Math.min(Math.floor(pos), _dateRanges.length - 1)];
    const minMod = dateRange?.minModified ?? 0;
    const minCreated = dateRange?.minCreated ?? 0;

    // The SAME tier decision buildingFader uses in Live, so hover dims the
    // city identically while scrubbing (the fader is dormant in Timeline).
    const sel = deps.picker.selection.peek();
    const hov = deps.picker.hover.peek();

    return {
      pos,
      lineStats: r && (r.min > 0 || r.max > 0) ? r : { min: 1, max: 1 },
      ruinsOn: ruins.ENABLED,
      ruinBuildingOpacity: ruins.BUILDING_OPACITY,
      ruinHeight: ruins.STUB_HEIGHT * floorHeight,
      ruinGrayMix: ruins.DESATURATION,
      futureOn: bp.ENABLED,
      futureBuildingOpacity: bp.BUILDING_OPACITY,
      futureHeight: FUTURE_SLAB_FLOORS * floorHeight,
      futureTint: bp.BUILDING_TINT,
      minMod,
      minCreated,
      // Spread 0 (all present files share a date) → freshest, matching Live.
      modSpread: (dateRange?.maxModified ?? 0) - minMod,
      createdSpread: (dateRange?.maxCreated ?? 0) - minCreated,
      bldgTargetFile: sel?.kind === NodeKind.File ? sel.file : null,
      dirTarget: resolveDirTarget(sel, hov, deps.streetsByDir),
      hoverFile: hov?.kind === NodeKind.File ? hov.file : null,
      fadeCfg: BUILDINGS.peek(),
    };
  }

  // What one pass over the buildings accumulates: the GPU attributes that need
  // re-upload, and the per-street rollup the street pass then consumes.
  interface ScrubSinks {
    meshes: Set<THREE.InstancedMesh>;
    fades: Set<THREE.BufferAttribute>;
    colors: Set<THREE.InstancedMesh>;
    floors: Set<THREE.BufferAttribute>;
    modifiedAges: Set<THREE.BufferAttribute>;
    iconUVs: Set<THREE.BufferAttribute>;
    kinds: Set<THREE.BufferAttribute>;
    // A street fades with its PRESENT descendants; a ruin-only or future-only
    // street renders fully opaque, set apart by color instead of fading.
    maxPresentOp: Map<Street, number>;
    ruinStreets: Set<Street>;
    presentStreets: Set<Street>;
    // Ad-panel opacity by path: the building's op when present, else 0 (a ruin
    // or absent building shows no media image). Feeds applyBuildingFades only.
    opByPath: Map<string, number>;
  }

  function createSinks(): ScrubSinks {
    return {
      meshes: new Set(),
      fades: new Set(),
      colors: new Set(),
      floors: new Set(),
      modifiedAges: new Set(),
      iconUVs: new Set(),
      kinds: new Set(),
      maxPresentOp: new Map(),
      ruinStreets: new Set(),
      presentStreets: new Set(),
      opByPath: new Map(),
    };
  }

  function flushSinks(s: ScrubSinks): void {
    for (const mesh of s.meshes) mesh.instanceMatrix.needsUpdate = true;
    for (const iFade of s.fades) iFade.needsUpdate = true;
    for (const mesh of s.colors) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const attr of s.floors) attr.needsUpdate = true;
    for (const attr of s.modifiedAges) attr.needsUpdate = true;
    for (const attr of s.iconUVs) attr.needsUpdate = true;
    for (const attr of s.kinds) attr.needsUpdate = true;
  }

  /** Height + matrix for one building, by scrub state. Writes iFloors too,
   *  since a ruin and a future slab both blank their window rows. */
  function writeBuildingShape(
    b: Building,
    slot: number,
    iFloorsAttr: THREE.BufferAttribute | undefined,
    present: boolean,
    ruin: boolean,
    future: boolean,
    scrubFile: FileNode,
    createdAge: number,
    f: ScrubFrame,
    s: ScrubSinks
  ): void {
    if (present) {
      // Gate height on presence (intervals), not line count: media/empty files are present with 0 lines.
      // Height uses lineStats (this commit's range); width stays layout-baked (b.w), so dims.w is unused.
      const dims = getBuildingDimensions(scrubFile, f.lineStats, deps.heightCtx.byteStats);
      if (iFloorsAttr) {
        iFloorsAttr.setX(slot, dims.floors);
        s.floors.add(iFloorsAttr);
      }
      // Bake the age-lean shear into the matrix so the picker + outline follow it.
      const { tiltX, tiltZ } = getBuildingTiltAtAge(b.file.path, createdAge);
      _pos.set(b.x, dims.h / 2, b.y);
      _scale.set(b.w, dims.h, b.d);
      composeShearMatrix(_pos, _scale, tiltX, tiltZ, _m);
    } else if (ruin) {
      // A deleted building: uniform low stub, blank facade (0 window rows) — reads as rubble.
      if (iFloorsAttr) {
        iFloorsAttr.setX(slot, 0);
        s.floors.add(iFloorsAttr);
      }
      _m.makeScale(b.w, f.ruinHeight, b.d);
      _m.setPosition(b.x, f.ruinHeight / 2, b.y);
    } else if (future) {
      // A future building: ultra-low slab at its real footprint, blank facade.
      if (iFloorsAttr) {
        iFloorsAttr.setX(slot, 0);
        s.floors.add(iFloorsAttr);
      }
      _m.makeScale(b.w, f.futureHeight, b.d);
      _m.setPosition(b.x, f.futureHeight / 2, b.y);
    } else {
      // Absent → fully zero-scaled, not a flat (w, 0, d) quad that would still
      // write depth and outline as a cutout on the road.
      _m.makeScale(0, 0, 0);
    }
  }

  /** Weathering from the file's DATES at this position, the exact formulas the
   *  live view bakes, so HEAD matches. Absent buildings are already faded to 0. */
  function writeBuildingWeathering(
    b: Building,
    pt: PathTimeline,
    mesh: THREE.InstancedMesh,
    slot: number,
    finalIdx: number,
    present: boolean,
    ruin: boolean,
    future: boolean,
    createdAge: number,
    f: ScrubFrame,
    s: ScrubSinks
  ): void {
    if (present) {
      // recency = modified-date t (0=oldest, 1=newest) → getBuildingColor's curve.
      const modMs = modifiedMsAt(b, pt, finalIdx, f.pos);
      const recency =
        f.modSpread > 0 ? Math.max(0, Math.min(1, (modMs - f.minMod) / f.modSpread)) : 1;
      _color.set(
        getBuildingColorForRecency(
          b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
          recency
        )
      );
      mesh.setColorAt(slot, _color);
      s.colors.add(mesh);

      // getModifiedAge polarity: 0=most recent, 1=longest-untouched.
      const iModifiedAgeAttr = mesh.geometry.getAttribute('iModifiedAge') as
        | THREE.BufferAttribute
        | undefined;
      if (iModifiedAgeAttr) {
        iModifiedAgeAttr.setX(slot, 1 - recency);
        s.modifiedAges.add(iModifiedAgeAttr);
      }

      // createdAge drives grime/weathering: 0=newest, 1=oldest.
      const iIconUVAttr = mesh.geometry.getAttribute('iIconUV') as
        | THREE.BufferAttribute
        | undefined;
      if (iIconUVAttr) {
        iIconUVAttr.setW(slot, createdAge);
        s.iconUVs.add(iIconUVAttr);
      }
    } else if (ruin) {
      // A ghost ruin keeps a muted memory of its file's hue, pulled toward gray.
      _color
        .set(
          getBuildingColorForRecency(
            b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
            RUIN_BASE_RECENCY
          )
        )
        .lerp(_RUIN_GRAY, f.ruinGrayMix);
      mesh.setColorAt(slot, _color);
      s.colors.add(mesh);
    } else if (future) {
      // A future slab keeps its file's own hue, pulled toward the future color.
      _color
        .set(
          getBuildingColorForRecency(
            b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
            FUTURE_BASE_RECENCY
          )
        )
        .lerp(_futureColor, f.futureTint);
      mesh.setColorAt(slot, _color);
      s.colors.add(mesh);
    }
  }

  // Reused scratch: this resolves once per building per frame, so returning a
  // fresh object would allocate tens of thousands of times a frame.
  const _scrubState = { present: false, ruin: false, future: false, op: 0 };

  function resolveScrubState(
    pt: PathTimeline,
    createdIdx: number,
    f: ScrubFrame
  ): typeof _scrubState {
    const state = ruinStateAt(pt, f.pos);
    const present = state === 'present';
    const ruin = state === 'ruin' && f.ruinsOn;
    // Future: genesis is ahead — an ultra-low tinted slab at its eventual footprint.
    const future = !present && !ruin && f.futureOn && createdIdx > f.pos;
    _scrubState.present = present;
    _scrubState.ruin = ruin;
    _scrubState.future = future;
    // present → fully present; ruin → faint stub; future → faint slab;
    // before-genesis (out of range) or ruins-off deletion → gone.
    _scrubState.op = present
      ? presenceAt(pt, f.pos, 0)
      : ruin
        ? f.ruinBuildingOpacity
        : future
          ? f.futureBuildingOpacity
          : 0;
    return _scrubState;
  }

  /** iKind recomputed every frame so a state change resets it: Ruin/Future,
   *  else Empty (no content here), else Data (binary), else Normal. */
  function resolveBuildingKind(
    file: FileNode,
    emptyFile: FileNode,
    ruin: boolean,
    future: boolean
  ): number {
    if (ruin) return BuildingKind.Ruin;
    if (future) return BuildingKind.Future;
    if (isEmptyFile(emptyFile)) return BuildingKind.Empty;
    if (isDataBuilding(file)) return BuildingKind.Data;
    return BuildingKind.Normal;
  }

  function applyBuildingAtScrub(
    entry: (typeof entries)[number],
    f: ScrubFrame,
    s: ScrubSinks
  ): void {
    const { b, pt, streets, createdIdx, finalIdx } = entry;
    const pos = f.pos;
    const { present, ruin, future, op } = resolveScrubState(pt, createdIdx, f);

    // Neighborhood fade for PRESENT buildings only, exactly as Live's fader
    // (op is 1 when present, so op * tier.bodyOpacity is the Live absolute).
    let bodyOp = op;
    let silhouette = 0;
    let tierOutlineOp = 0;
    if (present) {
      const tier = tierFor(b.file, f.bldgTargetFile, f.dirTarget, f.hoverFile, f.fadeCfg);
      bodyOp = tier.detail === FadeDetail.Hidden ? 0 : op * tier.bodyOpacity;
      silhouette = tier.detail === FadeDetail.Silhouette ? 1 : 0;
      tierOutlineOp = tier.outlineEnabled ? tier.outlineOpacity : 0;
    }

    // Driven for EVERY union building (even without a detail mesh), else the
    // footprint/street strand at their defaults.
    for (const street of streets) {
      if (present) {
        s.maxPresentOp.set(street, Math.max(s.maxPresentOp.get(street) ?? 0, op));
        s.presentStreets.add(street);
      } else if (ruin) {
        s.ruinStreets.add(street);
      }
    }
    // Facade panels only: gate on presence (no media image on a ruin/slab),
    // dimmed with the body so a panel fades with its building.
    s.opByPath.set(b.file.path, present ? bodyOp : 0);
    // Footprint plot: present + ruin only. A future building IS the slab, so it
    // gets no plot (keeps future independent of the footprint controls).
    deps.footprints.setBuildingFootprintOpacity(b.file.path, future ? 0 : op, ruin);

    const resolved = deps.getMeshForBuilding(b);
    if (!resolved) return;
    const { mesh, slot } = resolved;

    // createdAge (0=newest, 1=oldest) is scrub-relative here — needed for both
    // the lean shear and the window/grime weathering (iIconUV.w).
    const createdMs = createdMsFor(b, createdIdx);
    const createdAge =
      present && f.createdSpread > 0
        ? 1 - Math.max(0, Math.min(1, (createdMs - f.minCreated) / f.createdSpread))
        : 0;

    const iFloorsAttr = mesh.geometry.getAttribute('iFloors') as THREE.BufferAttribute | undefined;
    // Interpolated count: the union node's size is max-over-history, so only
    // the replay knows what this file measured HERE.
    const scrubFile = present ? { ...b.file, lines: linesAt(pt, pos) } : b.file;
    // Emptiness is a fact about the blob in effect, not a point on a curve:
    // between a 0-line commit and a later big one, a lerp reads non-empty.
    const emptyFile = present ? { ...b.file, lines: entryAt(pt, pos)?.lines ?? 0 } : b.file;

    writeBuildingShape(b, slot, iFloorsAttr, present, ruin, future, scrubFile, createdAge, f, s);
    mesh.setMatrixAt(slot, _m);
    s.meshes.add(mesh);

    const iKindAttr = mesh.geometry.getAttribute('iKind') as THREE.BufferAttribute | undefined;
    if (iKindAttr) {
      iKindAttr.setX(slot, resolveBuildingKind(b.file, emptyFile, ruin, future));
      s.kinds.add(iKindAttr);
    }

    const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
    if (iFade) {
      // Present → tiered body/silhouette/outline (owning all three so hover
      // shows); non-present → faint op only, so a Live overlay can't linger.
      if (present) iFade.setXYZ(slot, bodyOp, silhouette, tierOutlineOp);
      else iFade.setXYZ(slot, op, 0, 0);
      s.fades.add(iFade);
    }

    writeBuildingWeathering(b, pt, mesh, slot, finalIdx, present, ruin, future, createdAge, f, s);
  }

  function applyStreetsAtScrub(f: ScrubFrame, s: ScrubSinks): void {
    // Every street gets written each frame (defaulting to 0) so an orphaned street can't stick at a stale opacity.
    // ROOT is forced to 1: the repo root directory always exists, even when scrubbed back to an empty tree.
    for (const street of allStreets) {
      const hasPresent = s.presentStreets.has(street);
      // Present descendants fade the road with the buildings; else ruin, else
      // future. Ruin/future render opaque, set apart by color. Present > ruin > future.
      const streetRuin = f.ruinsOn && !street.isRoot && !hasPresent && s.ruinStreets.has(street);
      const streetFuture = f.futureOn && !street.isRoot && !hasPresent && !streetRuin;
      const op = street.isRoot
        ? 1
        : hasPresent
          ? (s.maxPresentOp.get(street) ?? 0)
          : streetRuin || streetFuture
            ? 1
            : 0;
      // Asphalt tint (streets machinery): 1 = ruin, 2 = future. Independent of the footprint controls.
      const tint = streetRuin ? 1 : streetFuture ? 2 : 0;
      deps.streets.setStreetOpacity(street, op, tint);
      deps.streets.setStreetLabelOpacity(street, op);
      if (street.dir?.path != null) {
        // Footprint plot: present + ruin only. A future road is the tinted asphalt,
        // so its plot stays hidden (keeps future independent of footprint controls).
        deps.footprints.setStreetFootprintOpacity(
          street.dir.path,
          streetFuture ? 0 : op,
          streetRuin
        );
        if (streetRuin) RUINED_STREET_DIRS.add(street.dir.path);
        else if (streetFuture) FUTURE_STREET_DIRS.add(street.dir.path);
      }
    }
  }

  function update(): void {
    const pos = SCRUB_POS.peek();
    deps.trees.setScrubCommit(Math.floor(pos));
    deps.fireflies.setScrubCommit(Math.floor(pos));

    RUINED_STREET_DIRS.clear();
    FUTURE_STREET_DIRS.clear();

    const frame = readScrubFrame(pos);
    const sinks = createSinks();

    for (const entry of entries) applyBuildingAtScrub(entry, frame, sinks);

    flushSinks(sinks);
    // ?? 0 (not null): an undriven panel must HIDE, not linger at its shown
    // default (Live's fader still uses null = leave untouched).
    deps.getFacadePanels()?.applyBuildingFades((p) => sinks.opByPath.get(p) ?? 0);
    applyStreetsAtScrub(frame, sinks);
  }

  function dispose(): void {
    entries.length = 0;
    RUINED_STREET_DIRS.clear();
    FUTURE_STREET_DIRS.clear();
  }

  return { update, dispose };
}
