// city/types/index.ts — the shape every scene component, the composer and the
// render loop agree on. Types only.

import type * as THREE from 'three';
import type { Picker } from '../interaction/picker';
import type { CameraRig, FocusMode } from '../render/cameraRig';
import type { CityResources } from '../resources';
import type { CitySettingsStore } from '../settings/store';
import type { CitySettingsPatch } from '../settings';
import type { CityStatus } from '../status';
import type { CityChangeListener } from '../change';
import type { CityViewState } from '../viewState';
import type { WatchOptions } from '../watch';
import type { TimelineRequest } from '../loadTimeline';
import type { TimelineBundle } from './timeline';
import type { CityState } from '../state';
import type { Trees } from '../components/trees/treeRenderer';
import type { PathTimeline } from '../timeline/replay';
import type { TimelineState } from '../timeline/state';
import type { BuildStage } from './build';
import type { CityEmitter } from '../events';
import type { SourceLoader } from '../loadSource';
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

/** The top-level city object returned by the city composer (createCity). */
export interface City {
  scene: THREE.Scene;
  picker: Picker;
  rig: CameraRig;
  /** Select what `ref` names and point the camera at it. False when there is
   *  nothing to look at — the caller's chrome should then stay where it is. */
  focus(ref: FocusRef, mode?: FocusMode): boolean;
  three: CityThree;
  /** What this city is doing, as one value: is there something to look at, is
   *  more coming, which phase, how far, what is it called. Readable at any
   *  moment — a host that mounts mid-load asks rather than needing to have
   *  been listening. This is what a readout binds to; `on` is for the detail
   *  behind it. */
  readonly status: CityStatus;
  /** Hear that `status` changed. Returns the unsubscribe. */
  onStatus(listener: (status: CityStatus) => void): () => void;
  /** Hear ONCE that something moved, with what moved and the values to read.
   *  What a UI binds to; the eleven events are the detail behind it. */
  onChange(listener: CityChangeListener): () => void;
  /** Keep this city on the newest version of the repo it is showing. Returns
   *  stop(). A refresh, not a load: no overlay, no skeleton. */
  watchSource(options?: WatchOptions): () => void;
  /** Ask once, now, whether the repo has moved. Same rules as a poll. */
  refreshSource(options?: WatchOptions): Promise<void>;
  /** Where you are in this city — selection and scrub position — as one plain
   *  value a host can store, put in a URL, or hand back later. */
  getViewState(): CityViewState;
  /** Put this city back where a snapshot says. An absent field is left alone. */
  setViewState(next: CityViewState): void;
  /** Subscribe to what this city is doing, event by event. Everything the
   *  consumer used to get by reading a global it now gets here, per instance. */
  on: CityEmitter['on'];
  /** Show a repo. The city fetches it, applies what comes back and reports the
   *  scan as it goes; the manifest arrives on `scan:manifest`. */
  loadSource: SourceLoader['load'];
  /** Stop whatever is loading. A load already superseded by another needs no
   *  cancelling: the next one does it. */
  cancelLoad(): void;
  /** Show this repo's HISTORY rather than its working tree: the union of every
   *  file that ever existed, packed once, with a scrubber over it. */
  loadTimeline(request: TimelineRequest): Promise<TimelineBundle>;
  /** Stop a timeline load. Only meaningful before the pack begins. */
  cancelTimelineLoad(): void;
  /** This city's own API client, on the base URL it was given. Exposed because
   *  a consumer's chrome (a file pane, a branch picker) talks to the same
   *  server about the same repo, and should not build a second one. */
  client: CodecityClient;
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
