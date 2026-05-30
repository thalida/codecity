import { describe, it, expect, beforeEach } from 'vitest';
import { createLoadingOverlay } from '@/views/components/loadingOverlay.js';

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

  it('show rebuilds the DOM on second call (no duplicate cards)', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'local', label: 'A' });
    o.show({ kind: 'local', label: 'B' });
    expect(root.querySelectorAll('.loading-card').length).toBe(1);
  });

  // ── New stepped-progress tests ───────────────────────────────────────────

  it('renders the right steps for git', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'owner/repo' });
    // Title shows the current step (not the project name — that lives in
    // the pending-label header set separately via setPendingLabel).
    expect(root.textContent).toContain('Resolving source');
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

  // ── Pending-label header (Task 7) ───────────────────────────────────────

  it('renders the pending label as a header when setPendingLabel is called', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'owner/repo' });
    o.setPendingLabel('owner/repo');
    const header = root.querySelector('.loading-pending-label');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('owner/repo');
  });

  it('hides the pending label when setPendingLabel is called with null', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'owner/repo' });
    o.setPendingLabel('owner/repo');
    o.setPendingLabel(null);
    const header = root.querySelector('.loading-pending-label');
    expect(header).toBeNull();
  });

  // ── Step-tail render (Task 11) ──────────────────────────────────────────

  it('renders a tail string next to a step row', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'owner/repo' });
    o.setStepTail('cloning', '45% (receiving)');
    const cloningRow = root.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).toContain('45%');
    expect(cloningRow?.textContent).toContain('receiving');
  });

  it('replaces an existing tail string with a new one', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'owner/repo' });
    o.setStepTail('cloning', '10%');
    o.setStepTail('cloning', '80%');
    const cloningRow = root.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).toContain('80%');
    expect(cloningRow?.textContent).not.toContain('10%');
  });

  it('clears the tail when setStepTail is called with null', () => {
    const o = createLoadingOverlay();
    o.show({ kind: 'git', label: 'owner/repo' });
    o.setStepTail('cloning', '45%');
    o.setStepTail('cloning', null);
    const cloningRow = root.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).not.toContain('45%');
  });
});
