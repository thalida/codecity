// hooks/useHomeBackdrop.ts — paints a city behind the landing for as long as
// HomeView is mounted: the project you were last in, from whatever the server
// had cached for it, then the featured repo. Neither scans, and every failure
// is silent, since the hero image underneath is already a complete answer.

// It chooses; it does not paint. The manifest it settles on is what <City>
// gets as a prop, so there is no city here to reach into and no way for a

import { ScanPhase } from '@codecity/city';
import type { Manifest } from '@codecity/city';
import { useEffect, useState } from 'preact/hooks';
import { useServerConfig } from '@/state/server';
import { RECENTS } from '@/state/recents';
import { CURRENT_SOURCE } from '@/state/source';
import { BACKDROP_CITY, BackdropKind } from '@/views/HomeView/backdrop';
import { identityBranch, resolveBranch, sameSourceIdentity } from '@codecity/city';
import { API } from '@/apiClient';

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
    for await (const event of API.streamManifest(API.manifestUrlFor({ src }), { signal })) {
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
function candidates(featuredRepo: string | undefined): Candidate[] {
  const out: Candidate[] = [];
  // The project you just left, from the server's cache. It used to be handed
  // over in memory, which meant the landing reading a manifest belonging to a
  const current = CURRENT_SOURCE.peek();
  if (current) {
    out.push({
      src: current.src,
      branch: current.branch,
      kind: BackdropKind.Recent,
      fetch: (signal) => API.fetchCachedManifest(current.src, current.branch, signal),
    });
  }
  const recent = RECENTS.peek()[0];
  if (recent && !sameSourceIdentity(recent, current ?? { src: '' })) {
    out.push({
      src: recent.src,
      branch: recent.branch,
      kind: BackdropKind.Recent,
      fetch: (signal) => API.fetchCachedManifest(recent.src, recent.branch, signal),
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

/** The manifest the landing should show behind it, or null while it is still
 *  looking. Hand it to a <City> as its `manifest`. */
export function useHomeBackdrop(): Manifest | null {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  // Featured gets its turn once the server's description lands.
  const featured = useServerConfig().featuredRepo;

  useEffect(() => {
    const controller = new AbortController();
    // One go each, so a re-run cannot re-fetch a failure: this is what lets
    // the effect give featured its turn when the config lands late.
    const tried = new Set<string>();
    let inFlight = false;

    async function tryNext(featuredRepo?: string): Promise<void> {
      const signal = controller.signal;
      const next = candidates(featuredRepo).find((c) => !tried.has(`${c.kind}:${c.src}`));
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
        setManifest(manifest);
        BACKDROP_CITY.value = {
          src: next.src,
          label: manifest.tree?.name ?? next.src,
          // Normalised the way commitSource does: identity includes the
          // branch, or the repo won't match its own row in recents.
          branch: identityBranch(next.src, resolveBranch(manifest, next.branch)),
          kind: next.kind,
        };
      } finally {
        inFlight = false;
      }
    }

    if (!inFlight && !BACKDROP_CITY.peek()) void tryNext(featured);

    return () => {
      controller.abort();
      BACKDROP_CITY.value = null;
    };
  }, [featured]);

  return manifest;
}
