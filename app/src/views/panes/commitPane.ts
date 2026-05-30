// views/panes/commitPane.ts — right-sidebar pane shown when a tree
// (commit) is selected in the city. Shows the short SHA (in the pane
// header title), author, full commit message (subject + lazy-fetched
// body), relative age, files changed, same-day commit count with a
// busyness label, and an "Open on origin" link built from
// manifest.repo.remote_url + the full SHA.
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
import { fetchCommitDetail } from './commitFetch.js';
import { colorForAuthor } from '@/scene/components/fireflies/authorColor.js';

interface BuildCommitPaneOpts {
  onClose?: () => void;
  /** Called when the user clicks the focus button in the pane header.
   *  Equivalent of pressing F on the canvas with the current commit selected. */
  onFocus?: (commit: CommitEntry) => void;
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

function _busynessLabel(count: number): 'Light' | 'Avg' | 'Busy' {
  if (count >= 8) return 'Busy';
  if (count >= 3) return 'Avg';
  return 'Light';
}

export function buildCommitPane(opts: BuildCommitPaneOpts = {}) {
  const pane = document.createElement('div');
  pane.className = 'pane commit-pane';

  const { el: header, api: headerApi } = buildPaneHeader({
    title: 'Commit',
    onClose: opts.onClose,
    onFocus: opts.onFocus
      ? () => {
          if (_currentCommit) opts.onFocus!(_currentCommit);
        }
      : undefined,
    focusTitle: 'Focus the camera on this commit (F)',
  });
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pane-body commit-body';
  pane.appendChild(body);

  // SHA-based race guard: tracks the most recently requested commit sha so
  // late fetch results from a previous commit are silently dropped.
  let _currentSha: string | null = null;
  let _currentCommit: CommitEntry | null = null;

  // Body cache: sha → fetched body text (empty string is a valid cached value).
  // Lives on the pane instance; never invalidated (commits are immutable).
  const _bodyCache = new Map<string, string>();

  function _renderEmpty(): void {
    _currentSha = null;
    _currentCommit = null;
    headerApi.setFocusEnabled(false);
    headerApi.setTitle('Commit');
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

  function _renderLoading(): void {
    body.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'commit-loading';
    loading.textContent = 'Loading commit…';
    body.appendChild(loading);
  }

  function _renderError(err: unknown): void {
    body.replaceChildren();
    const errEl = document.createElement('div');
    errEl.className = 'commit-message-error';
    errEl.textContent = `Failed to load commit: ${err instanceof Error ? err.message : String(err)}`;
    body.appendChild(errEl);
  }

  function _renderFullContent(
    commit: CommitEntry,
    remoteUrl: string | null,
    sameDayTotal: number,
    color: string | undefined,
    now: Date,
    bodyText: string
  ): void {
    body.replaceChildren();

    // ── Author row ───────────────────────────────────────────────────
    const authorEl = document.createElement('div');
    authorEl.className = 'commit-author';
    const dotEl = document.createElement('span');
    dotEl.className = 'commit-author-dot';
    dotEl.style.backgroundColor = colorForAuthor(commit.authors[0]).hex;
    authorEl.appendChild(dotEl);
    const authorName = document.createElement('span');
    authorName.className = 'commit-author-name';
    authorName.textContent = commit.authors[0] || '(unknown)';
    authorEl.appendChild(authorName);
    body.appendChild(authorEl);

    // ── Commit message block (subject + body if non-empty) ───────────
    const messageEl = document.createElement('div');
    messageEl.className = 'commit-message';

    const subjectEl = document.createElement('div');
    subjectEl.className = 'commit-message-subject';
    subjectEl.textContent = commit.subject || '(no subject)';
    messageEl.appendChild(subjectEl);

    const trimmed = bodyText.trim();
    if (trimmed) {
      const msgBodyEl = document.createElement('pre');
      msgBodyEl.className = 'commit-message-body';
      msgBodyEl.textContent = bodyText;
      messageEl.appendChild(msgBodyEl);
    }

    body.appendChild(messageEl);

    // ── Footer line 1: relative age · files changed ──────────────────
    const metaEl = document.createElement('div');
    metaEl.className = 'commit-meta';

    const ageEl = document.createElement('span');
    ageEl.className = 'commit-age';
    ageEl.textContent = `committed ${formatRelativeAge(commit.date, now)}`;
    ageEl.title = commit.date;
    metaEl.appendChild(ageEl);

    const sepEl = document.createElement('span');
    sepEl.className = 'commit-meta-sep';
    sepEl.setAttribute('aria-hidden', 'true');
    sepEl.textContent = '·';
    metaEl.appendChild(sepEl);

    const filesEl = document.createElement('span');
    filesEl.className = 'commit-files';
    filesEl.textContent = `${commit.files} file${commit.files === 1 ? '' : 's'} changed`;
    metaEl.appendChild(filesEl);

    body.appendChild(metaEl);

    // ── Footer line 2: busyness label + same-day count ───────────────
    if (sameDayTotal !== undefined && sameDayTotal > 0) {
      const sameDayEl = document.createElement('div');
      sameDayEl.className = 'commit-same-day';
      if (color) {
        const swatch = document.createElement('span');
        swatch.className = 'commit-swatch';
        swatch.style.backgroundColor = color;
        sameDayEl.appendChild(swatch);
      }
      const label = _busynessLabel(sameDayTotal);
      const commitWord = sameDayTotal === 1 ? 'commit' : 'commits';
      sameDayEl.appendChild(
        document.createTextNode(`${label} day — ${sameDayTotal} ${commitWord} that day`)
      );
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

  function _renderCommit(
    commit: CommitEntry,
    remoteUrl: string | null,
    sameDayTotal: number,
    color: string | undefined,
    now: Date
  ): void {
    _currentSha = commit.sha;
    _currentCommit = commit;
    headerApi.setFocusEnabled(true);

    // Update the pane header title to "Commit <short-sha>" + optional open
    // link. This happens immediately, even during loading, so the user sees
    // what they clicked on right away.
    const titleNodes: Node[] = [document.createTextNode('Commit ')];
    const shaEl = document.createElement('span');
    shaEl.className = 'commit-sha';
    shaEl.textContent = commit.sha.slice(0, SHORT_SHA_LEN);
    titleNodes.push(shaEl);
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
      titleNodes.push(link);
    }
    headerApi.setTitleChildren(titleNodes);

    // Cache hit → render immediately, no loading state.
    const cached = _bodyCache.get(commit.sha);
    if (cached !== undefined) {
      _renderFullContent(commit, remoteUrl, sameDayTotal, color, now, cached);
      return;
    }

    // Cache miss → pane-wide loading state, then render on resolve.
    _renderLoading();
    const fetchSha = commit.sha;
    fetchCommitDetail(fetchSha).then(
      (detail) => {
        const bodyText = detail.body ?? '';
        _bodyCache.set(fetchSha, bodyText);
        if (_currentSha !== fetchSha) return;
        _renderFullContent(commit, remoteUrl, sameDayTotal, color, now, bodyText);
      },
      (err) => {
        if (_currentSha !== fetchSha) return;
        _renderError(err);
      }
    );
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
