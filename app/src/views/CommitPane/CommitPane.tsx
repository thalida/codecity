// views/CommitPane.tsx — right-sidebar pane shown when a tree
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
// A Preact function component reading a `state` signal prop (the selected
// commit); RightSidebar swaps panes by switching which one it renders.

import './CommitPane.css';
import { useState, useEffect, useRef } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import type { CommitEntry } from '@/types';
import { GitCommitHorizontal, History } from 'lucide-preact';
import { Pane, PaneEmpty } from '@/components/Pane';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { commitUrl } from '@/utils/commit';
import { formatRelativeAge, formatFullDate } from '@/utils/dates';
import { fetchCommitDetail } from '@/api/commit';
import { colorForAuthor } from '@/city/components/fireflies/authorColor';

const SHORT_SHA_LEN = 7;

// Discriminant for the lazy-loaded commit-message body. Enum (not an inline
// string union) to match the NodeKind discriminant pattern used elsewhere.
export enum CommitBodyKind {
  Loading = 'loading',
  Text = 'text',
  Error = 'error',
  Hidden = 'hidden',
}

type BodyState =
  | { kind: CommitBodyKind.Loading }
  | { kind: CommitBodyKind.Text; body: string }
  | { kind: CommitBodyKind.Error; err: unknown }
  | { kind: CommitBodyKind.Hidden };

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
  /** name -> backend-resolved AuthorStat.hue, for the author dot. */
  authorHues?: Record<string, number>;
  color?: string;
  now?: Date;
  /** Whether Timeline mode is already on — wording only for the timeline
   *  button's tooltip. */
  inTimeline?: boolean;
}

export interface CommitPaneProps {
  state: ReadonlySignal<CommitPaneState>;
  onClose?: () => void;
  onFocus?: (commit: CommitEntry) => void;
  /** Enter Timeline mode (if needed) and scrub to this commit. */
  onViewInTimeline?: (commit: CommitEntry) => void;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function CommitPane({ state, onClose, onFocus, onViewInTimeline }: CommitPaneProps) {
  const {
    commit,
    remoteUrl,
    sameDayTotal = 0,
    busynessThresholds = { avg: 1, busy: 1 },
    authorHues = {},
    color,
    now = new Date(),
    inTimeline = false,
  } = state.value;

  const [bodyState, setBodyState] = useState<BodyState>({ kind: CommitBodyKind.Loading });
  const bodyCache = useRef(new Map<string, string>());

  useEffect(() => {
    if (!commit) return;
    const sha = commit.sha;
    const cached = bodyCache.current.get(sha);
    if (cached !== undefined) {
      setBodyState(
        cached.trim()
          ? { kind: CommitBodyKind.Text, body: cached }
          : { kind: CommitBodyKind.Hidden }
      );
      return;
    }
    setBodyState({ kind: CommitBodyKind.Loading });
    let cancelled = false;
    fetchCommitDetail(sha).then(
      (detail) => {
        if (cancelled) return;
        const bodyText = detail.body ?? '';
        bodyCache.current.set(sha, bodyText);
        setBodyState(
          bodyText.trim()
            ? { kind: CommitBodyKind.Text, body: bodyText }
            : { kind: CommitBodyKind.Hidden }
        );
      },
      (err) => {
        if (cancelled) return;
        setBodyState({ kind: CommitBodyKind.Error, err });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [commit?.sha]);

  if (!commit) {
    return (
      <Pane
        paneClass="commit-pane"
        title="Commit"
        onClose={onClose}
        bodyClass="commit-body pane-inset"
      >
        <PaneEmpty
          icon={GitCommitHorizontal}
          title="No commit"
          sub="Select a tree in the city to inspect its commit."
        />
      </Pane>
    );
  }

  const shortSha = commit.sha.slice(0, SHORT_SHA_LEN);
  const url = remoteUrl ? commitUrl(remoteUrl, commit.sha) : null;
  const label = _busynessLabel(sameDayTotal, busynessThresholds);
  const commitWord = sameDayTotal === 1 ? 'commit' : 'commits';
  const primaryAuthor = (commit.authors ?? [])[0] || '(unknown)';

  const titleSlot = (
    <>
      Commit <span class="commit-sha">{shortSha}</span>
      <span class="commit-title-author"> · {primaryAuthor}</span>
    </>
  );

  return (
    <Pane
      paneClass="commit-pane"
      titleSlot={titleSlot}
      onFocus={typeof onFocus === 'function' ? () => onFocus(commit) : undefined}
      focusTitle={`Focus the camera on this commit (${KEY_BINDINGS.FOCUS_SELECTION.label})`}
      copyText={commit.sha}
      copyLabel="Copy SHA"
      openUrl={url}
      openLabel="Open commit on origin"
      actionsSlot={
        typeof onViewInTimeline === 'function' ? (
          <button
            type="button"
            class="btn-icon"
            title={
              inTimeline ? 'Scrub the timeline to this commit' : 'View this commit on the timeline'
            }
            aria-label="View on timeline"
            onClick={() => onViewInTimeline(commit)}
          >
            <History class="icon" />
          </button>
        ) : undefined
      }
      onClose={onClose}
      bodyClass="commit-body pane-inset"
    >
      <div class="commit-message-subject">{commit.subject || '(no subject)'}</div>
      {(commit.authors ?? []).map((author) => (
        <div key={author} class="commit-author">
          <span
            class="commit-author-dot"
            style={{ backgroundColor: colorForAuthor(authorHues[author] ?? 0).hex }}
          />
          <span class="commit-author-name">{author || '(unknown)'}</span>
        </div>
      ))}
      <div class="commit-meta">
        <span class="commit-age" title={commit.date}>
          {formatRelativeAge(commit.date, now)}
        </span>
        <span class="commit-meta-sep" aria-hidden="true">
          ·
        </span>
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
        {/* role=status on the transient states only, so the async load /
            failure is announced without reading out the whole commit body. */}
        {bodyState.kind === CommitBodyKind.Loading && (
          <div class="commit-message-body-slot--loading" role="status">
            Loading…
          </div>
        )}
        {bodyState.kind === CommitBodyKind.Text && (
          <pre class="commit-message-body">{bodyState.body}</pre>
        )}
        {bodyState.kind === CommitBodyKind.Error && (
          <div class="commit-message-body-slot--error" role="status">
            <div class="commit-message-error">
              {`Failed to load message: ${bodyState.err instanceof Error ? bodyState.err.message : String(bodyState.err)}`}
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
}
