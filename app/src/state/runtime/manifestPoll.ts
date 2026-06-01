// state/runtime/manifestPoll.ts — World-rebuild status signals + the live-update
// poll loop. These two pieces always travel together: the poll loop is the
// primary writer of REBUILD_STATUS / LAST_REBUILD_ERROR, and the manual
// refresh entrypoint exposed here (refreshManifest) routes back into the
// same fetch+apply path the poll uses.
//
// Lives OUTSIDE state/stores/settings/ on purpose: these atoms are session-only
// and must NOT be persisted to localStorage. If REBUILD_STATUS were
// rehydrated, the poll's status-gated logic would strand the footer on
// "rebuilding…" forever after a mid-fetch reload.
//
// Two writers feed the same atoms:
//   - setupLiveUpdates() below — live-poll fetch + applyManifest
//   - scheduleRebuild() in state/stores/settings/hotReload.ts — save-driven applyManifest
//
// LAST_UPDATED_AT is written by the coordinator on every applied
// manifest (initial paint + each successful poll that swapped state).
//
// Two-stage poll: each tick first hits /api/manifest/signature (cheap —
// stat-only walk, no file content reads, no per-file git history) and
// only fetches the full /api/manifest when the signature has changed.
// On a large repo the no-op poll cost drops by ~10×. REBUILD_STATUS is
// only flipped during the actual manifest fetch so the footer's
// "rebuilding…" indicator only lights up when there's real work.

import { signal, effect } from '@preact/signals';
import { LIVE_UPDATES } from '@/state/stores/settings/index';
import { manifestUrl, signatureUrl, streamManifest } from '@/api/manifest';
import { _applyDisplayLabel, startRenderLoop } from '@/scene/renderLoop';
import { setLoadingStep } from '@/state/runtime/uiState';
import { LoadingStep } from '@/constants';

// ── Rebuild status signals ───────────────────────────────────────────

/**
 * State of the most recent (or current) world rebuild.
 *   'rebuilding' — applyManifest is constructing the city (streets,
 *                  buildings, gem).
 *   'decorating' — the city is already in the scene; the deferred
 *                  decoration pass (trees, future mesa bounds, etc.)
 *                  is still in flight. Only emitted when at least one
 *                  decoration layer is enabled.
 */
export type RebuildStatus = 'idle' | 'rebuilding' | 'decorating' | 'error';

export const REBUILD_STATUS = signal<RebuildStatus>('idle');

// Bridge REBUILD_STATUS → loading overlay. When the deferred decoration pass
// starts (REBUILD_STATUS → 'decorating'), advance the overlay's active step so
// users see "Adding decorations…". Colocated here next to its source signal
// rather than in a standalone runtime/ bridge module; installs once at import.
effect(() => {
  if (REBUILD_STATUS.value === 'decorating') {
    setLoadingStep(LoadingStep.Decorating);
  }
});

/** Error message from the most recent failed rebuild; null when idle/success. */
export const LAST_REBUILD_ERROR = signal<string | null>(null);

/** Epoch millis of the most recent manifest apply (initial or via poll). */
export const LAST_UPDATED_AT = signal<number>(0);

// ── Manual refresh action ────────────────────────────────────────────
// The footer's refresh button (and any future "force re-sync" UI) goes
// through this single chokepoint so the live-poll plumbing stays the
// only place that owns fetch + applyManifest. setupLiveUpdates registers
// its `refreshFromToggle` here during boot; anything that wants to "act
// like a fresh page load" just calls refreshManifest().

let _refreshHandler: (() => Promise<void>) | null = null;

/** Trigger a fresh manifest fetch + apply. Resolves when the rebuild
 *  finishes (or immediately, when no handler has been registered yet —
 *  which only happens during boot, before setupLiveUpdates runs). */
export async function refreshManifest(): Promise<void> {
  if (_refreshHandler) await _refreshHandler();
}

// ── Live-update poll loop ────────────────────────────────────────────

// Hard bounds for the user-set poll interval. 1s floor — the server does a real
// filesystem walk per poll, so tighter just burns CPU. 60s ceiling — beyond
// that "live" stops feeling live. Not user-tunable, so they live here (the only
// consumer) rather than in the settings store.
const POLL_SECONDS_MIN = 1;
const POLL_SECONDS_MAX = 60;

function _clampPollSeconds(s: number | unknown): number {
  if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
  return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
}

interface LiveUpdateHandle {
  world: Awaited<ReturnType<typeof startRenderLoop>>['world'];
  applyTheme: () => void;
}

interface SignatureResponse {
  root: string;
  scanned_at: string;
  signature: string;
}

export function setupLiveUpdates(
  handle: LiveUpdateHandle,
  initialSignature: string
): { setSignature(sig: string): void } {
  let lastSignature = initialSignature || '';
  let timer: number | null = null;
  let inFlight = false;
  let needsRefresh = false;

  // Single fetch+apply path. Always flips REBUILD_STATUS to 'rebuilding'
  // for the duration — both the poll's "signature changed" branch and
  // the toggle handler funnel through here so the footer indicator
  // behaves identically. A non-2xx response or a JSON parse error
  // resolves to 'error' with the message captured in LAST_REBUILD_ERROR.
  async function fetchAndApply(): Promise<void> {
    REBUILD_STATUS.value = 'rebuilding';
    try {
      for await (const event of streamManifest(manifestUrl())) {
        if (event.phase === 'error') throw new Error(event.error);
        // Live-update path: skip skeleton. The city is already drawn
        // with the previous final manifest; applying a skeleton would
        // animate every building down to placeholder heights and back
        // up on every save — visible oscillation. Only the final
        // tweens into the actual new state.
        if (event.phase !== 'final') continue;
        const m = event.manifest;
        if (m?.signature) {
          lastSignature = m.signature;
          _applyDisplayLabel(m);
          await handle.world.applyManifest(m);
        }
      }
      REBUILD_STATUS.value = 'idle';
      LAST_REBUILD_ERROR.value = null;
    } catch (err) {
      REBUILD_STATUS.value = 'error';
      LAST_REBUILD_ERROR.value = err instanceof Error ? err.message : String(err);
    }
  }

  // Poll tick: cheap signature first, full manifest only on change.
  // After a refresh, re-check needsRefresh in case a toggle fired
  // mid-flight and queued itself.
  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      do {
        needsRefresh = false;
        const sigResp = await fetch(signatureUrl());
        if (!sigResp.ok) break;
        const sig: SignatureResponse | null = await sigResp.json();
        if (!sig?.signature || sig.signature === lastSignature) break;
        await fetchAndApply();
      } while (needsRefresh);
    } catch (_) {
      // Signature-fetch errors (network blip on the cheap probe) are
      // intentionally not surfaced through REBUILD_STATUS — no rebuild
      // attempt happened. The next tick retries. Only failures inside
      // fetchAndApply (the full fetch + applyManifest) populate the
      // error indicator.
    } finally {
      inFlight = false;
    }
  }

  // Toggle handler: bypass the cheap check (the manifest WILL differ),
  // but defer to the polling closure's inFlight gate so the two paths
  // can't trample each other.
  async function refreshFromToggle(): Promise<void> {
    if (inFlight) {
      needsRefresh = true;
      return;
    }
    inFlight = true;
    try {
      do {
        needsRefresh = false;
        await fetchAndApply();
      } while (needsRefresh);
    } catch {
      /* keep polling */
    } finally {
      inFlight = false;
    }
  }

  function start(): void {
    stop();
    const seconds = _clampPollSeconds(LIVE_UPDATES.value.POLL_SECONDS);
    timer = window.setInterval(tick, seconds * 1000);
  }
  function stop(): void {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  // Register the manual-refresh entrypoint so anything outside the
  // live-poll loop (e.g. the footer's refresh button) can trigger the
  // same fetch+apply chain without re-implementing it.
  _refreshHandler = refreshFromToggle;

  // effect() fires the callback synchronously with the current value
  // the instant it is called. We arm the effect AFTER registering it —
  // same pattern as attachCommitReactions — so the initial synthetic fire
  // is suppressed. Runtime changes (user toggles LIVE_UPDATES.ENABLED)
  // happen after `armed = true` and behave normally.
  let _liveUpdatesArmed = false;
  effect(() => {
    const val = LIVE_UPDATES.value;
    if (!_liveUpdatesArmed) return;
    if (val.ENABLED) start();
    else stop();
  });
  _liveUpdatesArmed = true;
  // Kick off the initial poll state now that the effect is armed.
  // The effect's initial fire was suppressed above, so we explicitly
  // honour the current ENABLED value here.
  if (LIVE_UPDATES.value.ENABLED) start();

  return {
    setSignature(sig: string) {
      lastSignature = sig;
    },
  };
}
