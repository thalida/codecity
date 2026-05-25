// NDJSON streaming reader for /api/manifest responses. Each line is a
// single JSON event. The browser handles Content-Encoding: gzip
// transparently, so we read decoded UTF-8 text directly.
//
// Event variants (server emits in roughly this order):
//   cloning  — marker, no payload. Sent for git sources before the clone
//              subprocess runs so the UI can light up its "Cloning" step
//              from real state instead of a wall-clock timer.
//   scanning — marker, no payload. Sent once the clone (if any) is done
//              and the on-disk scan is about to start.
//   skeleton — first paint manifest with placeholder building heights.
//   final    — populated manifest ready for the final tween.
//   error    — fatal mid-stream failure; client should surface and stop.

import type { Manifest } from '@/types/manifest';

// One variant per discriminant value so TS narrows cleanly through
// `if (event.phase === 'cloning' || event.phase === 'scanning')` etc.
export type ScanStreamEvent =
  | { phase: 'cloning' }
  | { phase: 'scanning' }
  | { phase: 'skeleton'; manifest: Manifest }
  | { phase: 'final'; manifest: Manifest }
  | { phase: 'error'; error: string };

export async function* streamManifest(
  url: string,
  fetchImpl: typeof fetch = fetch,
): AsyncIterable<ScanStreamEvent> {
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    const errMsg = (body && typeof body.error === 'string') ? body.error : `HTTP ${resp.status}`;
    throw new Error(errMsg);
  }
  if (!resp.body) {
    throw new Error('Response has no body');
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  // Buffer grows up to one full NDJSON line — for the final-manifest
  // event that can be 10MB-300MB of UTF-8. Acceptable here because
  // the server emits at most 2 events per response.
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) yield JSON.parse(line) as ScanStreamEvent;
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as ScanStreamEvent;
}
