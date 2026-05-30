// views/shell/leftSidebar.js — Mounts the left-side activity bar
// (VSCode-style) and the stacked panes it switches between. Owns:
//   - active-tab state
//   - collapsed/expanded state (clicking the active icon collapses; the ×
//     in the panel header also collapses; persisted in localStorage)
//   - drag-to-resize handle on the sidebar's right edge (also persisted)

import { buildTreePane } from '@/views/panes/treePane.js';
import { buildInfoPane } from '@/views/panes/infoPane.js';
import { buildControlsPane } from '@/views/panes/controlsPane.js';
import { buildSearchPane } from '@/views/panes/searchPane.js';
import { ACTIVITY_BAR_TABS, DOM_IDS, LUCIDE_ICON_BASE_URL, STORAGE_KEYS } from '@/constants';
import { SidebarTab } from '@/types';
import type { DirNode, Manifest, TreeNode } from '@/types';
import { loadFlag, saveFlag } from '@/utils/localFlag.js';

const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 600;

interface ShowLeftSidebarOpts {
  /** fn() the Settings UI used to call after every input edit. Now driven by config/hotReload.js subscriptions when the user clicks Save; this option is accepted for caller compatibility but is no longer forwarded to the controls panel. */
  applyTheme?: () => void;
  /** fn() called when the user clicks the "Run collision check" debug button. */
  onRunCollisionCheck?: () => void;
  /** fn() called when the user clicks the "Diagnose stem placement" debug button. */
  onRunStemDiagnostic?: () => void;
  /** Initial active tab. Defaults to SidebarTab.Tree. */
  initialTab?: SidebarTab;
  /** fn(node) called when the user single-clicks a tree row. */
  onTreeSelect?: (node: TreeNode) => void;
  /** fn(node) called when the user double-clicks a tree row. */
  onTreeFocus?: (node: TreeNode) => void;
  /** fn(node) on row mouseenter. */
  onTreeHover?: (node: TreeNode) => void;
  /** fn(node) on row mouseleave. */
  onTreeHoverEnd?: (node: TreeNode) => void;
  /** fn(path) when the user single-clicks a search result. Host routes to picker.selectByPath. */
  onSearchSelect?: (path: string) => void;
  /** fn(path) when the user double-clicks a search result. Host routes to rig.focusBuilding. */
  onSearchFocus?: (path: string) => void;
  /** Older callback kept accepted for compatibility with coordinator callsites. */
  onResetView?: () => void;
}

// showLeftSidebar(manifest, opts) -> { setSelectedTreePath, setHoveredTreePath }
//
// opts:
//   applyTheme        — fn() the Settings UI used to call after every input edit.
//                       Now driven by config/hotReload.js subscriptions when the
//                       user clicks Save; accepted for caller compatibility but no
//                       longer forwarded to the controls panel.
//   initialTab        — 'tree' | 'controls' (default 'tree')
//   onTreeSelect      — fn(node) called when the user single-clicks a tree row.
//                       Host wires to _setSelection so tree → city selection
//                       flows through the same channel as a canvas click.
//   onTreeFocus       — fn(node) called when the user double-clicks a tree row.
//                       Host wires to _focusOnBuilding/_focusOnStreet.
//   onTreeHover       — fn(node) on row mouseenter. Host wires to _setHover
//                       so hovering a tree row mirrors into the scene.
//   onTreeHoverEnd    — fn(node) on row mouseleave. Host calls _setHover(null).
//
// Returns an api the host uses to drive the REVERSE direction (city → tree):
//   setSelectedTreePath(path) — keep tree highlight in sync with scene
//                               currentSelection.
//   setHoveredTreePath(path)  — mirror scene hover state to the tree row.
//
// (No onResetView callback: the Controls panel's View section shows a
// kbd table with R/Esc/etc. The R key is wired in main.js's keydown
// handler, so this component doesn't need its own callback.)
export function showLeftSidebar(
  manifest: Manifest | { tree: unknown; [k: string]: unknown },
  opts: ShowLeftSidebarOpts = {}
) {
  const noop = () => {};
  const container = document.getElementById(DOM_IDS.TREE_SIDEBAR);
  if (!container) return { setSelectedTreePath: noop, setHoveredTreePath: noop };

  while (container.firstChild) container.removeChild(container.firstChild);

  // Clear legacy localStorage entries that were used to persist the open/closed
  // state of individual Controls sections. These keys are no longer written, but
  // may exist from earlier sessions. Remove them so old state cannot leak back
  // via direct localStorage.getItem() calls or devtools inspection.
  _clearLegacyControlsState();

  // Restore persisted width, if any.
  _applyPersistedWidth(container);

  const activityBar = document.createElement('div');
  activityBar.className = 'activity-bar';

  const panel = document.createElement('div');
  panel.className = 'pane';

  // Each pane renders its own × close button inside its header (flexbox
  // layout in the header keeps title + button vertically aligned without
  // any absolute-positioning math). Clicking either calls _setCollapsed
  // — same effect as clicking the active activity-bar icon a second time.
  const paneOnClose = () => _setCollapsed(true);
  const treeBundle = buildTreePane(manifest, {
    onClose: paneOnClose,
    onSelect: opts.onTreeSelect,
    onFocus: opts.onTreeFocus,
    onHover: opts.onTreeHover,
    onHoverEnd: opts.onTreeHoverEnd,
  });
  const infoBundle = buildInfoPane(manifest, { onClose: paneOnClose });
  const searchBundle = buildSearchPane(manifest, {
    onClose: paneOnClose,
    onSelect: opts.onSearchSelect,
    onFocus: opts.onSearchFocus,
  });
  const controlsBundle = buildControlsPane({
    onClose: paneOnClose,
    onRunCollisionCheck: opts.onRunCollisionCheck,
    onRunStemDiagnostic: opts.onRunStemDiagnostic,
  });
  const panes: Record<string, HTMLElement> = {};
  panes[SidebarTab.Tree] = treeBundle.pane;
  panes[SidebarTab.Search] = searchBundle.pane;
  panes[SidebarTab.Info] = infoBundle.pane;
  panes[SidebarTab.Controls] = controlsBundle.pane;

  for (const key in panes) {
    if (Object.hasOwn(panes, key)) {
      panel.appendChild(panes[key]);
    }
  }

  let activeTab: SidebarTab =
    opts.initialTab === SidebarTab.Controls ? SidebarTab.Controls : SidebarTab.Tree;
  // Empty-manifest cold boot: force the sidebar collapsed so the user
  // isn't staring at an empty Explorer pane behind the picker modal.
  // The persisted preference is restored automatically on the next
  // mount once a project is loaded (showLeftSidebar is re-run by the
  // boot path when applyManifest swaps in a real manifest).
  const _treeRoot = ((manifest as { tree?: unknown }).tree || manifest) as TreeNode | DirNode;
  const _manifestIsEmpty =
    !('children' in _treeRoot) ||
    (((_treeRoot as DirNode).children?.length ?? 0) === 0 && !_treeRoot.name);
  let collapsed = _manifestIsEmpty ? true : loadFlag(STORAGE_KEYS.SIDEBAR_COLLAPSED, false);
  const iconBtns: Record<string, HTMLButtonElement> = {};

  // The activity bar splits into a top group (tabs that stack from the
  // top) and a bottom group (tabs pinned to the bottom). The bar itself
  // is `justify-content: space-between` over the two groups — no
  // margin-top: auto trick — so the bottom group naturally sits at the
  // foot of the column.
  const topGroup = document.createElement('div');
  topGroup.className = 'activity-bar-group activity-bar-top';
  const bottomGroup = document.createElement('div');
  bottomGroup.className = 'activity-bar-group activity-bar-bottom';

  const iconBase = LUCIDE_ICON_BASE_URL;
  const tabs = ACTIVITY_BAR_TABS;
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'activity-bar-icon';
    btn.dataset.tab = tab.id;
    btn.title = tab.title;
    btn.setAttribute('aria-label', tab.title);

    const glyph = document.createElement('span');
    glyph.className = 'activity-bar-glyph';
    glyph.style.maskImage = `url(${iconBase}${tab.icon})`;
    glyph.style.webkitMaskImage = `url(${iconBase}${tab.icon})`;
    btn.appendChild(glyph);

    iconBtns[tab.id] = btn;

    (function (tabId) {
      btn.addEventListener('click', () => {
        _onIconClick(tabId);
      });
    })(tab.id);

    const group = tab.placement === 'bottom' ? bottomGroup : topGroup;
    group.appendChild(btn);
  }

  activityBar.appendChild(topGroup);
  activityBar.appendChild(bottomGroup);

  // _onIconClick — the same icon while expanded collapses; any other
  // icon (or any icon while collapsed) opens the sidebar with that tab.
  function _onIconClick(tabId: string): void {
    if (!panes[tabId]) return;
    if (!collapsed && tabId === activeTab) {
      _setCollapsed(true);
      return;
    }
    if (collapsed) _setCollapsed(false);
    _setActive(tabId);
  }

  function _setActive(tabId: string): void {
    if (!panes[tabId]) return;
    const prev = activeTab;
    activeTab = tabId as SidebarTab;
    _refreshActiveStates();
    // Auto-focus the search input when switching to the Search tab —
    // saves a click. Other panes don't have an interactive primary
    // element so they don't need this hook.
    if (activeTab === SidebarTab.Search) {
      // Defer to next frame so the display:none → '' transition has
      // happened before focus() runs (focus on a hidden input is a
      // no-op in some browsers).
      requestAnimationFrame(() => searchBundle.api.focus());
    }
    // Controls panel: reset all collapsible sections to closed whenever
    // the tab becomes visible. This runs both when switching from another
    // tab and when the sidebar un-collapses directly onto the Controls tab.
    if (activeTab === SidebarTab.Controls && prev !== SidebarTab.Controls) {
      controlsBundle.resetCollapsed();
    }
  }

  function _setCollapsed(value: boolean): void {
    const wasCollapsed = collapsed;
    collapsed = value;
    container.classList.toggle('is-collapsed', collapsed);
    _refreshActiveStates();
    saveFlag(STORAGE_KEYS.SIDEBAR_COLLAPSED, collapsed);
    // If the sidebar re-opens while already parked on the Controls tab,
    // reset all sections — _setActive won't fire in that path.
    if (wasCollapsed && !collapsed && activeTab === SidebarTab.Controls) {
      controlsBundle.resetCollapsed();
    }
  }

  // Sync the visible state of all panes + activity-bar icons against
  // the (activeTab, collapsed) tuple. When collapsed, NO icon shows as
  // active — the user is parked at "no pane visible".
  function _refreshActiveStates() {
    for (const id in panes) {
      if (!Object.hasOwn(panes, id)) continue;
      panes[id].style.display = id === activeTab ? '' : 'none';
    }
    for (const iid in iconBtns) {
      if (!Object.hasOwn(iconBtns, iid)) continue;
      const isActive = !collapsed && iid === activeTab;
      iconBtns[iid].classList.toggle('active', isActive);
      iconBtns[iid].setAttribute('aria-pressed', String(isActive));
    }
  }

  _refreshActiveStates();

  container.classList.toggle('is-collapsed', collapsed);

  container.appendChild(activityBar);
  container.appendChild(panel);
  container.appendChild(_buildResizeHandle(container));

  return {
    setSelectedTreePath: treeBundle.api.setSelectedPath,
    setHoveredTreePath: treeBundle.api.setHoveredPath,
    setInfoManifest: infoBundle.api.setManifest,
    setTreeManifest: treeBundle.api.setManifest,
    setSearchManifest: searchBundle.api.setManifest,
  };
}

// _buildResizeHandle(sidebar) — a thin invisible strip on the sidebar's
// right edge. Drag to resize; the chosen width is clamped to [MIN, MAX]
// and persisted in localStorage.
function _buildResizeHandle(sidebar: HTMLElement): HTMLDivElement {
  const handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize';

  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let w = e.clientX;
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > SIDEBAR_MAX_WIDTH) w = SIDEBAR_MAX_WIDTH;
    sidebar.style.width = `${w}px`;
  });
  handle.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    _persistWidth(parseFloat(sidebar.style.width) || sidebar.offsetWidth);
  });
  return handle;
}

function _applyPersistedWidth(sidebar: HTMLElement): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SIDEBAR_WIDTH);
    if (raw == null) return;
    let w = parseFloat(raw);
    if (!Number.isFinite(w)) return;
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > SIDEBAR_MAX_WIDTH) w = SIDEBAR_MAX_WIDTH;
    sidebar.style.width = `${w}px`;
  } catch (_) {
    /* private mode / no storage — silently fall back to CSS default */
  }
}

function _persistWidth(w: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_WIDTH, String(w));
  } catch (_) {
    /* quota / private — drop */
  }
}

// Remove any localStorage entries written by earlier versions of the controls
// pane that persisted the open/closed state of individual sections and
// collapsible subgroups. Keys had the form:
//   controls.section.<name>
//   controls.subgroup.<slug>
// We no longer write these; wipe them on boot so stale values don't linger.
function _clearLegacyControlsState(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('controls.section.') || key.startsWith('controls.subgroup.'))) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch (_) {
    /* private mode / quota — silently skip */
  }
}
