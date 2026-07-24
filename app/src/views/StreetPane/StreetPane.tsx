// views/StreetPane/StreetPane.tsx — right-sidebar pane shown when a directory
// (road) is selected. Shows the subtree's activity-date span and its
// composition as a ranked by-extension bar list (each bar an extension's share
// of the directory's files). Path orientation lives in the app-header
// breadcrumb and tree navigation in the Explore sidebar — this pane answers
// "what is this neighborhood made of".
//
// A Preact function component reading a `state` signal prop (the selected
// directory); RightSidebar swaps panes by switching which one it renders.

import './StreetPane.css';
import type { ReadonlySignal } from '@preact/signals';
import type { DirNode, ExtBreakdownEntry } from '@/types';
import { Pane, PaneEmpty } from '@/components/Pane';
import { TimelineStaleNote } from '@/components/TimelineStaleNote/TimelineStaleNote';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { Route, FileType, CalendarRange } from 'lucide-preact';
import { ExtensionBadge } from '@/components/Badge/Badge';
import { PathBreadcrumbs } from '@/components/PathBreadcrumbs/PathBreadcrumbs';
import { nodeUrl } from '@/utils/commit';
import { extHueColor } from '@/city/components/buildings/color';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { pluralize } from '@/utils/format';
import { ROOT_PATH } from '@/constants/manifest';
import { extBarPct, extShareLabel, extTypeLabel, streetDateRange } from './streetStats';

// ── State shape for Preact component ─────────────────────────────────────────

export interface StreetPaneState {
  directory: DirNode | null;
  /** Repo label + root path, for the header path breadcrumb. */
  rootLabel?: string;
  rootPath?: string;
  /** Repo remote URL + branch, for the header open-on-origin link. */
  remoteUrl?: string | null;
  branch?: string;
  /** In Timeline mode the folder stats are the union (all-time), not the scrubbed
   *  commit — show a note saying so. */
  inTimeline?: boolean;
}

export interface StreetPaneProps {
  state: ReadonlySignal<StreetPaneState>;
  onClose?: () => void;
  onFocus?: (dir: DirNode) => void;
  onExclude?: (dir: DirNode) => void;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function StreetPane({ state, onClose, onFocus, onExclude }: StreetPaneProps) {
  const {
    directory: d,
    rootLabel = '',
    rootPath = '',
    remoteUrl,
    branch = '',
    inTimeline,
  } = state.value;

  if (!d) {
    return (
      <Pane
        paneClass="street-pane"
        title="Road"
        onClose={onClose}
        bodyClass="street-body pane-inset"
      >
        <PaneEmpty
          icon={Route}
          title="No road selected"
          sub="Select a road in the city to inspect it here."
        />
      </Pane>
    );
  }

  const dirPath = d.path ?? '';

  // Backend-computed (api/scan.py), sorted by count desc. Guard against a
  // manifest that predates the field (stale cache / skeleton / in-flight) so a
  // missing breakdown renders without the section instead of crashing the pane.
  const stats = d.descendants_ext_breakdown ?? [];
  // Total descendant files — each bar's width is its extension's share of this.
  const total = stats.reduce((n, s) => n + s.count, 0);
  const dateRange = streetDateRange(d.descendants_created_min, d.descendants_modified_max);

  return (
    <Pane
      paneClass="street-pane"
      titleSlot={<PathBreadcrumbs path={dirPath} isDir rootLabel={rootLabel} rootPath={rootPath} />}
      mono
      onFocus={typeof onFocus === 'function' ? () => onFocus(d) : undefined}
      focusTitle={`Focus the camera on this road (${KEY_BINDINGS.FOCUS_SELECTION.label})`}
      copyText={dirPath && dirPath !== ROOT_PATH ? dirPath : rootPath}
      copyLabel="Copy path"
      openUrl={
        remoteUrl && dirPath && dirPath !== ROOT_PATH
          ? nodeUrl(remoteUrl, branch, dirPath, true)
          : null
      }
      openLabel="Open folder on origin"
      onClose={onClose}
      onExclude={
        typeof onExclude === 'function' && d.path && d.path !== ROOT_PATH
          ? () => onExclude(d)
          : undefined
      }
      excludeTitle="Exclude this road from the city"
      bodyClass={`street-body${inTimeline ? ' has-stale-note' : ''}`}
    >
      {inTimeline && (
        <TimelineStaleNote>
          All-time folder stats, not based on the timeline commit.
        </TimelineStaleNote>
      )}
      <div class="street-content pane-inset">
        {dateRange && (
          <div class="street-dates" title="Oldest file created → newest change">
            <CalendarRange class="icon street-dates-icon" aria-hidden="true" />
            {dateRange}
          </div>
        )}
        {stats.length > 0 && (
          <>
            <div class="street-ext-h text-label">
              <FileType class="icon street-ext-icon" aria-hidden="true" />
              By extension
            </div>
            <div class="street-ext-list">
              {stats.map((s) => (
                <StreetExtRow key={s.ext ?? ''} s={s} total={total} />
              ))}
            </div>
          </>
        )}
      </div>
    </Pane>
  );
}

// One ranked extension row: badge · proportional bar · "share · count". The fill
// width is this extension's share of the directory's files; its hue matches the
// badge + the city's buildings (live theme palette). The badge identifies the
// type; the bar's title names it in full ("TypeScript (.ts)"), which the 4-char
// badge can't.
function StreetExtRow({ s, total }: { s: ExtBreakdownEntry; total: number }) {
  const pct = extBarPct(s.count, total);
  const share = extShareLabel(s.count, total);
  return (
    <div class="street-ext-row">
      <ExtensionBadge extension={s.ext} isDir={false} />
      <div class="street-ext-track" title={extTypeLabel(s.ext)}>
        <span
          class="street-ext-fill"
          aria-hidden="true"
          style={{ width: `${pct}%`, background: extHueColor(s.ext, BUILDINGS.value.HUE_EXT_MAP) }}
        />
      </div>
      <span class="street-ext-meta" aria-label={`${share}, ${pluralize(s.count, 'file')}`}>
        {share} · {s.count}
      </span>
    </div>
  );
}
