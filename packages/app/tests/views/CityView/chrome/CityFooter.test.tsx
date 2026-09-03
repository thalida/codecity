import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { CityFooter } from '@/features/city/components/CityFooter/CityFooter';
import { renderWithServer } from '../../../_helpers/query';
import { flush } from '../../../_helpers/preact';

describe('CityFooter', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('shows the running build version in the app line, on the right', async () => {
    renderWithServer(<CityFooter />, container, { config: { version: '1.3.0' } });
    await flush();

    const right = container.querySelector('.app-footer-right')!;
    expect(right.textContent).toContain('v1.3.0');
  });

  // The header is the project, the footer is the app.
  it('holds no project state: the freshness readout lives in the header', async () => {
    renderWithServer(<CityFooter />, container, { config: { version: '1.3.0' } });
    await flush();

    expect(container.querySelector('.freshness-status')).toBeNull();
  });

  it('credits the creator on the right, linked to thalida.com', async () => {
    renderWithServer(<CityFooter />, container, { config: { version: '1.3.0' } });
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
    renderWithServer(<CityFooter />, container, { config: { version: '1.3.0' } });
    await flush();

    expect(container.querySelector('#city-footer')!.textContent).not.toContain('//');
  });

  // Both are app-level, so both belong here rather than in the project header.
  it('holds the shortcuts button and the about link', async () => {
    renderWithServer(<CityFooter />, container, { config: { version: '1.3.0' } });
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
