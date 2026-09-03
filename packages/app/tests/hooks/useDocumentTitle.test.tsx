import type { Manifest } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { useDocumentTitle } from '@/features/city/hooks/useDocumentTitle';
import { PENDING_SOURCE_LABEL } from '@/features/city/state/overlay';
import { renderWithCity, type FakeCity } from '../_helpers/cityChrome';
import { drainAsync } from '../_helpers/preact';

// The single owner of document.title, named after the CITY on screen.

function Harness() {
  useDocumentTitle();
  return null;
}

let container: HTMLDivElement;

describe('useDocumentTitle', () => {
  let city: FakeCity;

  /** Mount the hook under a city, and re-mount it when that city publishes. */
  const mount = () => void (city = renderWithCity(<Harness />, container, city));

  beforeEach(() => {
    PENDING_SOURCE_LABEL.value = null;
    document.title = 'codecity';
    container = document.createElement('div');
    document.body.appendChild(container);
    city = undefined as unknown as FakeCity;
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    PENDING_SOURCE_LABEL.value = null;
  });

  it('shows plain codecity with no source', async () => {
    mount();
    await drainAsync();
    expect(document.title).toBe('codecity');
  });

  it('shows the manifest name once loaded', async () => {
    mount();
    await drainAsync();
    city.setManifest({ tree: { name: 'repo' } } as unknown as Manifest);
    await drainAsync();
    expect(document.title).toBe('repo — codecity');
  });

  it('ignores PENDING_SOURCE_LABEL, which entering Timeline also sets', async () => {
    // It outlived a load and stranded the tab at "(pending)".
    mount();
    city.setManifest({ tree: { name: 'repo' } } as unknown as Manifest);
    mount();
    await drainAsync();
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    await drainAsync();
    expect(document.title).toBe('repo — codecity');
  });
});
