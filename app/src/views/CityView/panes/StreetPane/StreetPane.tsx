// views/StreetPane/StreetPane.tsx — the pane for a selected road: its subtree's
// date span and what it is made of, ranked by extension. Where you are lives in
// the breadcrumb, so this answers what the neighbourhood is made of.

import './StreetPane.css';
import type { ReadonlySignal } from '@preact/signals';
import { NodeKind } from '@/types';
import type { DirNode, ExtBreakdownEntry } from '@/types';
import { Pane } from '@/components/panes/Pane/Pane';
import { PaneEmpty } from '@/components/panes/PaneEmpty/PaneEmpty';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { Route, FileType, CalendarRange, FolderX } from 'lucide-preact';
import { KindBadge } from '@/components/nodes/KindBadge/KindBadge';
import { PaneStats } from '@/components/panes/PaneStats/PaneStats';
import { directoryStatItems } from '@/components/panes/PaneStats/statItems';
import { PathBreadcrumbs } from '@/components/panes/PathBreadcrumbs/PathBreadcrumbs';
import { nodeUrl } from '@/utils/remoteUrls';
import { extHueColor } from '@/city/components/buildings/color';
import { BUILDINGS } from '@/state/settings/fields/buildings';
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
  /** Gone by the scrubbed commit. Every figure here would be the union's
   *  all-time one, which is worse than none, so the body says only that. */
  isAbsent?: boolean;
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
    isAbsent,
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

  // Backend-computed and sorted. Guarded, so a manifest predating the field
  // renders without the section instead of taking the pane down.
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
        remoteUrl && !isAbsent && dirPath && dirPath !== ROOT_PATH
          ? nodeUrl(remoteUrl, branch, dirPath, true)
          : null
      }
      openLabel="Open folder on origin"
      onClose={onClose}
      onExclude={typeof onExclude === 'function' ? () => onExclude(d) : undefined}
      excludeTitle="Exclude this road from the city"
      excludeDisabledReason={
        d.path && d.path !== ROOT_PATH
          ? undefined
          : 'Excluding the project root would leave nothing to look at'
      }
      bodyClass="street-body"
      footerSlot={isAbsent ? null : <PaneStats items={directoryStatItems(d)} />}
    >
      {isAbsent ? (
        <PaneEmpty icon={FolderX} title="Directory not available" modifier="empty-state--absent" />
      ) : (
        <>
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
        </>
      )}
    </Pane>
  );
}

// One extension: badge, a bar of its share, then share and count. The bar's
// title names the type in full, which a four-character badge can't.
function StreetExtRow({ s, total }: { s: ExtBreakdownEntry; total: number }) {
  const pct = extBarPct(s.count, total);
  const share = extShareLabel(s.count, total);
  return (
    <div class="street-ext-row">
      <KindBadge kind={NodeKind.File} extension={s.ext} />
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
