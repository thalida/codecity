// views/panes/commitPane.tsx — right-sidebar pane shown when a tree
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

import { useState, useEffect, useRef } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type { CommitEntry } from '@/types';
import { LucideIcon, makeLucideIcon } from '@/views/components/LucideIcon';
import { buildPaneHeader } from '@/views/components/PaneHeader';
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
  /**
   * Repo-relative thresholds for the busyness label. `count >= busy` →
   * "Busy"; `count >= avg` → "Avg"; otherwise "Light". Derived via
   * `dailyCommitThresholds(manifest.commits)` by the caller so the
   * label reflects this repo's own activity, not global magic numbers.
   */
  busynessThresholds?: { avg: number; busy: number };
  /** Injected for testability of relative age. Defaults to new Date(). */
  now?: Date;
}

const SHORT_SHA_LEN = 7;

function _busynessLabel(
  count: number,
  thresholds: { avg: number; busy: number } = { avg: 1, busy: 1 }
): 'Light' | 'Avg' | 'Busy' {
  if (count >= thresholds.busy) return 'Busy';
  if (count >= thresholds.avg) return 'Avg';
  return 'Light';
}

// ── State shape for Preact component ─────────────────────────────────────────

export interface CommitPaneState {
  commit: CommitEntry | null;
  remoteUrl?: string | null;
  sameDayTotal?: number;
  /** See SetCommitOpts.busynessThresholds. */
  busynessThresholds?: { avg: number; busy: number };
  color?: string;
  now?: Date;
}

export interface CommitPaneProps {
  state: Signal<CommitPaneState>;
  onClose?: () => void;
  onFocus?: (commit: CommitEntry) => void;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function CommitPane({ state, onClose, onFocus }: CommitPaneProps) {
  const {
    commit,
    remoteUrl,
    sameDayTotal = 0,
    busynessThresholds = { avg: 1, busy: 1 },
    color,
    now = new Date(),
  } = state.value;

  type BodyState =
    | { kind: 'loading' }
    | { kind: 'text'; body: string }
    | { kind: 'error'; err: unknown }
    | { kind: 'hidden' };

  const [bodyState, setBodyState] = useState<BodyState>({ kind: 'loading' });
  const bodyCache = useRef(new Map<string, string>());

  useEffect(() => {
    if (!commit) return;
    const sha = commit.sha;
    const cached = bodyCache.current.get(sha);
    if (cached !== undefined) {
      setBodyState(cached.trim() ? { kind: 'text', body: cached } : { kind: 'hidden' });
      return;
    }
    setBodyState({ kind: 'loading' });
    let cancelled = false;
    fetchCommitDetail(sha).then(
      (detail) => {
        if (cancelled) return;
        const bodyText = detail.body ?? '';
        bodyCache.current.set(sha, bodyText);
        setBodyState(bodyText.trim() ? { kind: 'text', body: bodyText } : { kind: 'hidden' });
      },
      (err) => {
        if (cancelled) return;
        setBodyState({ kind: 'error', err });
      }
    );
    return () => { cancelled = true; };
  }, [commit?.sha]);

  if (!commit) {
    return (
      <div class="pane commit-pane">
        <div class="pane-header">
          <h3 class="text-pane-title">Commit</h3>
          {typeof onClose === 'function' && (
            <button type="button" class="btn-icon btn-icon--text" title="Hide sidebar" aria-label="Hide sidebar" onClick={() => onClose()} />
          )}
        </div>
        <div class="pane-body commit-body">
          <div class="empty-state empty-state--lg">
            <p class="text-card-title">No commit</p>
            <p class="text-card-sub">Select a tree in the city to inspect its commit.</p>
          </div>
        </div>
      </div>
    );
  }

  const shortSha = commit.sha.slice(0, SHORT_SHA_LEN);
  const url = remoteUrl ? commitUrl(remoteUrl, commit.sha) : null;
  const label = _busynessLabel(sameDayTotal, busynessThresholds);
  const commitWord = sameDayTotal === 1 ? 'commit' : 'commits';

  return (
    <div class="pane commit-pane">
      <div class="pane-header">
        {typeof onFocus === 'function' && (
          <button
            type="button"
            class="btn-icon btn-icon--text"
            title="Focus the camera on this commit (F)"
            aria-label="Focus the camera on this commit (F)"
            onClick={() => onFocus(commit)}
          />
        )}
        <h3 class="text-pane-title">
          Commit <span class="commit-sha">{shortSha}</span>
          {url && (
            <a
              class="commit-open btn-icon btn-icon--link"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this commit on the origin remote"
              aria-label="Open commit on origin"
            >
              <LucideIcon name="external-link" />
            </a>
          )}
        </h3>
        {typeof onClose === 'function' && (
          <button type="button" class="btn-icon btn-icon--text" title="Hide sidebar" aria-label="Hide sidebar" onClick={() => onClose()} />
        )}
      </div>
      <div class="pane-body commit-body">
        <div class="commit-message-subject">{commit.subject || '(no subject)'}</div>
        {commit.authors.map((author) => (
          <div key={author} class="commit-author">
            <span class="commit-author-dot" style={{ backgroundColor: colorForAuthor(author).hex }} />
            <span class="commit-author-name">{author || '(unknown)'}</span>
          </div>
        ))}
        <div class="commit-meta">
          <span class="commit-age" title={commit.date}>{formatRelativeAge(commit.date, now)}</span>
          <span class="commit-meta-sep" aria-hidden="true">·</span>
          <span class="commit-files">{`${commit.files} file${commit.files === 1 ? '' : 's'} changed`}</span>
        </div>
        {sameDayTotal > 0 && (
          <div
            class="commit-same-day"
            title={`${sameDayTotal} ${commitWord} on ${formatFullDate(commit.date)}`}
          >
            {color && <span class="commit-swatch" style={{ backgroundColor: color }} />}
            {`${label} day: ${sameDayTotal} ${commitWord}`}
          </div>
        )}
        <div class="commit-message-body-slot">
          {bodyState.kind === 'loading' && (
            <div class="commit-message-body-slot--loading">Loading…</div>
          )}
          {bodyState.kind === 'text' && (
            <pre class="commit-message-body">{bodyState.body}</pre>
          )}
          {bodyState.kind === 'error' && (
            <div class="commit-message-body-slot--error">
              <div class="commit-message-error">
                {`Failed to load message: ${bodyState.err instanceof Error ? bodyState.err.message : String(bodyState.err)}`}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Backward-compat factory ───────────────────────────────────────────────────

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
    sameDayTotal: number,
    busynessThresholds: { avg: number; busy: number },
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
      const label = _busynessLabel(sameDayTotal, busynessThresholds);
      const commitWord = sameDayTotal === 1 ? 'commit' : 'commits';
      sameDayEl.appendChild(document.createTextNode(`${label} day: ${sameDayTotal} ${commitWord}`));
      // Hover tooltip carries the full date so the "that day" context isn't
      // lost. e.g. "24 commits on March 12, 2026".
      sameDayEl.title = `${sameDayTotal} ${commitWord} on ${formatFullDate(commit.date)}`;
      body.appendChild(sameDayEl);
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
    busynessThresholds: { avg: number; busy: number },
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
    _renderSkeleton(commit, sameDayTotal, busynessThresholds, color, now);

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
    const busynessThresholds = opts.busynessThresholds ?? { avg: 1, busy: 1 };
    const color = opts.color;
    const now = opts.now ?? new Date();
    _renderCommit(commit, remoteUrl, sameDayTotal, busynessThresholds, color, now);
  }

  setCommit(null);

  return {
    pane,
    api: { setCommit },
  };
}
