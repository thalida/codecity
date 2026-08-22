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
import type { CityBindings, CityScene } from '@/city/types';
import type { Manifest } from '@/types';

/** The city open in one place. Loading a new source swaps its contents rather
 *  than making a second one; the scene rendering it stays put. */
export class CitySession {
  /** Order is the dependency graph: the manifest is what a source describes,
   *  and both are what progress and history are measured against. */
  readonly manifest = new ManifestStore();
  readonly source = new SourceStore(this.manifest);
  readonly progress = new ProgressStore(this.manifest, this.source);
  readonly timeline = new TimelineStore(this.manifest);

  /** The scene drawing this city, while one is mounted. The chrome reaches
   *  through here to command it; a city with no scene is still a city. */
  readonly scene: Signal<CityScene | null> = signal(null);

  /** The verbs the chrome sends that scene. */
  readonly commands = new CityCommands(this);
  /** Fetching this city: the scan, its cancel, and the live-update poll. */
  readonly load = new CityLoader(this);
  /** Timeline for this city: entering, scrubbing, and leaving. */
  readonly timelineMode = new TimelineMode(this);

  /** Everything a scene drawing this city is wired to. One place, so the two
   *  cities on screen differ only in which session they were handed. */
  bindings(cameraMode?: CameraMode): CityBindings {
    return {
      cameraMode,
      report: this.progress,
      subjectKey: () => this.source.key.peek(),
      timeline: {
        store: this.timeline,
        // The store's value spans the skeleton the stream emits before it is
        // fully typed; the scene takes manifests.
        liveManifest: () => this.manifest.current.peek() as Manifest | null,
        reassemble: () => this.timelineMode.reassemble(),
      },
    };
  }

  dispose(): void {
    this.load.dispose();
    this.timeline.dispose();
  }
}
