import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { AppFooter } from '@/layout/AppFooter/AppFooter';
import { SERVER_CONFIG, DEFAULT_SERVER_CONFIG } from '@/state/stores/serverConfig';
import { flush } from '../_helpers/preact';

describe('AppFooter', () => {
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
    render(<AppFooter />, container);
    await flush();

    const right = container.querySelector('.app-footer-right')!;
    expect(right.textContent).toContain('v1.3.0');
  });

  // The header is the project, the footer is the app. Freshness is a fact
  // about the project and moved up beside the refresh button that acts on it.
  it('holds no project state: the freshness readout lives in the header', async () => {
    render(<AppFooter />, container);
    await flush();

    expect(container.querySelector('.freshness-status')).toBeNull();
  });

  it('credits the creator on the right, linked to thalida.com', async () => {
    render(<AppFooter />, container);
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
    render(<AppFooter />, container);
    await flush();

    expect(container.querySelector('#app-footer')!.textContent).not.toContain('//');
  });

  // Both are app-level, so both belong here rather than in the project header.
  it('holds the shortcuts button and the about link', async () => {
    render(<AppFooter />, container);
    await flush();

    const shortcuts = container.querySelector('[aria-label="Keyboard shortcuts"]')!;
    expect(shortcuts).not.toBeNull();
    // In the left cluster, grouped with the debug tools rather than loose.
    expect(shortcuts.closest('.chrome-cluster')).not.toBeNull();
    expect(container.querySelector('a[href="https://github.com/thalida/codecity"]')).not.toBeNull();
  });
});
