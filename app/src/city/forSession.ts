// city/forProject.ts — the configuration that renders one project as a city:
// what it shows, whose readouts its build drives, what it is a picture of, and
// the scrubber that owns it in Timeline. The city layer reads no store, so this
// is the one place a session's signals become a city's config.

import { computed } from '@preact/signals';
import { CameraMode } from '@/city/render/cameraRig';
import type { CitySession } from '@/state/city/session';
import type { CityProps } from '@/city/City';
import type { Manifest } from '@/types';

/** Render `session` as a city: pass the result straight to <City>. */
export function cityPropsFor(session: CitySession): CityProps {
  const { manifest, source, progress, timeline } = session;
  return {
    // The store's value spans the skeleton the stream emits before it is fully
    // typed; the city takes manifests.
    source: computed<Manifest | null>(() => manifest.current.value as Manifest | null),
    cameraMode: CameraMode.Project,
    report: progress.reporter,
    subjectKey: () => source.key.peek(),
    timeline: {
      store: timeline,
      liveManifest: () => manifest.current.peek() as Manifest | null,
      repack: () => session.timelineMode.reapply(),
    },
    handle: session.scene,
  };
}
