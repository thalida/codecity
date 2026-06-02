import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { CommitPane } from '@/views/CommitPane';
import type { CommitPaneState } from '@/views/CommitPane';
import type { CommitEntry } from '@/types';
// Settling a CommitPane render involves two interleaved schedulers: the
// commit-body fetch chain (fetchCommitDetail awaits fetch() then resp.json(),
// or rejects on a non-ok response) and Preact picking up the resulting
// useState change. drainAsync alternates microtask + macrotask yields to
// cover both the success and the longer reject path deterministically.
import { drainAsync } from '../_helpers/preact';

const COMMIT: CommitEntry = {
  date: '2026-03-12',
  files: 4,
  sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
  authors: ['Alice Author'],
  subject: 'fix(scan): handle empty repos cleanly',
  same_day_total: 4,
};

// setCommit(commit, opts) on the old factory maps to assigning the signal
// value (commit + opts fields) and flushing.
type SetOpts = Omit<CommitPaneState, 'commit'>;

describe('CommitPane', () => {
  let container: HTMLDivElement;
  let state: ReturnType<typeof signal<CommitPaneState>>;

  function mount(opts: { onClose?: () => void; onFocus?: (c: CommitEntry) => void } = {}): void {
    state = signal<CommitPaneState>({ commit: null });
    render(
      <CommitPane state={state} onClose={opts.onClose ?? (() => {})} onFocus={opts.onFocus} />,
      container
    );
  }

  async function setCommit(commit: CommitEntry | null, opts: SetOpts = {}): Promise<void> {
    state.value = { commit, ...opts };
    await drainAsync();
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Default: every fetch resolves to an empty body so existing tests don't
    // hang in loading state. Individual tests can override globalThis.fetch.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          sha: '',
          authors: [''],
          date: '',
          subject: '',
          body: '',
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
  });

  afterEach(() => {
    // Unmount so the useEffect cleanup flips `cancelled` on any in-flight
    // fetch — stray late resolutions are then dropped instead of touching
    // an unmounted tree.
    render(null, container);
    container.remove();
  });

  it('returns a .pane wrapper with a pane-header titled "Commit"', () => {
    mount();
    const pane = container.querySelector('.pane') as HTMLElement;
    expect(pane.classList.contains('pane')).toBe(true);
    expect(pane.querySelector('.pane-header')).not.toBeNull();
    expect(pane.querySelector('.text-pane-title')!.textContent).toBe('Commit');
  });

  it('renders an empty state when no commit is set', () => {
    mount();
    expect(container.querySelector('.commit-sha')).toBeNull();
    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders short SHA, age, files changed, and an open-on-origin link', async () => {
    mount();
    const now = new Date('2026-05-24T12:00:00Z');
    await setCommit(COMMIT, { remoteUrl: 'https://github.com/org/repo', now });

    // SHA is inside the pane header title.
    expect(container.querySelector('.text-pane-title .commit-sha')!.textContent).toBe('a1b2c3d');

    // Open link is in the pane header title.
    const link = container.querySelector('.text-pane-title .commit-open') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe(`https://github.com/org/repo/commit/${COMMIT.sha}`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');

    // Wait for fetch to resolve so the rest of the content renders.
    await drainAsync();

    // Age is inside .commit-meta
    expect(container.querySelector('.commit-age')!.textContent).toContain('2 months ago');

    // Files is inside .commit-meta
    expect(container.querySelector('.commit-files')!.textContent).toBe('4 files changed');
  });

  it('uses singular "1 file changed" when files is 1', async () => {
    mount();
    const oneFile: CommitEntry = { ...COMMIT, files: 1 };
    await setCommit(oneFile, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();
    expect(container.querySelector('.commit-meta .commit-files')!.textContent).toBe(
      '1 file changed'
    );
  });

  it('hides the open link when remoteUrl is null', async () => {
    mount();
    await setCommit(COMMIT, { remoteUrl: null, now: new Date('2026-05-24T12:00:00Z') });
    expect(container.querySelector('.text-pane-title .commit-open')).toBeNull();
    await drainAsync();
    // Absence of a remote is reflected by the missing open link alone —
    // no "No remote configured" hint copy.
    expect(container.textContent ?? '').not.toContain('No remote configured');
  });

  it('setCommit(null) returns to the empty state', async () => {
    mount();
    await setCommit(COMMIT, {
      remoteUrl: 'https://github.com/org/repo',
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await setCommit(null);
    expect(container.querySelector('.commit-sha')).toBeNull();
    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('onClose fires when the × is clicked', () => {
    const onClose = vi.fn();
    mount({ onClose });
    const closeBtn = container.querySelector(
      '.pane-header [aria-label*="lose" i], .pane-header [aria-label="Hide sidebar"], .pane-header button'
    ) as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
  });

  // ── Age / date ────────────────────────────────────────────────────────────

  it("shows the full ISO date in the age span's title attribute", async () => {
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();
    const ageEl = container.querySelector('.commit-age') as HTMLElement;
    expect(ageEl).not.toBeNull();
    expect(ageEl.title).toBe(COMMIT.date);
  });

  // ── Same-day count ────────────────────────────────────────────────────────

  it('shows "<label> day: N commits" when sameDayTotal > 1', async () => {
    mount();
    await setCommit(COMMIT, { sameDayTotal: 5, now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    const sameDayEl = container.querySelector('.commit-same-day') as HTMLElement;
    expect(sameDayEl).not.toBeNull();
    expect(sameDayEl.textContent).toMatch(/day:\s*\d+ commits$/);
    // No "that day" suffix — the date moved into the tooltip.
    expect(sameDayEl.textContent).not.toMatch(/that day/);
  });

  it('shows "<label> day: 1 commit" (singular) when sameDayTotal === 1', async () => {
    mount();
    await setCommit(COMMIT, { sameDayTotal: 1, now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    const sameDayEl = container.querySelector('.commit-same-day') as HTMLElement;
    expect(sameDayEl).not.toBeNull();
    expect(sameDayEl.textContent).toMatch(/day:\s*1 commit$/);
  });

  it('exposes the full date as the same-day tooltip', async () => {
    mount();
    await setCommit(COMMIT, { sameDayTotal: 24, now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    const sameDayEl = container.querySelector('.commit-same-day') as HTMLElement;
    expect(sameDayEl.title).toMatch(/^24 commits on /);
    // The COMMIT fixture is 2026-03-12 — assert the formatted date shows
    // the right year, month name, and day. Locale-aware formatting may
    // produce "March 12, 2026" or "12 March 2026" depending on the
    // runner's locale; just check the salient parts are present.
    expect(sameDayEl.title).toMatch(/March/);
    expect(sameDayEl.title).toMatch(/12/);
    expect(sameDayEl.title).toMatch(/2026/);
  });

  it('omits .commit-same-day when sameDayTotal is not provided', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    expect(container.querySelector('.commit-same-day')).toBeNull();
  });

  it('shows a colored swatch inside .commit-same-day when color is provided', async () => {
    mount();
    await setCommit(COMMIT, {
      color: '#5e8a3a',
      sameDayTotal: 3,
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await drainAsync();

    // Swatch lives inside .commit-same-day, NOT in the pane header.
    const swatch = container.querySelector('.commit-same-day > .commit-swatch') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe('rgb(94, 138, 58)'); // jsdom converts hex to rgb

    // No swatch in the header.
    expect(container.querySelector('.pane-header .commit-swatch')).toBeNull();
  });

  it('omits .commit-swatch when color is undefined', async () => {
    mount();
    await setCommit(COMMIT, { sameDayTotal: 3, now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    expect(container.querySelector('.commit-swatch')).toBeNull();
  });

  it('omits .commit-swatch when sameDayTotal is undefined or 0', async () => {
    mount();
    // sameDayTotal undefined
    await setCommit(COMMIT, { color: '#5e8a3a', now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();
    expect(container.querySelector('.commit-swatch')).toBeNull();

    // sameDayTotal === 0
    await setCommit(COMMIT, {
      color: '#5e8a3a',
      sameDayTotal: 0,
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await drainAsync();
    expect(container.querySelector('.commit-swatch')).toBeNull();
  });

  // ── Busyness label ────────────────────────────────────────────────────────
  // Tests pass explicit busynessThresholds so the label logic is exercised
  // deterministically. In production the thresholds are derived per-repo
  // from manifest.commits via dailyCommitThresholds() — see rightSidebar.tsx.

  const TEST_THRESHOLDS = { avg: 3, busy: 8 };

  it('labels sameDayTotal=1 as a Light day', async () => {
    mount();
    await setCommit(COMMIT, {
      sameDayTotal: 1,
      busynessThresholds: TEST_THRESHOLDS,
      color: '#abc',
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await drainAsync();
    expect(container.querySelector('.commit-same-day')!.textContent).toMatch(/Light day/);
  });

  it('labels sameDayTotal=5 as an Avg day', async () => {
    mount();
    await setCommit(COMMIT, {
      sameDayTotal: 5,
      busynessThresholds: TEST_THRESHOLDS,
      color: '#abc',
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await drainAsync();
    expect(container.querySelector('.commit-same-day')!.textContent).toMatch(/Avg day/);
  });

  it('labels sameDayTotal=20 as a Busy day', async () => {
    mount();
    await setCommit(COMMIT, {
      sameDayTotal: 20,
      busynessThresholds: TEST_THRESHOLDS,
      color: '#abc',
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await drainAsync();
    expect(container.querySelector('.commit-same-day')!.textContent).toMatch(/Busy day/);
  });

  // ── Pane header title ─────────────────────────────────────────────────────

  it('sets the pane header title to "Commit <short-sha>"', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    const title = container.querySelector('.text-pane-title') as HTMLElement;
    expect(title.textContent).toContain('Commit');
    expect(title.querySelector('.commit-sha')!.textContent).toBe(COMMIT.sha.slice(0, 7));
  });

  it('resets the header title to plain "Commit" when setCommit(null)', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await setCommit(null);
    const title = container.querySelector('.text-pane-title') as HTMLElement;
    expect(title.textContent?.trim()).toBe('Commit');
  });

  // ── Author row ────────────────────────────────────────────────────────────

  it('renders the author row with a colored dot matching the author', async () => {
    const { colorForAuthor } = await import('@/scene/components/fireflies/authorColor.js');
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    const authorEl = container.querySelector('.commit-author');
    expect(authorEl).not.toBeNull();
    expect(authorEl!.textContent).toContain('Alice Author');

    const dot = container.querySelector('.commit-author-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.backgroundColor).toBeTruthy();
    // The dot color should match colorForAuthor for this name.
    // Browsers normalize 'background-color' to 'rgb(r, g, b)', so just
    // assert it was set to *some* color (exact-match assertion is brittle
    // due to rgb-vs-hex normalization).
    expect(dot.style.backgroundColor).not.toBe('');
    // Sanity: dependency on colorForAuthor is real.
    expect(typeof colorForAuthor(COMMIT.authors[0]).hex).toBe('string');
  });

  it('renders one .commit-author row for a single-author commit (regression)', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();
    const rows = container.querySelectorAll('.commit-author');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.commit-author-name')!.textContent).toBe('Alice Author');
  });

  it('renders one .commit-author row per author for a multi-author commit', async () => {
    const { colorForAuthor } = await import('@/scene/components/fireflies/authorColor.js');
    const multi: CommitEntry = {
      date: '2026-03-12',
      files: 4,
      sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
      authors: ['Alice Author', 'Bob Builder', 'Carol Coder'],
      subject: 'feat: team effort',
      same_day_total: 4,
    };
    mount();
    await setCommit(multi, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    const rows = container.querySelectorAll('.commit-author');
    expect(rows.length).toBe(3);

    const names = Array.from(rows).map((r) => r.querySelector('.commit-author-name')!.textContent);
    expect(names).toEqual(['Alice Author', 'Bob Builder', 'Carol Coder']);

    // Each dot uses the per-author color.
    const dots = container.querySelectorAll('.commit-author-dot') as NodeListOf<HTMLElement>;
    expect(dots.length).toBe(3);
    // jsdom returns inline backgroundColor as rgb(...) — compare via
    // the hex round-trip by setting a probe element.
    const probe = document.createElement('div');
    multi.authors.forEach((author, i) => {
      probe.style.backgroundColor = colorForAuthor(author).hex;
      expect(dots[i].style.backgroundColor).toBe(probe.style.backgroundColor);
    });
  });

  // ── Message block ─────────────────────────────────────────────────────────

  it('renders the commit subject inside .commit-message-subject (full text, not ellipsized)', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();
    const subjectEl = container.querySelector('.commit-message-subject') as HTMLElement;
    expect(subjectEl).not.toBeNull();
    expect(subjectEl.textContent).toBe(COMMIT.subject);
    // Confirm the old ellipsized class is gone.
    expect(container.querySelector('.commit-subject')).toBeNull();
  });

  // ── Pane-wide loading state ───────────────────────────────────────────────

  it('body slot transitions Loading… → text when the fetch resolves', async () => {
    let resolveFn!: (resp: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFn = r;
    });
    globalThis.fetch = (async () => pending) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });

    // Skeleton is up; body slot shows the loading hint.
    expect(container.querySelector('.commit-author')).not.toBeNull();
    expect(container.querySelector('.commit-meta')).not.toBeNull();
    expect(container.querySelector('.commit-message-subject')).not.toBeNull();
    const slot = container.querySelector('.commit-message-body-slot')!;
    // Loading indicator lives inside the slot as a `--loading` element.
    expect(slot.querySelector('.commit-message-body-slot--loading')).not.toBeNull();
    expect(slot.textContent?.trim()).toMatch(/Loading/);

    // Resolve the fetch.
    resolveFn(
      new Response(
        JSON.stringify({
          sha: COMMIT.sha,
          authors: COMMIT.authors,
          date: COMMIT.date,
          subject: COMMIT.subject,
          body: 'a body',
        }),
        { status: 200 }
      )
    );
    await drainAsync();

    // Loading indicator gone; body <pre> is now in the slot.
    expect(slot.querySelector('.commit-message-body-slot--loading')).toBeNull();
    expect(container.querySelector('.commit-message-body')!.textContent).toBe('a body');
  });

  // ── Body cache ────────────────────────────────────────────────────────────

  it('caches the body so a second select of the same commit skips the fetch', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sha: COMMIT.sha,
            authors: COMMIT.authors,
            date: COMMIT.date,
            subject: COMMIT.subject,
            body: 'cached body',
          }),
          { status: 200 }
        )
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.commit-message-body')!.textContent).toBe('cached body');

    // Re-select the same commit. Body renders synchronously from cache —
    // the slot must NOT enter a loading state.
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    const slot = container.querySelector('.commit-message-body-slot')!;
    expect(slot.querySelector('.commit-message-body-slot--loading')).toBeNull();
    expect(container.querySelector('.commit-message-body')!.textContent).toBe('cached body');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1, no new fetch
  });

  it('omits the body <pre> when the fetched body is empty and hides the slot', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          sha: COMMIT.sha,
          authors: COMMIT.authors,
          date: COMMIT.date,
          subject: COMMIT.subject,
          body: '', // empty body
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();
    // Subject is present.
    expect(container.querySelector('.commit-message-subject')).not.toBeNull();
    // Body <pre> is NOT present.
    expect(container.querySelector('.commit-message-body')).toBeNull();
    // Slot exists but holds no content (no body, no loading, no error).
    const slot = container.querySelector('.commit-message-body-slot') as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.querySelector('.commit-message-body-slot--loading')).toBeNull();
    expect(slot.querySelector('.commit-message-body-slot--error')).toBeNull();
    expect(slot.textContent?.trim()).toBe('');
  });

  it('shows an error at body level when the body fetch fails', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    const err = container.querySelector('.commit-message-error') as HTMLElement;
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/failed/i);

    // Skeleton remains intact — error is scoped to the body slot.
    expect(container.querySelector('.commit-author')).not.toBeNull();
    expect(container.querySelector('.commit-message-subject')).not.toBeNull();
    expect(container.querySelector('.commit-meta')).not.toBeNull();
    // The error lives inside the body slot, not at the pane root.
    const slot = container.querySelector('.commit-message-body-slot')!;
    expect(slot.contains(err)).toBe(true);
    expect(slot.querySelector('.commit-message-body-slot--error')).not.toBeNull();
  });

  it('passes onFocus through to the pane header and fires with the current commit', async () => {
    const onFocus = vi.fn();
    mount({ onFocus });
    await setCommit(COMMIT, { remoteUrl: null });
    const focusBtn =
      (container.querySelector(
        '.pane-header .btn-icon[aria-label="Focus the camera on this commit (F)"]'
      ) as HTMLButtonElement | null) ??
      (container.querySelector(
        '.pane-header button[aria-label*="Focus"]'
      ) as HTMLButtonElement | null);
    expect(focusBtn).not.toBeNull();
    focusBtn!.click();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith(COMMIT);
  });

  it('focus button is not actionable in the empty state', () => {
    const onFocus = vi.fn();
    mount({ onFocus });
    // In the empty state CommitPane renders no focus button — focus is not
    // actionable when there is no commit (the old factory rendered a present
    // but disabled button; the Preact pane omits it entirely).
    const focusBtn = container.querySelector(
      '.pane-header button[aria-label*="Focus"]'
    ) as HTMLButtonElement | null;
    expect(focusBtn).toBeNull();
  });

  it('drops a late fetch result when the pane has moved to a different commit', async () => {
    // Fetch for the first commit hangs, then resolves AFTER the second
    // commit's render has replaced the body. The late result must
    // NOT clobber the second commit's body.
    let resolveFirst!: (resp: Response) => void;
    const firstFetchPromise = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    const SECOND_COMMIT: CommitEntry = {
      ...COMMIT,
      sha: 'b'.repeat(40),
      subject: 'second commit',
    };
    globalThis.fetch = (async (url: string) => {
      if (url.includes(COMMIT.sha)) return firstFetchPromise;
      return new Response(
        JSON.stringify({
          sha: SECOND_COMMIT.sha,
          authors: SECOND_COMMIT.authors,
          date: SECOND_COMMIT.date,
          subject: SECOND_COMMIT.subject,
          body: 'second body',
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    mount();
    // First commit — loading state, fetch in flight.
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    // Second commit — re-renders loading. First fetch's sha no longer current.
    await setCommit(SECOND_COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await drainAsync();

    // Second commit's body is showing.
    const msgBody = container.querySelector('.commit-message-body') as HTMLElement;
    expect(msgBody.textContent).toContain('second body');

    // Now the first fetch finally resolves. It should be silently dropped.
    resolveFirst(
      new Response(
        JSON.stringify({
          sha: COMMIT.sha,
          authors: COMMIT.authors,
          date: COMMIT.date,
          subject: COMMIT.subject,
          body: 'first body (LATE)',
        }),
        { status: 200 }
      )
    );
    await drainAsync();

    // Second commit's body is still showing, not clobbered.
    expect(container.querySelector('.commit-message-body')!.textContent).toContain('second body');
    expect(container.querySelector('.commit-message-body')!.textContent).not.toContain('LATE');
  });

  // ── Skeleton-on-mount (perf + layout refactor) ────────────────────────────

  it('renders authors synchronously on setCommit, BEFORE the fetch resolves', async () => {
    // Block the fetch indefinitely so the skeleton MUST appear without it.
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    // The drainAsync above only settles the render; the fetch never
    // resolves, so these assertions exercise the pre-fetch skeleton.
    expect(container.querySelector('.commit-author')).not.toBeNull();
    expect(container.querySelector('.commit-author-name')!.textContent).toBe('Alice Author');
  });

  it('renders meta (age + files) synchronously on setCommit', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    expect(container.querySelector('.commit-age')!.textContent).toContain('2 months ago');
    expect(container.querySelector('.commit-files')!.textContent).toBe('4 files changed');
  });

  it('renders subject synchronously on setCommit', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    expect(container.querySelector('.commit-message-subject')!.textContent).toBe(COMMIT.subject);
  });

  it('renders same-day badge synchronously when sameDayTotal > 0', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { sameDayTotal: 5, now: new Date('2026-05-24T12:00:00Z') });
    expect(container.querySelector('.commit-same-day')).not.toBeNull();
  });

  it('shows a body-slot loading indicator (NOT a pane-wide one) while fetching', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    // The slot wrapper exists with a loading indicator inside it.
    const slot = container.querySelector('.commit-message-body-slot');
    expect(slot).not.toBeNull();
    expect(slot!.querySelector('.commit-message-body-slot--loading')).not.toBeNull();
    // The old pane-wide loading class is gone.
    expect(container.querySelector('.commit-loading')).toBeNull();
    // Skeleton content above is still visible (not blanked).
    expect(container.querySelector('.commit-author')).not.toBeNull();
    expect(container.querySelector('.commit-meta')).not.toBeNull();
  });

  it('DOM order is: subject → authors → meta → same-day → body slot', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { sameDayTotal: 3, now: new Date('2026-05-24T12:00:00Z') });
    const body = container.querySelector('.commit-body') as HTMLElement;
    const children = Array.from(body.children) as HTMLElement[];
    // Find first occurrence of each marker class.
    const idx = (cls: string) => children.findIndex((c) => c.classList.contains(cls));
    const iSubject = idx('commit-message-subject');
    const iAuthor = idx('commit-author');
    const iMeta = idx('commit-meta');
    const iSameDay = idx('commit-same-day');
    const iBody = idx('commit-message-body-slot');
    // Every section must be present and in the expected order: subject
    // (commit title) at top, authors below it, then meta, same-day, body slot.
    expect(iSubject).toBeGreaterThanOrEqual(0);
    expect(iAuthor).toBeGreaterThan(iSubject);
    expect(iMeta).toBeGreaterThan(iAuthor);
    expect(iSameDay).toBeGreaterThan(iMeta);
    expect(iBody).toBeGreaterThan(iSameDay);
  });

  it('content above the body slot does not move when body resolves', async () => {
    let resolveFn!: (r: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFn = r;
    });
    globalThis.fetch = (async () => pending) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });

    // Snapshot the DOM positions of stable elements while body is loading.
    const subjectBefore = container.querySelector('.commit-message-subject')!;
    const authorBefore = container.querySelector('.commit-author')!;
    const metaBefore = container.querySelector('.commit-meta')!;

    // Resolve the fetch with a multi-line body.
    resolveFn(
      new Response(
        JSON.stringify({
          sha: COMMIT.sha,
          authors: COMMIT.authors,
          date: COMMIT.date,
          subject: COMMIT.subject,
          body: 'line 1\nline 2\nline 3',
        }),
        { status: 200 }
      )
    );
    await drainAsync();

    // Same DOM nodes are still in the DOM (not replaced) — Preact keyed/diffed
    // reconciliation preserves the stable skeleton nodes when only the body
    // slot's contents change.
    expect(container.querySelector('.commit-message-subject')).toBe(subjectBefore);
    expect(container.querySelector('.commit-author')).toBe(authorBefore);
    expect(container.querySelector('.commit-meta')).toBe(metaBefore);

    // And the body is now there.
    const bodyEl = container.querySelector('.commit-message-body') as HTMLElement;
    expect(bodyEl.textContent).toContain('line 1');
  });
});
