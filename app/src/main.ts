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
import { manifestUrl } from './api/urls.js';
import { srcKind, labelFromUrl } from './utils/sources.js';
import { applyHljsTheme } from './utils/syntaxTheme.js';
import { buildIconAtlas } from './scene/components/buildings/iconAtlas.js';
import { setIconAtlas } from './scene/components/buildings/buildings.js';
import { setCellIconAtlas } from './scene/components/buildings/buildingsCell.js';
import { createSourcePicker, type SourcePayload } from './views/components/sourcePicker.js';
import { createLoadingOverlay } from './views/components/loadingOverlay.js';
import { streamManifest } from './api/manifest.js';
import { pushRecent } from './utils/sourceRecents.js';
import { startRenderLoop, _applyDisplayLabel } from './scene/renderLoop.js';
import { getServerConfig } from './api/config.js';

/**
 * Set document.title to "{label} (pending) — codecity" from a server-emitted
 * `display_root`. Called from the source-applying loop on the FIRST stream
 * event that carries display_root — before any manifest exists — so the tab
 * title shows the project being loaded instead of the static page title.
 *
 * Once the final manifest lands, coordinator.ts's title-swap (using
 * labelFromManifest) takes over and the "(pending)" suffix disappears.
 *
 * Exported so the corresponding unit test can drive it without booting
 * the renderer.
 */
export function applyPendingTitle(displayRoot: string): void {
  const label = labelFromUrl(displayRoot);
  document.title = label ? `${label} (pending) — codecity` : 'codecity';
}

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
  repo: {
    branch: null,
    remote_url: null,
    head_sha: null,
    head_subject: null,
    dirty: false,
  },
  commits: [],
};

// One-shot flag: set by the source-picker onSubmit when the user ticked
// "Skip cache (fresh scan)". Consumed by the FIRST applyNewSource() call
// that follows, then cleared — subsequent live-update polls are unaffected.
let _pendingSkipCache = false;

// Boot. Guarded by a canvas check so unit tests can import this module
// without triggering any DOM/network side effects.
const _canvas = document.getElementById(DOM_IDS.CANVAS) as HTMLCanvasElement | null;
if (_canvas) {
  (async function boot() {
    // Hydrate every config store from localStorage BEFORE the initial
    // manifest fetch so user-persisted config values are applied before
    // the first paint.
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
        kind: srcKind(_bootSrc),
        label: labelFromUrl(_bootSrc) ?? _bootSrc,
        branch: _bootBranch,
      });
      try {
        let _pendingTitleSet = false;
        for await (const event of streamManifest(manifestUrl())) {
          if (event.phase === 'error') throw new Error(event.error);
          // First event carrying display_root (cloning for git, scanning
          // for local) — set the pending document title AND the overlay
          // header before the manifest lands, so both the tab and the
          // loading card show the project name during clone/scan instead
          // of just the static page title / generic spinner copy.
          if (!_pendingTitleSet && 'display_root' in event && event.display_root) {
            applyPendingTitle(event.display_root);
            loadingOverlay.setPendingLabel(labelFromUrl(event.display_root));
            _pendingTitleSet = true;
          }
          // Lifecycle markers (cloning/scanning) carry no manifest —
          // advance the overlay step and continue. The first manifest-
          // bearing event (skeleton or final) does the bootstrap below.
          if (event.phase === 'cloning' || event.phase === 'scanning') {
            loadingOverlay.setStep(event.phase);
            // Subsequent same-phase events carry running progress —
            // render it as a tail on the active step row. Spec: ~250ms
            // throttle is server-side; client just paints what arrives.
            if (event.phase === 'cloning' && event.percent !== undefined) {
              const stage = event.stage ? ` (${event.stage})` : '';
              loadingOverlay.setStepTail('cloning', `${event.percent}%${stage}`);
            } else if (event.phase === 'scanning' && event.files_scanned !== undefined) {
              loadingOverlay.setStepTail(
                'scanning',
                `${event.files_scanned.toLocaleString()} files`
              );
            }
            continue;
          }
          const m = event.manifest;
          // Advance the overlay step BEFORE the (synchronous-looking) work
          // begins so the user sees the phase update before the city paints
          // behind the semi-transparent backdrop. Clear any lingering
          // tails from the now-completed phases so the step rows look
          // clean as they collapse into the "done" state.
          loadingOverlay.setStepTail('cloning', null);
          loadingOverlay.setStepTail('scanning', null);
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
            _applyDisplayLabel(m);
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
        kind: srcKind(payload.src),
        label: labelFromUrl(payload.src) ?? payload.src,
        branch: payload.branch,
      });
      try {
        const url = new URL('/api/manifest', window.location.origin);
        url.searchParams.set('src', payload.src);
        if (payload.branch) url.searchParams.set('branch', payload.branch);
        // Consume the one-shot skip-cache flag set by the source picker.
        // Only this first fetch uses it; the poll loop is unaffected.
        if (_pendingSkipCache) {
          url.searchParams.set('no_cache', 'true');
          _pendingSkipCache = false;
        }

        let manifest: Manifest | null = null;
        let _pendingTitleSet = false;
        for await (const event of streamManifest(url.toString())) {
          if (event.phase === 'error') throw new Error(event.error);
          // First event carrying display_root (cloning for git, scanning
          // for local) — set the pending document title AND the overlay
          // header before the manifest lands, so both the tab and the
          // loading card show the new project name during clone/scan
          // after a source-switch.
          if (!_pendingTitleSet && 'display_root' in event && event.display_root) {
            applyPendingTitle(event.display_root);
            loadingOverlay.setPendingLabel(labelFromUrl(event.display_root));
            _pendingTitleSet = true;
          }
          // Lifecycle markers (cloning/scanning) carry no manifest —
          // advance the overlay step and continue. Progress fields
          // (percent / files_scanned) render as a tail on the active
          // step row; main flow is unchanged.
          if (event.phase === 'cloning' || event.phase === 'scanning') {
            loadingOverlay.setStep(event.phase);
            if (event.phase === 'cloning' && event.percent !== undefined) {
              const stage = event.stage ? ` (${event.stage})` : '';
              loadingOverlay.setStepTail('cloning', `${event.percent}%${stage}`);
            } else if (event.phase === 'scanning' && event.files_scanned !== undefined) {
              loadingOverlay.setStepTail(
                'scanning',
                `${event.files_scanned.toLocaleString()} files`
              );
            }
            continue;
          }
          // Skeleton step covers the placeholder paint while the server
          // resolves per-file metadata; building step covers the final
          // tween. Overlay stays up through both — hidden only in finally.
          // Clear lingering progress tails so the now-done step rows
          // look clean.
          loadingOverlay.setStepTail('cloning', null);
          loadingOverlay.setStepTail('scanning', null);
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
              srcKind(payload.src) === 'git' ? payload.src : undefined
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
        // Strip any stale git_window left over from older bookmarks.
        pageUrl.searchParams.delete('git_window');
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

        // If the user didn't explicitly request a branch, fall back to
        // the manifest's resolved HEAD (the repo's default branch) so
        // both the header pill and the recents row reflect what was
        // actually loaded instead of leaving the branch blank.
        //
        // Defensive guard: the scanner labels a detached HEAD with
        // strings like "detached HEAD" or "detached @ a1b2c3d". Those
        // are display labels, NOT real branch names — passing them to
        // a later `git clone --branch …` would fail. Only treat the
        // manifest branch as a usable default when it looks like a
        // normal ref (no spaces, no leading parens/"detached" prefix).
        const manifestBranch = manifest.repo.branch;
        const looksLikeRealBranch =
          !!manifestBranch &&
          !/\s/.test(manifestBranch) &&
          !manifestBranch.startsWith('(') &&
          !manifestBranch.startsWith('detached');
        const resolvedBranch =
          payload.branch ?? (looksLikeRealBranch ? manifestBranch! : undefined);
        const branchIsDefault = !payload.branch && looksLikeRealBranch;

        // Update the header (project label, branch pill) + footer (repo link)
        // AFTER applyManifest so world.getManifest() inside the coordinator
        // resolves to the just-applied manifest — otherwise the label is stale.
        handle.coordinator.setSourceInfo(
          resolvedBranch,
          srcKind(payload.src) === 'git' ? payload.src : undefined
        );

        _liveUpdates?.setSignature(manifest.signature);
        pushRecent({
          src: payload.src,
          branch: resolvedBranch,
          branchIsDefault,
          label: labelFromUrl(payload.src) ?? payload.src,
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

    const serverConfig = await getServerConfig();
    const picker = createSourcePicker({
      allowLocalRepos: serverConfig.allowLocalRepos,
      onSubmit: (payload) => {
        _pendingSkipCache = !!payload.skipCache;
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
            }
          : undefined,
      });
    };
  })();
}
