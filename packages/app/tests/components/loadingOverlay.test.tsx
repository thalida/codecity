import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { LoadingOverlay } from '@/features/city/components/LoadingOverlay/LoadingOverlay';
import {
  LOADING_OVERLAY,
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
  PENDING_SOURCE_LABEL,
} from '@/features/city/state/overlay';

import { LoadingStep, TIMELINE_LOADING_STEPS } from '@/features/city/state/loading';
import { navigate, ROUTES } from '@/router/location';
import { SourceKind } from '@codecity/city';
import { flush } from '../_helpers/preact';

// The overlay is signal-driven, so these tests render the component and poke
// the ui-store helpers, flushing Preact's re-render before asserting.

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
  render(<LoadingOverlay onCancel={() => {}} />, container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  PENDING_SOURCE_LABEL.value = null;
  navigate(ROUTES.CITY, { replace: true });
});

describe('LoadingOverlay', () => {
  it('starts hidden (renders nothing)', () => {
    expect(container.querySelector('.loading-backdrop')).toBeNull();
  });

  it('show reveals the overlay', async () => {
    showLoadingOverlay({ kind: SourceKind.Local });
    await flush();
    expect(container.querySelector('.loading-backdrop')).not.toBeNull();
  });

  it('hide removes it from view', async () => {
    showLoadingOverlay({ kind: SourceKind.Local });
    await flush();
    hideLoadingOverlay();
    await flush();
    expect(container.querySelector('.loading-backdrop')).toBeNull();
  });

  it('renders a single card across re-shows (no duplicates)', async () => {
    showLoadingOverlay({ kind: SourceKind.Local });
    await flush();
    showLoadingOverlay({ kind: SourceKind.Local });
    await flush();
    expect(container.querySelectorAll('.loading-card').length).toBe(1);
  });

  // ── Stepped progress ──────────────────────────────────────────────────────

  it('renders the right steps for git', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote });
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
    showLoadingOverlay({ kind: SourceKind.Local });
    await flush();
    const resolving = container.querySelector('[data-step="resolving"]') as HTMLElement;
    const cloning = container.querySelector('[data-step="cloning"]') as HTMLElement;
    expect(resolving.style.display).toBe('none');
    expect(cloning.style.display).toBe('none');
  });

  it('setLoadingStep marks previous steps done and target active', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote });
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

  it('shows the branch as a pill beside the repo name when provided', async () => {
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    showLoadingOverlay({ kind: SourceKind.Remote, branch: 'main' });
    await flush();
    expect(container.querySelector('.branch-pill')?.textContent).toBe('@main');
  });

  it('git mode starts with resolving active', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote });
    await flush();
    expect(container.querySelector('[data-step="resolving"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(container.querySelector('[data-step="cloning"]')?.getAttribute('data-state')).toBe(
      'pending'
    );
  });

  it('local mode starts with scanning active', async () => {
    showLoadingOverlay({ kind: SourceKind.Local });
    await flush();
    expect(container.querySelector('[data-step="scanning"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(container.querySelector('[data-step="building"]')?.getAttribute('data-state')).toBe(
      'pending'
    );
  });

  it('renders the Timeline list as one row per server stage, starting on the first', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, steps: TIMELINE_LOADING_STEPS });
    await flush();
    expect(
      container.querySelector('[data-step="timeline-fetch"]')?.getAttribute('data-state')
    ).toBe('active');
    expect(
      container.querySelector('[data-step="timeline-history"]')?.getAttribute('data-state')
    ).toBe('pending');
    expect(
      container.querySelector('[data-step="timeline-blobs"]')?.getAttribute('data-state')
    ).toBe('pending');
    expect(container.querySelector('[data-step="building"]')).toBeTruthy();
    // None of the default list's rows leak in.
    expect(container.querySelector('[data-step="resolving"]')).toBeNull();
    expect(container.querySelector('[data-step="scanning"]')).toBeNull();
    expect(container.textContent).toContain('Fetching history');
    expect(container.textContent).toContain('Walking commits');
    expect(container.textContent).toContain('Resolving files');
  });

  it('hides the history fetch for a local Timeline entry and starts on the walk', async () => {
    showLoadingOverlay({ kind: SourceKind.Local, steps: TIMELINE_LOADING_STEPS });
    await flush();
    const fetchRow = container.querySelector('[data-step="timeline-fetch"]') as HTMLElement;
    expect(fetchRow.style.display).toBe('none'); // nothing to fetch: the repo is already on disk
    expect(
      container.querySelector('[data-step="timeline-history"]')?.getAttribute('data-state')
    ).toBe('active');
  });

  it('marks the stages behind the active one done', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote, steps: TIMELINE_LOADING_STEPS });
    await flush();
    setLoadingStep(LoadingStep.TimelineBlobs);
    await flush();
    expect(
      container.querySelector('[data-step="timeline-fetch"]')?.getAttribute('data-state')
    ).toBe('done');
    expect(
      container.querySelector('[data-step="timeline-history"]')?.getAttribute('data-state')
    ).toBe('done');
    expect(container.querySelector('[data-step="building"]')?.getAttribute('data-state')).toBe(
      'pending'
    );
  });

  // ── Pending-label header ────────────────────────────────────────────────

  it('renders the pending label as a header when set', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote });
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    await flush();
    const header = container.querySelector('.loading-pending-label');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('owner/repo');
  });

  it('drops the label text but holds its row', async () => {
    // The label lands a beat after the overlay does, so its row is always
    // there: one appearing would jog every row under it mid-load.
    showLoadingOverlay({ kind: SourceKind.Remote });
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    await flush();
    PENDING_SOURCE_LABEL.value = null;
    await flush();
    expect(container.querySelector('.loading-pending-label')?.textContent).toBe('');
    expect(container.querySelector('.loading-header')).not.toBeNull();
  });

  // ── Step tails ─────────────────────────────────────────────────────────

  it('renders a tail string next to a step row', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote });
    setLoadingStepTail(LoadingStep.Cloning, '45% (receiving)');
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).toContain('45%');
    expect(cloningRow?.textContent).toContain('receiving');
  });

  it('replaces an existing tail string with a new one', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote });
    setLoadingStepTail(LoadingStep.Cloning, '10%');
    await flush();
    setLoadingStepTail(LoadingStep.Cloning, '80%');
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).toContain('80%');
    expect(cloningRow?.textContent).not.toContain('10%');
  });

  it('clears the tail when set to null', async () => {
    showLoadingOverlay({ kind: SourceKind.Remote });
    setLoadingStepTail(LoadingStep.Cloning, '45%');
    await flush();
    setLoadingStepTail(LoadingStep.Cloning, null);
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).not.toContain('45%');
  });
});
