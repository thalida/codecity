// hooks/useHomeBackdrop.ts — paints a city behind the landing for as long as
// HomeView is mounted: the project you were last in, from whatever the server
// had cached for it, then the featured repo. Neither scans, and every failure
// is silent, since the hero image underneath is already a complete answer.

// Its own source signal and its own reporter, never MANIFEST and never the
// app's status: those mean "the project you opened", which a backdrop is not.

import { useEffect, useMemo } from 'preact/hooks';
import { effect, signal, type ReadonlySignal } from '@preact/signals';
import { fetchCachedManifest, manifestUrlFor, streamManifest, ScanPhase } from '@/api/manifest';
import { SERVER_CONFIG } from '@/state/stores/serverData';
import { SILENT_BUILD_REPORTER, type BuildReporter } from '@/state/stores/progress';
import { useCity } from '@/state/city/context';
import type { CitySession } from '@/state/city/session';
import { RECENTS, BACKDROP_CITY, BackdropKind, type BackdropCity } from '@/state/stores/source';
import { identityBranch, resolveBranch, sameSourceIdentity } from '@/utils/sources';
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

/** Who gets to be the backdrop, best first. */
function candidates(featuredRepo: string | undefined, session: CitySession): Candidate[] {
  const out: Candidate[] = [];
  // The project you just left, still in that session: no round trip, and it is
  // the city you were looking at a moment ago.
  const loaded = session.manifest.current.peek();
  const current = session.source.current.peek();
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

/** What the landing hands its city: the repo it picked, and a status channel
 *  nobody else reads. */
export interface HomeBackdrop {
  source: ReadonlySignal<Manifest | null>;
  report: BuildReporter;
}

export function useHomeBackdrop(): HomeBackdrop {
  // The landing's wallpaper opens on the project the focused session last had.
  const session = useCity();
  // Per landing visit, like the city it feeds: a second one would be a second
  // wallpaper, showing whatever IT picked.
  const backdrop = useMemo(() => {
    const source = signal<Manifest | null>(null);
    // Named only once it lands: BACKDROP_CITY fades the canvas in, and a fade
    // that starts on the manifest fades in an empty canvas.
    let painting: BackdropCity | null = null;
    const report: BuildReporter = {
      ...SILENT_BUILD_REPORTER,
      markIdle: () => {
        BACKDROP_CITY.value = painting;
      },
    };
    const show = (manifest: Manifest, city: BackdropCity): void => {
      painting = city;
      source.value = manifest;
    };
    return { source: source as ReadonlySignal<Manifest | null>, report, show };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // One go each, so a re-run cannot re-fetch a failure: this is what lets
    // the effect give featured its turn when the config lands late.
    const tried = new Set<string>();
    let inFlight = false;

    async function tryNext(featuredRepo?: string): Promise<void> {
      const signal = controller.signal;
      const next = candidates(featuredRepo, session).find((c) => !tried.has(`${c.kind}:${c.src}`));
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
        backdrop.show(manifest, {
          src: next.src,
          label: manifest.tree?.name ?? next.src,
          // Normalised the way commitSource does: identity includes the
          // branch, or the repo won't match its own row in recents.
          branch: identityBranch(next.src, resolveBranch(manifest, next.branch)),
          kind: next.kind,
        });
      } finally {
        inFlight = false;
      }
    }

    // Re-runs when the server config lands, which gives featured its turn.
    const stop = effect(() => {
      const featured = SERVER_CONFIG.value.featuredRepo;
      if (!inFlight && !BACKDROP_CITY.peek()) void tryNext(featured);
    });

    return () => {
      stop();
      controller.abort();
      BACKDROP_CITY.value = null;
    };
  }, []);

  return backdrop;
}
