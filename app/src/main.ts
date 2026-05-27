// main.ts — Entry point. Fetches the manifest from the local Python server
// at /api/manifest, lays out the city, builds the scene, and starts the
// render loop with orbit/pan/zoom controls and raycast picking.

import './styles.css';

import * as Config from './config/index.js';
import { REBUILD_STATUS } from './store/liveStatus.js';
import { attachPersistence, persistAtomPerSource } from './store/persist.js';
import { SYNTAX_THEME } from './config/prefs/syntaxTheme.js';
import { sourceKey, CURRENT_SOURCE_KEY } from './store/sourceContext.js';
import { attachCommitReactions } from './store/configCommitReactions.js';
import { setupLiveUpdates } from './store/liveUpdates.js';
import { DOM_IDS } from './constants';
import { NodeKind } from './types';
import type { Manifest } from './types';

import { PICKER_SELECTION_KEY } from './scene/system/picker.js';
import { manifestUrl } from './utils/url.js';
import { _srcKind, _deriveLabel } from './utils/source.js';
import { applyHljsTheme } from './utils/syntaxTheme.js';
import { buildIconAtlas } from './scene/components/buildings/iconAtlas.js';
import { setIconAtlas } from './scene/components/buildings/buildings.js';
import { setCellIconAtlas } from './scene/components/buildings/buildingsCell.js';
import { createSourcePicker, type SourcePayload } from './views/source/sourcePicker.js';
import { createLoadingOverlay } from './views/source/loadingOverlay.js';
import { streamManifest } from './utils/manifestStream.js';
import { pushRecent } from './views/source/sourceRecents.js';
import { startRenderLoop, _applyDisplayLabel } from './scene/renderLoop.js';

const EMPTY_MANIFEST: Manifest = {
  root: '',
  scanned_at: new Date().toISOString(),
  signature: '',
  tree_signature: '',
  tree: {
    name: '',
    type: NodeKind.Directory,
    path: '',
    fullPath: '',
    children: [],
    children_count: 0,
    children_file_count: 0,
    children_dir_count: 0,
    descendants_count: 0,
    descendants_file_count: 0,
    descendants_dir_count: 0,
    descendants_size: 0,
  },
  repo: null,
  commits: null,
};

// Boot. Guarded by a canvas check so unit tests can import this module
// without triggering any DOM/network side effects.
const _canvas = document.getElementById(DOM_IDS.CANVAS) as HTMLCanvasElement | null;
if (_canvas) {
  (async function boot() {
    // Hydrate every config store from localStorage BEFORE the initial
    // manifest fetch so SCAN_FILTERS.SHOW_ALL_FILES (which feeds
    // manifestUrl) reflects the user's persisted toggle from a prior
    // session — otherwise the first paint ignores the saved value and
    // only corrects itself on the next poll.
    attachPersistence(Config);

    // Apply the persisted (or default) syntax theme immediately after
    // hydration, then track future changes. The subscribe call fires
    // synchronously on registration — that first fire covers the boot case.
    SYNTAX_THEME.subscribe(applyHljsTheme);

    // Set CURRENT_SOURCE_KEY from URL params BEFORE wiring per-source
    // persistence so hydration sees the right key.
    {
      const qp = new URLSearchParams(window.location.search);
      if (qp.has('src')) {
        CURRENT_SOURCE_KEY.set(sourceKey(qp.get('src')!, qp.get('branch') ?? undefined));
      }
    }

    persistAtomPerSource('selection', PICKER_SELECTION_KEY, null);

    const qp = new URLSearchParams(window.location.search);
    const hasSrc = qp.has('src');

    const loadingOverlay = createLoadingOverlay();

    // Forward REBUILD_STATUS → loadingOverlay so the loading card
    // advances to "Adding decorations" while applyManifest is in its
    // deferred foliage-build phase. Lives for the page lifetime so
    // source-switches (which re-show the overlay) also get the step.
    // setStep on a hidden overlay is a harmless DOM update.
    REBUILD_STATUS.subscribe((s) => {
      if (s === 'decorating') loadingOverlay.setStep('decorating');
    });

    let initialManifest: Manifest = EMPTY_MANIFEST;
    let initialError: string | null = null;
    let handle: Awaited<ReturnType<typeof startRenderLoop>> | null = null;
    if (hasSrc) {
      const _bootSrc = qp.get('src')!;
      const _bootBranch = qp.get('branch') ?? undefined;
      loadingOverlay.show({
        kind: _srcKind(_bootSrc),
        label: _deriveLabel(_bootSrc),
        branch: _bootBranch,
      });
      try {
        for await (const event of streamManifest(manifestUrl())) {
          if (event.phase === 'error') throw new Error(event.error);
          // Lifecycle markers (cloning/scanning) carry no manifest —
          // advance the overlay step and continue. The first manifest-
          // bearing event (skeleton or final) does the bootstrap below.
          if (event.phase === 'cloning' || event.phase === 'scanning') {
            loadingOverlay.setStep(event.phase);
            continue;
          }
          const m = event.manifest;
          // Advance the overlay step BEFORE the (synchronous-looking) work
          // begins so the user sees the phase update before the city paints
          // behind the semi-transparent backdrop.
          loadingOverlay.setStep(event.phase === 'skeleton' ? 'skeleton' : 'building');
          if (handle === null) {
            // First manifest event — skeleton on cold cache, or final on
            // cache hit. Either way: bootstrap the renderer NOW so the city
            // becomes visible behind the overlay. The skeleton manifest has
            // the full tree shape, so the icon atlas built from it is
            // correct for the final manifest too — no rebuild needed when
            // final arrives. world.applyManifest diff-and-tweens the
            // skeleton → final transition.
            try {
              const _builtAtlas = await buildIconAtlas(m);
              setIconAtlas(_builtAtlas);
              setCellIconAtlas(_builtAtlas);
            } catch (err) {
              console.warn(
                '[codecity] icon atlas build failed; roofs will render without icons',
                err
              );
            }
            handle = await startRenderLoop(_canvas, m);
            attachCommitReactions({
              world: handle.world,
              applyTheme: handle.applyTheme,
            });
          } else {
            // Second event (final after skeleton) — tween the city into its
            // final state. startRenderLoop already applied the skeleton, so
            // re-call applyManifest on the existing scene. Phase 2 swaps
            // b.file to the fresh FileNode from the new manifest so colors,
            // ages, and dimensions compute from real metadata on the cache-hit
            // fast path.
            await handle.world.applyManifest(m);
          }
          initialManifest = m;
        }
        if (handle === null) {
          // Stream closed without emitting a single event.
          throw new Error('No manifest received');
        }
      } catch (err) {
        initialError = err instanceof Error ? err.message : String(err);
        // If we never constructed a renderer, do it with EMPTY now so the
        // rest of main.ts (picker, Save-commit reactions) has a valid
        // handle to work against.
        if (handle === null) {
          handle = await startRenderLoop(_canvas, EMPTY_MANIFEST);
          attachCommitReactions({
            world: handle.world,
            applyTheme: handle.applyTheme,
          });
        }
        initialManifest = EMPTY_MANIFEST;
      } finally {
        // Hide only after both events (or cache-hit single final) have been
        // fully applied — the spec's "modal stays up until the city is
        // fully built" invariant.
        loadingOverlay.hide();
      }
    } else {
      handle = await startRenderLoop(_canvas, EMPTY_MANIFEST);
      attachCommitReactions({
        world: handle.world,
        applyTheme: handle.applyTheme,
      });
    }

    let liveUpdatesStarted = false;
    let _liveUpdates: { setSignature(sig: string): void } | null = null;
    if (hasSrc && !initialError) {
      _liveUpdates = setupLiveUpdates(handle, initialManifest.signature);
      liveUpdatesStarted = true;
    }

    // Remember the dismissible flag of the most recent open() call so error
    // reopen preserves it (header-switch reopen stays dismissible after a
    // failed submit; cold-boot reopen stays non-dismissible).
    let _lastDismissible = false;

    async function applyNewSource(payload: SourcePayload): Promise<void> {
      // Clear the layout cache so the cell fast path doesn't reuse stale cells
      // from the previous source. The cache is valid within a single source
      // (skeleton → final live-update), but must be reset when switching sources
      // since different repos can produce the same tree_signature by coincidence.
      handle.world.resetCache();
      const dismissibleOnError = _lastDismissible;
      loadingOverlay.show({
        kind: _srcKind(payload.src),
        label: _deriveLabel(payload.src),
        branch: payload.branch,
      });
      try {
        const url = new URL('/api/manifest', window.location.origin);
        url.searchParams.set('src', payload.src);
        if (payload.branch) url.searchParams.set('branch', payload.branch);
        if (payload.gitWindow) url.searchParams.set('git_window', payload.gitWindow);

        let manifest: Manifest | null = null;
        for await (const event of streamManifest(url.toString())) {
          if (event.phase === 'error') throw new Error(event.error);
          // Lifecycle markers (cloning/scanning) carry no manifest —
          // advance the overlay step and continue.
          if (event.phase === 'cloning' || event.phase === 'scanning') {
            loadingOverlay.setStep(event.phase);
            continue;
          }
          // Skeleton step covers the placeholder paint while the server
          // resolves per-file metadata; building step covers the final
          // tween. Overlay stays up through both — hidden only in finally.
          loadingOverlay.setStep(event.phase === 'skeleton' ? 'skeleton' : 'building');
          if (event.phase === 'skeleton') {
            // Apply the skeleton so the new city paints behind the overlay
            // — the final event will tween into final heights.
            _applyDisplayLabel(event.manifest);
            await handle.world.applyManifest(event.manifest);
            // Update the header (project label, branch pill) right after the
            // skeleton lands so it reflects the new project immediately,
            // not minutes later when the final manifest arrives. The
            // post-loop call below covers the cache-hit case where this
            // branch doesn't fire; both calls are idempotent for the same
            // payload.
            handle.coordinator.setSourceInfo(
              payload.branch,
              _srcKind(payload.src) === 'git' ? payload.src : undefined
            );
          }
          manifest = event.manifest;
        }
        if (!manifest) throw new Error('No manifest received');

        // Update URL first so per-source persistence subscriptions see the
        // right CURRENT_SOURCE_KEY on the next tick.
        const pageUrl = new URL(window.location.href);
        pageUrl.searchParams.set('src', payload.src);
        if (payload.branch) pageUrl.searchParams.set('branch', payload.branch);
        else pageUrl.searchParams.delete('branch');
        if (payload.gitWindow) pageUrl.searchParams.set('git_window', payload.gitWindow);
        else pageUrl.searchParams.delete('git_window');
        history.replaceState(null, '', pageUrl.toString());

        CURRENT_SOURCE_KEY.set(sourceKey(payload.src, payload.branch));

        try {
          const _builtAtlas = await buildIconAtlas(manifest);
          setIconAtlas(_builtAtlas);
          setCellIconAtlas(_builtAtlas);
        } catch (err) {
          console.warn('[codecity] icon atlas build failed', err);
        }

        _applyDisplayLabel(manifest);
        await handle.world.applyManifest(manifest);

        // Update the header (project label, branch pill) + footer (repo link)
        // AFTER applyManifest so world.getManifest() inside the coordinator
        // resolves to the just-applied manifest — otherwise the label is stale.
        handle.coordinator.setSourceInfo(
          payload.branch,
          _srcKind(payload.src) === 'git' ? payload.src : undefined
        );

        _liveUpdates?.setSignature(manifest.signature);
        pushRecent({
          src: payload.src,
          branch: payload.branch,
          gitWindow: payload.gitWindow,
          label: _deriveLabel(payload.src),
        });

        if (!liveUpdatesStarted) {
          _liveUpdates = setupLiveUpdates(handle, manifest.signature);
          liveUpdatesStarted = true;
        }
      } catch (err) {
        picker.open({
          dismissible: dismissibleOnError,
          prefill: payload,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      } finally {
        loadingOverlay.hide();
      }
    }

    const picker = createSourcePicker({
      onSubmit: (payload) => {
        picker.close();
        applyNewSource(payload);
      },
    });

    // Boot decisions:
    if (initialError) {
      // Direct-boot fetch failed → modal in non-dismissible mode with the error.
      _lastDismissible = false;
      picker.open({
        dismissible: false,
        prefill: {
          src: qp.get('src')!,
          branch: qp.get('branch') ?? undefined,
          gitWindow: qp.get('git_window') ?? undefined,
        },
        error: initialError,
      });
    } else if (!hasSrc) {
      // Cold boot, no URL params → modal in non-dismissible mode.
      _lastDismissible = false;
      picker.open({ dismissible: false });
    } else {
      // Boot complete with manifest applied.
      loadingOverlay.hide();
    }

    // Wire the header "switch source" button via a global hook.
    (window as Window & { __openSourcePicker?: () => void }).__openSourcePicker = () => {
      const cur = new URLSearchParams(window.location.search);
      _lastDismissible = true;
      picker.open({
        dismissible: true,
        prefill: cur.has('src')
          ? {
              src: cur.get('src')!,
              branch: cur.get('branch') ?? undefined,
              gitWindow: cur.get('git_window') ?? undefined,
            }
          : undefined,
      });
    };
  })();
}
