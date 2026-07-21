// components/TimeTravelBar.tsx — bottom bar: slider over the full commit history to jump the city to any past commit.

import './TimeTravelBar.css';
import { signal, effect } from '@preact/signals';
import { History } from 'lucide-preact';
import { MANIFEST } from '@/state/stores/manifest';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { TIME_TRAVEL_REF } from '@/state/stores/timeTravel';
import { loadRef, exitTimeTravel } from '@/hooks/useManifestSource';
import { isEmptyManifest } from '@/utils/manifest';
import { formatShortDate } from '@/utils/dates';
import type { CommitEntry, Manifest } from '@/types';

// Stable HEAD-history axis: locked in per source so a past-ref manifest's shorter commits list never shrinks the slider.
const AXIS = signal<CommitEntry[]>([]);
let _axisSourceKey: string | null = null;

effect(() => {
  const key = CURRENT_SOURCE_KEY.value;
  if (key !== _axisSourceKey) {
    _axisSourceKey = key;
    AXIS.value = [];
  }
  if (AXIS.value.length > 0) return;
  const m = MANIFEST.value;
  if (isEmptyManifest(m)) return;
  const commits = (m as Manifest).commits;
  if (commits && commits.length > 0) AXIS.value = commits;
});

export function TimeTravelBar() {
  const axis = AXIS.value;
  if (axis.length < 2) return null;

  const ref = TIME_TRAVEL_REF.value;
  const headIndex = axis.length - 1;
  const refIndex = ref === null ? -1 : axis.findIndex((c) => c.sha === ref);
  const index = refIndex === -1 ? headIndex : refIndex;
  const commit = axis[index];

  const onChange = (e: Event) => {
    const i = Number((e.currentTarget as HTMLInputElement).value);
    if (i === headIndex) exitTimeTravel();
    else void loadRef(axis[i].sha);
  };

  return (
    <div class="time-travel-bar card-overlay">
      <input
        type="range"
        class="setting-slider time-travel-slider"
        min={String(0)}
        max={String(headIndex)}
        value={String(index)}
        onChange={onChange}
        aria-label="Scrub commit history"
      />
      <div class="time-travel-info">
        <History class="icon" aria-hidden="true" />
        <span class="time-travel-sha">{commit.sha.slice(0, 7)}</span>
        <span class="time-travel-date">{formatShortDate(commit.date)}</span>
        <span class="time-travel-subject">{commit.subject || '(no subject)'}</span>
      </div>
      {ref !== null && (
        <button type="button" class="btn-secondary" onClick={() => exitTimeTravel()}>
          Back to live
        </button>
      )}
    </div>
  );
}
