// state/city/session.ts — one open city, whole: which repo, its manifest, how
// far its load and build have got, the history it is scrubbed through, and the
// scene drawing it. Nothing here is app-wide, so a second session shares
// nothing — which is what lets two cities sit side by side.

import { signal, type Signal } from '@preact/signals';
import { ManifestStore } from '@/state/stores/manifest';
import { SourceStore } from '@/state/stores/source';
import { ProgressStore } from '@/state/stores/progress';
import { TimelineStore } from '@/state/stores/timeline';
import { CityCommands } from '@/city/commands';
import { CityLoader } from '@/state/city/loader';
import { TimelineMode } from '@/state/city/timelineMode';
import type { CameraMode } from '@/city/render/cameraRig';
import { CityConfig } from '@/city/config';
import type { CityScene } from '@/city/types';

/** The city open in one place. Loading a new source swaps its contents rather
 *  than making a second one; the scene rendering it stays put. */
export class CitySession {
  /** What a scene of this city is for: the opened city is one you fly around,
   *  the landing's is a turntable. Left out, it is one you fly around. */
  constructor(readonly cameraMode?: CameraMode) {}

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
