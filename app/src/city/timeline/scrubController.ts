// city/timeline/scrubController.ts — per-frame building driver for Timeline mode.
//
// Reads SCRUB_POS and writes every scrub-varying per-instance attribute so a
// building renders as a real scan at that commit would: instance matrix
// (scaleY + floor count), presence opacity (iFade.x), weathered color
// (instanceColor), lit-window recency (iModifiedAge), grime/tilt age
// (iIconUV.w), and the iKind render mode — all with no re-pack. It owns
// these fields while in mode; the
// tween queue and fader are dormant (index.ts gates them on TIMELINE_MODE).
// iCols/iDoorWidth/iOrient/iIconUV.xyz don't vary with scrub (driven by
// bytes/ext/path, which the delta replay never changes) so they stay untouched.

import * as THREE from 'three';

import { SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { getBuildingDimensions } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/stores/settings/buildings';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';
import { FadeDetail, NodeKind } from '@/types';
import type { Building, RangeStat, Street } from '@/types';
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
import { lastModifiedIndexAt, linesAt, presenceAt, ruinStateAt } from './replay';
import type { PathTimeline } from './replay';

// A deleted building's ghost-ruin: a uniform low stub with a blank facade (0
// window rows), its hue pulled toward gray. Height/opacity/gray come from the
// RUINS settings store; these two are fixed.
const RUIN_BASE_RECENCY = 0.5; // sample the building's hue at mid-recency before graying
const _RUIN_GRAY = new THREE.Color(0.3, 0.31, 0.34);

// A future (not-yet-created) building: an ultra-low slab at the building's real
// footprint, tinted the future color — a ground marker of where it will land,
// via the building mesh (NOT the footprint plots, so it's independent of the
// footprint controls). Height in floors, ×FLOOR_HEIGHT at draw time.
export const FUTURE_SLAB_FLOORS = 0.05;

// A future slab keeps its file's own hue, sampled at mid-recency (it has no real
// last-modified date yet), then pulled toward the future color by BUILDING_TINT.
const FUTURE_BASE_RECENCY = 0.5;

// Dir paths of streets currently rendered as ruins — the picker rejects hits on
// them so a ruined road isn't hoverable/selectable (buildings use iKind instead).
// Owned here, repopulated each update(); read by interaction/picker.ts.
export const RUINED_STREET_DIRS = new Set<string>();

// Dir paths of streets rendered as future roads — not yet created at the scrub
// position, so the picker rejects hits (you can't select a folder that doesn't
// exist yet). Future buildings use iKind Future, which the picker treats as hidden.
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
  // Pair each union building with its replay timeline + the full ancestor street
  // chain (its own street PLUS every containing directory up to root) once; a
  // container street (e.g. `src/` with only subdirs) must stay visible as long as
  // ANY descendant file is live, not just direct children.
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

  // Scrub-relative modified date in ms. Once the file has reached its final (HEAD)
  // modification, use its own full-precision date so HEAD weathering is 1:1 with
  // Live; earlier in history only the day-precise commit date is available.
  // Falls back to the commit date when the file carries no modified date.
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

  function update(): void {
    const pos = SCRUB_POS.peek();
    deps.trees.setScrubCommit(Math.floor(pos));
    deps.fireflies.setScrubCommit(Math.floor(pos));
    // Height range for this commit → matches Live-at-that-commit. Degenerate {0,0} → {1,1}.
    const ri = Math.max(0, Math.min(deps.commitLineRanges.length - 1, Math.floor(pos)));
    const r = deps.commitLineRanges[ri];
    const lineStats: RangeStat = r && (r.min > 0 || r.max > 0) ? r : { min: 1, max: 1 };
    const dirtyMeshes = new Set<THREE.InstancedMesh>();
    const dirtyFades = new Set<THREE.BufferAttribute>();
    const dirtyColors = new Set<THREE.InstancedMesh>();
    const dirtyFloors = new Set<THREE.BufferAttribute>();
    const dirtyModifiedAges = new Set<THREE.BufferAttribute>();
    const dirtyIconUVs = new Set<THREE.BufferAttribute>();
    const dirtyKinds = new Set<THREE.BufferAttribute>();
    // A street fades with its PRESENT descendants; a ruin-only or future-only
    // street renders fully opaque, set apart by color instead of fading.
    const maxPresentOp = new Map<Street, number>();
    const ruinStreets = new Set<Street>();
    // Ad-panel opacity by path: the building's op when present, else 0 (a ruin or
    // absent building shows no media image). Feeds applyBuildingFades only.
    const opByPath = new Map<string, number>();
    const presentStreets = new Set<Street>();
    RUINED_STREET_DIRS.clear();
    FUTURE_STREET_DIRS.clear();

    const floorHeight = BUILDING_DIMENSIONS.peek().FLOOR_HEIGHT;
    const ruins = RUINS.peek();
    const ruinsOn = ruins.ENABLED;
    const ruinBuildingOpacity = ruins.BUILDING_OPACITY;
    const ruinHeight = ruins.STUB_HEIGHT * floorHeight;
    const ruinGrayMix = ruins.DESATURATION;

    const bp = BLUEPRINTS.peek();
    const futureOn = bp.ENABLED;
    const futureBuildingOpacity = bp.BUILDING_OPACITY;
    const futureHeight = FUTURE_SLAB_FLOORS * floorHeight;
    const futureTint = bp.BUILDING_TINT;
    _futureColor.set(bp.BUILDING_COLOR);

    // Pre-pass: weathering DATE ranges over the PRESENT buildings at this scrub
    // position — the file set + dates a real scan at this commit would see, so
    // color/window-lighting/grime normalize against them (and at HEAD the present
    // set == the live file set, matching the live view). Heights do NOT: see the
    // getBuildingDimensions call.
    let minMod = Infinity;
    let maxMod = -Infinity;
    let minCreated = Infinity;
    let maxCreated = -Infinity;
    for (const { b, pt, createdIdx, finalIdx } of entries) {
      if (ruinStateAt(pt, pos) !== 'present') continue;
      const modMs = modifiedMsAt(b, pt, finalIdx, pos);
      const createdMs = createdMsFor(b, createdIdx);
      if (modMs < minMod) minMod = modMs;
      if (modMs > maxMod) maxMod = modMs;
      if (createdMs < minCreated) minCreated = createdMs;
      if (createdMs > maxCreated) maxCreated = createdMs;
    }
    // Spread 0 (all present files share a date) → the live view's getSaturation/
    // getModifiedAge treat that as freshest (recency 1); createdAge as newest (0).
    const modSpread = maxMod - minMod;
    const createdSpread = maxCreated - minCreated;

    // Neighborhood fade cascade — the SAME tier decision buildingFader uses in
    // Live, so a hover/selection dims the surrounding city identically while
    // scrubbing. The fader is dormant in Timeline (it owns iFade in Live; the
    // scrub controller owns it here), so this is where the cascade gets applied.
    const sel = deps.picker.selection.peek();
    const hov = deps.picker.hover.peek();
    const bldgTargetFile = sel?.kind === NodeKind.File ? sel.file : null;
    const dirTarget = resolveDirTarget(sel, hov, deps.streetsByDir);
    const hoverFile = hov?.kind === NodeKind.File ? hov.file : null;
    const fadeCfg = BUILDINGS.peek();

    for (const { b, pt, streets, createdIdx, finalIdx } of entries) {
      const state = ruinStateAt(pt, pos);
      const present = state === 'present';
      const ruin = state === 'ruin' && ruinsOn;
      // Future: not yet created at this scrub position (genesis is ahead). Shown
      // as an ultra-low tinted slab at its eventual footprint — a marker of where
      // it WILL land, rendered via the building mesh (not the footprint plots).
      const future = !present && !ruin && futureOn && createdIdx > pos;
      // present → fully present; ruin → faint stub; future → faint slab;
      // before-genesis (out of range) or ruins-off deletion → gone.
      const op = present
        ? presenceAt(pt, pos, 0)
        : ruin
          ? ruinBuildingOpacity
          : future
            ? futureBuildingOpacity
            : 0;

      // Neighborhood fade cascade for PRESENT buildings: dim / silhouette /
      // outline this building by its dir-tree distance from the hover/selection
      // target, exactly as Live's fader does (op is 1 for a present file, so
      // op * tier.bodyOpacity reproduces the Live absolute). Non-present states
      // (ruin/future/absent) keep their own faint opacity, no cascade.
      let bodyOp = op;
      let silhouette = 0;
      let tierOutlineOp = 0;
      if (present) {
        const tier = tierFor(b.file, bldgTargetFile, dirTarget, hoverFile, fadeCfg);
        bodyOp = tier.detail === FadeDetail.Hidden ? 0 : op * tier.bodyOpacity;
        silhouette = tier.detail === FadeDetail.Silhouette ? 1 : 0;
        tierOutlineOp = tier.outlineEnabled ? tier.outlineOpacity : 0;
      }

      // Driven for EVERY union building (even one with no detail mesh on a large
      // repo), else the footprint/street strand at their defaults. A street's
      // future state isn't tracked per-building: any non-present, non-ruin street
      // is a future road (see the final loop), so the whole road network shows.
      for (const street of streets) {
        if (present) {
          maxPresentOp.set(street, Math.max(maxPresentOp.get(street) ?? 0, op));
          presentStreets.add(street);
        } else if (ruin) {
          ruinStreets.add(street);
        }
      }
      // opByPath feeds ONLY the facade panels — gate on presence so a ruin/absent/
      // future building shows no media image, just its stub or slab. Uses the
      // neighborhood-dimmed bodyOp so a media panel fades with its building body.
      opByPath.set(b.file.path, present ? bodyOp : 0);
      // Footprint plot: present + ruin only. A future building IS the slab, so it
      // gets no plot (keeps future independent of the footprint controls).
      deps.footprints.setBuildingFootprintOpacity(b.file.path, future ? 0 : op, ruin);

      const resolved = deps.getMeshForBuilding(b);
      if (!resolved) continue;
      const { mesh, slot } = resolved;

      // createdAge (0=newest, 1=oldest) is scrub-relative here — needed for both
      // the lean shear (below) and the window/grime weathering (iIconUV.w later).
      const createdMs = createdMsFor(b, createdIdx);
      const createdAge =
        present && createdSpread > 0
          ? 1 - Math.max(0, Math.min(1, (createdMs - minCreated) / createdSpread))
          : 0;

      const iFloorsAttr = mesh.geometry.getAttribute('iFloors') as
        | THREE.BufferAttribute
        | undefined;
      // The file as it stood at this scrub position: its replayed line count
      // drives both the height curve and the empty test. The union node's `size`
      // is a max-over-history footprint, never the size at this commit, so only
      // the replayed `lines` can say the file was empty HERE.
      const scrubFile = present ? { ...b.file, lines: linesAt(pt, pos) } : b.file;
      if (present) {
        // Gate height on presence (intervals), not line count: media/empty files are present with 0 lines.
        // Height uses lineStats (this commit's range); width stays layout-baked (b.w), so dims.w is unused.
        const dims = getBuildingDimensions(scrubFile, lineStats, deps.heightCtx.byteStats);
        if (iFloorsAttr) {
          iFloorsAttr.setX(slot, dims.floors);
          dirtyFloors.add(iFloorsAttr);
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
          dirtyFloors.add(iFloorsAttr);
        }
        _m.makeScale(b.w, ruinHeight, b.d);
        _m.setPosition(b.x, ruinHeight / 2, b.y);
      } else if (future) {
        // A future building: ultra-low slab at its real footprint, blank facade.
        if (iFloorsAttr) {
          iFloorsAttr.setX(slot, 0);
          dirtyFloors.add(iFloorsAttr);
        }
        _m.makeScale(b.w, futureHeight, b.d);
        _m.setPosition(b.x, futureHeight / 2, b.y);
      } else {
        // Absent → fully zero-scaled, not a flat (w, 0, d) quad that would still
        // write depth and outline as a cutout on the road.
        _m.makeScale(0, 0, 0);
      }
      mesh.setMatrixAt(slot, _m);
      dirtyMeshes.add(mesh);

      // iKind render mode, rewritten every frame so a state change resets it:
      // Ruin/Future for scrub states, else Empty for a file with no content at
      // this position, else Data for a present binary, else Normal.
      const iKindAttr = mesh.geometry.getAttribute('iKind') as THREE.BufferAttribute | undefined;
      if (iKindAttr) {
        let kind: number = BuildingKind.Normal;
        if (ruin) kind = BuildingKind.Ruin;
        else if (future) kind = BuildingKind.Future;
        else if (isEmptyFile(scrubFile)) kind = BuildingKind.Empty;
        else if (isDataBuilding(b.file)) kind = BuildingKind.Data;
        iKindAttr.setX(slot, kind);
        dirtyKinds.add(iKindAttr);
      }

      const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
      if (iFade) {
        // Present → neighborhood-tiered body(.x)/silhouette(.y)/outline(.z), owning
        // all three so a hover cascade actually shows. Non-present → its faint op
        // with no silhouette/outline, so a leftover Live-mode overlay can't linger.
        if (present) iFade.setXYZ(slot, bodyOp, silhouette, tierOutlineOp);
        else iFade.setXYZ(slot, op, 0, 0);
        dirtyFades.add(iFade);
      }

      // Weather: color / lit-windows / grime-age from the file's DATES at this
      // scrub position (not a commit-index proxy), normalized against the
      // present-file ranges — the exact formulas the live view bakes, so HEAD
      // matches. Absent buildings are already scaled/faded to 0, so skip them.
      if (present) {
        // recency = modified-date t (0=oldest, 1=newest) → getBuildingColor's curve.
        const modMs = modifiedMsAt(b, pt, finalIdx, pos);
        const recency = modSpread > 0 ? Math.max(0, Math.min(1, (modMs - minMod) / modSpread)) : 1;
        _color.set(
          getBuildingColorForRecency(
            b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
            recency
          )
        );
        mesh.setColorAt(slot, _color);
        dirtyColors.add(mesh);

        // getModifiedAge polarity: 0=most recent, 1=longest-untouched.
        const iModifiedAgeAttr = mesh.geometry.getAttribute('iModifiedAge') as
          | THREE.BufferAttribute
          | undefined;
        if (iModifiedAgeAttr) {
          iModifiedAgeAttr.setX(slot, 1 - recency);
          dirtyModifiedAges.add(iModifiedAgeAttr);
        }

        // createdAge (hoisted above) drives grime/weathering: 0=newest, 1=oldest.
        const iIconUVAttr = mesh.geometry.getAttribute('iIconUV') as
          | THREE.BufferAttribute
          | undefined;
        if (iIconUVAttr) {
          iIconUVAttr.setW(slot, createdAge);
          dirtyIconUVs.add(iIconUVAttr);
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
          .lerp(_RUIN_GRAY, ruinGrayMix);
        mesh.setColorAt(slot, _color);
        dirtyColors.add(mesh);
      } else if (future) {
        // A future slab keeps its file's own hue, pulled toward the future color.
        _color
          .set(
            getBuildingColorForRecency(
              b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
              FUTURE_BASE_RECENCY
            )
          )
          .lerp(_futureColor, futureTint);
        mesh.setColorAt(slot, _color);
        dirtyColors.add(mesh);
      }
    }

    for (const mesh of dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
    for (const iFade of dirtyFades) iFade.needsUpdate = true;
    for (const mesh of dirtyColors) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const attr of dirtyFloors) attr.needsUpdate = true;
    for (const attr of dirtyModifiedAges) attr.needsUpdate = true;
    for (const attr of dirtyIconUVs) attr.needsUpdate = true;
    for (const attr of dirtyKinds) attr.needsUpdate = true;
    // ?? 0 (not null): a panel the scrub never drives must HIDE, not linger at
    // its shown default — mirrors the footprint default-hidden fix. (Live-mode
    // buildingFader still uses null = "leave untouched".)
    deps.getFacadePanels()?.applyBuildingFades((p) => opByPath.get(p) ?? 0);
    // Every street gets written each frame (defaulting to 0) so an orphaned street can't stick at a stale opacity.
    // ROOT is forced to 1: the repo root directory always exists, even when scrubbed back to an empty tree.
    for (const street of allStreets) {
      const hasPresent = presentStreets.has(street);
      // Present descendants fade the road with the buildings; else a deleted-folder
      // road is a ruin, and any remaining non-root road is future (a folder not yet
      // created at this scrub position). Ruin + future roads render fully opaque,
      // set apart by their color, not by fading. Present wins over ruin over future.
      const streetRuin = ruinsOn && !street.isRoot && !hasPresent && ruinStreets.has(street);
      const streetFuture = futureOn && !street.isRoot && !hasPresent && !streetRuin;
      const op = street.isRoot
        ? 1
        : hasPresent
          ? (maxPresentOp.get(street) ?? 0)
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

  function dispose(): void {
    entries.length = 0;
    RUINED_STREET_DIRS.clear();
    FUTURE_STREET_DIRS.clear();
  }

  return { update, dispose };
}
