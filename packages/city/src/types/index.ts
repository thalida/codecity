// city/types/index.ts — the shape every scene component, the composer and the
// render loop agree on. Types only.

import type * as THREE from 'three';
import type { Picker } from '../interaction/picker';
import type { CameraRig, FocusMode } from '../render/cameraRig';
import type { CityResources } from '../render/resources';
import type { CitySettingsStore } from '../settings/store';
import type { CitySettingsPatch } from '../settings';
import type { CityStatus } from '../state/status';
import type { CityChangeListener } from '../state/change';
import type { CityViewState } from '../state/viewState';
import type { WatchOptions } from '../data/watch';
import type { TimelineRequest } from '../data/loadTimeline';
import type { TimelineBundle } from './timeline';
import type { CityState } from '../state';
import type { Trees } from '../components/trees/treeRenderer';
import type { PathTimeline } from '../timeline/replay';
import type { TimelineState } from '../timeline/state';
import type { BuildStage } from './build';
import type { CityEmitter } from '../state/events';
import type { SourceLoader } from '../data/loadSource';
import type { CodecityClient } from '../client';
import type { Manifest, RangeStat } from './manifest';

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
  settings: CitySettingsStore;
  /** The history this city is showing, and where in it. Per city for the same
   *  reason: a bundle is one repo's history. */
  timeline: TimelineState;
  /** This city's API client, on the base URL it was built with. */
  client: CodecityClient;
}

/** Per-frame state passed to each component's tick() method. */
export interface FrameContext {
  dt: number;
  time: number;
  camera: THREE.PerspectiveCamera;
}

/** Minimal uniform contract every scene component satisfies. */
/** A layer of a city. Everything the city draws is one of these, and so is
 *  anything a host adds: same contract, same frame loop, same teardown.
 *
 *  `group` is added to the scene, `tick` is called every frame if present, and
 *  `dispose` has to free GPU resources AND stop any subscription it opened —
 *  a city can be torn down and rebuilt on the same page. */
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

/** A host's own layer, built once the city's context exists. Given everything
 *  the city's own components get: the scene, the picker, this city's settings
 *  and timeline, and its client. Returns a component, or null to add nothing —
 *  which is how an extension turns itself off without the host branching. */
export type CityExtension = (ctx: SceneContext) => SceneComponent | null;

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
export interface CityTimeline extends TimelineState {
  /** Install the scrub controller. Only once the union has been packed. */
  installScrubController(timelines: Map<string, PathTimeline>, commitLineRanges: RangeStat[]): void;
  /** Uninstall + dispose the scrub controller (returns the tweens to the tick). */
  uninstallScrubController(): void;
  /** Move both street materials into (true) or out of (false) the transparent pass. */
  setStreetsTransparent(on: boolean): void;
  /** Move the footprint material into (true) or out of (false) the transparent pass. */
  setFootprintsTransparent(on: boolean): void;
}

/** What a focus command points at: a node by path, a commit by sha, or
 *  whatever is already selected. */
export type FocusRef = { path: string } | { sha: string } | null;

/** The raw Three.js objects, for a consumer doing something this API has no
 *  opinion about. Read freely; writing is your own risk. */
export interface CityThree {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
}
