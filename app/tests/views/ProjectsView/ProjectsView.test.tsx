// Native-harness tests for ProjectsView — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).
//
// Focus: the inline-load-progress cutover (#77 Task 9) — while SCAN_PROGRESS is
// non-null the view shows progress + a working Cancel and the form/recents (the
// "second load" surface) are unmounted, not just visually disabled.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { ProjectsView } from '@/views/ProjectsView/ProjectsView';
import {
  PROJECTS_VIEW,
  openProjectsView,
  closeProjectsView,
  setLoadingStepTail,
  PENDING_SOURCE_LABEL,
} from '@/state/stores/ui';
import { LoadingStep } from '@/constants/loadingSteps';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';

import { SERVER_CONFIG, DEFAULT_SERVER_CONFIG } from '@/state/stores/serverConfig';
import { RECENTS, CURRENT_SOURCE } from '@/state/stores/source';
import { DISCOVER } from '@/state/stores/discover';
import { FEATURED_CITY } from '@/state/stores/ui';
import { ScanPhase } from '@/api/manifest';
import { SourceKind } from '@/utils/sources';
import { flush, drainAsync } from '../../_helpers/preact';

describe('ProjectsView', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: true };
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    closeProjectsView();
    SCAN_PROGRESS.value = null;
    PENDING_SOURCE_LABEL.value = null;
    RECENTS.value = [];
    DISCOVER.value = [];
    FEATURED_CITY.value = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders nothing when closed', async () => {
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.querySelector('.landing')).toBeNull();
  });

  it('renders the new-project form when open and idle', async () => {
    openProjectsView({ dismissible: true });
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.querySelector('.new-project')).not.toBeNull();
    expect(container.querySelector('.landing-progress')).toBeNull();
  });

  it('shows inline progress and hides the form/recents while a load is in flight', async () => {
    openProjectsView({ dismissible: true });
    RECENTS.value = [
      { src: 'https://github.com/o/r', branch: 'main', label: 'o/r', lastOpenedAt: 1 },
    ];
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.querySelector('.recents-list')).not.toBeNull();

    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CloneProgress };
    PENDING_SOURCE_LABEL.value = 'o/r';
    await flush();

    // The "second load" surface is gone, not just disabled — nothing left to
    // click into while the current load streams.
    expect(container.querySelector('.new-project')).toBeNull();
    expect(container.querySelector('.recents-list')).toBeNull();

    const progress = container.querySelector('.landing-progress');
    expect(progress).not.toBeNull();
    expect(progress?.textContent).toContain('o/r');
    expect(progress?.textContent).toMatch(/Cloning/i);
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('forwards per-step tails (clone %) into the inline switcher progress', async () => {
    openProjectsView({ dismissible: true });
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CloneProgress };
    setLoadingStepTail(LoadingStep.Cloning, '45% (Receiving)');
    await flush();

    const tail = container.querySelector('.loading-step-tail');
    expect(tail).not.toBeNull();
    expect(tail!.textContent).toContain('45%');

    setLoadingStepTail(LoadingStep.Cloning, null); // reset the shared overlay state
  });

  it('wires the Cancel button to onCancel', async () => {
    openProjectsView({ dismissible: true });
    const onCancel = vi.fn();
    render(<ProjectsView onSubmit={() => {}} onCancel={onCancel} onClose={() => {}} />, container);
    SCAN_PROGRESS.value = { kind: SourceKind.Local, phase: null };
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
    SCAN_PROGRESS.value = { kind: SourceKind.Local, phase: null };
    await flush();
    expect(container.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it('drops a stale error banner once a new load starts', async () => {
    openProjectsView({ dismissible: true, error: 'repository not found' });
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.textContent).toMatch(/repository not found/i);

    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: null };
    await flush();
    expect(container.textContent).not.toMatch(/repository not found/i);
  });

  it('drops a stale error banner as soon as the user edits the source', async () => {
    openProjectsView({
      dismissible: true,
      error: 'unrecognized source',
      prefill: { src: 'https://forgejo.example/o/r' },
    });
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, container);
    await flush();
    expect(container.textContent).toMatch(/unrecognized source/i);

    const input = container.querySelector<HTMLInputElement>('#new-project-source')!;
    input.value = 'https://forgejo.example/o/r2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    // Banner gone; the field keeps what the user typed (no remount).
    expect(container.textContent).not.toMatch(/unrecognized source/i);
    expect(container.querySelector<HTMLInputElement>('#new-project-source')!.value).toBe(
      'https://forgejo.example/o/r2'
    );
  });

  it('closes on Escape only when dismissible and not loading', async () => {
    openProjectsView({ dismissible: true });
    const onClose = vi.fn();
    render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={onClose} />, container);
    await flush();

    // The Escape listener rebinds via a useEffect keyed on `loading`; that
    // commit needs an rAF-scale tick in jsdom (see _helpers/preact.ts), not
    // just a microtask flush, so drainAsync rather than flush() here.
    SCAN_PROGRESS.value = { kind: SourceKind.Local, phase: null };
    await drainAsync();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).not.toHaveBeenCalled();

    SCAN_PROGRESS.value = null;
    await drainAsync();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe('the Recent / Discover card', () => {
    const RECENT = { src: 'https://github.com/o/r', label: 'r', lastOpenedAt: 1 };
    const CURATED = [
      { url: 'https://github.com/preactjs/preact', label: 'preact', featured: false },
    ];

    const tabLabels = () =>
      Array.from(container.querySelectorAll('[role="tab"]')).map((el) => el.textContent);
    const open = async () => {
      openProjectsView({ dismissible: true });
      render(
        <ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />,
        container
      );
      await flush();
    };

    it('keeps the Recent tab with an empty state, so a first visit learns it exists', async () => {
      await open();
      expect(tabLabels()).toEqual(['Recent']);
      expect(container.querySelector('.recents-empty')?.textContent).toMatch(
        /projects you open will show up here/i
      );
    });

    it('hides the Discover tab when the server sent an empty list', async () => {
      RECENTS.value = [RECENT];
      await open();
      expect(tabLabels()).toEqual(['Recent']);
    });

    it('opens on Discover when you have no recents, since that is the tab with something in it', async () => {
      DISCOVER.value = CURATED;
      await open();
      expect(tabLabels()).toEqual(['Recent', 'Discover']);
      expect(container.querySelector('.discover-list')).not.toBeNull();
      expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
        'Discover'
      );
    });

    it('opens on Recent once you have some, since your own projects outrank a suggestion', async () => {
      RECENTS.value = [RECENT];
      DISCOVER.value = CURATED;
      await open();
      expect(tabLabels()).toEqual(['Recent', 'Discover']);
      expect(container.querySelector('.recents-list')).not.toBeNull();
      expect(container.querySelector('.discover-list')).toBeNull();
    });

    it('switches the panel when a tab is picked', async () => {
      RECENTS.value = [RECENT];
      DISCOVER.value = CURATED;
      await open();
      const discoverTab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (el) => el.textContent === 'Discover'
      )!;
      discoverTab.click();
      await flush();
      expect(container.querySelector('.discover-list')).not.toBeNull();
      expect(container.querySelector('.recents-list')).toBeNull();
    });

    it('marks the same repo Active in both lists, branch or no branch', async () => {
      // Regression: source identity includes the branch. Recents stores @main,
      // a Discover row names the repo alone, and ACTIVE_SOURCE can only carry
      // one shape. Comparing both the same way marked one list and missed the
      // other, in whichever direction the shape happened to lean.
      const src = 'https://github.com/preactjs/preact';
      CURRENT_SOURCE.value = { src, branch: 'main' };
      RECENTS.value = [{ src, branch: 'main', label: 'preactjs/preact', lastOpenedAt: 1 }];
      DISCOVER.value = [{ url: src, label: 'preact', featured: false }];
      await open();

      const noteIn = (list: string) =>
        container.querySelector(`${list} .source-row--active .source-row-note`)?.textContent;
      expect(noteIn('.recents-list')).toBe('Active');

      const discoverTab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (el) => el.textContent === 'Discover'
      )!;
      discoverTab.click();
      await flush();
      expect(noteIn('.discover-list')).toBe('Active');

      CURRENT_SOURCE.value = null;
    });

    it('marks the featured repo Active in recents, which stores a branch', async () => {
      // The featured city is not an opened project, so it has no CURRENT_SOURCE.
      // Its identity still has to carry the branch it loaded, or it fails to
      // match its own row in recents.
      const src = 'https://github.com/thalida/codecity';
      RECENTS.value = [{ src, branch: 'main', label: 'thalida/codecity', lastOpenedAt: 1 }];
      DISCOVER.value = [{ url: src, label: 'codecity', featured: true }];
      FEATURED_CITY.value = { src, label: 'thalida/codecity', branch: 'main' };
      await open();
      expect(
        container.querySelector('.recents-list .source-row--active .source-row-note')?.textContent
      ).toBe('Active');
    });

    it('forgets a picked tab when the switcher closes', async () => {
      // Regression: the view returns null while hidden but stays mounted, so a
      // tab picked once became the tab you got on every later open, Discover
      // included, however many recents you had.
      RECENTS.value = [RECENT];
      DISCOVER.value = CURATED;
      await open();
      const discoverTab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (el) => el.textContent === 'Discover'
      )!;
      discoverTab.click();
      await flush();
      expect(container.querySelector('.discover-list')).not.toBeNull();

      closeProjectsView();
      await flush();
      openProjectsView({ dismissible: true });
      await flush();
      expect(container.querySelector('.recents-list')).not.toBeNull();
      expect(container.querySelector('.discover-list')).toBeNull();
    });

    it('opens the source a Discover row names', async () => {
      const onSubmit = vi.fn();
      DISCOVER.value = CURATED;
      openProjectsView({ dismissible: true });
      render(
        <ProjectsView onSubmit={onSubmit} onCancel={() => {}} onClose={() => {}} />,
        container
      );
      await flush();
      container.querySelector<HTMLButtonElement>('.discover-list .source-row')!.click();
      expect(onSubmit).toHaveBeenCalledWith({ src: 'https://github.com/preactjs/preact' });
    });

    it('shows no remove control on a Discover row: it is not yours to forget', async () => {
      DISCOVER.value = CURATED;
      await open();
      expect(
        container.querySelector('.discover-list [aria-label="Remove from recents"]')
      ).toBeNull();
    });

    it('wires the panel to the active tab for screen readers', async () => {
      RECENTS.value = [RECENT];
      DISCOVER.value = CURATED;
      await open();
      const panel = container.querySelector('[role="tabpanel"]')!;
      const activeTab = container.querySelector('[role="tab"][aria-selected="true"]')!;
      expect(panel.getAttribute('aria-labelledby')).toBe(activeTab.id);
      expect(activeTab.getAttribute('aria-controls')).toBe(panel.id);
    });
  });

  describe('the featured city', () => {
    const stage = () => container.querySelector('.landing-stage');
    const featured = () => container.querySelector('.landing-featured');

    it('stages a backdrop on a cold boot, where there is no city to reveal', async () => {
      openProjectsView({ dismissible: false });
      render(
        <ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />,
        container
      );
      await flush();
      expect(stage()).not.toBeNull();
      // Decoration: named for nobody, so it stays out of the a11y tree.
      expect(stage()!.getAttribute('aria-hidden')).toBe('true');
    });

    it('stages nothing over a loaded city, which is already the backdrop', async () => {
      openProjectsView({ dismissible: true });
      render(
        <ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />,
        container
      );
      await flush();
      expect(stage()).toBeNull();
    });

    it('names the city on screen once it has actually painted', async () => {
      openProjectsView({ dismissible: false });
      render(
        <ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />,
        container
      );
      await flush();
      // Nothing painted yet: naming a repo the viewer can't see would be a lie.
      expect(featured()).toBeNull();

      FEATURED_CITY.value = {
        src: 'https://github.com/thalida/codecity',
        label: 'thalida/codecity',
      };
      await flush();
      expect(featured()!.textContent).toContain('thalida/codecity');
    });
  });

  it('reflects the PROJECTS_VIEW signal directly', () => {
    expect(PROJECTS_VIEW.value.visible).toBe(false);
  });

  // The landing is fixed over the whole viewport, so it covers the app header
  // and footer: without these, a cold boot shows no version, repo link or
  // credit until a repo is loaded.
  describe('identity line', () => {
    const renderLanding = async (opts: { dismissible: boolean }) => {
      SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: true, version: '1.4.0' };
      openProjectsView(opts);
      render(
        <ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />,
        container
      );
      await flush();
      return container.querySelector('.landing-hero')!;
    };

    it('shows the running version under the wordmark', async () => {
      const hero = await renderLanding({ dismissible: false });
      expect(hero.querySelector('.landing-wordmark')!.textContent).toBe('codecity');
      expect(hero.textContent).toContain('v1.4.0');
    });

    it('links about to the repo and the credit to thalida.com', async () => {
      const hero = await renderLanding({ dismissible: false });
      const links = Array.from(hero.querySelectorAll<HTMLAnchorElement>('a'));
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
      const hero = await renderLanding({ dismissible: false });
      expect(hero.textContent).toContain('🦄 thalida.');
    });

    it('shows on the dismissible switcher too, which also covers the chrome', async () => {
      const hero = await renderLanding({ dismissible: true });
      expect(hero.textContent).toContain('v1.4.0');
      expect(hero.querySelectorAll('a')).toHaveLength(2);
    });
  });
});
