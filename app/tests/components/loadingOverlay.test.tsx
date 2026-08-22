import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { LoadingOverlay } from '@/components/loading/LoadingOverlay/LoadingOverlay';

import { LoadingStep, TIMELINE_LOADING_STEPS } from '@/constants/progress';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { SourceKind } from '@/utils/sources';
import { flush } from '../_helpers/preact';
import { makeSession, renderInCity } from '../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

// The overlay is signal-driven, so these tests render the component and poke
// the ui-store helpers, flushing Preact's re-render before asserting.

let container: HTMLDivElement;

beforeEach(() => {
  // Reset the shared signal so each test starts from a clean hidden state.
  session.progress.overlay.value = {
    visible: false,
    showOpts: null,
    activeStep: null,
    stepTails: {},
  };
  session.progress.pendingLabel.value = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  renderInCity(<LoadingOverlay onCancel={() => {}} />, session, container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  session.progress.pendingLabel.value = null;
  navigate(ROUTES.CITY, { replace: true });
});

describe('LoadingOverlay', () => {
  it('starts hidden (renders nothing)', () => {
    expect(container.querySelector('.loading-backdrop')).toBeNull();
  });

  it('show reveals the overlay', async () => {
    session.progress.showOverlay({ kind: SourceKind.Local });
    await flush();
    expect(container.querySelector('.loading-backdrop')).not.toBeNull();
  });

  it('hide removes it from view', async () => {
    session.progress.showOverlay({ kind: SourceKind.Local });
    await flush();
    session.progress.hideOverlay();
    await flush();
    expect(container.querySelector('.loading-backdrop')).toBeNull();
  });

  it('renders a single card across re-shows (no duplicates)', async () => {
    session.progress.showOverlay({ kind: SourceKind.Local });
    await flush();
    session.progress.showOverlay({ kind: SourceKind.Local });
    await flush();
    expect(container.querySelectorAll('.loading-card').length).toBe(1);
  });

  // ── Stepped progress ──────────────────────────────────────────────────────

  it('renders the right steps for git', async () => {
    session.progress.showOverlay({ kind: SourceKind.Remote });
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
    session.progress.showOverlay({ kind: SourceKind.Local });
    await flush();
    const resolving = container.querySelector('[data-step="resolving"]') as HTMLElement;
    const cloning = container.querySelector('[data-step="cloning"]') as HTMLElement;
    expect(resolving.style.display).toBe('none');
    expect(cloning.style.display).toBe('none');
  });

  it('setLoadingStep marks previous steps done and target active', async () => {
    session.progress.showOverlay({ kind: SourceKind.Remote });
    await flush();
    session.progress.setStep(LoadingStep.Building);
    await flush();
    expect(container.querySelector('[data-step="building"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(container.querySelector('[data-step="scanning"]')?.getAttribute('data-state')).toBe(
      'done'
    );
  });

  it('shows the branch as a pill beside the repo name when provided', async () => {
    session.progress.pendingLabel.value = 'owner/repo';
    session.progress.showOverlay({ kind: SourceKind.Remote, branch: 'main' });
    await flush();
    expect(container.querySelector('.branch-pill')?.textContent).toBe('@main');
  });

  it('git mode starts with resolving active', async () => {
    session.progress.showOverlay({ kind: SourceKind.Remote });
    await flush();
    expect(container.querySelector('[data-step="resolving"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(container.querySelector('[data-step="cloning"]')?.getAttribute('data-state')).toBe(
      'pending'
    );
  });

  it('local mode starts with scanning active', async () => {
    session.progress.showOverlay({ kind: SourceKind.Local });
    await flush();
    expect(container.querySelector('[data-step="scanning"]')?.getAttribute('data-state')).toBe(
      'active'
    );
    expect(container.querySelector('[data-step="building"]')?.getAttribute('data-state')).toBe(
      'pending'
    );
  });

  it('renders the Timeline list as one row per server stage, starting on the first', async () => {
    session.progress.showOverlay({ kind: SourceKind.Remote, steps: TIMELINE_LOADING_STEPS });
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
    session.progress.showOverlay({ kind: SourceKind.Local, steps: TIMELINE_LOADING_STEPS });
    await flush();
    const fetchRow = container.querySelector('[data-step="timeline-fetch"]') as HTMLElement;
    expect(fetchRow.style.display).toBe('none'); // nothing to fetch: the repo is already on disk
    expect(
      container.querySelector('[data-step="timeline-history"]')?.getAttribute('data-state')
    ).toBe('active');
  });

  it('marks the stages behind the active one done', async () => {
    session.progress.showOverlay({ kind: SourceKind.Remote, steps: TIMELINE_LOADING_STEPS });
    await flush();
    session.progress.setStep(LoadingStep.TimelineBlobs);
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
    session.progress.showOverlay({ kind: SourceKind.Remote });
    session.progress.pendingLabel.value = 'owner/repo';
    await flush();
    const header = container.querySelector('.loading-pending-label');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('owner/repo');
  });

  it('drops the label text but holds its row', async () => {
    // The label lands a beat after the overlay does, so its row is always
    // there: one appearing would jog every row under it mid-load.
    session.progress.showOverlay({ kind: SourceKind.Remote });
    session.progress.pendingLabel.value = 'owner/repo';
    await flush();
    session.progress.pendingLabel.value = null;
    await flush();
    expect(container.querySelector('.loading-pending-label')?.textContent).toBe('');
    expect(container.querySelector('.loading-header')).not.toBeNull();
  });

  // ── Step tails ─────────────────────────────────────────────────────────

  it('renders a tail string next to a step row', async () => {
    session.progress.showOverlay({ kind: SourceKind.Remote });
    session.progress.setStepTail(LoadingStep.Cloning, '45% (receiving)');
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).toContain('45%');
    expect(cloningRow?.textContent).toContain('receiving');
  });

  it('replaces an existing tail string with a new one', async () => {
    session.progress.showOverlay({ kind: SourceKind.Remote });
    session.progress.setStepTail(LoadingStep.Cloning, '10%');
    await flush();
    session.progress.setStepTail(LoadingStep.Cloning, '80%');
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).toContain('80%');
    expect(cloningRow?.textContent).not.toContain('10%');
  });

  it('clears the tail when set to null', async () => {
    session.progress.showOverlay({ kind: SourceKind.Remote });
    session.progress.setStepTail(LoadingStep.Cloning, '45%');
    await flush();
    session.progress.setStepTail(LoadingStep.Cloning, null);
    await flush();
    const cloningRow = container.querySelector('[data-step="cloning"]');
    expect(cloningRow?.textContent).not.toContain('45%');
  });
});
