import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { setManifest } from '@/state/stores/manifest';

import { drainAsync } from '../_helpers/preact';
import { PENDING_SOURCE_LABEL } from '@/state/stores/progress';
import type { Manifest } from '@codecity/city';

// The single owner of document.title, driven by MANIFEST alone. drainAsync()
// settles useSignalEffect's deferred run; a single flush() is not enough.

function Harness() {
  useDocumentTitle();
  return null;
}

let container: HTMLDivElement;

describe('useDocumentTitle', () => {
  beforeEach(() => {
    PENDING_SOURCE_LABEL.value = null;
    setManifest(null);
    document.title = 'codecity';
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    PENDING_SOURCE_LABEL.value = null;
    setManifest(null);
  });

  it('shows plain codecity with no source', async () => {
    render(<Harness />, container);
    await drainAsync();
    expect(document.title).toBe('codecity');
  });

  it('shows the manifest name once loaded', async () => {
    render(<Harness />, container);
    await drainAsync();
    setManifest({ tree: { name: 'repo' } } as unknown as Manifest);
    await drainAsync();
    expect(document.title).toBe('repo — codecity');
  });

  it('ignores PENDING_SOURCE_LABEL, which entering Timeline also sets', async () => {
    // It outlived a load and stranded the tab at "(pending)".
    setManifest({ tree: { name: 'repo' } } as unknown as Manifest);
    render(<Harness />, container);
    await drainAsync();
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    await drainAsync();
    expect(document.title).toBe('repo — codecity');
  });
});
