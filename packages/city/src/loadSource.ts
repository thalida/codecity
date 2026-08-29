// city/loadSource.ts — a city fetching its own repo. Given a source it opens
// the manifest stream, applies each manifest it is sent, and reports what the
// server is doing as it goes.
//
// This is the whole reason a second city on the page is possible: the landing's
// wallpaper loads a different repo from the project behind it, and neither ends
// up in the other's manifest, because neither of them shares one.

import { ScanError, ScanPhase, type ScanStreamEvent } from './client/manifest';
import type { CodecityClient } from './client';
import type { CityEmitter } from './events';
import type { Manifest } from './types/manifest';
import { sourceKey } from './source';

/** Which repo, and how to read it. `src` is the only required part: everything
 *  else narrows what the server does with it. */
export interface SourceRequest {
  src: string;
  branch?: string;
  /** Re-scan rather than serve what the server already has. */
  noCache?: boolean;
  /** Paths this reader has hidden, so the scan skips them. */
  exclude?: string[];
  /** Reconstruct the repo as of this commit instead of the working tree. */
  ref?: string;
  /** Apply the skeleton as it arrives, so structure is on screen while the
   *  server resolves per-file metadata. Default true.
   *
   *  False waits for the finished city and shows nothing before it — which is
   *  what a city behind other content wants, since a wallpaper snapping from
   *  placeholder heights to real ones is movement nobody asked to look at. */
  skeleton?: boolean;
}

export interface SourceLoader {
  /** Load a repo into this city. Supersedes whatever was loading: the previous
   *  stream is aborted, so a fast repo picked after a slow one still wins. */
  load(request: SourceRequest): Promise<Manifest>;
  /** What this city is showing, as one comparable string. Null before the first
   *  load. Two loads of the same repo and branch share a key. */
  key(): string | null;
  /** The request that produced what is on screen, so a refresh can repeat it
   *  without the caller keeping its own copy. Null before the first load. */
  request(): SourceRequest | null;
  /** Whether a load is in flight. A refresh yields to one rather than racing
   *  it: the foreground load is showing what the reader actually asked for. */
  loading(): boolean;
  /** A generation that moves on every load. A refresh captures it and drops its
   *  own result if it changed, so a slow refresh cannot overwrite a new repo. */
  generation(): number;
  /** Abort whatever is in flight. */
  cancel(): void;
  dispose(): void;
}

export function createSourceLoader({
  client,
  events,
  applyManifest,
}: {
  client: CodecityClient;
  events: CityEmitter;
  applyManifest(manifest: Manifest): Promise<void>;
}): SourceLoader {
  let inflight: AbortController | null = null;
  let currentKey: string | null = null;
  let currentRequest: SourceRequest | null = null;
  let generation = 0;
  let disposed = false;

  function cancel(): void {
    inflight?.abort();
    inflight = null;
  }

  async function load(request: SourceRequest): Promise<Manifest> {
    if (disposed) throw new Error('city disposed');
    cancel();
    const controller = new AbortController();
    inflight = controller;
    const { src, branch } = request;

    generation++;
    currentRequest = request;
    events.emit('scan:start', { src, branch });
    // Claimed up front, not on success: the reframe gate asks "is this a
    // different repo from the one framed?", and a load that fails part way
    // still left this city showing something of the new one.
    currentKey = sourceKey(src, branch);

    let label: string | null = null;
    let last: Manifest | null = null;

    try {
      const url = client.manifestUrlFor(request);
      for await (const event of client.streamManifest(url, { signal: controller.signal })) {
        if (event.phase === ScanPhase.Error) throw new ScanError(event.error, event.code);
        _emitLabel(event);

        if (event.phase === ScanPhase.CloneProgress || event.phase === ScanPhase.ScanProgress) {
          events.emit('scan:progress', { event });
          continue;
        }

        // A consumer that only wants the finished city: the skeleton still
        // streams (the server sends it either way), it is simply not shown.
        if (request.skeleton === false && event.phase !== ScanPhase.CompleteManifest) {
          last = event.manifest;
          continue;
        }
        // Applied before it is announced, so nothing hears "the tree is
        // complete" ahead of the paint that shows it.
        await applyManifest(event.manifest);
        if (controller.signal.aborted) break;
        last = event.manifest;
        events.emit('scan:manifest', { manifest: event.manifest, phase: event.phase });
      }

      if (!last) throw new Error('No manifest received');
      events.emit('scan:done', { manifest: last });
      return last;
    } catch (err) {
      // An abort is this city being told to show something else, which is not
      // a failure anyone needs told about.
      if (!controller.signal.aborted) events.emit('scan:error', { error: err });
      throw err;
    } finally {
      if (inflight === controller) inflight = null;
    }

    function _emitLabel(event: ScanStreamEvent): void {
      // The scanned tree's own name beats the server's label, which for a
      // working tree is whatever the folder happens to be called.
      const next =
        'manifest' in event && event.manifest.tree?.name
          ? event.manifest.tree.name
          : 'label' in event && event.label
            ? event.label
            : null;
      if (!next || next === label) return;
      label = next;
      events.emit('scan:label', { label: next });
    }
  }

  return {
    load,
    key: () => currentKey,
    request: () => currentRequest,
    loading: () => inflight !== null,
    generation: () => generation,
    cancel,
    dispose(): void {
      disposed = true;
      cancel();
    },
  };
}
