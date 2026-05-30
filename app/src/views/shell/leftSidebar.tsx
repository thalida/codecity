// views/shell/leftSidebar.tsx — Mounts the left-side activity bar
// (VSCode-style) and the stacked panes it switches between. Owns:
//   - active-tab state
//   - collapsed/expanded state (clicking the active icon collapses; the ×
//     in the panel header also collapses; persisted in localStorage)
//   - drag-to-resize handle on the sidebar's right edge (also persisted)

import { h } from 'preact';
import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { buildTreePane } from '@/views/panes/treePane';
import { buildInfoPane } from '@/views/panes/infoPane';
import { buildControlsPane } from '@/views/panes/controlsPane';
import { buildSearchPane } from '@/views/panes/searchPane';
import { ACTIVITY_BAR_TABS, DOM_IDS, LUCIDE_ICON_BASE_URL, STORAGE_KEYS } from '@/constants';
import { SidebarTab } from '@/types';
import type { DirNode, Manifest, TreeNode } from '@/types';
import { loadFlag, saveFlag } from '@/state/runtime/localFlag';

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

// ── State shape ───────────────────────────────────────────────────────────────

export interface LeftSidebarState {
  activeTab: SidebarTab;
  collapsed: boolean;
}

// ── Preact component ─────────────────────────────────────────────────────────
// Used when App.tsx mounts <LeftSidebar /> directly (Phase 3e+).
// The activity bar icons are rendered as JSX; pane visibility is driven by
// the activeTab + collapsed state read from the signal.

export interface LeftSidebarProps {
  state: ReadonlySignal<LeftSidebarState>;
  /** Map of tabId → pane DOM element (from 3b/3c buildXPane factories). */
  panes: Record<string, HTMLElement>;
  /** Called when an activity-bar icon is clicked. */
  onIconClick: (tabId: string) => void;
}

export function LeftSidebar({ state, panes, onIconClick }: LeftSidebarProps) {
  const { activeTab, collapsed } = state.value;

  // Sync pane visibility (signal-driven; runs on every render that reads .value)
  for (const id in panes) {
    if (Object.hasOwn(panes, id)) {
      panes[id].style.display = id === activeTab ? '' : 'none';
    }
  }

  const iconBase = LUCIDE_ICON_BASE_URL;
  const tabs = ACTIVITY_BAR_TABS;
  const topTabs = tabs.filter((t) => t.placement !== 'bottom');
  const bottomTabs = tabs.filter((t) => t.placement === 'bottom');

  function renderTab(tab: (typeof tabs)[number]) {
    const isActive = !collapsed && tab.id === activeTab;
    return (
      <button
        key={tab.id}
        type="button"
        class={`activity-bar-icon${isActive ? ' active' : ''}`}
        data-tab={tab.id}
        title={tab.title}
        aria-label={tab.title}
        aria-pressed={isActive}
        onClick={() => onIconClick(tab.id)}
      >
        <span
          class="activity-bar-glyph"
          style={{
            maskImage: `url(${iconBase}${tab.icon})`,
            webkitMaskImage: `url(${iconBase}${tab.icon})`,
          }}
        />
      </button>
    );
  }

  return (
    <div class="activity-bar">
      <div class="activity-bar-group activity-bar-top">{topTabs.map(renderTab)}</div>
      <div class="activity-bar-group activity-bar-bottom">{bottomTabs.map(renderTab)}</div>
    </div>
  );
}

// ── Resize handle helpers ─────────────────────────────────────────────────────

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
// pane that persisted the open/closed state of individual sections.
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

// ── Backward-compat shim ──────────────────────────────────────────────────────
// Phase 3e will delete this once App.tsx mounts <LeftSidebar /> directly.
// The shim keeps synchronous DOM mutations for test compatibility.

// showLeftSidebar(manifest, opts) -> { setSelectedTreePath, setHoveredTreePath, ... }
export function showLeftSidebar(
  manifest: Manifest | { tree: unknown; [k: string]: unknown },
  opts: ShowLeftSidebarOpts = {}
) {
  const noop = () => {};
  const container = document.getElementById(DOM_IDS.TREE_SIDEBAR);
  if (!container) return { setSelectedTreePath: noop, setHoveredTreePath: noop };

  while (container.firstChild) container.removeChild(container.firstChild);

  _clearLegacyControlsState();
  _applyPersistedWidth(container);

  const activityBar = document.createElement('div');
  activityBar.className = 'activity-bar';

  const panel = document.createElement('div');
  panel.className = 'pane';

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

  const _treeRoot = ((manifest as { tree?: unknown }).tree || manifest) as TreeNode | DirNode;
  const _manifestIsEmpty =
    !('children' in _treeRoot) ||
    (((_treeRoot as DirNode).children?.length ?? 0) === 0 && !_treeRoot.name);
  let collapsed = _manifestIsEmpty ? true : loadFlag(STORAGE_KEYS.SIDEBAR_COLLAPSED, false);
  const iconBtns: Record<string, HTMLButtonElement> = {};

  // Signal backing the Preact activity bar — updated on state changes.
  const state = signal<LeftSidebarState>({ activeTab, collapsed });

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
    state.value = { ...state.value, activeTab };
    _refreshActiveStates();
    if (activeTab === SidebarTab.Search) {
      requestAnimationFrame(() => searchBundle.api.focus());
    }
    if (activeTab === SidebarTab.Controls && prev !== SidebarTab.Controls) {
      controlsBundle.resetCollapsed();
    }
  }

  function _setCollapsed(value: boolean): void {
    const wasCollapsed = collapsed;
    collapsed = value;
    state.value = { ...state.value, collapsed };
    container.classList.toggle('is-collapsed', collapsed);
    _refreshActiveStates();
    saveFlag(STORAGE_KEYS.SIDEBAR_COLLAPSED, collapsed);
    if (wasCollapsed && !collapsed && activeTab === SidebarTab.Controls) {
      controlsBundle.resetCollapsed();
    }
  }

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

/**
 * No-op hideLeftSidebar — the left sidebar doesn't have a show/hide
 * toggle in the current design (it uses the collapsed state instead).
 * Kept for API symmetry with rightSidebar.
 */
export function hideLeftSidebar(): void {
  const container = document.getElementById(DOM_IDS.TREE_SIDEBAR);
  if (container) container.classList.add('is-collapsed');
}
