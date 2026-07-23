// state/stores/historyManifest.ts — the manifest the left-sidebar file tree +
// search read. While scrubbing, the all-time UNION manifest (so deleted paths
// still appear and can be inspected); otherwise the live HEAD manifest. The
// README pane stays on HEAD (it fetches the current checkout), so it reads
// MANIFEST directly rather than this.

import { computed, type ReadonlySignal } from '@preact/signals';
import { MANIFEST, type ManifestValue } from './manifest';
import { TIMELINE_MODE, TIMELINE_BUNDLE } from './timeline';

export const HISTORY_MANIFEST: ReadonlySignal<ManifestValue> = computed(() => {
  const bundle = TIMELINE_BUNDLE.value;
  return TIMELINE_MODE.value && bundle
    ? (bundle.unionManifest as unknown as ManifestValue)
    : MANIFEST.value;
});
