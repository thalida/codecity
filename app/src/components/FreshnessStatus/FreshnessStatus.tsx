// components/FreshnessStatus/FreshnessStatus.tsx — how fresh the loaded city
// is: one dot plus a short detail line. Self-reading, so wherever it's mounted
// it shows the same thing.
//
// One dot, two channels of state:
//   colour    — rebuild state (green = idle, yellow = rebuilding, red = error)
//   animation — live state (slow heartbeat when polling, static when paused,
//               fast pulse while rebuilding, static on error)
//
// It sits in the header, beside the refresh control that acts on it. Freshness
// is a fact about the project, and a readout parked in the opposite corner from
// its own button is the mistake the split button exists to fix.

import './FreshnessStatus.css';
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { formatRelativeAgeShort } from '@/utils/dates';
import { LIVE_UPDATES_ACTIVE } from '@/state/stores/settings/updates';
import {
  REBUILD_STATUS,
  RebuildStatus,
  LAST_REBUILD_ERROR,
  LAST_UPDATED_AT,
} from '@/state/stores/manifest';

// CSS modifier classes for the combined dot/detail (see FreshnessStatus.css).
// Named so the className composition reads without inline magic strings.
enum BuildClass {
  Rebuilding = 'is-rebuilding',
  Ready = 'is-ready',
  Error = 'is-error',
}
enum LiveClass {
  Live = 'is-live',
  Paused = 'is-paused',
}

// Static detail-text copy. Dynamic variants (relative age, "error: <msg>") are
// composed inline below.
const DETAIL_TEXT = {
  rebuilding: 'rebuilding…',
  decorating: 'decorating…',
  error: 'error',
  // Guard for unit tests / any path that reads status before LAST_UPDATED_AT
  // is seeded.
  ready: 'ready',
} as const;

export function FreshnessStatus() {
  // 1-second tick so relative timestamps ("5s ago") advance smoothly. useSignal
  // is component-local, so writing it re-renders only this component.
  const tick = useSignal(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      tick.value = tick.peek() + 1;
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  void tick.value;

  const liveEnabled = LIVE_UPDATES_ACTIVE.value;
  const rebuildStatus = REBUILD_STATUS.value;
  const lastUpdatedAt = LAST_UPDATED_AT.value;
  const errorMessage = LAST_REBUILD_ERROR.value;

  let buildClass: BuildClass;
  let detailText: string;
  switch (rebuildStatus) {
    case RebuildStatus.Rebuilding:
      buildClass = BuildClass.Rebuilding;
      detailText = DETAIL_TEXT.rebuilding;
      break;
    case RebuildStatus.Decorating:
      buildClass = BuildClass.Rebuilding;
      detailText = DETAIL_TEXT.decorating;
      break;
    case RebuildStatus.Error:
      buildClass = BuildClass.Error;
      detailText = errorMessage ? `error: ${errorMessage}` : DETAIL_TEXT.error;
      break;
    default: // Idle
      buildClass = BuildClass.Ready;
      detailText =
        lastUpdatedAt > 0 ? formatRelativeAgeShort(lastUpdatedAt, Date.now()) : DETAIL_TEXT.ready;
  }

  const liveClass = liveEnabled ? LiveClass.Live : LiveClass.Paused;

  const liveLabel = `Auto-refresh: ${liveEnabled ? 'on' : 'off'}`;
  let titleText: string;
  if (rebuildStatus === RebuildStatus.Error && errorMessage) {
    titleText = `${liveLabel} · error: ${errorMessage}`;
  } else if (rebuildStatus === RebuildStatus.Idle && lastUpdatedAt > 0) {
    titleText = `${liveLabel} · rebuilt ${detailText}`;
  } else if (rebuildStatus === RebuildStatus.Rebuilding) {
    titleText = `${liveLabel} · ${DETAIL_TEXT.rebuilding}`;
  } else {
    titleText = liveLabel;
  }

  return (
    <span
      class={`freshness-status ${buildClass} ${liveClass}`}
      role="status"
      title={titleText}
      aria-label={titleText}
    >
      <span class="dot freshness-status-dot" aria-hidden="true" />
      <span class="freshness-status-detail">{detailText}</span>
    </span>
  );
}
