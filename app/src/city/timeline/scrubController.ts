// city/timeline/scrubController.ts — per-frame building driver for Timeline mode.
//
// Reads SCRUB_POS and writes every scrub-varying per-instance attribute so a
// building renders as a real scan at that commit would: instance matrix
// (scaleY + floor count), presence opacity (iFade.x), weathered color
// (instanceColor), lit-window recency (iModifiedAge), grime/tilt age
// (iIconUV.w), and the ghost-ruin flag (iRuin) — all with no re-pack. It owns
// these fields while in mode; the
// tween queue and fader are dormant (index.ts gates them on TIMELINE_MODE).
// iCols/iDoorWidth/iOrient/iIconUV.xyz don't vary with scrub (driven by
// bytes/ext/path, which the delta replay never changes) so they stay untouched.

import * as THREE from 'three';

import { SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { getBuildingDimensions } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';
import type { Building, Street } from '@/types';
import type { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { InstancedAdPanels } from '@/city/components/buildings/adPanels';
import { getBuildingColorForRecency } from '@/city/components/buildings/color';
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

// Dir paths of streets currently rendered as ruins — the picker rejects hits on
// them so a ruined road isn't hoverable/selectable (buildings use iRuin instead).
// Owned here, repopulated each update(); read by interaction/picker.ts.
export const RUINED_STREET_DIRS = new Set<string>();

// Dir paths of streets rendered as future roads — not yet created at the scrub
// position, so the picker rejects hits (you can't select a folder that doesn't
// exist yet). Future buildings use iRuin (2), which the picker treats as hidden.
export const FUTURE_STREET_DIRS = new Set<string>();

export interface ScrubControllerDeps {
  getBuildingIndex(): BuildingIndex | null;
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
  getAdPanels(): InstancedAdPanels | null;
  timelines: Map<string, PathTimeline>;
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
  const entries: { b: Building; pt: PathTimeline; streets: Street[]; createdIdx: number }[] = [];
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
      entries.push({ b, pt, streets, createdIdx });
    }
  }
  for (const street of Object.values(deps.streetsByDir)) allStreets.push(street);

  // Commit dates as ms, for date-based weathering (matches the live view's
  // date-normalized color/age, not a commit-index proxy). Precomputed once.
  const _commitMs = (TIMELINE_BUNDLE.peek()?.commits ?? []).map((c) => Date.parse(c.date) || 0);

  const _m = new THREE.Matrix4();
  const _color = new THREE.Color();
  const _futureColor = new THREE.Color();

  function update(): void {
    const pos = SCRUB_POS.peek();
    deps.trees.setScrubCommit(Math.floor(pos));
    deps.fireflies.setScrubCommit(Math.floor(pos));
    const dirtyMeshes = new Set<THREE.InstancedMesh>();
    const dirtyFades = new Set<THREE.BufferAttribute>();
    const dirtyColors = new Set<THREE.InstancedMesh>();
    const dirtyFloors = new Set<THREE.BufferAttribute>();
    const dirtyModifiedAges = new Set<THREE.BufferAttribute>();
    const dirtyIconUVs = new Set<THREE.BufferAttribute>();
    const dirtyRuins = new Set<THREE.BufferAttribute>();
    // A street fades with its PRESENT descendants; a ruin-only or future-only
    // street uses the road opacity instead, so building vs road opacity stay
    // independent.
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
    const ruinRoadOpacity = ruins.ROAD_OPACITY;
    const ruinHeight = ruins.STUB_HEIGHT * floorHeight;
    const ruinGrayMix = ruins.DESATURATION;

    const bp = BLUEPRINTS.peek();
    const futureOn = bp.ENABLED;
    const futureBuildingOpacity = bp.BUILDING_OPACITY;
    const futureRoadOpacity = bp.ROAD_OPACITY;
    const futureHeight = FUTURE_SLAB_FLOORS * floorHeight;
    _futureColor.set(bp.BUILDING_COLOR);

    // Pre-pass: weathering ranges over the PRESENT buildings at this scrub
    // position — last-modified + created commit dates, and line counts. Color,
    // window-lighting, grime, and floors all normalize against these, so a
    // building renders as a real scan at this commit would (and at HEAD, where
    // present == the live file set, it matches the non-timeline view exactly).
    let minMod = Infinity;
    let maxMod = -Infinity;
    let minCreated = Infinity;
    let maxCreated = -Infinity;
    let minLines = Infinity;
    let maxLines = -Infinity;
    for (const { pt, createdIdx } of entries) {
      if (ruinStateAt(pt, pos) !== 'present') continue;
      const modMs = _commitMs[lastModifiedIndexAt(pt, pos)] ?? 0;
      const createdMs = _commitMs[createdIdx] ?? 0;
      const lines = linesAt(pt, pos);
      if (modMs < minMod) minMod = modMs;
      if (modMs > maxMod) maxMod = modMs;
      if (createdMs < minCreated) minCreated = createdMs;
      if (createdMs > maxCreated) maxCreated = createdMs;
      if (lines < minLines) minLines = lines;
      if (lines > maxLines) maxLines = lines;
    }
    // Spread 0 (all present files share a date) → the live view's getSaturation/
    // getModifiedAge treat that as freshest (recency 1); createdAge as newest (0).
    const modSpread = maxMod - minMod;
    const createdSpread = maxCreated - minCreated;
    const presentLineStats = {
      min: minLines === Infinity ? 0 : minLines,
      max: maxLines === -Infinity ? 0 : maxLines,
    };

    for (const { b, pt, streets, createdIdx } of entries) {
      const state = ruinStateAt(pt, pos);
      const present = state === 'present';
      const ruin = state === 'ruin' && ruinsOn;
      // Future: not yet created at this scrub position (genesis is ahead). Shown
      // as an ultra-low tinted slab at its eventual footprint — a marker of where
      // it WILL land, rendered via the building mesh (not the footprint plots).
      const future = !present && !ruin && futureOn && createdIdx > pos;
      // present → genesis grow-in ramp; ruin → faint stub; future → faint slab;
      // before-genesis (out of range) or ruins-off deletion → gone.
      const op = present
        ? presenceAt(pt, pos, 0)
        : ruin
          ? ruinBuildingOpacity
          : future
            ? futureBuildingOpacity
            : 0;

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
      // opByPath feeds ONLY the ad panels — gate on presence so a ruin/absent/
      // future building shows no media image, just its stub or slab.
      opByPath.set(b.file.path, present ? op : 0);
      // Footprint plot: present + ruin only. A future building IS the slab, so it
      // gets no plot (keeps future independent of the footprint controls).
      deps.footprints.setBuildingFootprintOpacity(b.file.path, future ? 0 : op, ruin);

      const resolved = deps.getMeshForBuilding(b);
      if (!resolved) continue;
      const { mesh, slot } = resolved;

      const iFloorsAttr = mesh.geometry.getAttribute('iFloors') as
        | THREE.BufferAttribute
        | undefined;
      if (present) {
        // Gate height on presence (intervals), not line count: media/empty files are present with 0 lines.
        const dims = getBuildingDimensions(
          { ...b.file, lines: linesAt(pt, pos) },
          presentLineStats, // present-file line range → floors match a real scan (byteStats drives width only, unused: matrix uses b.w)
          deps.heightCtx.byteStats
        );
        if (iFloorsAttr) {
          iFloorsAttr.setX(slot, dims.floors);
          dirtyFloors.add(iFloorsAttr);
        }
        _m.makeScale(b.w, dims.h, b.d);
        _m.setPosition(b.x, dims.h / 2, b.y);
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

      // iRuin is a 3-state the frag branches on: 1 = ruin (crumble + grime),
      // 2 = future (blank slab, no crumble). Both suppress the door. Written
      // every frame so a state change clears back to 0.
      const iRuinAttr = mesh.geometry.getAttribute('iRuin') as THREE.BufferAttribute | undefined;
      if (iRuinAttr) {
        iRuinAttr.setX(slot, ruin ? 1 : future ? 2 : 0);
        dirtyRuins.add(iRuinAttr);
      }

      const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
      if (iFade) {
        // Outline (.z) only while present, so a leftover Live-mode outline can't linger on a ruin/future/absent building.
        iFade.setXYZ(slot, op, iFade.getY(slot), present ? iFade.getZ(slot) : 0);
        dirtyFades.add(iFade);
      }

      // Weather: color / lit-windows / grime-age from the file's DATES at this
      // scrub position (not a commit-index proxy), normalized against the
      // present-file ranges — the exact formulas the live view bakes, so HEAD
      // matches. Absent buildings are already scaled/faded to 0, so skip them.
      if (present) {
        // recency = modified-date t (0=oldest, 1=newest) → getBuildingColor's curve.
        const modMs = _commitMs[lastModifiedIndexAt(pt, pos)] ?? 0;
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

        // getCreatedAge polarity: 0=newest, 1=oldest, on the creation-date axis.
        const createdMs = _commitMs[createdIdx] ?? 0;
        const createdAge =
          createdSpread > 0
            ? 1 - Math.max(0, Math.min(1, (createdMs - minCreated) / createdSpread))
            : 0;
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
        // A future slab reads in the future tint, not its eventual file hue.
        mesh.setColorAt(slot, _futureColor);
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
    for (const attr of dirtyRuins) attr.needsUpdate = true;
    // ?? 0 (not null): a panel the scrub never drives must HIDE, not linger at
    // its shown default — mirrors the footprint default-hidden fix. (Live-mode
    // buildingFader still uses null = "leave untouched".)
    deps.getAdPanels()?.applyBuildingFades((p) => opByPath.get(p) ?? 0);
    // Every street gets written each frame (defaulting to 0) so an orphaned street can't stick at a stale opacity.
    // ROOT is forced to 1: the repo root directory always exists, even when scrubbed back to an empty tree.
    for (const street of allStreets) {
      const hasPresent = presentStreets.has(street);
      // Present descendants fade the road; else a deleted-folder road is a ruin,
      // and any remaining non-root road is future (a folder not yet created at
      // this scrub position). Present wins over ruin wins over future.
      const streetRuin = ruinsOn && !street.isRoot && !hasPresent && ruinStreets.has(street);
      const streetFuture = futureOn && !street.isRoot && !hasPresent && !streetRuin;
      const op = street.isRoot
        ? 1
        : hasPresent
          ? (maxPresentOp.get(street) ?? 0)
          : streetRuin
            ? ruinRoadOpacity
            : streetFuture
              ? futureRoadOpacity
              : 0;
      // Asphalt tint (streets machinery): 1 = ruin, 2 = future. Independent of the footprint controls.
      const tint = streetRuin ? 1 : streetFuture ? 2 : 0;
      deps.streets.setStreetOpacity(street, op, tint);
      deps.streets.setStreetLabelOpacity(street, op);
      if (street.dir?.path != null) {
        // Footprint plot: present + ruin only. A future road is the tinted asphalt,
        // so its plot stays hidden (keeps future independent of footprint controls).
        deps.footprints.setStreetFootprintOpacity(street.dir.path, streetFuture ? 0 : op, streetRuin);
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
