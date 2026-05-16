import { describe, it, expect, beforeEach } from 'vitest';
import { createLoadingOverlay } from '../../views/shell/loadingOverlay.js';

function mountRoot(): HTMLElement {
  document.body.innerHTML = '<div id="loading-overlay-root" style="display: none;"></div>';
  return document.getElementById('loading-overlay-root')!;
}

describe('loadingOverlay', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = mountRoot();
  });

  it('starts hidden', () => {
    createLoadingOverlay();
    expect(root.style.display).toBe('none');
  });

  it('show(caption) reveals with text', () => {
    const o = createLoadingOverlay();
    o.show('Loading foo…');
    expect(root.style.display).not.toBe('none');
    expect(root.textContent).toContain('Loading foo…');
  });

  it('hide() removes from view', () => {
    const o = createLoadingOverlay();
    o.show('Loading…');
    o.hide();
    expect(root.style.display).toBe('none');
  });

  it('show is idempotent and updates caption', () => {
    const o = createLoadingOverlay();
    o.show('Loading A…');
    o.show('Loading B…');
    expect(root.textContent).toContain('Loading B…');
    expect(root.textContent).not.toContain('Loading A…');
  });
});
