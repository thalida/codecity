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
    const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as ScanStreamEvent;
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as ScanStreamEvent;
}
