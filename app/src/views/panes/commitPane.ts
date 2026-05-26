// views/panes/commitPane.ts — right-sidebar pane shown when a tree
// (commit) is selected in the city. Shows the short SHA, absolute date,
// relative age, files changed, same-day commit count, and an "Open on
// origin" link built from manifest.repo.remote_url + the full SHA.
// When the repo has no remote, the link is replaced with a muted hint.
//
// A colored swatch matching the tree's render color is shown inline
// inside the "N commits that day" row (next to the same-day text)
// when a color is provided.
//
// API matches filePreviewPane's shape (build once, push selection in
// via setCommit) so the coordinator can swap panes in the right
// sidebar without churn.

import type { CommitEntry } from '@/types';
import { makeLucideIcon } from '@/views/widgets/icon.js';
import { buildPaneHeader } from '@/views/shell/paneHeader.js';
import { commitUrl } from './commitUrl.js';
import { formatRelativeAge } from '@/views/widgets/formatRelativeAge.js';

interface BuildCommitPaneOpts {
  onClose?: () => void;
}

export interface SetCommitOpts {
  remoteUrl?: string | null;
  /** Total commits on this date (including this one); >= 1. */
  sameDayTotal?: number;
  /** CSS color for the same-day swatch, e.g. "#5e8a3a". */
  color?: string;
  /** Injected for testability of relative age. Defaults to new Date(). */
  now?: Date;
}

const SHORT_SHA_LEN = 7;

export function buildCommitPane(opts: BuildCommitPaneOpts = {}) {
  const pane = document.createElement('div');
  pane.className = 'pane commit-pane';

  const { el: header } = buildPaneHeader({
    title: 'Commit',
    onClose: opts.onClose,
  });
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pane-body commit-body';
  pane.appendChild(body);

  function _renderEmpty(): void {
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'empty-state empty-state--lg';
    box.appendChild(makeLucideIcon('git-commit-horizontal'));
    const h = document.createElement('p');
    h.className = 'text-card-title';
    h.textContent = 'No commit';
    box.appendChild(h);
    const sub = document.createElement('p');
    sub.className = 'text-card-sub';
    sub.textContent = 'Select a tree in the city to inspect its commit.';
    box.appendChild(sub);
    body.appendChild(box);
  }

  function _renderCommit(
    commit: CommitEntry,
    remoteUrl: string | null,
    sameDayTotal: number,
    color: string | undefined,
    now: Date
  ): void {
    body.replaceChildren();

    // ── SHA row (SHA on left, open-on-origin link on right) ──────────
    const headerRow = document.createElement('div');
    headerRow.className = 'commit-row';

    const shaEl = document.createElement('span');
    shaEl.className = 'commit-sha';
    shaEl.textContent = commit.sha.slice(0, SHORT_SHA_LEN);
    headerRow.appendChild(shaEl);

    // Right-side: subtle open-on-origin link (icon-only, matches app-header repo link style)
    const url = remoteUrl ? commitUrl(remoteUrl, commit.sha) : null;
    if (url) {
      const link = document.createElement('a');
      link.className = 'commit-open btn-icon btn-icon--link';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = 'Open this commit on the origin remote';
      link.setAttribute('aria-label', 'Open commit on origin');
      link.appendChild(makeLucideIcon('external-link'));
      headerRow.appendChild(link);
    }

    body.appendChild(headerRow);

    // ── Date + age (side-by-side, age first) ─────────────────────────
    const whenEl = document.createElement('div');
    whenEl.className = 'commit-when';

    const ageEl = document.createElement('span');
    ageEl.className = 'commit-age';
    ageEl.textContent = formatRelativeAge(commit.date, now);
    whenEl.appendChild(ageEl);

    const sepEl = document.createElement('span');
    sepEl.className = 'commit-when-sep';
    sepEl.textContent = '·';
    whenEl.appendChild(sepEl);

    const dateEl = document.createElement('span');
    dateEl.className = 'commit-date';
    dateEl.textContent = commit.date;
    whenEl.appendChild(dateEl);

    body.appendChild(whenEl);

    // ── Files changed ────────────────────────────────────────────────
    const filesEl = document.createElement('div');
    filesEl.className = 'commit-files';
    filesEl.textContent = `${commit.files} file${commit.files === 1 ? '' : 's'} changed`;
    body.appendChild(filesEl);

    // ── Same-day count (with optional color swatch) ──────────────────
    if (sameDayTotal !== undefined && sameDayTotal > 0) {
      const sameDayEl = document.createElement('div');
      sameDayEl.className = 'commit-same-day';
      if (color) {
        const swatch = document.createElement('span');
        swatch.className = 'commit-swatch';
        swatch.style.backgroundColor = color;
        sameDayEl.appendChild(swatch);
      }
      const text = document.createTextNode(
        sameDayTotal === 1 ? 'only commit that day' : `${sameDayTotal} commits that day`
      );
      sameDayEl.appendChild(text);
      body.appendChild(sameDayEl);
    }

    // ── No remote hint (only when no remote configured) ──────────────
    if (!remoteUrl) {
      const note = document.createElement('div');
      note.className = 'commit-no-remote';
      note.textContent = 'No remote configured';
      body.appendChild(note);
    }
  }

  function setCommit(commit: CommitEntry | null, opts: SetCommitOpts = {}): void {
    if (!commit) {
      _renderEmpty();
      return;
    }
    const remoteUrl = opts.remoteUrl ?? null;
    const sameDayTotal = opts.sameDayTotal ?? 0;
    const color = opts.color;
    const now = opts.now ?? new Date();
    _renderCommit(commit, remoteUrl, sameDayTotal, color, now);
  }

  setCommit(null);

  return {
    pane,
    api: { setCommit },
  };
}
