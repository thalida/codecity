// hooks/useTimelineMode.ts — enter/exit the explicit Timeline mode.
//
// Enter: fetch the history bundle, pack the union city ONCE, install the scrub
// controller (which owns each building's scaleY + iFade and its street's opacity
// per frame), and flip TIMELINE_MODE so the live poll + fader stand down. Exit:
// tear the controller down and reload live HEAD. Called by the header toggle.

import { batch } from '@preact/signals';

import { fetchTimelineBundle } from '@/api/timeline';
import { buildPathTimelines } from '@/city/timeline/replay';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { markRebuilding, markError } from '@/state/stores/manifest';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { loadSource } from '@/hooks/useManifestSource';
import type { Manifest } from '@/types';

export async function enterTimelineMode(): Promise<void> {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return;
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;

  markRebuilding(); // footer feedback through the fetch (slow on a blobless remote)
  try {
    const bundle = await fetchTimelineBundle(cur.src, cur.branch);
    TIMELINE_BUNDLE.value = bundle;
    const timelines = buildPathTimelines(bundle);
    // unionManifest is the generated Manifest; the packer reads it structurally.
    await handle.applyManifest(bundle.unionManifest as unknown as Manifest);
    // After the pack: the rebuild recreates the street meshes at default (opaque),
    // so flip transparency on now, not before applyManifest.
    handle.timeline.setStreetsTransparent(true);
    handle.timeline.installScrubController(timelines);
    batch(() => {
      TIMELINE_MODE.value = true;
      SCRUB_POS.value = Math.max(0, bundle.commits.length - 1); // start at present
    });
  } catch (err) {
    // Leave nothing half-set: revert to live and surface via the footer.
    TIMELINE_MODE.value = false;
    handle.timeline.uninstallScrubController();
    handle.timeline.setStreetsTransparent(false);
    markError(err);
  }
}

export function exitTimelineMode(): void {
  const cur = CURRENT_SOURCE.peek();
  const handle = SCENE_HANDLE.peek();
  TIMELINE_MODE.value = false; // clears the poll + fader guards
  handle?.timeline.uninstallScrubController();
  handle?.timeline.setStreetsTransparent(false);
  if (cur) void loadSource({ src: cur.src, branch: cur.branch });
}
