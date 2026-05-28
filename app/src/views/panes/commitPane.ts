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
  });
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pane-body commit-body';
  pane.appendChild(body);

  // Tracks the currently-active message-body placeholder so a late fetch
  // result from a previous commit doesn't clobber the current view. Each
  // _renderCommit assigns a fresh placeholder; _renderEmpty nulls it.
  let _currentPlaceholder: HTMLElement | null = null;

  function _renderEmpty(): void {
    _currentPlaceholder = null;
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

  function _renderCommit(
    commit: CommitEntry,
    remoteUrl: string | null,
    sameDayTotal: number,
    color: string | undefined,
    now: Date
  ): void {
    body.replaceChildren();

    // ── Pane header title: "Commit <short-sha>" + optional open link ────
    const titleText = document.createTextNode('Commit ');
    const shaEl = document.createElement('span');
    shaEl.className = 'commit-sha';
    shaEl.textContent = commit.sha.slice(0, SHORT_SHA_LEN);

    const titleNodes: Node[] = [titleText, shaEl];

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

    // ── Author row ───────────────────────────────────────────────────
    const authorEl = document.createElement('div');
    authorEl.className = 'commit-author';
    const dotEl = document.createElement('span');
    dotEl.className = 'commit-author-dot';
    dotEl.style.backgroundColor = colorForAuthor(commit.author).hex;
    authorEl.appendChild(dotEl);
    const authorName = document.createElement('span');
    authorName.className = 'commit-author-name';
    authorName.textContent = commit.author || '(unknown)';
    authorEl.appendChild(authorName);
    body.appendChild(authorEl);

    // ── Commit message block (subject + lazy-fetched body) ───────────
    const messageEl = document.createElement('div');
    messageEl.className = 'commit-message';

    const subjectEl = document.createElement('div');
    subjectEl.className = 'commit-message-subject';
    subjectEl.textContent = commit.subject || '(no subject)';
    messageEl.appendChild(subjectEl);

    // Render a placeholder immediately, fire the fetch in parallel, and
    // swap the placeholder for the body (or error) once it resolves.
    // The closure-based identity check guards against race: if another
    // commit is selected while this fetch is in flight, _currentPlaceholder
    // points at a different element and we silently drop the late result.
    const placeholder = document.createElement('div');
    placeholder.className = 'commit-message-loading';
    placeholder.textContent = 'Loading message…';
    messageEl.appendChild(placeholder);
    _currentPlaceholder = placeholder;

    fetchCommitDetail(commit.sha).then(
      (detail) => {
        if (placeholder !== _currentPlaceholder) return;
        if (detail.body && detail.body.trim()) {
          const msgBodyEl = document.createElement('pre');
          msgBodyEl.className = 'commit-message-body';
          msgBodyEl.textContent = detail.body;
          placeholder.replaceWith(msgBodyEl);
        } else {
          // One-liner commit: no body to show, just remove the placeholder.
          placeholder.remove();
        }
        _currentPlaceholder = null;
      },
      (err) => {
        if (placeholder !== _currentPlaceholder) return;
        const errEl = document.createElement('div');
        errEl.className = 'commit-message-error';
        errEl.textContent = `Failed to load full message: ${err.message ?? err}`;
        placeholder.replaceWith(errEl);
        _currentPlaceholder = null;
      }
    );

    body.appendChild(messageEl);

    // ── Footer line 1: relative age · files changed ──────────────────
    const metaEl = document.createElement('div');
    metaEl.className = 'commit-meta';

    const ageEl = document.createElement('span');
    ageEl.className = 'commit-age';
    ageEl.textContent = `committed ${formatRelativeAge(commit.date, now)}`;
    ageEl.title = commit.date;
    metaEl.appendChild(ageEl);

    metaEl.appendChild(document.createTextNode(' · '));

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
