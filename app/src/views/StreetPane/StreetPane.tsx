// views/StreetPane/StreetPane.tsx — right-sidebar pane shown when a directory
// (road) is selected. Leads with the subtree's composition: a one-line summary
// (totals + dominant language), a ranked by-extension bar list, then a local
// structure line. Path orientation lives in the app-header breadcrumb and tree
// navigation in the Explore sidebar — this pane answers "what is this
// neighborhood made of".
//
// A Preact function component reading a `state` signal prop (the selected
// directory); RightSidebar swaps panes by switching which one it renders.

import './StreetPane.css';
import type { ReadonlySignal } from '@preact/signals';
import type { DirNode, ExtBreakdownEntry } from '@/types';
import { Pane, PaneEmpty } from '@/components/Pane';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { Route } from 'lucide-preact';
import { ExtensionBadge } from '@/components/Badge/Badge';
import { getHue } from '@/city/components/buildings/color';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { formatBytes } from '@/utils/bytes';
import { pluralize } from '@/utils/format';
import { streetSummary, extBarPct } from './streetStats';

// ── State shape for Preact component ─────────────────────────────────────────

export interface StreetPaneState {
  directory: DirNode | null;
}

export interface StreetPaneProps {
  state: ReadonlySignal<StreetPaneState>;
  onClose?: () => void;
  onFocus?: (dir: DirNode) => void;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function StreetPane({ state, onClose, onFocus }: StreetPaneProps) {
  const { directory: d } = state.value;

  if (!d) {
    return (
      <Pane paneClass="street-pane" title="Road" onClose={onClose} bodyClass="street-body">
        <PaneEmpty
          icon={Route}
          title="No road selected"
          sub="Select a road in the city to inspect it here."
        />
      </Pane>
    );
  }

  const path = d.path && d.path !== '.' ? d.path : '';
  const leaf = (path ? path.split('/').filter(Boolean).pop() : null) || d.name || 'Road';

  // Backend-computed (api/scan.py), sorted by count desc. Guard against a
  // manifest that predates the field (stale cache / skeleton / in-flight) so a
  // missing breakdown renders without the section instead of crashing the pane.
  const stats = d.descendants_ext_breakdown ?? [];
  const maxCount = stats.length > 0 ? stats[0].count : 0;
  const summary = streetSummary(d);

  return (
    <Pane
      paneClass="street-pane"
      prefixSlot={<ExtensionBadge extension={null} isDir />}
      titleSlot={<span title={path || undefined}>{leaf}</span>}
      mono
      onFocus={typeof onFocus === 'function' ? () => onFocus(d) : undefined}
      focusTitle={`Focus the camera on this road (${KEY_BINDINGS.FOCUS_SELECTION.label})`}
      onClose={onClose}
      bodyClass="street-body"
    >
      <div class="street-summary">
        <span class="street-summary-totals">{summary.totals}</span>
        {summary.language && <span class="street-summary-lang"> — mostly {summary.language}</span>}
      </div>
      {stats.length > 0 && (
        <>
          <div class="street-ext-h">By extension</div>
          <div class="street-ext-list">
            {stats.map((s) => (
              <StreetExtRow key={s.ext} s={s} maxCount={maxCount} />
            ))}
          </div>
        </>
      )}
    </Pane>
  );
}

// One ranked extension row: badge · proportional bar (count inside) · byte size.
// The fill width is count-relative to the busiest extension; its hue matches the
// badge + the city's buildings (live theme palette). The badge identifies the
// type; the row's title holds the exact extension, which the 4-char badge (and
// the generic "(none)" badge) can't always show in full.
function StreetExtRow({ s, maxCount }: { s: ExtBreakdownEntry; maxCount: number }) {
  const badgeExt = s.ext === '(none)' ? null : s.ext;
  const hue = getHue(s.ext === '(none)' ? '' : s.ext, BUILDINGS.value.HUE_EXT_MAP);
  const pct = extBarPct(s.count, maxCount);
  return (
    <div class="street-ext-row" title={s.ext}>
      <ExtensionBadge extension={badgeExt} isDir={false} />
      <div class="street-ext-track">
        <span
          class="street-ext-fill"
          aria-hidden="true"
          style={{ width: `${pct}%`, background: `hsl(${hue}, 60%, 35%)` }}
        />
        <span class="street-ext-count" aria-label={pluralize(s.count, 'file')}>
          {s.count}
        </span>
      </div>
      <span class="street-ext-size">{formatBytes(s.size)}</span>
    </div>
  );
}
