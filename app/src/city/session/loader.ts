// state/city/loader.ts — the FETCH layer for ONE city: it streams manifests and
// writes that session's stores, and nothing else. Scene-free by contract; the
// render layer consumes those signals and owns the apply's rebuild status.

import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';

import {
  manifestUrlFor,
  signatureUrlFor,
  streamManifest,
  ScanPhase,
  ScanError,
} from '@/api/manifest';
import { LIVE_UPDATES, liveUpdatesActive } from '@/city/session/settings/updates';
import { activeExcludePathsFor } from '@/city/session/stores/excludes';
import type { ProgressStore } from '@/city/session/stores/progress';
import type { CitySession } from '@/city/session/session';
import { srcKind, SourceKind, identityBranch, sourceKey } from '@/utils/sources';
import type { UrlView } from '@/router/viewParams';
import type { Manifest } from '@/types';
import type { SourcePayload } from '@/types/ui';

/** Consume a manifest stream, publishing SCAN_PROGRESS per event and handing
 *  each skeleton/final to onManifest. Returns the final; throws without one. */
async function pumpManifestStream(
  url: string,
  meta: { kind: SourceKind; branch?: string },
  /** Where the stream's own progress goes: this project's readouts. */
  progress: ProgressStore,
  onManifest: (
    manifest: Manifest,
    phase: ScanPhase.PartialManifest | ScanPhase.CompleteManifest
  ) => Promise<void> | void,
  signal?: AbortSignal
): Promise<Manifest> {
  let lastManifest: Manifest | null = null;
  // Only partials are applied in here, so the complete event carries the last
  // applied `pending` forward rather than claiming its own as applied.
  let appliedPending: Manifest['pending'] | undefined;

  for await (const event of streamManifest(url, { signal })) {
    if (event.phase === ScanPhase.Error) throw new ScanError(event.error, event.code);

    if ('label' in event && event.label) {
      // Server-side, so the document title and the overlay header name the
      // project the same way instead of each deriving it from the src.
      progress.pendingLabel.value = event.label;
    }

    if (event.phase === ScanPhase.CloneProgress || event.phase === ScanPhase.ScanProgress) {
      progress.scan.value = {
        ...meta,
        phase: event.phase,
        percent: event.phase === ScanPhase.CloneProgress ? event.percent : undefined,
        stage: event.phase === ScanPhase.CloneProgress ? event.stage : undefined,
        mbOnDisk: event.phase === ScanPhase.CloneProgress ? event.mb_on_disk : undefined,
        objects: event.phase === ScanPhase.CloneProgress ? event.objects : undefined,
        objectsTotal: event.phase === ScanPhase.CloneProgress ? event.objects_total : undefined,
        mib: event.phase === ScanPhase.CloneProgress ? event.mib : undefined,
        filesScanned: event.phase === ScanPhase.ScanProgress ? event.files_scanned : undefined,
      };
      continue;
    }

    // tree.name beats the src basename, which for a working tree is whatever
    // the folder is called (e.g. a git-worktree dir).
    if (event.manifest.tree?.name) progress.pendingLabel.value = event.manifest.tree.name;
    await onManifest(event.manifest, event.phase);
    lastManifest = event.manifest;
    if (event.phase === ScanPhase.PartialManifest) appliedPending = event.manifest.pending;
    // After onManifest, so the overlay reaction can never see "heights final"
    // ahead of the paint that shows them.
    progress.scan.value = { ...meta, phase: event.phase, appliedPending };
  }

  if (!lastManifest) throw new Error('No manifest received');
  return lastManifest;
}

/** Fetching one city. Every write lands in that session's stores, so two of
 *  these can stream different repos at once without a shared generation. */
// Floor: the server walks the filesystem per poll, so tighter burns CPU.
// Ceiling: past a minute "live" stops feeling live.
const POLL_SECONDS_MIN = 1;
const POLL_SECONDS_MAX = 60;

interface SignatureResponse {
  root: string;
  scanned_at: string;
  content_signature: string;
}

export class CityLoader {
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly session: CitySession) {}

  // Every write is gated on "am I still the current generation?", so a newer
  // load silently drops an older one and any in-flight poll write with it.
  private generation = 0;
  // The controller for the current foreground load, so the UI can cancel a slow
  // clone/scan. A new load or a cancel aborts the previous one.
  private controller: AbortController | null = null;

  /** The one way to load a source into this city. The poll below is a separate
   *  op that shares only the manifest sink and yields to this by generation. */
  loadSource = async (payload: SourcePayload): Promise<void> => {
    // This attempt supersedes the last failure, so nothing outlives it to explain
    // a load that is no longer the current one.
    this.session.source.error.value = null;
    // A source switch always exits Timeline; the city layer reacts to the flip.
    if (this.session.timeline.mode.peek()) this.session.timeline.reset();
    const myGen = ++this.generation; // claim authority; supersedes any in-flight load/poll
    this.controller?.abort(); // supersede any in-flight load
    const controller = new AbortController();
    this.controller = controller;
    // A local source has no branch axis, so a stale deep-link's branch is dropped
    // rather than carried into the URL, the overlay and the committed this.session.source.
    const branch = identityBranch(payload.src, payload.branch);
    // The server's label arrives with the first stream event; until then the
    // overlay names the source you asked for.
    this.session.progress.pendingLabel.value = payload.label ?? null;
    const meta = {
      kind: srcKind(payload.src),
      branch,
    };
    this.session.progress.scan.value = { ...meta, phase: null }; // show overlay immediately
    // What a cancel rolls back to, captured before the clear below: otherwise the
    // canceled repo's geometry lingers under the unchanged header.
    const prevManifest = this.session.manifest.current.peek();
    // What is on screen stays only while re-scanning the very project it shows:
    // otherwise the manifest in hand builds a city this load is about to replace.
    const keepCityUp =
      this.session.source.isOpen(payload.src, branch) && this.session.progress.cityOnScreen.peek();
    if (!keepCityUp) this.session.manifest.set(null);

    try {
      const url = manifestUrlFor({
        src: payload.src,
        branch,
        noCache: !!payload.skipCache,
        exclude: activeExcludePathsFor(payload.src),
      });
      // Skeleton streams out here; the final is published below, after the
      // source is committed.
      const loaded = await pumpManifestStream(
        url,
        meta,
        this.session.progress,
        (m, phase) => {
          if (phase === ScanPhase.PartialManifest && myGen === this.generation)
            this.session.manifest.set(m);
        },
        controller.signal
      );
      // A newer load superseded this one: it owns MANIFEST now, don't touch.
      if (myGen !== this.generation) return;
      // An aborted stream ends as done, not a throw, so a cancel arrives here
      // holding the partial. Roll back rather than commit it.
      if (controller.signal.aborted) {
        this.session.manifest.set(prevManifest);
        return;
      }
      // One commit point, whichever view loaded it: source, recents, this.session.manifest.
      this.session.source.set(payload.src, branch, loaded);
    } catch (err) {
      if (myGen !== this.generation) return; // superseded — its error isn't current
      if (controller.signal.aborted) {
        this.session.manifest.set(prevManifest); // user canceled: not an error; roll back any skeleton
        return;
      }
      this.session.source.error.value = {
        error: err instanceof Error ? err.message : String(err),
        code: err instanceof ScanError ? err.code : undefined,
        prefill: { src: payload.src, branch },
      };
    } finally {
      // Only the authoritative load tears the overlay down, or a superseded one
      // clears it out from under the load still streaming.
      if (myGen === this.generation) {
        this.session.progress.scan.value = null;
        if (this.controller === controller) this.controller = null;
      }
    }
  };

  /** Abort the in-flight foreground load. Treated as a clean user cancel, not a
   *  failure: see the `catch` branch above. */
  /** Abort the in-flight load. A clean user cancel, not a failure. */
  cancel = (): void => {
    this.controller?.abort();
  };

  /** Re-read the source already open, in whichever mode it is being viewed:
   *  Timeline refetches its bundle in place rather than dropping to live HEAD. */
  /** Re-read the source already open, in whichever mode it is being viewed. */
  refresh = (skipCache = false): void => {
    const cur = this.session.source.current.peek();
    if (!cur) return;
    if (this.session.timeline.mode.peek()) {
      // Asked for by hand, so it gets the same stepped overlay a Live refresh
      // does: the history walk behind it runs for minutes on a big repo.
      void this.session.timelineMode.loadScene({
        inPlace: true,
        noCache: skipCache,
        overlay: true,
      });
      return;
    }
    void this.loadSource({ src: cur.src, branch: cur.branch, skipCache: skipCache || undefined });
  };

  // ── Live-update poll loop ────────────────────────────────────────────

  private clampPollSeconds(s: number | unknown): number {
    if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
    return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
  }

  /** Start the live-update poll loop and the exclude-refresh reaction, returning
   *  a dispose for both. Exported so the reaction is directly testable. */
  /** Start the live-update poll + the exclude-refresh reaction. */
  setupLiveUpdates = (): (() => void) => {
    let timer: number | null = null;
    let inFlight = false;

    const fetchAndApply = async (src: string, branch: string | undefined): Promise<void> => {
      const myGen = this.generation; // capture; a foreground load bumping this drops our write
      try {
        for await (const event of streamManifest(
          manifestUrlFor({ src, branch, exclude: activeExcludePathsFor(src) })
        )) {
          if (event.phase === ScanPhase.Error) throw new ScanError(event.error, event.code);
          // Skip the skeleton: the city is already drawn, and applying one would
          // animate every building to placeholder heights and back on each save.
          if (event.phase !== ScanPhase.CompleteManifest) continue;
          if (myGen !== this.generation) return; // a foreground load started — this refresh is stale
          const m = event.manifest;
          if (m?.content_signature) this.session.manifest.set(m);
        }
      } catch (err) {
        if (myGen !== this.generation) return; // superseded by a load — not our error to surface
        this.session.progress.markError(err);
      }
    };

    // Cheap signature first, full manifest only when it differs. Targets the
    // committed CURRENT_SOURCE, not the page URL, which lags a switch.
    const tick = async (): Promise<void> => {
      if (inFlight) return;
      if (this.session.timeline.mode.peek()) return; // Timeline mode owns the scene (union city + scrub) — no live poll
      if (this.session.progress.scan.peek() !== null) return; // a foreground load is in flight — yield
      const cur = this.session.source.current.peek();
      if (!cur) return; // nothing loaded yet
      const current = this.session.manifest.current.peek();
      if (!current) return;
      const applied = (current as Manifest).content_signature;
      inFlight = true;
      try {
        const sigResp = await fetch(
          signatureUrlFor(cur.src, cur.branch, activeExcludePathsFor(cur.src))
        );
        if (!sigResp.ok) return;
        const sig: SignatureResponse | null = await sigResp.json();
        if (!sig?.content_signature || sig.content_signature === applied) return;
        await fetchAndApply(cur.src, cur.branch);
      } catch (_) {
        // Cheap-probe network blip: no rebuild attempted, so not surfaced. Next
        // tick retries.
      } finally {
        inFlight = false;
      }
    };

    const start = (): void => {
      stop();
      const seconds = this.clampPollSeconds(LIVE_UPDATES.value.POLL_SECONDS);
      timer = window.setInterval(tick, seconds * 1000);
    };
    const stop = (): void => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const disposeEnabledEffect = effect(() => {
      // Tracks the source too, so switching between a local tree and a clone
      // starts or stops the timer without a reload.
      if (liveUpdatesActive(this.session.source)) start();
      else stop();
    });

    // Excludes need their own trigger, since the poll is gated on
    // the poll being active. Key-guarded so a source switch isn't read as an edit.
    let lastExcludeKey: string | null = null;
    const disposeExcludeRefresh = effect(() => {
      const serialized = this.session.source.excludes.value.join('\n');
      const cur = this.session.source.current.peek();
      const repoKey = cur ? sourceKey(cur.src) : null;
      const nextKey = repoKey === null ? null : `${repoKey}|${serialized}`;
      const prev = lastExcludeKey;
      lastExcludeKey = nextKey;
      if (prev === null || nextKey === null) return; // first run / no source
      const [prevRepo] = prev.split('|', 1);
      if (prevRepo !== repoKey) return; // source switched — the load owns it
      if (prev === nextKey) return; // no actual change
      if (this.session.progress.scan.peek() !== null) return; // yield to a foreground load
      if (!cur) return;
      if (inFlight) return; // the poll's tick is already covering this refresh
      inFlight = true;
      // Timeline owns the scene: excludes change the union data, so refetch its
      // bundle + re-pack (it reports itself through the readout). Live: re-scan.
      let refresh: Promise<void>;
      if (this.session.timeline.mode.peek()) {
        refresh = this.session.timelineMode.loadScene({ inPlace: true });
      } else {
        this.session.progress.markRebuilding(); // say so now, not after the re-scan streams back
        refresh = fetchAndApply(cur.src, cur.branch);
      }
      void refresh.finally(() => {
        inFlight = false;
      });
    });

    return () => {
      stop();
      disposeEnabledEffect();
      disposeExcludeRefresh();
    };
  };

  /** The load the URL asks for, in the mode it asks for. A Timeline boot that
   *  fails to engage falls through to Live, so the page lands on a working city. */
  /** Load whatever the URL names, in the mode it asks for. */
  boot = async (view: UrlView): Promise<void> => {
    const src = view.src;
    if (!src) return;
    if (view.timeline) {
      await this.session.timelineMode.loadSource({
        src,
        branch: view.branch,
        commit: view.commit ?? undefined,
      });
      if (this.session.timeline.mode.peek()) return;
    }
    await this.loadSource({ src, branch: view.branch });
  };

  dispose = (): void => this.disposers.splice(0).forEach((stop) => stop());
}

/** Watch this city for changes on disk while it is mounted. One loop per
 *  session: it re-reads the signals per tick, so a switch needs no restart. */
export function useLiveUpdates(session: CitySession): void {
  useEffect(() => session.load.setupLiveUpdates(), [session]);
}
