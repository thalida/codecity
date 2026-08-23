// city/types/index.ts — the shape every scene component, the composer and the
// render loop agree on. Types only.

import type * as THREE from 'three';
import type { Picker } from '../interaction/picker';
import type { CityConfig } from '../config';
import type { BuildingMaterial } from '../components/buildings/material';
import type { CameraRig } from '../render/cameraRig';
import type { CitySceneState } from '../state';
import type { Trees } from '../components/trees/treeRenderer';
import type { PathTimeline } from '../timeline/replay';
import type { ReadonlySignal } from '@preact/signals';
import type { Manifest, RangeStat } from '@/types';
import type { BuildStage } from '@/constants/progress';
import type { TimelineStore } from '@/state/stores/timeline';

/** What a city asks of whatever it is mounted in: it says what the user asked
 *  for and the app decides what moves. No chrome, and these are no-ops. */
export interface CityChrome {
  /** True while something else owns the keyboard, so scene shortcuts hold. */
  keyboardBusy(): boolean;
  /** The user asked what this node IS: the details are the answer. */
  showDetails(): void;
  /** The user asked to LOOK at the city: move whatever is in the way. */
  revealCity(): void;
}

/** What a component needs to wire itself in. picker is null until after the
 *  components exist, so anything needing it arms on the first tick. */
export interface SceneContext {
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  picker: Picker;
  sceneState: CitySceneState;
  /** What this city looks like. Every visual setting is read through here, so
   *  nothing under city/ reaches for the panel's own signals. */
  config: CityConfig;
  /** This city's building material and icon atlas: every cell of it shares
   *  one, so a uniform written there reaches this city and no other. */
  buildingMaterial: BuildingMaterial;
  /** What this city asks of whatever it is mounted in. */
  chrome: CityChrome;
  /** This city's history state, for the components drawing what a scrub
   *  implies. Its own, so a second city scrubs its own. */
  timeline: TimelineStore;
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

/** The machinery drawing one city: its canvas, renderer, camera and picker,
 *  and the verbs that swap what it is showing. The city itself is the session. */
export interface CityScene {
  /** What this city is showing: the manifest its last apply landed. */
  manifest: ReadonlySignal<Manifest | null>;
  scene: THREE.Scene;
  picker: Picker;
  rig: CameraRig;
  applyManifest(m: Manifest, leadingStages?: readonly BuildStage[]): Promise<void>;
  /** The stages that apply would run, for a caller whose own work comes first. */
  buildStagesFor(m: Manifest): BuildStage[];
  invalidateLayoutCache(): void;
  /** Re-pack what this city is already showing: the settings path, where the
   *  manifest has not moved and only the packer's inputs have. */
  repack(): Promise<void>;
  /** Resolves once a frame carrying the latest build has been presented, which
   *  WebGL will not tell you. `report.markIdle`'s moment, asked instead of told. */
  whenOnScreen(): Promise<void>;
  world: CityWorld;
  /** Timeline-mode install surface (see state/city/timelineMode). The controller
   *  is built here because it needs the components' mesh/attr resolvers. */
  timeline: CityTimeline;
  /** Tear all of it down. Required on unmount, or a remount stacks a second
   *  renderer and frame loop on the same canvas. */
  dispose(): void;
}
