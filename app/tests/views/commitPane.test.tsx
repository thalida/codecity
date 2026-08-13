import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { CommitPane } from '@/views/CommitPane/CommitPane';
import type { CommitPaneState } from '@/views/CommitPane/CommitPane';
import type { CommitEntry } from '@/types';
// Settling a CommitPane render involves two interleaved schedulers: the
// commit-body fetch chain (fetchCommitDetail awaits fetch() then resp.json(),
// or rejects on a non-ok response) and Preact picking up the resulting
// useState change. drainAsync alternates microtask + macrotask yields to
// cover both the success and the longer reject path deterministically.
import { colorForAuthor } from '@/city/components/fireflies/authorColor';
import { commits as buildCommits } from '../_helpers/commits';
import { drainAsync } from '../_helpers/preact';

const [COMMIT] = buildCommits({
  date: '2026-03-12',
  files: 4,
  sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
  authors: ['Alice Author'],
  subject: 'fix(scan): handle empty repos cleanly',
  same_day_total: 4,
});

// setCommit(commit, opts) assigns the signal and flushes.
type SetOpts = Omit<CommitPaneState, 'commit'>;

// Stand-in for the backend's AuthorStat.hue map, which RightSidebar threads in.
const AUTHOR_HUES: Record<string, number> = { Alice: 10, Bob: 120, Carol: 250 };

describe('CommitPane', () => {
  let container: HTMLDivElement;
  let state: ReturnType<typeof signal<CommitPaneState>>;

  function mount(
    opts: {
      onClose?: () => void;
      onFocus?: (c: CommitEntry) => void;
      onViewInTimeline?: (c: CommitEntry) => void;
    } = {}
  ): void {
    state = signal<CommitPaneState>({ commit: null });
    render(
      <CommitPane
        state={state}
        onClose={opts.onClose ?? (() => {})}
        onFocus={opts.onFocus}
        onViewInTimeline={opts.onViewInTimeline}
      />,
      container
    );
  }

  async function setCommit(commit: CommitEntry | null, opts: SetOpts = {}): Promise<void> {
    state.value = { commit, authorHues: AUTHOR_HUES, ...opts };
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
    const now = new Date(2026, 4, 24, 12);
    await setCommit(COMMIT, { remoteUrl: 'https://github.com/org/repo', now });

    // SHA is inside the pane header title.
    expect(container.querySelector('.text-pane-title .commit-sha')!.textContent).toBe('a1b2c3d');

    // Open link travels with the title: it acts on the commit, not on the pane.
    const link = container.querySelector(
      '.pane-header-identity a[aria-label="Open commit on origin"]'
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe(`https://github.com/org/repo/commit/${COMMIT.sha}`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');

    // Wait for fetch to resolve so the rest of the content renders.
    await drainAsync();

    // Age is inside .commit-meta
    expect(container.querySelector('.commit-age')!.textContent).toContain('2 months 12 days ago');

    // Files is inside .commit-meta
    expect(container.querySelector('.commit-files')!.textContent).toBe('4 files changed');
  });

  it('uses singular "1 file changed" when files is 1', async () => {
    mount();
    const oneFile: CommitEntry = { ...COMMIT, files: 1 };
    await setCommit(oneFile, { now: new Date(2026, 4, 24, 12) });
    await drainAsync();
    expect(container.querySelector('.commit-meta .commit-files')!.textContent).toBe(
      '1 file changed'
    );
  });

  it('hides the open link when remoteUrl is null', async () => {
    mount();
    await setCommit(COMMIT, { remoteUrl: null, now: new Date(2026, 4, 24, 12) });
    expect(
      container.querySelector('.pane-header-actions a[aria-label="Open commit on origin"]')
    ).toBeNull();
    await drainAsync();
    // Absence of a remote is reflected by the missing open link alone —
    // no "No remote configured" hint copy.
    expect(container.textContent ?? '').not.toContain('No remote configured');
  });

  it('setCommit(null) returns to the empty state', async () => {
    mount();
    await setCommit(COMMIT, {
      remoteUrl: 'https://github.com/org/repo',
      now: new Date(2026, 4, 24, 12),
    });
    await setCommit(null);
    expect(container.querySelector('.commit-sha')).toBeNull();
    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('shows the header timeline button (tooltip tracks mode) and fires onViewInTimeline with the commit', async () => {
    const onViewInTimeline = vi.fn();
    mount({ onViewInTimeline });
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    const btn = container.querySelector(
      '.pane-header [aria-label="View on timeline"]'
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('title')).toContain('View this commit on the timeline'); // live mode
    btn.click();
    expect(onViewInTimeline).toHaveBeenCalledWith(COMMIT);

    await setCommit(COMMIT, { inTimeline: true, now: new Date(2026, 4, 24, 12) });
    expect(
      container.querySelector('.pane-header [aria-label="View on timeline"]')!.getAttribute('title')
    ).toContain('Scrub the timeline to this commit');
  });

  it('omits the timeline button when no onViewInTimeline handler is given', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    expect(container.querySelector('[aria-label="View on timeline"]')).toBeNull();
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
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    await drainAsync();
    const ageEl = container.querySelector('.commit-age') as HTMLElement;
    expect(ageEl).not.toBeNull();
    expect(ageEl.title).toBe(COMMIT.date);
  });

  // ── Same-day count ────────────────────────────────────────────────────────

  const NOW = new Date(2026, 4, 24, 12);

  it.each([
    ['plural above one', 5, /day:\s*\d+ commits$/],
    ['singular at one', 1, /day:\s*1 commit$/],
  ])('counts the day %s', async (_label, sameDayTotal, pattern) => {
    mount();
    await setCommit(COMMIT, { sameDayTotal, now: NOW });
    await drainAsync();
    const el = container.querySelector('.commit-same-day') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.textContent).toMatch(pattern);
    // The date moved into the tooltip, so no "that day" suffix on the line.
    expect(el.textContent).not.toMatch(/that day/);
  });

  it('puts the full date in the same-day tooltip', async () => {
    mount();
    await setCommit(COMMIT, { sameDayTotal: 24, now: NOW });
    await drainAsync();
    // Locale-aware formatting reorders the parts, so assert the parts.
    const { title } = container.querySelector('.commit-same-day') as HTMLElement;
    expect(title).toMatch(/^24 commits on /);
    for (const part of [/March/, /12/, /2026/]) expect(title).toMatch(part);
  });

  // The swatch is the day's tree colour, so it needs both a colour to show and
  // a non-zero count to belong to. It lives in the line, never the header.
  it.each([
    ['both a colour and a count', { color: '#5e8a3a', sameDayTotal: 3 }, true],
    ['no colour', { sameDayTotal: 3 }, false],
    ['no count', { color: '#5e8a3a' }, false],
    ['a zero count', { color: '#5e8a3a', sameDayTotal: 0 }, false],
  ])('shows the swatch only with %s', async (_label, opts, shown) => {
    mount();
    await setCommit(COMMIT, { ...opts, now: NOW });
    await drainAsync();
    const swatch = container.querySelector('.commit-same-day > .commit-swatch') as HTMLElement;
    expect(swatch != null).toBe(shown);
    if (shown) expect(swatch.style.backgroundColor).toBe('rgb(94, 138, 58)');
    expect(container.querySelector('.pane-header .commit-swatch')).toBeNull();
  });

  it('omits the same-day line entirely when no total is given', async () => {
    mount();
    await setCommit(COMMIT, { now: NOW });
    await drainAsync();
    expect(container.querySelector('.commit-same-day')).toBeNull();
  });

  // Production derives these per repo from manifest.commits via
  // dailyCommitThresholds(); passing them explicitly pins the banding.
  it.each([
    [1, 'Light day'],
    [5, 'Avg day'],
    [20, 'Busy day'],
  ])('bands %i commits as a %s', async (sameDayTotal, label) => {
    mount();
    await setCommit(COMMIT, {
      sameDayTotal,
      busynessThresholds: { avg: 3, busy: 8 },
      color: '#abc',
      now: NOW,
    });
    await drainAsync();
    expect(container.querySelector('.commit-same-day')!.textContent).toContain(label);
  });

  // ── Pane header title ─────────────────────────────────────────────────────

  it('titles the pane with the kind badge and the short sha', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    const title = container.querySelector('.text-pane-title') as HTMLElement;
    // The badge names the kind, the way a file title's does — not a word in a
    // sentence, and the same shape the chip shows when this pane is closed.
    expect(title.querySelector('.path-badge')!.textContent).toBe('commit');
    expect(title.querySelector('.commit-sha')!.textContent).toBe(COMMIT.sha.slice(0, 7));
  });

  it('resets the header title to plain "Commit" when setCommit(null)', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    await setCommit(null);
    const title = container.querySelector('.text-pane-title') as HTMLElement;
    expect(title.textContent?.trim()).toBe('Commit');
  });

  // ── Author row ────────────────────────────────────────────────────────────

  it('renders the author row with a colored dot matching the author', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    await drainAsync();

    const authorEl = container.querySelector('.commit-author');
    expect(authorEl).not.toBeNull();
    expect(authorEl!.textContent).toContain('Alice Author');

    // Not an exact-colour match: jsdom normalises background-color to
    // 'rgb(r, g, b)' while colorForAuthor returns hex.
    const dot = container.querySelector('.commit-author-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.backgroundColor).toBeTruthy();
  });

  it('renders one .commit-author row for a single-author commit (regression)', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    await drainAsync();
    const rows = container.querySelectorAll('.commit-author');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.commit-author-name')!.textContent).toBe('Alice Author');
  });

  it('renders one .commit-author row per author for a multi-author commit', async () => {
    const [multi] = buildCommits({
      ...COMMIT,
      authors: ['Alice Author', 'Bob Builder', 'Carol Coder'],
      subject: 'feat: team effort',
    });
    mount();
    await setCommit(multi, { now: new Date(2026, 4, 24, 12) });
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
      probe.style.backgroundColor = colorForAuthor(AUTHOR_HUES[author] ?? 0).hex;
      expect(dots[i].style.backgroundColor).toBe(probe.style.backgroundColor);
    });
  });

  // ── Message block ─────────────────────────────────────────────────────────

  it('renders the commit subject inside .commit-message-subject (full text, not ellipsized)', async () => {
    mount();
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    await drainAsync();
    const subjectEl = container.querySelector('.commit-message-subject') as HTMLElement;
    expect(subjectEl).not.toBeNull();
    expect(subjectEl.textContent).toBe(COMMIT.subject);
  });

  // ── Pane-wide loading state ───────────────────────────────────────────────

  it('body slot transitions Loading… → text when the fetch resolves', async () => {
    let resolveFn!: (resp: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFn = r;
    });
    globalThis.fetch = (async () => pending) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });

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
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    await drainAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.commit-message-body')!.textContent).toBe('cached body');

    // Re-select the same commit. Body renders synchronously from cache —
    // the slot must NOT enter a loading state.
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
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
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
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
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
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
    // No focus button in the empty state: focus isn't actionable with no
    // commit, so the control is absent rather than present and disabled.
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
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    // Second commit — re-renders loading. First fetch's sha no longer current.
    await setCommit(SECOND_COMMIT, { now: new Date(2026, 4, 24, 12) });
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

  // Everything except the body comes off the CommitEntry the picker already
  // has, so a blocked fetch must not delay any of it. fetch never resolves
  // here, so these assertions can only pass on the pre-fetch render.
  it.each([
    ['the author', '.commit-author-name', 'Alice Author'],
    ['the age', '.commit-age', '2 months 12 days ago'],
    ['the file count', '.commit-files', '4 files changed'],
    ['the subject', '.commit-message-subject', COMMIT.subject],
  ])('paints %s before the body fetch resolves', async (_label, selector, text) => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { sameDayTotal: 5, now: new Date(2026, 4, 24, 12) });
    expect(container.querySelector(selector)!.textContent).toContain(text);
    // The same-day line is part of the same synchronous paint.
    expect(container.querySelector('.commit-same-day')).not.toBeNull();
  });

  it('shows a body-slot loading indicator (NOT a pane-wide one) while fetching', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });
    // The slot wrapper exists with a loading indicator inside it.
    const slot = container.querySelector('.commit-message-body-slot');
    expect(slot).not.toBeNull();
    expect(slot!.querySelector('.commit-message-body-slot--loading')).not.toBeNull();
    // Skeleton content above is still visible (not blanked).
    expect(container.querySelector('.commit-author')).not.toBeNull();
    expect(container.querySelector('.commit-meta')).not.toBeNull();
  });

  it('DOM order is: subject → authors → meta → same-day → body slot', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    mount();
    await setCommit(COMMIT, { sameDayTotal: 3, now: new Date(2026, 4, 24, 12) });
    const body = container.querySelector('.commit-body') as HTMLElement;
    const children = Array.from(body.children) as HTMLElement[];
    // Find first occurrence of each marker class.
    const idx = (cls: string) => children.findIndex((c) => c.classList.contains(cls));
    const iSubject = idx('commit-message-subject');
    const iAuthor = idx('commit-authors');
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
    await setCommit(COMMIT, { now: new Date(2026, 4, 24, 12) });

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
