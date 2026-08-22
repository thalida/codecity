// state/project/session.ts — one open project, whole: which repo, its manifest,
// how far its load and build have got, the history it is being scrubbed
// through, and the city rendering it. Nothing in here is app-wide, so a second
// session is a second project with nothing shared — which is what lets two
// cities sit side by side without hearing each other.

import { signal, type Signal } from '@preact/signals';
import { createManifestStore, type ManifestStore } from '@/state/stores/manifest';
import { createSourceStore, type SourceStore } from '@/state/stores/source';
import { createProgressStore, type ProgressStore } from '@/state/stores/progress';
import { createTimelineStore, type TimelineStore } from '@/state/stores/timeline';
import { createCityCommands, type CityCommands } from '@/city/sceneHandle';
import { createProjectLoader, type ProjectLoader } from '@/hooks/useManifestSource';
import { createTimelineController, type TimelineController } from '@/hooks/useTimelineMode';
import type { City } from '@/city/types';

export interface ProjectSession {
  source: SourceStore;
  manifest: ManifestStore;
  progress: ProgressStore;
  timeline: TimelineStore;
  /** The city rendering this project, while one is mounted. The chrome reaches
   *  through here to command it; a session with no city is still a session. */
  city: Signal<City | null>;
  /** The verbs the chrome sends that city. */
  commands: CityCommands;
  /** Fetching this project: the scan, its cancel, and the live-update poll. */
  load: ProjectLoader;
  /** Timeline for this project: entering, scrubbing, and leaving. */
  timelineMode: TimelineController;
  dispose(): void;
}

export function createProjectSession(): ProjectSession {
  // Order is the dependency graph: the manifest is what a source describes,
  // and both are what progress and history are measured against.
  const manifest = createManifestStore();
  const source = createSourceStore({ manifest });
  const progress = createProgressStore({ manifest, source });
  const timeline = createTimelineStore({ manifest });

  // The three below take the session they belong to, so a call can reach the
  // rest of it: filled in on the object rather than passed around, which is
  // what a scan needing the timeline (and vice versa) used to inject by hand.
  const session = {
    source,
    manifest,
    progress,
    timeline,
    city: signal<City | null>(null),
  } as ProjectSession;

  session.commands = createCityCommands(session);
  session.load = createProjectLoader(session);
  session.timelineMode = createTimelineController(session);
  session.dispose = () => {
    session.load.dispose();
    timeline.dispose();
  };
  return session;
}
