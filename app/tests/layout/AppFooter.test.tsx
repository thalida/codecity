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

  it('shows the running build version beside the status', async () => {
    render(<AppFooter />, container);
    await flush();

    const left = container.querySelector('.app-footer-left')!;
    expect(left.textContent).toContain('v1.3.0');
    // Beside the status dot, not merely somewhere in the bar.
    expect(left.querySelector('.app-footer-status')).not.toBeNull();
  });

  it('credits the creator on the right, linked to thalida.com', async () => {
    render(<AppFooter />, container);
    await flush();

    const right = container.querySelector('.app-footer-right')!;
    expect(right.textContent).toContain('🦄 thalida.');

    const link = right.querySelector<HTMLAnchorElement>('a')!;
    expect(link.getAttribute('href')).toBe('https://thalida.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('no longer reads as a code comment', async () => {
    render(<AppFooter />, container);
    await flush();

    expect(container.querySelector('#app-footer')!.textContent).not.toContain('//');
  });

  // About and the shortcuts button moved to the header; per-node stats moved to
  // the selection pane. Nothing should have been left behind here.
  it('holds neither the about link nor the shortcuts button', async () => {
    render(<AppFooter />, container);
    await flush();

    expect(container.querySelector('[aria-label="Keyboard shortcuts"]')).toBeNull();
    expect(container.querySelector('a[href="https://github.com/thalida/codecity"]')).toBeNull();
  });
});
