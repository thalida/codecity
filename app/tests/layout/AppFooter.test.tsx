import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { AppFooter } from '@/layout/AppFooter/AppFooter';
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
