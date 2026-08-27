// city/types/index.ts — the shape every scene component, the composer and the
// render loop agree on. Types only.

import type * as THREE from 'three';
import type { Picker } from '../interaction/picker';
import type { CameraRig } from '../render/cameraRig';
import type { CityResources } from '../resources';
import type { CitySettingsStore, SettingSignals } from '../settings/store';
import type { CitySettingsPatch } from '../settings';
import type { CityState } from '../state';
import type { Trees } from '../components/trees/treeRenderer';
import type { PathTimeline } from '../timeline/replay';
import type { BuildStage } from './build';
import type { CityEmitter } from '../events';
import type { Manifest, RangeStat } from '@/city/types/manifest';

/** What a component needs to wire itself in. picker is null until after the
 *  components exist, so anything needing it arms on the first tick. */
export interface SceneContext {
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  picker: Picker;
  cityState: CityState;
  /** GPU handles and caches this city owns alone — see city/resources.ts. */
  resources: CityResources;
  /** This city's own settings — see settings/store.ts. Never a module global:
   *  two cities on one page hold different values. */
  settings: SettingSignals;
}

/** Per-frame state passed to each component's tick() method. */
export interface FrameContext {
  dt: number;
  time: number;
  camera: THREE.PerspectiveCamera;
}

/** Minimal uniform contract every scene component satisfies. */
export interface SceneComponent {
  /** The composer adds this to the scene. */
  group: THREE.Object3D;
  /** Frame loop calls it if present. */
  tick?(dt: number, ctx: FrameContext): void;
  /** Re-fit anything cached against the viewport, on a canvas resize. */
  onResize?(cw: number, ch: number): void;
  /** Frees GPU resources AND stops own effects. */
  dispose(): void;
}

/** The scene-internal surface the view layer can't reach through signals.
 *  Plain manifest data is read from MANIFEST, never duplicated here. */
export interface CityWorld {
  getTrees(): Trees | null;
  runCollisionCheck(): void;
  runStemPlacementDiagnostic(): void;
  /** Audit every tree's trunk base against the ground plane. */
  runTreeGroundingDiagnostic(): void;
}

/** Timeline-mode install surface on the City handle. Owns building the scrub
 *  controller from the components + moving the streets into the transparent pass. */
export interface CityTimeline {
  /** Install the scrub controller. Only once the union has been packed. */
  installScrubController(timelines: Map<string, PathTimeline>, commitLineRanges: RangeStat[]): void;
  /** Uninstall + dispose the scrub controller (returns the tweens to the tick). */
  uninstallScrubController(): void;
  /** Move both street materials into (true) or out of (false) the transparent pass. */
  setStreetsTransparent(on: boolean): void;
  /** Move the footprint material into (true) or out of (false) the transparent pass. */
  setFootprintsTransparent(on: boolean): void;
}

/** The top-level city object returned by the city composer (createCity). */
export interface City {
  scene: THREE.Scene;
  picker: Picker;
  rig: CameraRig;
  /** Subscribe to what this city is doing. Everything the consumer used to get
   *  by reading a global it now gets here, per instance. */
  on: CityEmitter['on'];
  /** This city's resolved settings. Read through `snapshot()`; write through
   *  `updateSettings`. */
  settings: CitySettingsStore;
  /** The whole settings input surface: a plain patch, no reactive primitive of
   *  the caller's. What it costs (a repack, a uniform refresh, nothing) is the
   *  city's decision, off each field's declared route. */
  updateSettings(patch: CitySettingsPatch): void;
  applyManifest(m: Manifest, leadingStages?: readonly BuildStage[]): Promise<void>;
  /** The stages that apply would run, for a caller whose own work comes first. */
  buildStagesFor(m: Manifest): BuildStage[];
  invalidateLayoutCache(): void;
  world: CityWorld;
  /** Timeline-mode install surface (see hooks/useTimelineMode). The controller
   *  is built here because it needs the components' mesh/attr resolvers. */
  timeline: CityTimeline;
  /** Tear all of it down. Required on unmount, or a remount stacks a second
   *  renderer and frame loop on the same canvas. */
  dispose(): void;
}
