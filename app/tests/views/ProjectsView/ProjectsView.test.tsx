// Native-harness tests for ProjectsView — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).
//
// Focus: the inline-load-progress cutover (#77 Task 9) — while SCAN_PROGRESS is
// non-null the view shows progress + a working Cancel and the form/recents (the
// "second load" surface) are unmounted, not just visually disabled.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { ProjectsView } from '@/views/ProjectsView/ProjectsView';
import { PROJECTS_VIEW, openProjectsView, closeProjectsView } from '@/state/stores/ui';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { PENDING_SOURCE_LABEL } from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { RECENTS } from '@/state/stores/source';
import { ScanPhase } from '@/api/manifest';
import { SourceKind } from '@/utils/sources';
import { flush, drainAsync } from '../../_helpers/preact';

describe('ProjectsView', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SERVER_CONFIG.value = { allowLocalRepos: true };
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    closeProjectsView();
    SCAN_PROGRESS.value = null;
    PENDING_SOURCE_LABEL.value = null;
    RECENTS.value = [];
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', async () => {
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.querySelector('.projects-view')).toBeNull();
  });

  it('renders the new-project form when open and idle', async () => {
    openProjectsView({ dismissible: true });
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.querySelector('.new-project')).not.toBeNull();
    expect(container.querySelector('.projects-view-progress')).toBeNull();
  });

  it('shows inline progress and hides the form/recents while a load is in flight', async () => {
    openProjectsView({ dismissible: true });
    RECENTS.value = [
      { src: 'https://github.com/o/r', branch: 'main', label: 'o/r', lastOpenedAt: 1 },
    ];
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.querySelector('.recents')).not.toBeNull();

    SCAN_PROGRESS.value = { kind: SourceKind.Remote, label: 'o/r', phase: ScanPhase.CloneProgress };
    PENDING_SOURCE_LABEL.value = 'o/r';
    await flush();

    // The "second load" surface is gone, not just disabled — nothing left to
    // click into while the current load streams.
    expect(container.querySelector('.new-project')).toBeNull();
    expect(container.querySelector('.recents')).toBeNull();

    const progress = container.querySelector('.projects-view-progress');
    expect(progress).not.toBeNull();
    expect(progress?.textContent).toContain('o/r');
    expect(progress?.textContent).toMatch(/Cloning/i);
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('wires the Cancel button to onCancel', async () => {
    openProjectsView({ dismissible: true });
    const onCancel = vi.fn();
    render(<ProjectsView onSubmit={() => {}} onCancel={onCancel} onClose={() => {}} />, container);
    SCAN_PROGRESS.value = { kind: SourceKind.Local, label: 'proj', phase: null };
    await flush();

    const cancelBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel'
    )!;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not show a close button while loading, even when dismissible', async () => {
    openProjectsView({ dismissible: true });
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    SCAN_PROGRESS.value = { kind: SourceKind.Local, label: 'proj', phase: null };
    await flush();
    expect(container.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it('drops a stale error banner once a new load starts', async () => {
    openProjectsView({ dismissible: true, error: 'repository not found' });
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.textContent).toMatch(/repository not found/i);

    SCAN_PROGRESS.value = { kind: SourceKind.Remote, label: 'o/r', phase: null };
    await flush();
    expect(container.textContent).not.toMatch(/repository not found/i);
  });

  it('closes on Escape only when dismissible and not loading', async () => {
    openProjectsView({ dismissible: true });
    const onClose = vi.fn();
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={onClose} />, container);
    await flush();

    // The Escape listener rebinds via a useEffect keyed on `loading`; that
    // commit needs an rAF-scale tick in jsdom (see _helpers/preact.ts), not
    // just a microtask flush, so drainAsync rather than flush() here.
    SCAN_PROGRESS.value = { kind: SourceKind.Local, label: 'proj', phase: null };
    await drainAsync();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).not.toHaveBeenCalled();

    SCAN_PROGRESS.value = null;
    await drainAsync();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reflects the PROJECTS_VIEW signal directly', () => {
    expect(PROJECTS_VIEW.value.visible).toBe(false);
  });
});
