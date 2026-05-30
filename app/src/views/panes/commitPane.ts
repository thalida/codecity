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
import { makeLucideIcon } from '@/views/components/icon';
import { buildPaneHeader } from '@/views/components/paneHeader';
import { commitUrl } from '@/utils/commit';
import { formatRelativeAge, formatFullDate } from '@/utils/dates';
import { fetchCommitDetail } from '@/api/commit';
import { colorForAuthor } from '@/scene/components/fireflies/authorColor';

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

  /** Persistent reference to the body slot DOM element, so _setBodyState
   *  can mutate it without searching the tree on every state change. Set
   *  by _renderSkeleton; null when the empty state is showing. */
  let _bodySlotEl: HTMLElement | null = null;

  type BodyState =
    | { kind: 'loading' }
    | { kind: 'text'; body: string }
    | { kind: 'error'; err: unknown }
    | { kind: 'hidden' };

  function _renderEmpty(): void {
    _currentSha = null;
    _currentCommit = null;
    _bodySlotEl = null;
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

  function _setBodyState(state: BodyState): void {
    if (!_bodySlotEl) return;
    _bodySlotEl.replaceChildren();
    _bodySlotEl.classList.remove(
      'commit-message-body-slot--loading',
      'commit-message-body-slot--error'
    );
    _bodySlotEl.style.display = '';

    if (state.kind === 'loading') {
      _bodySlotEl.classList.add('commit-message-body-slot--loading');
      _bodySlotEl.textContent = 'Loading…';
      return;
    }
    if (state.kind === 'text') {
      const pre = document.createElement('pre');
      pre.className = 'commit-message-body';
      pre.textContent = state.body;
      _bodySlotEl.appendChild(pre);
      return;
    }
    if (state.kind === 'error') {
      _bodySlotEl.classList.add('commit-message-body-slot--error');
      const errEl = document.createElement('div');
      errEl.className = 'commit-message-error';
      errEl.textContent = `Failed to load message: ${
        state.err instanceof Error ? state.err.message : String(state.err)
      }`;
      _bodySlotEl.appendChild(errEl);
      return;
    }
    // hidden
    _bodySlotEl.style.display = 'none';
  }

  function _renderSkeleton(
    commit: CommitEntry,
    remoteUrl: string | null,
    sameDayTotal: number,
    color: string | undefined,
    now: Date
  ): void {
    body.replaceChildren();
    _bodySlotEl = null;

    // ── Subject (commit title at the top) ─────────────────────────────
    const subjectEl = document.createElement('div');
    subjectEl.className = 'commit-message-subject';
    subjectEl.textContent = commit.subject || '(no subject)';
    body.appendChild(subjectEl);

    // ── Author rows (one per distinct author; primary first) ─────────
    for (const author of commit.authors) {
      const row = document.createElement('div');
      row.className = 'commit-author';
      const dotEl = document.createElement('span');
      dotEl.className = 'commit-author-dot';
      dotEl.style.backgroundColor = colorForAuthor(author).hex;
      row.appendChild(dotEl);
      const authorName = document.createElement('span');
      authorName.className = 'commit-author-name';
      authorName.textContent = author || '(unknown)';
      row.appendChild(authorName);
      body.appendChild(row);
    }

    // ── Meta line 1: relative age · files changed ─────────────────────
    const metaEl = document.createElement('div');
    metaEl.className = 'commit-meta';

    const ageEl = document.createElement('span');
    ageEl.className = 'commit-age';
    ageEl.textContent = formatRelativeAge(commit.date, now);
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

    // ── Meta line 2: busyness label + same-day count ──────────────────
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
      sameDayEl.appendChild(document.createTextNode(`${label} day: ${sameDayTotal} ${commitWord}`));
      // Hover tooltip carries the full date so the "that day" context isn't
      // lost. e.g. "24 commits on March 12, 2026".
      sameDayEl.title = `${sameDayTotal} ${commitWord} on ${formatFullDate(commit.date)}`;
      body.appendChild(sameDayEl);
    }

    // ── No-remote hint (only when no remote configured) ───────────────
    if (!remoteUrl) {
      const note = document.createElement('div');
      note.className = 'commit-no-remote';
      note.textContent = 'No remote configured';
      body.appendChild(note);
    }

    // ── Body slot (mutable region for loading / text / error / hidden) ─
    const bodySlot = document.createElement('div');
    bodySlot.className = 'commit-message-body-slot';
    body.appendChild(bodySlot);
    _bodySlotEl = bodySlot;
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
    // link. Synchronous; user sees what they clicked on right away.
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

    // Render the skeleton synchronously — every piece of metadata that
    // lives in the manifest goes in immediately. Body slot starts as a
    // loading placeholder.
    _renderSkeleton(commit, remoteUrl, sameDayTotal, color, now);

    // Cache hit → body slot resolves synchronously, in the same tick as
    // the skeleton. No Loading… flicker.
    const cached = _bodyCache.get(commit.sha);
    if (cached !== undefined) {
      _setBodyState(cached.trim() ? { kind: 'text', body: cached } : { kind: 'hidden' });
      return;
    }

    // Cache miss → leave body slot in 'loading' (set by _renderSkeleton).
    _setBodyState({ kind: 'loading' });
    const fetchSha = commit.sha;
    fetchCommitDetail(fetchSha).then(
      (detail) => {
        const bodyText = detail.body ?? '';
        _bodyCache.set(fetchSha, bodyText);
        if (_currentSha !== fetchSha) return;
        _setBodyState(bodyText.trim() ? { kind: 'text', body: bodyText } : { kind: 'hidden' });
      },
      (err) => {
        if (_currentSha !== fetchSha) return;
        _setBodyState({ kind: 'error', err });
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
