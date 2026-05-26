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
});
