// views/panes/streetPane.tsx — right-sidebar pane shown when a directory
// (road) is selected in the city. Shows direct + descendant child
// counts and a sorted breakdown of every file extension in the
// descendant subtree.
//
// API matches commitPane's shape (build once, push selection via
// setDirectory) so the coordinator can swap panes in the right sidebar
// without churn.

import type { Signal } from '@preact/signals';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, TreeNode } from '@/types';
import { Pane, PaneEmpty } from '@/views/components/Pane';
import { ExtensionBadge } from '@/views/components/Badge';
import { formatBytes } from '@/utils/bytes';
import { ASPHALT, BUILDING_PALETTE } from '@/state/settings';

interface ExtensionStats {
  ext: string;
  count: number;
  size: number;
}

/** Walk a directory's descendant subtree and aggregate by extension.
 *  Treats missing/empty extension as '(none)'.
 *
 *  Memoized by the DirNode reference. A fresh manifest produces fresh
 *  node objects, so a manifest swap implicitly invalidates the cache;
 *  re-selecting the same directory in the same manifest is O(1). */
const _aggCache = new WeakMap<DirNode, ExtensionStats[]>();

function aggregateExtensions(d: DirNode): ExtensionStats[] {
  const hit = _aggCache.get(d);
  if (hit) return hit;
  const byExt = new Map<string, { count: number; size: number }>();
  function walk(node: TreeNode): void {
    if (node.type === NodeKind.File) {
      const ext = ((node as FileNode).extension || '(none)').toLowerCase();
      const cur = byExt.get(ext) || { count: 0, size: 0 };
      cur.count += 1;
      cur.size += (node as FileNode).size || 0;
      byExt.set(ext, cur);
      return;
    }
    if (node.type === NodeKind.Directory) {
      const kids = (node as DirNode).children || [];
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    }
  }
  walk(d);
  const result = Array.from(byExt, ([ext, v]) => ({ ext, ...v })).sort((a, b) => b.count - a.count);
  _aggCache.set(d, result);
  return result;
}

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
  const huePalette = BUILDING_PALETTE.value.HUE_EXT_MAP || {};
  const asphaltColor = ASPHALT.value.COLOR;

  if (!d) {
    return (
      <Pane paneClass="street-pane" title="Road" onClose={onClose} bodyClass="street-body">
        <PaneEmpty
          icon="route"
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

  const stats = aggregateExtensions(d);

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
  s: ExtensionStats;
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
