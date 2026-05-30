// views/panes/streetPane.ts — right-sidebar pane shown when a directory
// (road) is selected in the city. Shows direct + descendant child
// counts and a sorted breakdown of every file extension in the
// descendant subtree.
//
// API matches commitPane's shape (build once, push selection via
// setDirectory) so the coordinator can swap panes in the right sidebar
// without churn.

import { NodeKind } from '@/types';
import type { DirNode, FileNode, TreeNode } from '@/types';
import { makeLucideIcon } from '@/views/components/icon.js';
import { buildPaneHeader } from '@/views/shell/paneHeader.js';
import { makeExtensionBadge } from '@/views/components/badge.js';
import { ASPHALT, BUILDING_PALETTE } from '@/config';

interface BuildStreetPaneOpts {
  onClose?: () => void;
  /** Called when the user clicks the focus button in the pane header.
   *  Equivalent of pressing F on the canvas with the current dir selected. */
  onFocus?: (dir: DirNode) => void;
}

interface ExtensionStats {
  ext: string;
  count: number;
  size: number;
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

function formatBytes(n: number): string {
  if (n < BYTES_PER_KB) return `${n} B`;
  if (n < BYTES_PER_MB) return `${(n / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(n / BYTES_PER_MB).toFixed(1)} MB`;
}

/** Walk a directory's descendant subtree and aggregate by extension.
 *  Treats missing/empty extension as '(none)'. */
function aggregateExtensions(d: DirNode): ExtensionStats[] {
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
  return Array.from(byExt, ([ext, v]) => ({ ext, ...v })).sort((a, b) => b.count - a.count);
}

export function buildStreetPane(opts: BuildStreetPaneOpts = {}) {
  const pane = document.createElement('div');
  pane.className = 'pane street-pane';

  let _activeDir: DirNode | null = null;

  const { el: header, api: headerApi } = buildPaneHeader({
    title: 'Road',
    onClose: opts.onClose,
    onFocus: opts.onFocus
      ? () => {
          if (_activeDir) opts.onFocus!(_activeDir);
        }
      : undefined,
    focusTitle: 'Focus the camera on this road (F)',
  });
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pane-body street-body';
  pane.appendChild(body);

  function _renderEmpty(): void {
    _activeDir = null;
    headerApi.setFocusEnabled(false);
    headerApi.setTitle('Road');
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'empty-state empty-state--lg';
    box.appendChild(makeLucideIcon('route'));
    const h = document.createElement('p');
    h.className = 'text-card-title';
    h.textContent = 'No road selected';
    box.appendChild(h);
    const sub = document.createElement('p');
    sub.className = 'text-card-sub';
    sub.textContent = 'Select a road in the city to inspect it here.';
    box.appendChild(sub);
    body.appendChild(box);
  }

  function _renderDir(d: DirNode): void {
    _activeDir = d;
    headerApi.setFocusEnabled(true);
    const leaf =
      (d.path && d.path !== '.' ? d.path.split('/').filter(Boolean).pop() : null) ||
      d.name ||
      'Road';
    headerApi.setTitle(leaf);
    body.replaceChildren();

    // Counts block
    const counts = document.createElement('div');
    counts.className = 'street-counts';

    // Each row renders as "<count> <label>" so regex patterns like /2.*files/i
    // and /1.*dirs?/i in tests can match the plain textContent.
    function makeCol(label: string, rows: Array<[string, string]>): HTMLElement {
      const col = document.createElement('div');
      col.className = 'street-counts-col';
      const h = document.createElement('div');
      h.className = 'street-counts-h';
      h.textContent = label;
      col.appendChild(h);
      for (const [v, k] of rows) {
        const row = document.createElement('div');
        row.className = 'street-counts-row';
        const vEl = document.createElement('span');
        vEl.className = 'street-counts-v';
        vEl.textContent = v;
        const kEl = document.createElement('span');
        kEl.className = 'street-counts-k';
        kEl.textContent = k;
        row.appendChild(vEl);
        row.appendChild(kEl);
        col.appendChild(row);
      }
      return col;
    }

    counts.appendChild(
      makeCol('Direct', [
        [String(d.children_file_count ?? 0), 'files'],
        [String(d.children_dir_count ?? 0), 'dirs'],
      ])
    );
    counts.appendChild(
      makeCol('Descendants', [
        [String(d.descendants_file_count ?? 0), 'files'],
        [String(d.descendants_dir_count ?? 0), 'dirs'],
      ])
    );
    body.appendChild(counts);

    // By extension
    const stats = aggregateExtensions(d);
    if (stats.length > 0) {
      const h = document.createElement('div');
      h.className = 'street-ext-h';
      h.textContent = 'By extension';
      body.appendChild(h);
      const list = document.createElement('div');
      list.className = 'street-ext-list';
      const huePalette = BUILDING_PALETTE.get().HUE_EXT_MAP || {};
      const asphaltColor = ASPHALT.get().COLOR;
      for (const s of stats) {
        const row = document.createElement('div');
        row.className = 'street-ext-row';
        const badgeExt = s.ext === '(none)' ? null : s.ext;
        row.appendChild(makeExtensionBadge(badgeExt, false, huePalette, asphaltColor));
        const label = document.createElement('span');
        label.className = 'street-ext-label';
        label.textContent = s.ext;
        row.appendChild(label);
        const count = document.createElement('span');
        count.className = 'street-ext-count';
        count.textContent = `${s.count} file${s.count === 1 ? '' : 's'}`;
        row.appendChild(count);
        const sep = document.createElement('span');
        sep.className = 'street-ext-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '·';
        row.appendChild(sep);
        const size = document.createElement('span');
        size.className = 'street-ext-size';
        size.textContent = formatBytes(s.size);
        row.appendChild(size);
        list.appendChild(row);
      }
      body.appendChild(list);
    }
  }

  function setDirectory(d: DirNode | null): void {
    if (!d) {
      _renderEmpty();
      return;
    }
    _renderDir(d);
  }

  setDirectory(null);

  return {
    pane,
    api: { setDirectory },
  };
}
