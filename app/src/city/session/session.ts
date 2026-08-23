// state/city/session.ts — one open city, whole: which repo, its manifest, how
// far its load and build have got, the history it is scrubbed through, and the
// scene drawing it. Nothing here is app-wide, so a second session shares
// nothing — which is what lets two cities sit side by side.

import { signal, type Signal } from '@preact/signals';
import { ManifestStore } from '@/city/session/stores/manifest';
import { SourceStore } from '@/city/session/stores/source';
import { ProgressStore } from '@/city/session/stores/progress';
import { TimelineStore } from '@/city/session/stores/timeline';
import { CityCommands } from '@/city/session/commands';
import { CityLoader } from '@/city/session/loader';
import { TimelineMode } from '@/city/session/timelineMode';
import type { CameraMode } from '@/city/scene/render/cameraRig';
import type { CityChrome } from '@/city/scene/types';
import { CityConfig } from '@/city/session/config';
import type { CityScene } from '@/city/scene/types';

/** The city open in one place. Loading a new source swaps its contents rather
 *  than making a second one; the scene rendering it stays put. */
/** A city with nothing around it: no panes to open, no drawer to close, and
 *  nothing else holding the keyboard. What a backdrop gets. */
const NO_CHROME: CityChrome = {
  keyboardBusy: () => false,
  showDetails: () => {},
  revealCity: () => {},
};

export interface CitySessionOptions {
  /** What a scene of this city is for: the opened city is one you fly around,
   *  the landing's is a turntable. Left out, it is one you fly around. */
  cameraMode?: CameraMode;
  /** What it may ask of the app it is mounted in. Left out, it asks nothing. */
  chrome?: CityChrome;
}

export class CitySession {
  readonly cameraMode?: CameraMode;
  readonly chrome: CityChrome;

  constructor(opts: CitySessionOptions = {}) {
    this.cameraMode = opts.cameraMode;
    this.chrome = opts.chrome ?? NO_CHROME;
  }

  /** Order is the dependency graph: the manifest is what a source describes,
   *  and both are what progress and history are measured against. */
  readonly manifest = new ManifestStore();
  readonly source = new SourceStore(this.manifest);
  readonly progress = new ProgressStore(this.manifest, this.source);
  readonly timeline = new TimelineStore(this.manifest);
  /** What this city looks like. Its own, so a second city can differ. */
  readonly config = new CityConfig();

  /** The scene drawing this city, while one is mounted. The chrome reaches
   *  through here to command it; a city with no scene is still a city. */
  readonly scene: Signal<CityScene | null> = signal(null);

  /** The verbs the chrome sends that scene. */
  readonly commands = new CityCommands(this);
  /** Fetching this city: the scan, its cancel, and the live-update poll. */
  readonly load = new CityLoader(this);
  /** Timeline for this city: entering, scrubbing, and leaving. */
  readonly timelineMode = new TimelineMode(this);

  dispose(): void {
    this.load.dispose();
    this.timeline.dispose();
  }
}
