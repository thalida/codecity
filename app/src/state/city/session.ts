// state/city/session.ts — one open project, whole: which repo, its manifest,
// how far its load and build have got, the history it is scrubbed through, and
// the city rendering it. Nothing here is app-wide, so a second session shares
// nothing — which is what lets two cities sit side by side.

import { signal, type Signal } from '@preact/signals';
import { createManifestStore, type ManifestStore } from '@/state/stores/manifest';
import { createSourceStore, type SourceStore } from '@/state/stores/source';
import { createProgressStore, type ProgressStore } from '@/state/stores/progress';
import { createTimelineStore, type TimelineStore } from '@/state/stores/timeline';
import { createCityCommands, type CityCommands } from '@/city/sceneHandle';
import { createProjectLoader, type ProjectLoader } from '@/hooks/useManifestSource';
import { createTimelineController, type TimelineController } from '@/hooks/useTimelineMode';
import type { CityScene } from '@/city/types';

/** The project open in one place. Loading a new source swaps its contents
 *  rather than making a second one; the city rendering it stays put. */
export interface CitySession {
  source: SourceStore;
  manifest: ManifestStore;
  progress: ProgressStore;
  timeline: TimelineStore;
  /** The scene drawing this city, while one is mounted. The chrome reaches
   *  through here to command it; a city with no scene is still a city. */
  scene: Signal<CityScene | null>;
  /** The verbs the chrome sends that city. */
  commands: CityCommands;
  /** Fetching this project: the scan, its cancel, and the live-update poll. */
  load: ProjectLoader;
  /** Timeline for this project: entering, scrubbing, and leaving. */
  timelineMode: TimelineController;
  dispose(): void;
}

export function createCitySession(): CitySession {
  // Order is the dependency graph: the manifest is what a source describes,
  // and both are what progress and history are measured against.
  const manifest = createManifestStore();
  const source = createSourceStore({ manifest });
  const progress = createProgressStore({ manifest, source });
  const timeline = createTimelineStore({ manifest });

  // The three below take the session they belong to, so a scan can reach the
  // timeline and back without the handler injection that used to bridge them.
  const session = {
    source,
    manifest,
    progress,
    timeline,
    scene: signal<CityScene | null>(null),
  } as CitySession;

  session.commands = createCityCommands(session);
  session.load = createProjectLoader(session);
  session.timelineMode = createTimelineController(session);
  session.dispose = () => {
    session.load.dispose();
    timeline.dispose();
  };
  return session;
}
