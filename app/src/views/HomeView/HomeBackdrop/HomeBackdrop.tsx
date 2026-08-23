// views/HomeView/HomeBackdrop — a city behind the landing, over the hero image,
// for as long as the landing is mounted: the repo you were last in, from
// whatever the server had cached for it, then the featured repo. Neither scans,
// and every failure is silent, since the hero image is already a whole answer.

import './HomeBackdrop.css';
import { useEffect, useMemo } from 'preact/hooks';
import { effect } from '@preact/signals';
import { fetchCachedManifest, manifestUrlFor, streamManifest, ScanPhase } from '@/api/manifest';
import { SERVER_CONFIG } from '@/state/stores/serverData';
import { CitySession } from '@/city/session/session';
import { RECENTS } from '@/state/stores/recents';
import {
  BACKDROP_CITY,
  BackdropKind,
  type BackdropCity,
} from '@/views/HomeView/HomeBackdrop/backdropCity';
import { sameSourceIdentity } from '@/utils/sources';
import { City } from '@/city/City';
import { CameraMode } from '@/city/scene/render/cameraRig';
import type { Manifest } from '@/types';

interface Candidate {
  src: string;
  branch?: string;
  kind: BackdropKind;
  fetch: (signal: AbortSignal) => Promise<Manifest | null>;
}

/** Stream the featured repo. Only the complete manifest: a skeleton's
 *  placeholder heights would show the city snapping into shape. */
async function streamFeatured(src: string, signal: AbortSignal): Promise<Manifest | null> {
  let complete: Manifest | null = null;
  try {
    for await (const event of streamManifest(manifestUrlFor({ src }), { signal })) {
      if (event.phase === ScanPhase.Error) return null;
      if (event.phase === ScanPhase.CompleteManifest) complete = event.manifest;
    }
  } catch (_) {
    return null;
  }
  return complete;
}

// Building a city holds the main thread for seconds on a big repo, and behind
// the landing that is a frozen page for a city nobody came to look at.
const BACKDROP_MAX_FILES = 5000;

/** Whether this manifest is small enough to build without freezing the page. */
function fitsBehindTheLanding(manifest: Manifest): boolean {
  const files = manifest.tree?.descendants_file_count;
  return files === undefined || files <= BACKDROP_MAX_FILES;
}

/** Who gets to be the backdrop, best first. `opened` is the city you just
 *  left: reading it picks a wallpaper, and nothing writes back. */
function candidates(featuredRepo: string | undefined, opened: CitySession): Candidate[] {
  const out: Candidate[] = [];
  // Still in that session, so no round trip: it is the city you were looking
  // at a moment ago.
  const loaded = opened.manifest.current.peek();
  const current = opened.source.current.peek();
  if (current && loaded) {
    out.push({
      src: current.src,
      branch: current.branch,
      kind: BackdropKind.Recent,
      fetch: () => Promise.resolve(loaded as Manifest),
    });
  }
  const recent = RECENTS.peek()[0];
  if (recent && !sameSourceIdentity(recent, current ?? { src: '' })) {
    out.push({
      src: recent.src,
      branch: recent.branch,
      kind: BackdropKind.Recent,
      fetch: (signal) => fetchCachedManifest(recent.src, recent.branch, signal),
    });
  }
  // Skipped when it IS the recent one: it would only paint the same city again.
  if (featuredRepo && featuredRepo !== recent?.src && featuredRepo !== current?.src) {
    out.push({
      src: featuredRepo,
      kind: BackdropKind.Featured,
      fetch: (signal) => streamFeatured(featuredRepo, signal),
    });
  }
  return out;
}

/** Its own session, never `opened`'s: that keeps a backdrop's load, status and
 *  scene off the chrome. `opened` is read to pick a repo, never written to. */
export function HomeBackdrop({ opened }: { opened: CitySession }) {
  // Per landing visit, like the canvas it feeds: a second one would be a
  // second wallpaper, showing whatever IT picked.
  const backdrop = useMemo(() => new CitySession({ cameraMode: CameraMode.Backdrop }), []);

  useEffect(() => {
    const controller = new AbortController();
    // One go each, so a re-run cannot re-fetch a failure: this is what lets
    // the effect give featured its turn when the config lands late.
    const tried = new Set<string>();
    let inFlight = false;

    async function tryNext(featuredRepo?: string): Promise<void> {
      const signal = controller.signal;
      const next = candidates(featuredRepo, opened).find((c) => !tried.has(`${c.kind}:${c.src}`));
      if (!next) return;
      tried.add(`${next.kind}:${next.src}`);
      inFlight = true;
      try {
        const manifest = await next.fetch(signal);
        if (signal.aborted) return;
        // Too big to build without freezing the page, or nothing there at all:
        // either way this candidate is out and the next one gets its turn.
        if (!manifest || !fitsBehindTheLanding(manifest)) {
          void tryNext(featuredRepo);
          return;
        }
        // set, not commit: showing you a repo is not you having opened it, so
        // it stays out of recents.
        const ref = backdrop.source.set(next.src, next.branch, manifest);
        pending = { ...ref, label: manifest.tree?.name ?? next.src, kind: next.kind };
      } finally {
        inFlight = false;
      }
    }

    // Named only once its city is on screen: BACKDROP_CITY fades the canvas
    // in, and a fade that starts on the manifest fades in an empty one.
    let pending: BackdropCity | null = null;
    const stopPainted = effect(() => {
      if (backdrop.progress.cityOnScreen.value) BACKDROP_CITY.value = pending;
    });

    // Re-runs when the server config lands, which gives featured its turn.
    const stopPick = effect(() => {
      const featured = SERVER_CONFIG.value.featuredRepo;
      if (!inFlight && !BACKDROP_CITY.peek()) void tryNext(featured);
    });

    return () => {
      stopPick();
      stopPainted();
      controller.abort();
      BACKDROP_CITY.value = null;
      backdrop.dispose();
    };
  }, [backdrop]);

  // Decoration: no chrome, no controls, and nothing here for a screen reader
  // that the landing does not already say in text.
  return (
    <div class={`landing-stage${BACKDROP_CITY.value ? ' is-painted' : ''}`} aria-hidden="true">
      <City session={backdrop} label="Decorative 3D city." />
    </div>
  );
}
