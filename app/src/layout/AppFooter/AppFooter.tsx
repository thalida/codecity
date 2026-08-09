// layout/AppFooter.tsx — Sitewide bottom status bar. Two sections:
//   left   — what is running: [dot] detail-text, the build version, and the
//            debug-tools button when debug mode is on.
//            One dot, two channels of state:
//              color    — rebuild state (green=idle, yellow=rebuilding,
//                         red=error)
//              animation — live state (slow heartbeat when polling on,
//                         static when paused, fast pulse when rebuilding,
//                         static when error)
//            A detail <span> next to the dot shows human-readable status
//            ("rebuilt 5s ago", "rebuilding…", "error: <msg>", "paused").
//            title= on the wrapper is a fallback tooltip for narrow widths.
//   right  — authorship credit.
//
// Per-node stats live in the selection pane's own footer (<PaneStats>), beside
// the file or road they describe. About and the shortcuts button live in the
// app header.

import './AppFooter.css';
import { Bug } from 'lucide-preact';
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
import { openDebug } from '@/state/stores/ui';
import { isDebugMode } from '@/utils/debugMode';
import { FooterSep } from './FooterSep';
import { MetaVersion, MetaCredit } from '@/components/AppMeta/AppMeta';

export interface FooterStatus {
  /** True when live-poll is active; renders as `live`. False renders as `paused`. */
  liveEnabled: boolean;
  /** The current world-rebuild status; shared type from `state/stores/manifest.ts`. */
  rebuildStatus: RebuildStatus;
  /** Epoch millis of the most recent successful rebuild; 0 ⇒ unknown. */
  lastUpdatedAt: number;
  /** Surfaced as the indicator's `title` (hover tooltip) when rebuildStatus is Error. */
  errorMessage: string | null;
}

// ── Preact component ─────────────────────────────────────────────────────────

interface FooterStatusSectionProps {
  status: FooterStatus | null;
}

// CSS modifier classes for the combined status dot/detail (see AppFooter.css).
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

function FooterStatusSection({ status }: FooterStatusSectionProps) {
  if (!status) return <span class="app-footer-status" />;

  let buildClass: BuildClass;
  let detailText: string;
  switch (status.rebuildStatus) {
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
      detailText = status.errorMessage ? `error: ${status.errorMessage}` : DETAIL_TEXT.error;
      break;
    default: // Idle
      buildClass = BuildClass.Ready;
      detailText =
        status.lastUpdatedAt > 0
          ? formatRelativeAgeShort(status.lastUpdatedAt, Date.now())
          : DETAIL_TEXT.ready;
  }

  const liveClass = status.liveEnabled ? LiveClass.Live : LiveClass.Paused;

  // Compose hover tooltip
  const liveLabel = `Auto-refresh: ${status.liveEnabled ? 'on' : 'off'}`;
  let titleText: string;
  if (status.rebuildStatus === RebuildStatus.Error && status.errorMessage) {
    titleText = `${liveLabel} · error: ${status.errorMessage}`;
  } else if (status.rebuildStatus === RebuildStatus.Idle && status.lastUpdatedAt > 0) {
    titleText = `${liveLabel} · rebuilt ${detailText}`;
  } else if (status.rebuildStatus === RebuildStatus.Rebuilding) {
    titleText = `${liveLabel} · ${DETAIL_TEXT.rebuilding}`;
  } else {
    titleText = liveLabel;
  }

  return (
    <span
      class={`app-footer-status ${buildClass} ${liveClass}`}
      role="status"
      title={titleText}
      aria-label={titleText}
    >
      <span class="dot app-footer-status-dot" aria-hidden="true" />
      <span class="app-footer-status-detail">{detailText}</span>
    </span>
  );
}

// ── Self-reading AppFooter component ────────────────────────────────────────
// Reads its status signals directly; no props needed when mounted from App.tsx. A 1-second tick signal drives the relative-age text.

export function AppFooter() {
  // 1-second tick so relative timestamps ("5s ago") advance smoothly.
  // useSignal creates a component-local signal; writing it triggers a
  // fine-grained re-render of only this component.
  const tick = useSignal(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      tick.value = tick.peek() + 1;
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Status — reads all four status signals (auto-tracked in render)
  void tick.value; // ensure 1-second re-renders for relative timestamps
  const status: FooterStatus = {
    liveEnabled: LIVE_UPDATES_ACTIVE.value,
    rebuildStatus: REBUILD_STATUS.value,
    lastUpdatedAt: LAST_UPDATED_AT.value,
    errorMessage: LAST_REBUILD_ERROR.value,
  };

  return (
    <footer id="app-footer" class="surface-chrome">
      <div class="app-footer-section app-footer-left">
        <FooterStatusSection status={status} />
        <FooterSep />
        <MetaVersion />
        {isDebugMode() && (
          <button
            type="button"
            class="btn-icon btn-icon--sm"
            title="Debug tools"
            aria-label="Debug tools"
            onClick={openDebug}
          >
            <Bug class="icon" />
          </button>
        )}
      </div>
      <div class="app-footer-section app-footer-right">
        <MetaCredit linkClass="link--chrome" />
      </div>
    </footer>
  );
}
