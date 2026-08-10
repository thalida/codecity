// hooks/useFeaturedCity.ts — renders the server's featured repo behind the
// cold-boot landing, so the page shows what codecity makes instead of
// describing it. The switcher over a loaded city already looks like this; this
// gives the landing the same staging when there is no city yet.
//
// Applies the manifest STRAIGHT TO THE SCENE, never writing MANIFEST: that
// signal means "the project you opened", and the sidebar, title and
// dismissible-on-error logic all read it. A backdrop is not an opened project.
//
// Every failure is silent. This is decoration: a featured repo that won't clone
// should leave the landing exactly as it would have been without the feature.

import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { manifestUrlFor, streamManifest, ScanPhase } from '@/api/manifest';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { SCENE_HANDLE, type SceneHandle } from '@/state/stores/scene';
import { MANIFEST } from '@/state/stores/manifest';
import { PROJECTS_VIEW, FEATURED_CITY } from '@/state/stores/ui';
import { identityBranch, resolveBranch } from '@/utils/sources';
import { isEmptyManifest } from '@/utils/manifest';
import type { Manifest } from '@/types';

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Stream the featured repo's manifest. Returns null on any failure, and on a
 *  real project landing mid-flight: by then the scene belongs to that project
 *  and painting a backdrop over it would be a visible glitch. */
async function fetchFeatured(src: string, signal: AbortSignal): Promise<Manifest | null> {
  let complete: Manifest | null = null;
  try {
    for await (const event of streamManifest(manifestUrlFor({ src }), { signal })) {
      if (event.phase === ScanPhase.Error) return null;
      // Only the complete manifest: a skeleton's placeholder heights would show
      // the city snapping into shape, which is worse than showing it a beat later.
      if (event.phase === ScanPhase.CompleteManifest) complete = event.manifest;
    }
  } catch (_) {
    return null;
  }
  if (signal.aborted || !isEmptyManifest(MANIFEST.peek())) return null;
  return complete;
}

async function paint(src: string, handle: SceneHandle, signal: AbortSignal): Promise<void> {
  const manifest = await fetchFeatured(src, signal);
  if (!manifest) return;
  await handle.applyManifest(manifest);
  if (signal.aborted) return;
  handle.rig.enterShowcase({ autoRotate: !prefersReducedMotion() });
  // Normalised exactly the way setCurrentSource normalises an opened project.
  // Source identity includes the branch, so a featured repo recorded without
  // one would fail to match its own row in recents, which stores @main.
  FEATURED_CITY.value = {
    src,
    label: manifest.tree?.name ?? src,
    branch: identityBranch(src, resolveBranch(manifest, undefined)),
  };
}

export function useFeaturedCity(): void {
  useEffect(() => {
    const controller = new AbortController();
    let painting = false;
    let showcasing = false;

    const stop = effect(() => {
      const src = SERVER_CONFIG.value.featuredRepo;
      const pv = PROJECTS_VIEW.value;
      const handle = SCENE_HANDLE.value;
      // Cold boot only: dismissible means there's a real city behind already,
      // and that one is the better backdrop.
      const coldBoot = pv.visible && !pv.opts.dismissible;

      if (coldBoot && src && handle && !painting) {
        painting = true;
        showcasing = true;
        void paint(src, handle, controller.signal);
      } else if (!pv.visible && showcasing) {
        // The user opened something. Hand the camera back before their city
        // arrives, or it inherits the turntable and spins under them.
        showcasing = false;
        handle?.rig.exitShowcase();
        FEATURED_CITY.value = null;
      }
    });

    return () => {
      stop();
      controller.abort();
      if (showcasing) SCENE_HANDLE.peek()?.rig.exitShowcase();
      FEATURED_CITY.value = null;
    };
  }, []);
}
