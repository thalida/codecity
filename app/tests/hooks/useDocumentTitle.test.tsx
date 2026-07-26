import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { setManifest } from '@/state/stores/manifest';

import { EMPTY_MANIFEST } from '@/constants/manifest';
import type { Manifest } from '@/types';
import { drainAsync } from '../_helpers/preact';
import { PENDING_SOURCE_LABEL } from '@/state/stores/ui';

// useDocumentTitle is the single owner of document.title. It reacts to the
// canonical signals — PENDING_SOURCE_LABEL while a source is loading, MANIFEST
// once it lands. We render a tiny harness that calls the hook, poke the
// signals, and drainAsync() to settle Preact's debounced passive effect (the
// single-microtask flush() isn't enough for useSignalEffect's deferred run)
// before asserting.

function Harness() {
  useDocumentTitle();
  return null;
}

let container: HTMLDivElement;

describe('useDocumentTitle', () => {
  beforeEach(() => {
    PENDING_SOURCE_LABEL.value = null;
    setManifest(EMPTY_MANIFEST);
    document.title = 'codecity';
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    PENDING_SOURCE_LABEL.value = null;
    setManifest(EMPTY_MANIFEST);
  });

  it('shows plain codecity with no source', async () => {
    render(<Harness />, container);
    await drainAsync();
    expect(document.title).toBe('codecity');
  });

  it('shows the (pending) title while a source is loading', async () => {
    render(<Harness />, container);
    await drainAsync();
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    await drainAsync();
    expect(document.title).toBe('owner/repo (pending) — codecity');
  });

  it('shows the final title from the manifest once loaded and pending is cleared', async () => {
    render(<Harness />, container);
    await drainAsync();
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    setManifest({ tree: { name: 'repo' } } as unknown as Manifest);
    PENDING_SOURCE_LABEL.value = null;
    await drainAsync();
    expect(document.title).toBe('repo — codecity');
  });

  it('prefers pending over an already-loaded manifest (source switch)', async () => {
    setManifest({ tree: { name: 'old-repo' } } as unknown as Manifest);
    render(<Harness />, container);
    await drainAsync();
    PENDING_SOURCE_LABEL.value = 'new/repo';
    await drainAsync();
    expect(document.title).toBe('new/repo (pending) — codecity');
  });
});
