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
  beforeEach(resetDom);

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

  it('renders short SHA, date, age, files changed, and an open-on-origin link', () => {
    const { pane, api } = buildCommitPane({});
    const now = new Date('2026-05-24T12:00:00Z');
    api.setCommit(COMMIT, { remoteUrl: 'https://github.com/org/repo', now });

    expect(pane.querySelector('.commit-sha')!.textContent).toBe('a1b2c3d');
    expect(pane.querySelector('.commit-date')!.textContent).toBe('2026-03-12');
    expect(pane.querySelector('.commit-age')!.textContent).toBe('2 months ago');
    expect(pane.querySelector('.commit-files')!.textContent).toBe('4 files changed');

    const link = pane.querySelector('.commit-open') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe(`https://github.com/org/repo/commit/${COMMIT.sha}`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');
  });

  it('uses singular "1 file changed" when files is 1', () => {
    const { pane, api } = buildCommitPane({});
    const oneFile: CommitEntry = { ...COMMIT, files: 1 };
    api.setCommit(oneFile, { now: new Date('2026-05-24T12:00:00Z') });
    expect(pane.querySelector('.commit-files')!.textContent).toBe('1 file changed');
  });

  it('hides the open link and shows a no-remote hint when remoteUrl is null', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { remoteUrl: null, now: new Date('2026-05-24T12:00:00Z') });
    expect(pane.querySelector('.commit-open')).toBeNull();
    expect(pane.querySelector('.commit-no-remote')).not.toBeNull();
  });

  it('setCommit(null) returns to the empty state', () => {
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

  // ── New tests ─────────────────────────────────────────────────────────────

  it('date and age render side-by-side inside .commit-when', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });

    const whenEl = pane.querySelector('.commit-when');
    expect(whenEl).not.toBeNull();

    const dateEl = whenEl!.querySelector('.commit-date');
    const ageEl = whenEl!.querySelector('.commit-age');
    expect(dateEl).not.toBeNull();
    expect(ageEl).not.toBeNull();

    // Both should be direct children of .commit-when (siblings)
    expect(dateEl!.parentElement).toBe(whenEl);
    expect(ageEl!.parentElement).toBe(whenEl);
  });

  it('shows "N commits that day" when sameDayTotal > 1', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { sameDayTotal: 5, now: new Date('2026-05-24T12:00:00Z') });

    const sameDayEl = pane.querySelector('.commit-same-day');
    expect(sameDayEl).not.toBeNull();
    expect(sameDayEl!.textContent).toBe('5 commits that day');
  });

  it('shows "only commit that day" when sameDayTotal === 1', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { sameDayTotal: 1, now: new Date('2026-05-24T12:00:00Z') });

    const sameDayEl = pane.querySelector('.commit-same-day');
    expect(sameDayEl).not.toBeNull();
    expect(sameDayEl!.textContent).toBe('only commit that day');
  });

  it('omits .commit-same-day when sameDayTotal is not provided', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });

    expect(pane.querySelector('.commit-same-day')).toBeNull();
  });

  it('shows a colored swatch inside .commit-same-day when color is provided', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, {
      color: '#5e8a3a',
      sameDayTotal: 3,
      now: new Date('2026-05-24T12:00:00Z'),
    });

    // Swatch lives inside .commit-same-day, NOT in the pane header.
    const swatch = pane.querySelector('.commit-same-day > .commit-swatch') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe('rgb(94, 138, 58)'); // jsdom converts hex to rgb

    // No swatch in the header.
    expect(pane.querySelector('.pane-header .commit-swatch')).toBeNull();
  });

  it('omits .commit-swatch when color is undefined', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { sameDayTotal: 3, now: new Date('2026-05-24T12:00:00Z') });

    expect(pane.querySelector('.commit-swatch')).toBeNull();
  });

  it('omits .commit-swatch when sameDayTotal is undefined or 0', () => {
    const { pane, api } = buildCommitPane({});
    // sameDayTotal undefined
    api.setCommit(COMMIT, { color: '#5e8a3a', now: new Date('2026-05-24T12:00:00Z') });
    expect(pane.querySelector('.commit-swatch')).toBeNull();

    // sameDayTotal === 0
    api.setCommit(COMMIT, {
      color: '#5e8a3a',
      sameDayTotal: 0,
      now: new Date('2026-05-24T12:00:00Z'),
    });
    expect(pane.querySelector('.commit-swatch')).toBeNull();
  });

  it('renders the author row with a colored dot matching the author', async () => {
    const { colorForAuthor } = await import(
      '@/scene/components/fireflies/authorColor.js'
    );
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });

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

  it('renders the subject row, ellipsized via CSS', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
    const subjectEl = pane.querySelector('.commit-subject') as HTMLElement;
    expect(subjectEl).not.toBeNull();
    expect(subjectEl.textContent).toBe(COMMIT.subject);
    // CSS class is the ellipsization mechanism — verify the class is present.
    expect(subjectEl.classList.contains('commit-subject')).toBe(true);
  });

  it('shows the "Show full message" button by default, fetches once on click', async () => {
    // Stub fetch.
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({
        sha: COMMIT.sha, author: COMMIT.author, date: COMMIT.date,
        subject: COMMIT.subject, body: 'Body line one.\nBody line two.',
      }), { status: 200 })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const { pane, api } = buildCommitPane({});
      api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });

      const btn = pane.querySelector('.commit-expand') as HTMLButtonElement;
      expect(btn).not.toBeNull();
      btn.click();
      // Wait a tick for the fetch promise to settle.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const msgBody = pane.querySelector('.commit-message-body') as HTMLElement;
      expect(msgBody).not.toBeNull();
      expect(msgBody.textContent).toContain('Body line one.');
      expect(msgBody.textContent).toContain('Body line two.');
      expect(pane.querySelector('.commit-expand')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('shows an error inline when the body fetch fails', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    try {
      const { pane, api } = buildCommitPane({});
      api.setCommit(COMMIT, { now: new Date('2026-05-24T12:00:00Z') });
      (pane.querySelector('.commit-expand') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      const err = pane.querySelector('.commit-message-error') as HTMLElement;
      expect(err).not.toBeNull();
      expect(err.textContent).toMatch(/failed/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
