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

  it('renders short SHA, date, age, and an open-on-origin link', () => {
    const { pane, api } = buildCommitPane({});
    const now = new Date('2026-05-24T12:00:00Z');
    api.setCommit(COMMIT, 'https://github.com/org/repo', now);

    expect(pane.querySelector('.commit-sha')!.textContent).toBe('a1b2c3d');
    expect(pane.querySelector('.commit-date')!.textContent).toBe('2026-03-12');
    expect(pane.querySelector('.commit-age')!.textContent).toBe('2 months ago');

    const link = pane.querySelector('.commit-open') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe(`https://github.com/org/repo/commit/${COMMIT.sha}`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');
  });

  it('hides the open link and shows a no-remote hint when remoteUrl is null', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, null, new Date('2026-05-24T12:00:00Z'));
    expect(pane.querySelector('.commit-open')).toBeNull();
    expect(pane.querySelector('.commit-no-remote')).not.toBeNull();
  });

  it('setCommit(null) returns to the empty state', () => {
    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, 'https://github.com/org/repo', new Date('2026-05-24T12:00:00Z'));
    api.setCommit(null, null);
    expect(pane.querySelector('.commit-sha')).toBeNull();
    expect(pane.querySelector('.empty-state')).not.toBeNull();
  });

  it('clicking the short SHA copies the full SHA to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom does not implement navigator.clipboard; install a minimal stub.
    Object.assign(navigator, { clipboard: { writeText } });

    const { pane, api } = buildCommitPane({});
    api.setCommit(COMMIT, 'https://github.com/org/repo', new Date('2026-05-24T12:00:00Z'));

    (pane.querySelector('.commit-sha') as HTMLElement).click();
    expect(writeText).toHaveBeenCalledWith(COMMIT.sha);
  });

  it('onClose fires when the × is clicked', () => {
    const onClose = vi.fn();
    const { pane } = buildCommitPane({ onClose });
    const closeBtn = pane.querySelector('.pane-header [aria-label*="lose" i], .pane-header .pane-header-close, .pane-header button') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
  });
});
