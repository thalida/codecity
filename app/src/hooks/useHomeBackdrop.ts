// hooks/useHomeBackdrop.ts — paints a city behind the switcher on a cold boot:
// the project you were last in, from whatever the server had cached for it,
// then the featured repo. Neither scans, and every failure is silent, since the
// hero image underneath is already a complete answer.

// Applies the manifest STRAIGHT TO THE SCENE, never writing MANIFEST: that
// signal means "the project you opened", which a backdrop is not.

import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { fetchCachedManifest, manifestUrlFor, streamManifest, ScanPhase } from '@/api/manifest';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { SCENE_HANDLE, type SceneHandle } from '@/state/stores/scene';
import { MANIFEST } from '@/state/stores/manifest';
import { RECENTS } from '@/state/stores/source';
import { ON_HOME, SWITCHER_DISMISSIBLE } from '@/state/stores/ui';
import { BACKDROP_CITY, BackdropKind } from '@/state/stores/backdrop';
import { identityBranch, resolveBranch } from '@/utils/sources';
import { isEmptyManifest } from '@/utils/manifest';
import type { Manifest } from '@/types';

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

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

/** Who gets to be the backdrop, best first. */
function candidates(featuredRepo: string | undefined): Candidate[] {
  const out: Candidate[] = [];
  const recent = RECENTS.peek()[0];
  if (recent) {
    out.push({
      src: recent.src,
      branch: recent.branch,
      kind: BackdropKind.Recent,
      fetch: (signal) => fetchCachedManifest(recent.src, recent.branch, signal),
    });
  }
  // Skipped when it IS the recent one: it would only paint the same city again.
  if (featuredRepo && featuredRepo !== recent?.src) {
    out.push({
      src: featuredRepo,
      kind: BackdropKind.Featured,
      fetch: (signal) => streamFeatured(featuredRepo, signal),
    });
  }
  return out;
}

export function useHomeBackdrop(): void {
  useEffect(() => {
    const controller = new AbortController();
    // One go each, so a re-run cannot re-fetch a failure: this is what lets
    // the effect give featured its turn when the config lands late.
    const tried = new Set<string>();
    let inFlight = false;
    let showcasing = false;

    async function tryNext(handle: SceneHandle, featuredRepo?: string): Promise<void> {
      const signal = controller.signal;
      const next = candidates(featuredRepo).find((c) => !tried.has(`${c.kind}:${c.src}`));
      if (!next) return;
      tried.add(`${next.kind}:${next.src}`);
      inFlight = true;
      try {
        const manifest = await next.fetch(signal);
        if (signal.aborted) return;
        // A real project landed mid-flight: the scene is theirs now, and
        // painting over it would be a visible glitch.
        if (!isEmptyManifest(MANIFEST.peek())) return;
        if (!manifest) {
          void tryNext(handle, featuredRepo); // nothing there, try the next one
          return;
        }
        await handle.applyManifest(manifest);
        if (signal.aborted) return;
        handle.rig.enterShowcase({ autoRotate: !prefersReducedMotion() });
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

    const stop = effect(() => {
      const home = ON_HOME.value;
      const handle = SCENE_HANDLE.value;
      // Re-runs when the server config lands, which is what gives the featured
      // fallback its turn.
      const featured = SERVER_CONFIG.value.featuredRepo;
      // Cold boot only: dismissible means there's a real city behind already,
      // and that one is the better backdrop.
      const coldBoot = home && !SWITCHER_DISMISSIBLE.value;

      if (coldBoot && handle && !inFlight && !BACKDROP_CITY.peek()) {
        showcasing = true;
        void tryNext(handle, featured);
      } else if (!home && showcasing) {
        // The user opened something. Hand the camera back before their city
        // arrives, or it inherits the turntable and spins under them.
        showcasing = false;
        handle?.rig.exitShowcase();
        BACKDROP_CITY.value = null;
      }
    });

    return () => {
      stop();
      controller.abort();
      if (showcasing) SCENE_HANDLE.peek()?.rig.exitShowcase();
      BACKDROP_CITY.value = null;
    };
  }, []);
}
