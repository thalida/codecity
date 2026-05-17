// NDJSON streaming reader for /api/manifest responses. Each line is a
// single JSON event: either {phase:'skeleton'|'final', manifest} or
// {phase:'error', error}. The browser handles Content-Encoding: gzip
// transparently, so we read decoded UTF-8 text directly.

import type { Manifest } from './types/manifest';

export type ScanStreamEvent =
  | { phase: 'skeleton' | 'final'; manifest: Manifest }
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
