// components/menus/ScanMenu/FreshnessStatus/FreshnessStatus.tsx — how fresh the loaded city is.
// One dot, two channels: colour = rebuild state, animation = live state.
// Hook and markup are split because the scan menu's trigger needs the same
// derived state for its accessible name, and two 1s ticks would drift apart.

import './FreshnessStatus.css';
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { formatRelativeAgeShort } from '@/utils/dates';
import { LIVE_UPDATES_ACTIVE } from '@/state/settings/values/updates';
import { CityLifecycle } from '@codecity/city';
import { CITY_STATUS, HOST_WORK, LAST_UPDATED_AT, REBUILD_DETAIL } from '@/state/stores/progress';

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
  // An exception message is for the console, not the chrome: it names our
  // internals and tells a user nothing they can act on.
  error: "couldn't render",
  // Guard for unit tests / any path that reads status before LAST_UPDATED_AT
  // is seeded.
  ready: 'ready',
} as const;

export interface Freshness {
  /** Rebuild-state and live-state modifier classes for the dot. */
  stateClass: string;
  /** The short line beside the dot ("5s ago", "rebuilding…"). */
  detailText: string;
  /** The long form, for a tooltip or an accessible name. */
  titleText: string;
}

/** Derive the freshness readout, ticking once a second so relative timestamps
 *  ("5s ago") advance smoothly. */
export function useFreshness(): Freshness {
  // useSignal is component-local, so writing it re-renders only its owner.
  const tick = useSignal(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      tick.value = tick.peek() + 1;
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  void tick.value;

  const liveEnabled = LIVE_UPDATES_ACTIVE.value;
  const status = CITY_STATUS.value;
  const lastUpdatedAt = LAST_UPDATED_AT.value;
  const failure = status.error ?? HOST_WORK.value.error;
  const errorMessage = failure instanceof Error ? failure.message : null;
  const rebuildDetail = REBUILD_DETAIL.value;
  const host = HOST_WORK.value;
  // Working, by either account: the city is doing something, or this app is —
  // a Save answered in place, or a bundle it is fetching itself.
  const working = status.phase !== null || host.busy;
  const failed = status.lifecycle === CityLifecycle.Error || host.error !== null;

  let buildClass: BuildClass;
  let detailText: string;
  if (failed) {
    buildClass = BuildClass.Error;
    detailText = DETAIL_TEXT.error;
  } else if (working) {
    buildClass = BuildClass.Rebuilding;
    // A rebuild with nothing else on screen to report it (Timeline refetching
    // its bundle under an exclude edit) carries its stage here.
    detailText = rebuildDetail
      ? `${DETAIL_TEXT.rebuilding} ${rebuildDetail}`
      : DETAIL_TEXT.rebuilding;
  } else {
    buildClass = BuildClass.Ready;
    detailText =
      lastUpdatedAt > 0 ? formatRelativeAgeShort(lastUpdatedAt, Date.now()) : DETAIL_TEXT.ready;
  }

  const liveLabel = `Auto-refresh: ${liveEnabled ? 'on' : 'off'}`;
  let titleText: string;
  if (failed && errorMessage) {
    titleText = `${liveLabel} · error: ${errorMessage}`;
  } else if (!working && !failed && lastUpdatedAt > 0) {
    titleText = `${liveLabel} · rebuilt ${detailText}`;
  } else if (working) {
    // No stage tail here: ScanMenu announces this string from a live region,
    // and a count ticking every few hundred ms would talk over everything else.
    titleText = `${liveLabel} · ${DETAIL_TEXT.rebuilding}`;
  } else {
    titleText = liveLabel;
  }

  return {
    stateClass: `${buildClass} ${liveEnabled ? LiveClass.Live : LiveClass.Paused}`,
    detailText,
    titleText,
  };
}

/** No role and no title: it renders inside the scan menu's trigger, which owns
 *  both the accessible name and the live region that announces changes. */
export function FreshnessStatus({ freshness }: { freshness: Freshness }) {
  return (
    <span class={`freshness-status ${freshness.stateClass}`}>
      <span class="dot freshness-status-dot" aria-hidden="true" />
      <span class="freshness-status-detail">{freshness.detailText}</span>
    </span>
  );
}
