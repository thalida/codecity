import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { CityFooter } from '@/views/CityView/chrome/CityFooter/CityFooter';
import { SERVER_CONFIG, DEFAULT_SERVER_CONFIG } from '@/state/stores/serverData';
import { flush } from '../../../_helpers/preact';
import { makeSession, renderInProject } from '../../../_helpers/project';

// One project for this file, the way the app makes one for itself.
const session = makeSession();

describe('CityFooter', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, version: '1.3.0' };
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    SERVER_CONFIG.value = DEFAULT_SERVER_CONFIG;
  });

  it('shows the running build version in the app line, on the right', async () => {
    renderInProject(<CityFooter />, session, container);
    await flush();

    const right = container.querySelector('.app-footer-right')!;
    expect(right.textContent).toContain('v1.3.0');
  });

  // The header is the project, the footer is the app.
  it('holds no project state: the freshness readout lives in the header', async () => {
    renderInProject(<CityFooter />, session, container);
    await flush();

    expect(container.querySelector('.freshness-status')).toBeNull();
  });

  it('credits the creator on the right, linked to thalida.com', async () => {
    renderInProject(<CityFooter />, session, container);
    await flush();

    const right = container.querySelector('.app-footer-right')!;
    expect(right.textContent).toContain('🦄 thalida.');

    const link = Array.from(right.querySelectorAll<HTMLAnchorElement>('a')).find(
      (a) => a.getAttribute('href') === 'https://thalida.com'
    )!;
    expect(link.getAttribute('href')).toBe('https://thalida.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('no longer reads as a code comment', async () => {
    renderInProject(<CityFooter />, session, container);
    await flush();

    expect(container.querySelector('#city-footer')!.textContent).not.toContain('//');
  });

  // Both are app-level, so both belong here rather than in the project header.
  it('holds the shortcuts button and the about link', async () => {
    renderInProject(<CityFooter />, session, container);
    await flush();

    // Prefix match: jsdom's selector engine will not match an `&` inside a
    // quoted attribute value, and the label carries one.
    const shortcuts = container.querySelector('[aria-label^="Shortcuts"]')!;
    expect(shortcuts).not.toBeNull();
    // In the left cluster, grouped with the debug tools rather than loose.
    expect(shortcuts.closest('.chrome-cluster')).not.toBeNull();
    expect(container.querySelector('a[href="https://github.com/thalida/codecity"]')).not.toBeNull();
  });
});
