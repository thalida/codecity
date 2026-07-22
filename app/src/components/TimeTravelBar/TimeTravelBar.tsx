// components/TimeTravelBar.tsx — bottom bar: scrubs SCRUB_POS across the timeline bundle's commit history.

import './TimeTravelBar.css';
import { History, RotateCcw } from 'lucide-preact';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { exitTimelineMode } from '@/hooks/useTimelineMode';
import { formatShortDate } from '@/utils/dates';
import { commitUrl } from '@/utils/commit';

export function TimeTravelBar() {
  if (!TIMELINE_MODE.value) return null;

  const bundle = TIMELINE_BUNDLE.value;
  const commits = bundle?.commits ?? [];
  if (commits.length === 0) return null;

  const maxIndex = commits.length - 1;
  const commit = commits[Math.min(Math.max(Math.round(SCRUB_POS.value), 0), maxIndex)];
  const remote = bundle?.unionManifest?.repo?.remote_url ?? null;
  const url = remote ? commitUrl(remote, commit.sha) : null;

  const onInput = (e: Event) => {
    SCRUB_POS.value = Number((e.currentTarget as HTMLInputElement).value);
  };

  return (
    <div class="time-travel-bar">
      <div class="time-travel-track">
        <History class="icon time-travel-history" aria-hidden="true" />
        <input
          type="range"
          class="setting-slider time-travel-slider"
          min={String(0)}
          max={String(maxIndex)}
          value={String(SCRUB_POS.value)}
          onInput={onInput}
          aria-label="Scrub commit history"
        />
        <button
          type="button"
          class="setting-row-reset time-travel-reset"
          title="Back to live"
          aria-label="Back to live"
          onClick={() => exitTimelineMode()}
        >
          <RotateCcw class="icon" />
        </button>
      </div>
      <div class="time-travel-info">
        {url ? (
          <a
            class="time-travel-sha"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="View this commit on the remote"
          >
            {commit.sha.slice(0, 7)}
          </a>
        ) : (
          <span class="time-travel-sha">{commit.sha.slice(0, 7)}</span>
        )}
        <span class="time-travel-date">{formatShortDate(commit.date)}</span>
        <span class="time-travel-subject">{commit.subject || '(no subject)'}</span>
      </div>
    </div>
  );
}
