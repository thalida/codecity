// city/types/index.ts — the shape every scene component, the composer and the
// render loop agree on. Types only.

import type * as THREE from 'three';
import type { Picker } from '../interaction/picker';
import type { CameraMode, CameraRig } from '../render/cameraRig';
import type { CityState } from '../state';
import type { Trees } from '../components/trees/treeRenderer';
import type { PathTimeline } from '../timeline/replay';
import type { ReadonlySignal } from '@preact/signals';
import type { Manifest, RangeStat } from '@/types';
import type { BuildStage } from '@/constants/progress';
import type { BuildReporter } from '@/state/stores/progress';

/** What a component needs to wire itself in. picker is null until after the
 *  components exist, so anything needing it arms on the first tick. */
export interface SceneContext {
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  picker: Picker;
  cityState: CityState;
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
/** Scrubbing, for a city something scrubs through time. Left out, this city
 *  has no timeline: nothing gates its contents and nothing prunes its picks. */
export interface CityTimelineBinding {
  /** Tracked: leaving the mode tears this city's scrub controller down. */
  mode: ReadonlySignal<boolean>;
  /** Peeked per frame: where the scrubber is, and whether it is still held. */
  scrubPos: ReadonlySignal<number>;
  scrubDragging: ReadonlySignal<boolean>;
  /** What to rebuild from on exit: a union city holds buildings that do not
   *  exist at HEAD. A call, not a signal, so no store's type leaks in here. */
  liveManifest(): Manifest | null;
  /** Re-pack while the mode is on, for a setting that moved the packer's
   *  inputs: the union city is assembled, not applied from one manifest. */
  repack(): Promise<void>;
}

/** How a city is configured: what the one mounting it decides. Leave a field
 *  out and that part is off, which is what makes two of them independent. */
export interface CityBindings {
  /** Camera behaviour: what this city is for. */
  cameraMode?: CameraMode;
  /** Where this city announces its build, for whoever mounted it. Left out, it
   *  reports to nobody. Questions go the other way, through the handle. */
  report?: BuildReporter;
  /** What it is a picture OF, as one comparable string. The camera refits when
   *  it changes, so skeleton→heights→history frames once, not three times. */
  subjectKey?(): string | null;
  timeline?: CityTimelineBinding;
}

export interface City {
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
  /** Timeline-mode install surface (see hooks/useTimelineMode). The controller
   *  is built here because it needs the components' mesh/attr resolvers. */
  timeline: CityTimeline;
  /** Tear all of it down. Required on unmount, or a remount stacks a second
   *  renderer and frame loop on the same canvas. */
  dispose(): void;
}
