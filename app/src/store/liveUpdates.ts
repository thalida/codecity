// liveUpdates.ts — Live-update poll loop. When LIVE_UPDATES.ENABLED flips
// on we start re-fetching the manifest at the user-configured interval;
// when its signature changes vs. the last render, we hand the new manifest
// to world.applyManifest, which rebuilds the city in place. Camera +
// selection survive because picker.selectionKey is persisted and
// re-resolved on every world rebuild, and cameraRig keeps its pose
// across applyManifest calls (no re-frame).
//
// Two-stage poll: each tick first hits /api/manifest/signature (cheap —
// stat-only walk, no file content reads, no per-file git history) and
// only fetches the full /api/manifest when the signature has changed.
// On a large repo the no-op poll cost drops by ~10×. REBUILD_STATUS is
// only flipped during the actual manifest fetch so the footer's
// "rebuilding…" indicator only lights up when there's real work.

import { LIVE_UPDATES, POLL_SECONDS_MIN, POLL_SECONDS_MAX } from '@/state/settings/index.js';
import { REBUILD_STATUS, LAST_REBUILD_ERROR, setRefreshManifest } from '@/store/liveStatus.js';
import { streamManifest } from '@/api/manifest.js';
import { manifestUrl, signatureUrl } from '@/api/urls.js';
import { _applyDisplayLabel, startRenderLoop } from '@/scene/renderLoop.js';

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
  async function refreshManifest(): Promise<void> {
    REBUILD_STATUS.set('rebuilding');
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
      REBUILD_STATUS.set('idle');
      LAST_REBUILD_ERROR.set(null);
    } catch (err) {
      REBUILD_STATUS.set('error');
      LAST_REBUILD_ERROR.set(err instanceof Error ? err.message : String(err));
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
        await refreshManifest();
      } while (needsRefresh);
    } catch (_) {
      // Signature-fetch errors (network blip on the cheap probe) are
      // intentionally not surfaced through REBUILD_STATUS — no rebuild
      // attempt happened. The next tick retries. Only failures inside
      // refreshManifest (the full fetch + applyManifest) populate the
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
        await refreshManifest();
      } while (needsRefresh);
    } catch {
      /* keep polling */
    } finally {
      inFlight = false;
    }
  }

  function start(): void {
    stop();
    const seconds = _clampPollSeconds(LIVE_UPDATES.get().POLL_SECONDS);
    timer = window.setInterval(tick, seconds * 1000);
  }
  function stop(): void {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  // Expose the manual-refresh entrypoint to anything outside the
  // live-poll loop (e.g. the footer's refresh button) so they can
  // trigger the same fetch+apply chain without re-implementing it.
  setRefreshManifest(refreshFromToggle);

  // nanostores .subscribe() fires the callback synchronously with the
  // current value the instant it is called.  We arm the subscription
  // AFTER registering it — same pattern as attachCommitReactions — so the
  // initial synthetic fire is suppressed.  Runtime changes (user toggles
  // LIVE_UPDATES.ENABLED) happen after `armed = true` and behave normally.
  let _liveUpdatesArmed = false;
  LIVE_UPDATES.subscribe((val) => {
    if (!_liveUpdatesArmed) return;
    if (val.ENABLED) start();
    else stop();
  });
  _liveUpdatesArmed = true;
  // Kick off the initial poll state now that the subscription is armed.
  // The subscribe's initial fire was suppressed above, so we explicitly
  // honour the current ENABLED value here.
  if (LIVE_UPDATES.get().ENABLED) start();

  return {
    setSignature(sig: string) {
      lastSignature = sig;
    },
  };
}
