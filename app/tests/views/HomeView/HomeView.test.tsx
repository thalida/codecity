// Native-harness tests for HomeView (no @testing-library/preact here).
// Focus: the landing takes input and hands off. It renders no progress of its
// own — committing a source routes to /city, where the one overlay owns the
// load — so what is covered here is the form, recents, discover and errors.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';

// The backdrop canvas: jsdom has no WebGL, and none of this is about the scene.
vi.mock('@/city/City', () => ({ City: () => null }));

// Typing a remote URL mounts BranchSelect, which asks the API for branches: left
// real, that rejects "fetch failed" into whichever LATER test is running by then.
vi.mock('@/api/branches', () => ({
  fetchBranches: vi.fn(async () => ({ branches: [], default: null })),
}));

// Opening anything from here is a navigation, so this is what the assertions
// watch: the landing starts no load of its own.
vi.mock('@/router/location', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/router/location')>()),
  navigate: vi.fn(),
}));
import { HomeView } from '@/views/HomeView/HomeView';
import { BACKDROP_CITY, BackdropKind, RECENTS } from '@/state/stores/source';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';

import { SERVER_CONFIG, DEFAULT_SERVER_CONFIG, DISCOVER } from '@/state/stores/serverData';
import { flush } from '../../_helpers/preact';
import { makeSession, renderInCity } from '../../_helpers/city';

// The landing starts no load of its own, so this session's loader is spied.
const session = makeSession();
const loadSource = vi.spyOn(session.load, 'loadSource').mockResolvedValue(undefined);

/** A project already loaded, which the landing names as its backdrop. */
function loadedCity(): void {
  session.source.current.value = { src: 'https://github.com/o/loaded', branch: 'main' };
}

describe('HomeView', () => {
  let container: HTMLDivElement;

  // The real chain: SCAN_PROGRESS feeds the one driver, and the driver decides
  // when a load is over. Setting it by hand is what let the two disagree.
  let stopDriver: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: true };
    stopDriver = session.progress.attachOverlayDriver();
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    navigate(ROUTES.HOME, { replace: true });
    session.source.error.value = null;
    session.source.current.value = null;
    stopDriver();
    session.progress.scan.value = null;
    session.progress.hideOverlay();
    session.progress.pendingLabel.value = null;
    RECENTS.value = [];
    DISCOVER.value = [];
    BACKDROP_CITY.value = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the new-project form when open and idle', async () => {
    loadedCity();
    renderInCity(<HomeView />, session, container);
    await flush();
    expect(container.querySelector('.new-project')).not.toBeNull();
    expect(container.querySelector('.landing-progress')).toBeNull();
  });

  it('drops a stale error banner as soon as the user edits the source', async () => {
    loadedCity();
    session.source.error.value = {
      error: 'unrecognized source',
      prefill: { src: 'https://forgejo.example/o/r' },
    };
    renderInCity(<HomeView />, session, container);
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
      renderInCity(<HomeView />, session, container);
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
      session.source.current.value = { src, branch: 'main' };
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

      session.source.current.value = null;
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

    it('links a Discover row straight at the project it names', async () => {
      DISCOVER.value = CURATED;
      loadedCity();
      renderInCity(<HomeView />, session, container);
      await flush();
      // A link, not a handler: the destination is visible on hover, and the row
      // cannot open a repo other than the one it is labelled with.
      const row = container.querySelector<HTMLAnchorElement>(
        '[data-list="discover"] a.source-row'
      )!;
      expect(row.getAttribute('href')).toBe('/city?src=https://github.com/preactjs/preact');
      expect(loadSource).not.toHaveBeenCalled();
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
      renderInCity(<HomeView />, session, container);
      await flush();
      expect(stage()).not.toBeNull();
      // Decoration: named for nobody, so it stays out of the a11y tree.
      expect(stage()!.getAttribute('aria-hidden')).toBe('true');
    });

    it('reveals the canvas over the wallpaper only once a backdrop has painted', async () => {
      renderInCity(<HomeView />, session, container);
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
      navigate(ROUTES.HOME);
      renderInCity(<HomeView />, session, container);
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

  // Read top to bottom: the pitch stays one uninterrupted thought, and the
  // wallpaper caption is a caption rather than part of it.
  describe('hero column', () => {
    const hero = async () => {
      navigate(ROUTES.HOME);
      renderInCity(<HomeView />, session, container);
      await flush();
      return container.querySelector('.landing-hero')!;
    };

    it('keeps the tagline and the cues together, with nothing between them', async () => {
      const pitch = (await hero()).querySelector('.landing-pitch')!;
      expect(pitch.querySelector('.landing-tagline')).not.toBeNull();
      expect(pitch.querySelector('.landing-delights')).not.toBeNull();
      // Two children only: anything else here splits the pitch in half.
      expect(pitch.children).toHaveLength(2);
    });

    it('puts the wallpaper caption last, below everything it is not part of', async () => {
      BACKDROP_CITY.value = {
        src: 'https://github.com/thalida/codecity',
        label: 'thalida/codecity',
        kind: BackdropKind.Featured,
      };
      const column = await hero();
      expect(column.lastElementChild!.classList.contains('landing-featured')).toBe(true);
    });
  });

  // Answered in the field's helper-text slot at the smallest step in the type
  // scale, which is why it kept getting missed.
  describe('private and local repos', () => {
    const band = () => container.querySelector('.landing-local');

    const renderAt = async (allowLocalRepos: boolean) => {
      SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos };
      navigate(ROUTES.HOME);
      renderInCity(<HomeView />, session, container);
      await flush();
    };

    it('answers in the hero, not under the field, wherever a folder is unreachable', async () => {
      await renderAt(false);
      expect(band()).not.toBeNull();
      expect(band()!.textContent).toContain('private and local repos work');
      expect(band()!.querySelector('a')!.getAttribute('href')).toMatch(/#run-it-yourself$/);
    });

    // Keyed on what this instance can open, not on which deployment it is: the
    // message used to move between the hero and the field slot with `hosted`.
    it('stays put whether or not this is the public deployment', async () => {
      for (const hosted of [false, true]) {
        SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: false, hosted };
        navigate(ROUTES.HOME);
        renderInCity(<HomeView />, session, container);
        await flush();
        expect(band()).not.toBeNull();
        expect(container.querySelector('.unreachable')).toBeNull();
        render(null, container);
      }
    });

    it('says nothing once a folder here is openable', async () => {
      await renderAt(true);
      expect(band()).toBeNull();
    });
  });

  // The landing covers the app header and footer, so without these a cold
  // boot shows no version, repo link, or credit at all.
  describe('identity line', () => {
    const renderLanding = async (opts: { dismissible: boolean }) => {
      SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: true, version: '1.4.0' };
      if (opts.dismissible) loadedCity();
      navigate(ROUTES.HOME);
      renderInCity(<HomeView />, session, container);
      await flush();
      return container.querySelector('.landing-hero')!;
    };

    it('shows the running version under the wordmark', async () => {
      const hero = await renderLanding({ dismissible: false });
      expect(hero.querySelector('.landing-wordmark')!.textContent).toBe('codecity');
      expect(hero.textContent).toContain('v1.4.0');
    });

    it('links the brand home, the repo link to GitHub, and the credit to thalida.com', async () => {
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

    it('names the repo link for where it goes', async () => {
      const hero = await renderLanding({ dismissible: false });
      const repo = hero.querySelector<HTMLAnchorElement>('a[href$="/thalida/codecity"]')!;
      expect(repo.textContent).toBe('GitHub');
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
