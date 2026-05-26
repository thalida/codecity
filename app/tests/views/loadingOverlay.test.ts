import { describe, it, expect, beforeEach } from 'vitest';
import { createLoadingOverlay } from '@/views/source/loadingOverlay.js';

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

  it('show() reveals the overlay', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'local', label: 'foo' });
    expect(root.style.display).not.toBe('none');
  });

  it('hide() removes from view', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'local', label: 'foo' });
    o.hide();
    expect(root.style.display).toBe('none');
  });

  it('show is idempotent and updates title on second call', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'local', label: 'A' });
    o.show({ kind: 'local', label: 'B' });
    expect(root.textContent).toContain('Loading B');
    expect(root.textContent).not.toContain('Loading A');
  });

  // ── New stepped-progress tests ───────────────────────────────────────────

  it('renders the right steps for git', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'owner/repo' });
    expect(root.textContent).toContain('Loading owner/repo');
    expect(root.querySelector('[data-step="resolving"]')).toBeTruthy();
    expect(root.querySelector('[data-step="cloning"]')).toBeTruthy();
    expect(root.querySelector('[data-step="scanning"]')).toBeTruthy();
    expect(root.querySelector('[data-step="building"]')).toBeTruthy();
  });

  it('hides resolving/cloning for local', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'local', label: 'mydir' });
    const resolving = root.querySelector('[data-step="resolving"]') as HTMLElement;
    const cloning = root.querySelector('[data-step="cloning"]') as HTMLElement;
    expect(resolving.style.display).toBe('none');
    expect(cloning.style.display).toBe('none');
  });

  it('setStep marks previous steps done and target active', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'x/y' });
    o.setStep('building');
    expect(root.querySelector('[data-step="building"]')?.getAttribute('data-state')).toBe('active');
    expect(root.querySelector('[data-step="scanning"]')?.getAttribute('data-state')).toBe('done');
  });

  it('branch is included in the title when provided', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'x/y', branch: 'main' });
    expect(root.textContent).toContain('branch main');
  });

  it('git mode starts with resolving active', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'owner/repo' });
    expect(root.querySelector('[data-step="resolving"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(root.querySelector('[data-step="cloning"]')?.getAttribute('data-state')).toBe('pending');
  });

  it('local mode starts with scanning active', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'local', label: 'mydir' });
    expect(root.querySelector('[data-step="scanning"]')?.getAttribute('data-state')).toBe('active');
    expect(root.querySelector('[data-step="building"]')?.getAttribute('data-state')).toBe(
      'pending'
    );
  });
});
