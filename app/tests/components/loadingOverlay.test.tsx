import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import {
  LOADING_OVERLAY,
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
} from '@/state/stores/ui';
import { PENDING_SOURCE_LABEL } from '@/state/stores/source';
import { LoadingStep } from '@/constants/loadingSteps';
import { SourceKind } from '@/utils/sources';
import { flush } from '../_helpers/preact';

// The overlay is now a signal-driven Preact component (App.tsx mounts a
// single <LoadingOverlay/>); state is driven by the uiState helpers that
// the manifest-stream consumer calls. These tests render the component and
// poke those helpers, flushing Preact's microtask re-render before asserting.

let container: HTMLDivElement;

beforeEach(() => {
  // Reset the shared signal so each test starts from a clean hidden state.
  LOADING_OVERLAY.value = {
    visible: false,
    showOpts: null,
    activeStep: null,
    stepTails: {},
  };
  PENDING_SOURCE_LABEL.value = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  render(<LoadingOverlay />, container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  PENDING_SOURCE_LABEL.value = null;
});

describe('LoadingOverlay', () => {
  it('starts hidden (renders nothing)', () => {
    expect(container.querySelector('.loading-backdrop')).toBeNull();
  });

  it('show reveals the overlay', async () => {
    showLoadingOverlay({ kind: SourceKind.Local, label: 'foo' });
    await flush();
    expect(container.querySelector('.loading-backdrop')).not.toBeNull();
  });

  it('hide removes it from view', async () => {
    showLoadingOverlay({ kind: SourceKind.Local, label: 'foo' });
    await flush();
    hideLoadingOverlay();
    await flush();
    expect(container.querySelector('.loading-backdrop')).toBeNull();
  });

  it('renders a single card across re-shows (no duplicates)', async () => {
    showLoadingOverlay({ kind: SourceKind.Local, label: 'A' });
    await flush();
    showLoadingOverlay({ kind: SourceKind.Local, label: 'B' });
    await flush();
    expect(container.querySelectorAll('.loading-card').length).toBe(1);
  });

  // ── Stepped progress ──────────────────────────────────────────────────────

  it('renders the right steps for git', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'owner/repo' });
    await flush();
    // Title shows the current step (not the project name — that lives in
    // the pending-label header, driven by the PENDING_SOURCE_LABEL signal).
    expect(container.textContent).toContain('Resolving source');
    expect(container.querySelector('[data-step="resolving"]')).toBeTruthy();
    expect(container.querySelector('[data-step="cloning"]')).toBeTruthy();
    expect(container.querySelector('[data-step="scanning"]')).toBeTruthy();
    expect(container.querySelector('[data-step="building"]')).toBeTruthy();
  });

  it('hides resolving/cloning for local', async () => {
    showLoadingOverlay({ kind: SourceKind.Local, label: 'mydir' });
    await flush();
    const resolving = container.querySelector('[data-step="resolving"]') as HTMLElement;
    const cloning = container.querySelector('[data-step="cloning"]') as HTMLElement;
    expect(resolving.style.display).toBe('none');
    expect(cloning.style.display).toBe('none');
  });

  it('setLoadingStep marks previous steps done and target active', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'x/y' });
    await flush();
    setLoadingStep(LoadingStep.Building);
    await flush();
    expect(container.querySelector('[data-step="building"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(container.querySelector('[data-step="scanning"]')?.getAttribute('data-state')).toBe(
      'done'
    );
  });

  it('branch is included in the title when provided', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'x/y', branch: 'main' });
    await flush();
    expect(container.textContent).toContain('branch main');
  });

  it('git mode starts with resolving active', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'owner/repo' });
    await flush();
    expect(container.querySelector('[data-step="resolving"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(container.querySelector('[data-step="cloning"]')?.getAttribute('data-state')).toBe(
      'pending'
    );
  });

  it('local mode starts with scanning active', async () => {
    showLoadingOverlay({ kind: SourceKind.Local, label: 'mydir' });
    await flush();
    expect(container.querySelector('[data-step="scanning"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(container.querySelector('[data-step="building"]')?.getAttribute('data-state')).toBe(
      'pending'
    );
  });

  // ── Pending-label header ────────────────────────────────────────────────

  it('renders the pending label as a header when set', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'owner/repo' });
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    await flush();
    const header = container.querySelector('.loading-pending-label');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('owner/repo');
  });

  it('removes the pending label when set to null', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'owner/repo' });
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    await flush();
    PENDING_SOURCE_LABEL.value = null;
    await flush();
    expect(container.querySelector('.loading-pending-label')).toBeNull();
  });

  // ── Step tails ─────────────────────────────────────────────────────────

  it('renders a tail string next to a step row', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'owner/repo' });
    setLoadingStepTail(LoadingStep.Cloning, '45% (receiving)');
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).toContain('45%');
    expect(cloningRow?.textContent).toContain('receiving');
  });

  it('replaces an existing tail string with a new one', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'owner/repo' });
    setLoadingStepTail(LoadingStep.Cloning, '10%');
    await flush();
    setLoadingStepTail(LoadingStep.Cloning, '80%');
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).toContain('80%');
    expect(cloningRow?.textContent).not.toContain('10%');
  });

  it('clears the tail when set to null', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, label: 'owner/repo' });
    setLoadingStepTail(LoadingStep.Cloning, '45%');
    await flush();
    setLoadingStepTail(LoadingStep.Cloning, null);
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).not.toContain('45%');
  });
});
