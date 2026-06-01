// views/StreetPane.tsx — right-sidebar pane shown when a directory
// (road) is selected in the city. Shows direct + descendant child
// counts and a sorted breakdown of every file extension in the
// descendant subtree.
//
// API matches commitPane's shape (build once, push selection via
// setDirectory) so the coordinator can swap panes in the right sidebar
// without churn.

import type { Signal } from '@preact/signals';
import type { DirNode, ExtBreakdownEntry } from '@/types';
import { Pane, PaneEmpty } from '@/components/Pane';
import { Route } from 'lucide-preact';
import { ExtensionBadge } from '@/components/Badge';
import { formatBytes } from '@/utils/bytes';
import { STREETS, BUILDINGS } from '@/state/stores/settings';

// ── State shape for Preact component ─────────────────────────────────────────

export interface StreetPaneState {
  directory: DirNode | null;
}

export interface StreetPaneProps {
  state: Signal<StreetPaneState>;
  onClose?: () => void;
  onFocus?: (dir: DirNode) => void;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function StreetPane({ state, onClose, onFocus }: StreetPaneProps) {
  const { directory: d } = state.value;
  const huePalette = BUILDINGS.value.HUE_EXT_MAP || {};
  const asphaltColor = STREETS.value.ASPHALT_COLOR;

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

  const leaf =
    (d.path && d.path !== '.' ? d.path.split('/').filter(Boolean).pop() : null) ||
    d.name ||
    'Road';

  // Backend-computed (api/scan.py). Guard against a manifest that predates
  // the field (stale cache / skeleton / in-flight) so a missing breakdown
  // renders an empty section instead of crashing the pane.
  const stats = d.descendants_ext_breakdown ?? [];

  return (
    <Pane
      paneClass="street-pane"
      title={leaf}
      onFocus={typeof onFocus === 'function' ? () => onFocus(d) : undefined}
      focusTitle="Focus the camera on this road (F)"
      onClose={onClose}
      bodyClass="street-body"
    >
        <div class="street-counts">
          <div class="street-counts-col">
            <div class="street-counts-h">Direct</div>
            <div class="street-counts-row">
              <span class="street-counts-v">{String(d.children_file_count ?? 0)}</span>
              <span class="street-counts-k">files</span>
            </div>
            <div class="street-counts-row">
              <span class="street-counts-v">{String(d.children_dir_count ?? 0)}</span>
              <span class="street-counts-k">dirs</span>
            </div>
          </div>
          <div class="street-counts-col">
            <div class="street-counts-h">Descendants</div>
            <div class="street-counts-row">
              <span class="street-counts-v">{String(d.descendants_file_count ?? 0)}</span>
              <span class="street-counts-k">files</span>
            </div>
            <div class="street-counts-row">
              <span class="street-counts-v">{String(d.descendants_dir_count ?? 0)}</span>
              <span class="street-counts-k">dirs</span>
            </div>
          </div>
        </div>
        {stats.length > 0 && (
          <>
            <div class="street-ext-h">By extension</div>
            <div class="street-ext-list">
              {stats.map((s) => (
                <StreetExtRow
                  key={s.ext}
                  s={s}
                  huePalette={huePalette}
                  asphaltColor={asphaltColor}
                />
              ))}
            </div>
          </>
        )}
    </Pane>
  );
}

function StreetExtRow({
  s,
  huePalette,
  asphaltColor,
}: {
  s: ExtBreakdownEntry;
  huePalette: Record<string, number>;
  asphaltColor: string;
}) {
  const badgeExt = s.ext === '(none)' ? null : s.ext;
  return (
    <div class="street-ext-row">
      <ExtensionBadge
        extension={badgeExt}
        isDir={false}
        huePalette={huePalette}
        asphaltColor={asphaltColor}
      />
      <span class="street-ext-label">{s.ext}</span>
      <span class="street-ext-count">{`${s.count} file${s.count === 1 ? '' : 's'}`}</span>
      <span class="street-ext-sep" aria-hidden="true">·</span>
      <span class="street-ext-size">{formatBytes(s.size)}</span>
    </div>
  );
}
