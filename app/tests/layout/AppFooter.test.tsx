import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { AppFooter } from '@/layout/AppFooter/AppFooter';
import { SERVER_CONFIG, DEFAULT_SERVER_CONFIG } from '@/state/stores/serverConfig';
import { flush } from '../_helpers/preact';

describe('AppFooter — utility icon cluster', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('renders the keyboard-shortcuts button in the far-right cluster', async () => {
    render(<AppFooter />, container);
    await flush();

    const btn = container.querySelector('.app-footer-icons [aria-label="Keyboard shortcuts"]');
    expect(btn).not.toBeNull();
  });
});

describe('AppFooter — credit line', () => {
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

  it('shows the running build version', async () => {
    render(<AppFooter />, container);
    await flush();

    expect(container.querySelector('.app-footer-center')!.textContent).toContain('v1.3.0');
  });

  it('links about to the repo and the credit to thalida.com', async () => {
    render(<AppFooter />, container);
    await flush();

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('.app-footer-center a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://github.com/thalida/codecity',
      'https://thalida.com',
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('credits the creator with the unicorn', async () => {
    render(<AppFooter />, container);
    await flush();

    expect(container.querySelector('.app-footer-center')!.textContent).toContain('🦄 thalida.');
  });

  it('reads as a comment', async () => {
    render(<AppFooter />, container);
    await flush();

    expect(container.querySelector('.app-footer-center')!.textContent!.trimStart()).toMatch(
      /^\/\//
    );
  });
});
