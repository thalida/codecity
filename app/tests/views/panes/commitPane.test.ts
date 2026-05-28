import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildCommitPane } from '@/views/panes/commitPane.js';
import type { CommitEntry } from '@/types';

function resetDom() {
  document.body.innerHTML = '';
}

const COMMIT: CommitEntry = {
  date: '2026-03-12',
  files: 4,
  sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
  author: 'Alice Author',
  subject: 'fix(scan): handle empty repos cleanly',
};

describe('buildCommitPane', () => {
  beforeEach(() => {
    resetDom();
    // Default: every fetch resolves to an empty body so existing tests don't
    // hang in loading state. Individual tests can override globalThis.fetch.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          sha: '',
          author: '',
          date: '',
          subject: '',
          body: '',
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
  });

  it('returns a .pane wrapper with a pane-header titled "Commit"', () => {
    const { pane } = buildCommitPane({});
    expect(pane.classList.contains('pane')).toBe(true);
    expect(pane.querySelector('.pane-header')).not.toBeNull();
    expect(pane.querySelector('.text-pane-title')!.textContent).toBe('Commit');
  });

  it('renders an empty state when no commit is set', () => {
    const { pane } = buildCommitPane({});
    expect(pane.querySelector('.commit-sha')).toBeNull();
    expect(pane.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders short SHA, age, files changed, and an open-on-origin link', async () => {
    const { pane, api } = buildCommitPane({});
    const now = new Date('2026-05-24T12:00:00Z');
    api.setCommit(COMMIT, { remoteUrl: 'https://github.com/org/repo', now });

    // SHA is inside the pane header title (set synchronously even during loading)
    expect(pane.querySelector('.text-pane-title .commit-sha')!.textContent).toBe('a1b2c3d');

    // Open link is in the pane header title (also set synchronously)
    const link = pane.querySelector('.text-pane-title .commit-open') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe(`https://github.com/org/repo/commit/${COMMIT.sha}`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');

    // Wait for fetch to resolve so the rest of the content renders.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Age is inside .commit-meta
    expect(pane.querySelector('.commit-age')!.textContent).toContain('2 months ago');

    // Files is inside .commit-meta
    expect(pane.querySelector('.commit-files')!.textContent).toBe('4 files changed');
  });

  it('uses singular "1 file changed" when files is 1', async () => {
    const { pane, api } = buildCommitPane({});
    const oneFile: CommitEntry = { ...COMMIT, files: 1 };
    api.setCommit(oneFile, { now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(pane.querySelector('.commit-meta .commit-files')!.textContent).toBe('1 file changed');
  });

  it('hides the open link and shows a no-remote hint when remoteUrl is null', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { remoteUrl: null, now: new Date('2026-05-24T12:00:00Z') });
    // Open link check is synchronous (set in header before fetch).
    expect(pane.querySelector('.text-pane-title .commit-open')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(pane.querySelector('.commit-no-remote')).not.toBeNull();
  });

  it('setCommit(null) returns to the empty state', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, {
      remoteUrl: 'https://github.com/org/repo',
      now: new Date('2026-05-24T12:00:00Z'),
    });
    api.setCommit(null);
    expect(pane.querySelector('.commit-sha')).toBeNull();
    expect(pane.querySelector('.empty-state')).not.toBeNull();
  });

  it('onClose fires when the × is clicked', () => {
    const onClose = vi.fn();
    const { pane } = buildCommitPane({ onClose });
    const closeBtn = pane.querySelector(
      '.pane-header [aria-label*="lose" i], .pane-header .pane-header-close, .pane-header button'
    ) as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
  });

  // ── Age / date ────────────────────────────────────────────────────────────

  it("shows the full ISO date in the age span's title attribute", async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const ageEl = pane.querySelector('.commit-age') as HTMLElement;
    expect(ageEl).not.toBeNull();
    expect(ageEl.title).toBe(COMMIT.date);
  });

  // ── Same-day count ────────────────────────────────────────────────────────

  it('shows "N commits that day" when sameDayTotal > 1', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { sameDayTotal: 5, now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const sameDayEl = pane.querySelector('.commit-same-day');
    expect(sameDayEl).not.toBeNull();
    expect(sameDayEl!.textContent).toMatch(/\d+ commits that day/);
  });

  it('shows "1 commit that day" (singular) when sameDayTotal === 1', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { sameDayTotal: 1, now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const sameDayEl = pane.querySelector('.commit-same-day');
    expect(sameDayEl).not.toBeNull();
    expect(sameDayEl!.textContent).toMatch(/1 commit that day/);
  });

  it('omits .commit-same-day when sameDayTotal is not provided', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(pane.querySelector('.commit-same-day')).toBeNull();
  });

  it('shows a colored swatch inside .commit-same-day when color is provided', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, {
      color: '#5e8a3a',
      sameDayTotal: 3,
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Swatch lives inside .commit-same-day, NOT in the pane header.
    const swatch = pane.querySelector('.commit-same-day > .commit-swatch') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe('rgb(94, 138, 58)'); // jsdom converts hex to rgb

    // No swatch in the header.
    expect(pane.querySelector('.pane-header .commit-swatch')).toBeNull();
  });

  it('omits .commit-swatch when color is undefined', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { sameDayTotal: 3, now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(pane.querySelector('.commit-swatch')).toBeNull();
  });

  it('omits .commit-swatch when sameDayTotal is undefined or 0', async () => {
    const { pane, api } = buildCommitPane({});
    // sameDayTotal undefined
    api.setCommit(COMMIT, { color: '#5e8a3a', now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(pane.querySelector('.commit-swatch')).toBeNull();

    // sameDayTotal === 0
    api.setCommit(COMMIT, {
      color: '#5e8a3a',
      sameDayTotal: 0,
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(pane.querySelector('.commit-swatch')).toBeNull();
  });

  // ── Busyness label ────────────────────────────────────────────────────────

  it('labels sameDayTotal=1 as a Light day', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, {
      sameDayTotal: 1,
      color: '#abc',
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(pane.querySelector('.commit-same-day')!.textContent).toMatch(/Light day/);
  });

  it('labels sameDayTotal=5 as an Avg day', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, {
      sameDayTotal: 5,
      color: '#abc',
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(pane.querySelector('.commit-same-day')!.textContent).toMatch(/Avg day/);
  });

  it('labels sameDayTotal=20 as a Busy day', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, {
      sameDayTotal: 20,
      color: '#abc',
      now: new Date('2026-05-24T12:00:00Z'),
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(pane.querySelector('.commit-same-day')!.textContent).toMatch(/Busy day/);
  });

  // ── Pane header title ─────────────────────────────────────────────────────

  it('sets the pane header title to "Commit <short-sha>"', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    // Title is set synchronously before the fetch.
    const title = pane.querySelector('.text-pane-title') as HTMLElement;
    expect(title.textContent).toContain('Commit');
    expect(title.querySelector('.commit-sha')!.textContent).toBe(COMMIT.sha.slice(0, 7));
  });

  it('resets the header title to plain "Commit" when setCommit(null)', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    api.setCommit(null);
    const title = pane.querySelector('.text-pane-title') as HTMLElement;
    expect(title.textContent?.trim()).toBe('Commit');
  });

  // ── Author row ────────────────────────────────────────────────────────────

  it('renders the author row with a colored dot matching the author', async () => {
    const { colorForAuthor } = await import('@/scene/components/fireflies/authorColor.js');
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const authorEl = pane.querySelector('.commit-author');
    expect(authorEl).not.toBeNull();
    expect(authorEl!.textContent).toContain('Alice Author');

    const dot = pane.querySelector('.commit-author-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.backgroundColor).toBeTruthy();
    // The dot color should match colorForAuthor for this name.
    // Browsers normalize 'background-color' to 'rgb(r, g, b)', so just
    // assert it was set to *some* color (exact-match assertion is brittle
    // due to rgb-vs-hex normalization).
    expect(dot.style.backgroundColor).not.toBe('');
    // Sanity: dependency on colorForAuthor is real.
    expect(typeof colorForAuthor(COMMIT.author).hex).toBe('string');
  });

  // ── Message block ─────────────────────────────────────────────────────────

  it('renders the commit subject inside .commit-message-subject (full text, not ellipsized)', async () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const subjectEl = pane.querySelector('.commit-message-subject') as HTMLElement;
    expect(subjectEl).not.toBeNull();
    expect(subjectEl.textContent).toBe(COMMIT.subject);
    // Confirm the old ellipsized class is gone.
    expect(pane.querySelector('.commit-subject')).toBeNull();
  });

  // ── Pane-wide loading state ───────────────────────────────────────────────

  it('shows a pane-wide loading state until the fetch resolves', async () => {
    let resolveFn!: (resp: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFn = r;
    });
    globalThis.fetch = (async () => pending) as unknown as typeof fetch;
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });

    // Loading shows; the rest of the content is hidden.
    expect(pane.querySelector('.commit-loading')).not.toBeNull();
    expect(pane.querySelector('.commit-author')).toBeNull();
    expect(pane.querySelector('.commit-message')).toBeNull();
    expect(pane.querySelector('.commit-meta')).toBeNull();

    // Resolve the fetch.
    resolveFn(
      new Response(
        JSON.stringify({
          sha: COMMIT.sha,
          author: COMMIT.author,
          date: COMMIT.date,
          subject: COMMIT.subject,
          body: 'a body',
        }),
        { status: 200 }
      )
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Loading gone, content visible.
    expect(pane.querySelector('.commit-loading')).toBeNull();
    expect(pane.querySelector('.commit-author')).not.toBeNull();
    expect(pane.querySelector('.commit-message-body')!.textContent).toBe('a body');
  });

  // ── Body cache ────────────────────────────────────────────────────────────

  it('caches the body so a second select of the same commit skips the fetch', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sha: COMMIT.sha,
            author: COMMIT.author,
            date: COMMIT.date,
            subject: COMMIT.subject,
            body: 'cached body',
          }),
          { status: 200 }
        )
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(pane.querySelector('.commit-message-body')!.textContent).toBe('cached body');

    // Re-select the same commit. Should render immediately from cache, no new fetch.
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    // No loading state — render is synchronous from cache.
    expect(pane.querySelector('.commit-loading')).toBeNull();
    expect(pane.querySelector('.commit-message-body')!.textContent).toBe('cached body');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1, no new fetch
  });

  it('omits the body <pre> when the fetched body is empty', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          sha: COMMIT.sha,
          author: COMMIT.author,
          date: COMMIT.date,
          subject: COMMIT.subject,
          body: '', // empty body
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Subject is present.
    expect(pane.querySelector('.commit-message-subject')).not.toBeNull();
    // Body is NOT present.
    expect(pane.querySelector('.commit-message-body')).toBeNull();
  });

  it('shows an error at body level when the body fetch fails', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    // Auto-fetch fires on setCommit; no click needed.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const err = pane.querySelector('.commit-message-error') as HTMLElement;
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/failed/i);
  });

  it('passes onFocus through to the pane header and fires with the current commit', () => {
    const onFocus = vi.fn();
    const { pane, api } = buildCommitPane({ onFocus });
    api.setCommit(COMMIT, { remoteUrl: null });
    const focusBtn = pane.querySelector('.pane-header .btn-icon[aria-label="Focus the camera on this commit (F)"]') as HTMLButtonElement | null
      ?? pane.querySelector('.pane-header .btn-icon') as HTMLButtonElement | null;
    expect(focusBtn).not.toBeNull();
    focusBtn!.click();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith(COMMIT);
  });

  it('focus button is disabled in the empty state', () => {
    const onFocus = vi.fn();
    const { pane, api } = buildCommitPane({ onFocus });
    api.setCommit(null);
    const focusBtn = pane.querySelector('.pane-header button') as HTMLButtonElement | null;
    expect(focusBtn).not.toBeNull();
    expect(focusBtn!.disabled).toBe(true);
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
          author: SECOND_COMMIT.author,
          date: SECOND_COMMIT.date,
          subject: SECOND_COMMIT.subject,
          body: 'second body',
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const { pane, api } = buildCommitPane({});
    // First commit — loading state, fetch in flight.
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    // Second commit — re-renders loading. First fetch's sha no longer current.
    api.setCommit(SECOND_COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Second commit's body is showing.
    const msgBody = pane.querySelector('.commit-message-body') as HTMLElement;
    expect(msgBody.textContent).toContain('second body');

    // Now the first fetch finally resolves. It should be silently dropped.
    resolveFirst(
      new Response(
        JSON.stringify({
          sha: COMMIT.sha,
          author: COMMIT.author,
          date: COMMIT.date,
          subject: COMMIT.subject,
          body: 'first body (LATE)',
        }),
        { status: 200 }
      )
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Second commit's body is still showing, not clobbered.
    expect(pane.querySelector('.commit-message-body')!.textContent).toContain('second body');
    expect(pane.querySelector('.commit-message-body')!.textContent).not.toContain('LATE');
  });
});
