// views/panes/commitPane.ts — right-sidebar pane shown when a tree
// (commit) is selected in the city. Shows the short SHA (click-to-
// copy), absolute date, relative age, files changed, same-day commit
// count, and an "Open on origin" link built from manifest.repo.remote_url
// + the full SHA. When the repo has no remote, the link is replaced with
// a muted hint.
//
// A colored swatch matching the tree's render color is shown in the
// pane header (via setPrefixEl) when a color is provided.
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
  /** CSS color for the header swatch, e.g. "#5e8a3a". */
  color?: string;
  /** Injected for testability of relative age. Defaults to new Date(). */
  now?: Date;
}

const SHORT_SHA_LEN = 7;
const COPIED_FEEDBACK_MS = 1500;

export function buildCommitPane(opts: BuildCommitPaneOpts = {}) {
  const pane = document.createElement('div');
  pane.className = 'pane commit-pane';

  const { el: header, api: headerApi } = buildPaneHeader({
    title: 'Commit',
    onClose: opts.onClose,
  });
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pane-body commit-body';
  pane.appendChild(body);

  let _copiedTimer: ReturnType<typeof setTimeout> | 0 = 0;

  function _renderEmpty(): void {
    body.replaceChildren();
    headerApi.setPrefixEl(null);
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
    now: Date,
  ): void {
    body.replaceChildren();

    // ── Header swatch ────────────────────────────────────────────────
    if (color) {
      const swatch = document.createElement('span');
      swatch.className = 'commit-swatch';
      swatch.style.backgroundColor = color;
      headerApi.setPrefixEl(swatch);
    } else {
      headerApi.setPrefixEl(null);
    }

    // ── SHA ──────────────────────────────────────────────────────────
    const shaEl = document.createElement('button');
    shaEl.type = 'button';
    shaEl.className = 'commit-sha';
    shaEl.textContent = commit.sha.slice(0, SHORT_SHA_LEN);
    shaEl.title = `${commit.sha} (click to copy)`;
    shaEl.addEventListener('click', () => {
      void navigator.clipboard?.writeText(commit.sha).then(() => {
        const prev = shaEl.textContent;
        shaEl.textContent = 'Copied';
        shaEl.classList.add('is-copied');
        if (_copiedTimer) clearTimeout(_copiedTimer);
        _copiedTimer = setTimeout(() => {
          shaEl.textContent = prev;
          shaEl.classList.remove('is-copied');
          _copiedTimer = 0;
        }, COPIED_FEEDBACK_MS);
      });
    });
    body.appendChild(shaEl);

    // ── Date + age (side-by-side) ─────────────────────────────────────
    const whenEl = document.createElement('div');
    whenEl.className = 'commit-when';

    const dateEl = document.createElement('span');
    dateEl.className = 'commit-date';
    dateEl.textContent = commit.date;
    whenEl.appendChild(dateEl);

    const sepEl = document.createElement('span');
    sepEl.className = 'commit-when-sep';
    sepEl.textContent = '·';
    whenEl.appendChild(sepEl);

    const ageEl = document.createElement('span');
    ageEl.className = 'commit-age';
    ageEl.textContent = formatRelativeAge(commit.date, now);
    whenEl.appendChild(ageEl);

    body.appendChild(whenEl);

    // ── Files changed ────────────────────────────────────────────────
    const filesEl = document.createElement('div');
    filesEl.className = 'commit-files';
    filesEl.textContent = `${commit.files} file${commit.files === 1 ? '' : 's'} changed`;
    body.appendChild(filesEl);

    // ── Same-day count ───────────────────────────────────────────────
    if (sameDayTotal > 0) {
      const sameDayEl = document.createElement('div');
      sameDayEl.className = 'commit-same-day';
      if (sameDayTotal > 1) {
        sameDayEl.textContent = `${sameDayTotal} commits that day`;
      } else {
        sameDayEl.textContent = 'only commit that day';
      }
      body.appendChild(sameDayEl);
    }

    // ── Open on origin ───────────────────────────────────────────────
    const url = remoteUrl ? commitUrl(remoteUrl, commit.sha) : null;
    if (url) {
      const link = document.createElement('a');
      link.className = 'commit-open';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.appendChild(makeLucideIcon('external-link'));
      const label = document.createElement('span');
      label.textContent = 'Open on origin';
      link.appendChild(label);
      body.appendChild(link);
    } else {
      const note = document.createElement('div');
      note.className = 'commit-no-remote';
      note.textContent = 'No remote configured';
      body.appendChild(note);
    }
  }

  function setCommit(
    commit: CommitEntry | null,
    opts: SetCommitOpts = {},
  ): void {
    if (_copiedTimer) {
      clearTimeout(_copiedTimer);
      _copiedTimer = 0;
    }
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
