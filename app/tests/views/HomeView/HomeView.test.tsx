// Native-harness tests for HomeView (no @testing-library/preact here).
// Focus: while SCAN_PROGRESS is non-null the view shows progress + Cancel and
// unmounts the form/recents entirely, rather than disabling them.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';

// The backdrop canvas: jsdom has no WebGL, and none of this is about the scene.
vi.mock('@/city/City', () => ({
  City: () => null,
  CityVariant: { Scene: 'scene', Backdrop: 'backdrop' },
}));

// The view calls these directly now, so they are what "it opened a project" and
// "it cancelled the load" mean.
vi.mock('@/hooks/useManifestSource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useManifestSource')>()),
  loadSource: vi.fn(),
  cancelLoad: vi.fn(),
}));
import { HomeView } from '@/views/HomeView/HomeView';
import { HOME_OPTS, goHome } from '@/state/stores/home';
import { setLoadingStepTail, PENDING_SOURCE_LABEL } from '@/state/stores/loading';
import { BACKDROP_CITY, BackdropKind } from '@/state/stores/backdrop';
import { loadSource, cancelLoad } from '@/hooks/useManifestSource';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { LoadingStep } from '@/constants/loadingSteps';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';

import { SERVER_CONFIG, DEFAULT_SERVER_CONFIG } from '@/state/stores/serverConfig';
import { RECENTS, CURRENT_SOURCE } from '@/state/stores/source';
import { DISCOVER } from '@/state/stores/discover';
import { ScanPhase } from '@/api/manifest';
import { SourceKind } from '@/utils/sources';
import { flush } from '../../_helpers/preact';

/** A project already loaded, which the landing names as its backdrop. */
function loadedCity(): void {
  CURRENT_SOURCE.value = { src: 'https://github.com/o/loaded', branch: 'main' };
}

describe('HomeView', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: true };
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    navigate(ROUTES.HOME, { replace: true });
    HOME_OPTS.value = {};
    CURRENT_SOURCE.value = null;
    SCAN_PROGRESS.value = null;
    PENDING_SOURCE_LABEL.value = null;
    RECENTS.value = [];
    DISCOVER.value = [];
    BACKDROP_CITY.value = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the new-project form when open and idle', async () => {
    loadedCity();
    render(<HomeView />, container);
    await flush();
    expect(container.querySelector('.new-project')).not.toBeNull();
    expect(container.querySelector('.landing-progress')).toBeNull();
  });

  it('shows inline progress and hides the form/recents while a load is in flight', async () => {
    loadedCity();
    RECENTS.value = [
      { src: 'https://github.com/o/r', branch: 'main', label: 'o/r', lastOpenedAt: 1 },
    ];
    render(<HomeView />, container);
    await flush();
    expect(container.querySelector('[data-list="recents"]')).not.toBeNull();

    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CloneProgress };
    PENDING_SOURCE_LABEL.value = 'o/r';
    await flush();

    // The "second load" surface is gone, not just disabled — nothing left to
    // click into while the current load streams.
    expect(container.querySelector('.new-project')).toBeNull();
    expect(container.querySelector('[data-list="recents"]')).toBeNull();

    const progress = container.querySelector('.landing-progress');
    expect(progress).not.toBeNull();
    expect(progress?.textContent).toContain('o/r');
    expect(progress?.textContent).toMatch(/Cloning/i);
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('forwards per-step tails (clone %) into the inline switcher progress', async () => {
    loadedCity();
    render(<HomeView />, container);
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CloneProgress };
    setLoadingStepTail(LoadingStep.Cloning, '45% (Receiving)');
    await flush();

    const tail = container.querySelector('.loading-step-tail');
    expect(tail).not.toBeNull();
    expect(tail!.textContent).toContain('45%');

    setLoadingStepTail(LoadingStep.Cloning, null); // reset the shared overlay state
  });

  it('cancels the in-flight load from its Cancel button', async () => {
    loadedCity();
    render(<HomeView />, container);
    SCAN_PROGRESS.value = { kind: SourceKind.Local, phase: null };
    await flush();

    const cancelBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel'
    )!;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();
    expect(cancelLoad).toHaveBeenCalledOnce();
  });

  it('drops a stale error banner once a new load starts', async () => {
    loadedCity();
    goHome({ error: 'repository not found' });
    render(<HomeView />, container);
    await flush();
    expect(container.textContent).toMatch(/repository not found/i);

    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: null };
    await flush();
    expect(container.textContent).not.toMatch(/repository not found/i);
  });

  it('drops a stale error banner as soon as the user edits the source', async () => {
    loadedCity();
    goHome({
      error: 'unrecognized source',
      prefill: { src: 'https://forgejo.example/o/r' },
    });
    render(<HomeView />, container);
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

  describe('the Recent / Discover card', () => {
    const RECENT = { src: 'https://github.com/o/r', label: 'r', lastOpenedAt: 1 };
    const CURATED = [
      { url: 'https://github.com/preactjs/preact', label: 'preact', featured: false },
    ];

    const tabLabels = () =>
      Array.from(container.querySelectorAll('[role="tab"]')).map((el) => el.textContent);
    const open = async () => {
      render(<HomeView />, container);
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
      expect(container.querySelector('[data-list="discover"]')).not.toBeNull();
      expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
        'Discover'
      );
    });

    it('opens on Recent once you have some, since your own projects outrank a suggestion', async () => {
      RECENTS.value = [RECENT];
      DISCOVER.value = CURATED;
      await open();
      expect(tabLabels()).toEqual(['Recent', 'Discover']);
      expect(container.querySelector('[data-list="recents"]')).not.toBeNull();
      expect(container.querySelector('[data-list="discover"]')).toBeNull();
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
      expect(container.querySelector('[data-list="discover"]')).not.toBeNull();
      expect(container.querySelector('[data-list="recents"]')).toBeNull();
    });

    it('marks the same repo Active in both lists, branch or no branch', async () => {
      // Regression: recents stores @main while Discover names the repo
      // alone, so one comparison shape always missed a list.
      const src = 'https://github.com/preactjs/preact';
      CURRENT_SOURCE.value = { src, branch: 'main' };
      RECENTS.value = [{ src, branch: 'main', label: 'preactjs/preact', lastOpenedAt: 1 }];
      DISCOVER.value = [{ url: src, label: 'preact', featured: false }];
      await open();

      const noteIn = (list: string) =>
        container.querySelector(`${list} .source-row--active .source-row-note`)?.textContent;
      expect(noteIn('[data-list="recents"]')).toBe('Active');

      const discoverTab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (el) => el.textContent === 'Discover'
      )!;
      discoverTab.click();
      await flush();
      expect(noteIn('[data-list="discover"]')).toBe('Active');

      CURRENT_SOURCE.value = null;
    });

    it('marks the featured repo Active in recents, which stores a branch', async () => {
      // The featured city has no CURRENT_SOURCE, but its identity must still
      // carry a branch or it won't match its own recents row.
      const src = 'https://github.com/thalida/codecity';
      RECENTS.value = [{ src, branch: 'main', label: 'thalida/codecity', lastOpenedAt: 1 }];
      DISCOVER.value = [{ url: src, label: 'codecity', featured: true }];
      BACKDROP_CITY.value = {
        src,
        label: 'thalida/codecity',
        branch: 'main',
        kind: BackdropKind.Featured,
      };
      await open();
      expect(
        container.querySelector('[data-list="recents"] .source-row--active .source-row-note')
          ?.textContent
      ).toBe('Active');
    });

    it('forgets a picked tab when the switcher closes', async () => {
      // The route unmounts the view on close, which resets the tab: it used to
      // stay mounted and hidden, so one pick stuck for every later open.
      RECENTS.value = [RECENT];
      DISCOVER.value = CURATED;
      await open();
      const discoverTab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (el) => el.textContent === 'Discover'
      )!;
      discoverTab.click();
      await flush();
      expect(container.querySelector('[data-list="discover"]')).not.toBeNull();

      render(null, container); // leaving home
      await flush();
      await open(); // and coming back
      expect(container.querySelector('[data-list="recents"]')).not.toBeNull();
      expect(container.querySelector('[data-list="discover"]')).toBeNull();
    });

    it('opens the source a Discover row names', async () => {
      DISCOVER.value = CURATED;
      loadedCity();
      render(<HomeView />, container);
      await flush();
      container.querySelector<HTMLButtonElement>('[data-list="discover"] .source-row')!.click();
      expect(loadSource).toHaveBeenCalledWith({ src: 'https://github.com/preactjs/preact' });
    });

    it('shows no remove control on a Discover row: it is not yours to forget', async () => {
      DISCOVER.value = CURATED;
      await open();
      expect(
        container.querySelector('[data-list="discover"] [aria-label="Remove from recents"]')
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

  describe('the backdrop', () => {
    const stage = () => container.querySelector('.landing-stage');
    const featured = () => container.querySelector('.landing-featured');

    it('always stages the wallpaper: it is what "no city yet" looks like', async () => {
      render(<HomeView />, container);
      await flush();
      expect(stage()).not.toBeNull();
      // Decoration: named for nobody, so it stays out of the a11y tree.
      expect(stage()!.getAttribute('aria-hidden')).toBe('true');
    });

    it('reveals the canvas over the wallpaper only once a backdrop has painted', async () => {
      render(<HomeView />, container);
      await flush();
      expect(stage()!.classList.contains('is-painted')).toBe(false);

      BACKDROP_CITY.value = {
        src: 'https://github.com/o/r',
        label: 'o/r',
        kind: BackdropKind.Recent,
      };
      await flush();
      expect(stage()!.classList.contains('is-painted')).toBe(true);
    });

    it('names the city on screen once it has actually painted', async () => {
      goHome();
      render(<HomeView />, container);
      await flush();
      // Nothing painted yet: naming a repo the viewer can't see would be a lie.
      expect(featured()).toBeNull();

      BACKDROP_CITY.value = {
        src: 'https://github.com/thalida/codecity',
        label: 'thalida/codecity',
        kind: BackdropKind.Featured,
      };
      await flush();
      expect(featured()!.textContent).toContain('thalida/codecity');
    });
  });

  // The landing covers the app header and footer, so without these a cold
  // boot shows no version, repo link, or credit at all.
  describe('identity line', () => {
    const renderLanding = async (opts: { dismissible: boolean }) => {
      SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: true, version: '1.4.0' };
      if (opts.dismissible) loadedCity();
      goHome();
      render(<HomeView />, container);
      await flush();
      return container.querySelector('.landing-hero')!;
    };

    it('shows the running version under the wordmark', async () => {
      const hero = await renderLanding({ dismissible: false });
      expect(hero.querySelector('.landing-wordmark')!.textContent).toBe('codecity');
      expect(hero.textContent).toContain('v1.4.0');
    });

    it('links the brand home, about to the repo, and the credit to thalida.com', async () => {
      const hero = await renderLanding({ dismissible: false });
      const links = Array.from(hero.querySelectorAll<HTMLAnchorElement>('a'));
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        '/',
        'https://github.com/thalida/codecity',
        'https://thalida.com',
      ]);
      // The brand is an in-app home link; the external pair opens new tabs.
      for (const a of links.slice(1)) {
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
      expect(hero.querySelectorAll('a')).toHaveLength(3);
    });
  });
});
