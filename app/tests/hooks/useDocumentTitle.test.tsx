import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import type { Manifest } from '@/types';
import { drainAsync } from '../_helpers/preact';
import { makeSession, renderInProject } from '../_helpers/project';

// One project for this file, the way the app makes one for itself.
const session = makeSession();

// The single owner of document.title, driven by MANIFEST alone. drainAsync()
// settles useSignalEffect's deferred run; a single flush() is not enough.

function Harness() {
  useDocumentTitle();
  return null;
}

let container: HTMLDivElement;

describe('useDocumentTitle', () => {
  beforeEach(() => {
    session.progress.pendingLabel.value = null;
    session.manifest.set(null);
    document.title = 'codecity';
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    session.progress.pendingLabel.value = null;
    session.manifest.set(null);
  });

  it('shows plain codecity with no source', async () => {
    renderInProject(<Harness />, session, container);
    await drainAsync();
    expect(document.title).toBe('codecity');
  });

  it('shows the manifest name once loaded', async () => {
    renderInProject(<Harness />, session, container);
    await drainAsync();
    session.manifest.set({ tree: { name: 'repo' } } as unknown as Manifest);
    await drainAsync();
    expect(document.title).toBe('repo — codecity');
  });

  it('ignores PENDING_SOURCE_LABEL, which entering Timeline also sets', async () => {
    // It outlived a load and stranded the tab at "(pending)".
    session.manifest.set({ tree: { name: 'repo' } } as unknown as Manifest);
    renderInProject(<Harness />, session, container);
    await drainAsync();
    session.progress.pendingLabel.value = 'owner/repo';
    await drainAsync();
    expect(document.title).toBe('repo — codecity');
  });
});
