// components/TimeTravelBar.tsx — bottom bar: slider over the full commit history to jump the city to any past commit.

import './TimeTravelBar.css';
import { signal, effect } from '@preact/signals';
import { useState, useRef, useEffect } from 'preact/hooks';
import { History, RotateCcw } from 'lucide-preact';
import { MANIFEST } from '@/state/stores/manifest';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { TIME_TRAVEL_REF } from '@/state/stores/timeTravel';
import { loadRef, exitTimeTravel } from '@/hooks/useManifestSource';
import { isEmptyManifest } from '@/utils/manifest';
import { formatShortDate } from '@/utils/dates';
import { commitUrl } from '@/utils/commit';
import type { CommitEntry, Manifest } from '@/types';

// Stable HEAD-history axis + repo web URL: locked in per source so a past-ref
// manifest's shorter commits list never shrinks the slider.
const AXIS = signal<CommitEntry[]>([]);
const REMOTE = signal<string | null>(null);
let _axisSourceKey: string | null = null;

effect(() => {
  const key = CURRENT_SOURCE_KEY.value;
  if (key !== _axisSourceKey) {
    _axisSourceKey = key;
    AXIS.value = [];
    REMOTE.value = null;
  }
  if (AXIS.value.length > 0) return;
  const m = MANIFEST.value;
  if (isEmptyManifest(m)) return;
  const commits = (m as Manifest).commits;
  if (commits && commits.length > 0) {
    AXIS.value = commits;
    REMOTE.value = (m as Manifest).repo?.remote_url ?? null;
  }
});

export function TimeTravelBar() {
  const axis = AXIS.value;
  const ref = TIME_TRAVEL_REF.value;
  const headIndex = axis.length - 1;
  const refIndex = ref === null ? -1 : axis.findIndex((c) => c.sha === ref);
  const derived = refIndex === -1 ? headIndex : refIndex;

  // pos drives the thumb so it tracks the drag before the (debounced) load lands.
  const [pos, setPos] = useState(derived);
  const timer = useRef<number | null>(null);
  useEffect(() => setPos(derived), [derived]);

  if (axis.length < 2) return null;

  const commit = axis[Math.min(Math.max(pos, 0), headIndex)];
  const url = REMOTE.value ? commitUrl(REMOTE.value, commit.sha) : null;

  const onInput = (e: Event) => {
    const i = Number((e.currentTarget as HTMLInputElement).value);
    setPos(i);
    // Debounce: a drag = one load on settle, not one per step.
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (i === headIndex) exitTimeTravel();
      else void loadRef(axis[i].sha);
    }, 150);
  };

  return (
    <div class="time-travel-bar">
      <div class="time-travel-track">
        <History class="icon time-travel-history" aria-hidden="true" />
        <input
          type="range"
          class="setting-slider time-travel-slider"
          min={String(0)}
          max={String(headIndex)}
          value={String(pos)}
          onInput={onInput}
          aria-label="Scrub commit history"
        />
        <button
          type="button"
          class="setting-row-reset"
          title="Back to live"
          aria-label="Back to live"
          disabled={ref === null}
          onClick={() => exitTimeTravel()}
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
