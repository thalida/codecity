// views/shell/LeftSidebar.tsx — VSCode-style left sidebar.
//
// Owns:
//   - active-tab state (which pane is mounted)
//   - collapsed/expanded state (clicking the active icon collapses; the
//     × in the panel header also collapses; persisted in localStorage)
//   - drag-to-resize handle on the sidebar's right edge (also persisted)
//   - SCENE_HANDLE subscription: forwards picker selection/hover into
//     the tree pane's signals, plus translates tree clicks into
//     picker.selectByPath + rig.focusX
//
// Full Preact: <aside id="left-sidebar"> is rendered directly. The
// four panes are signal-driven Preact components mounted as JSX
// children — no imperative buildXPane factories on the active path.
// The factories survive (#10) for external consumers / tests until
// they too are ported.

import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  ACTIVITY_BAR_TABS,
  DOM_IDS,
  STORAGE_KEYS,
} from '@/constants';
import { SidebarTab, NodeKind } from '@/types';
import type { PickTarget, TreeNode } from '@/types';
import { persistedSignal } from '@/state/persist';
import { SCENE_HANDLE } from '@/state/runtime/scene';
import { MANIFEST } from '@/state/runtime/manifest';
import { isEmptyManifest } from '@/utils/manifest';
import { TreePane } from '@/views/panes/TreePane';
import { InfoPane } from '@/views/panes/InfoPane';
import { SearchPane } from '@/views/panes/SearchPane';
import { ControlsPane } from '@/views/panes/ControlsPane';

// Persistent boolean for the left-sidebar collapsed state.
const SIDEBAR_COLLAPSED = persistedSignal<boolean>('sidebarCollapsed', false);

const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 600;

// ── Helpers ──────────────────────────────────────────────────────────

function _pathOf(target: PickTarget | null): string | null {
  if (!target) return null;
  if (target.kind === NodeKind.File) return target.file?.path ?? null;
  if (target.kind === NodeKind.Directory) return target.dir?.path ?? null;
  return null;
}

// Older legacy localStorage keys that earlier code wrote per-section
// open/closed state under. Once on app boot we wipe them so they don't
// linger forever in stale browsers.
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
    /* private mode / quota — skip */
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

function _readPersistedWidth(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SIDEBAR_WIDTH);
    if (raw == null) return null;
    const w = parseFloat(raw);
    if (!Number.isFinite(w)) return null;
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w));
  } catch (_) {
    return null;
  }
}

// ── ActivityBar sub-component ────────────────────────────────────────

interface ActivityBarProps {
  activeTab: SidebarTab;
  collapsed: boolean;
  onIconClick: (tab: SidebarTab) => void;
}

function ActivityBar({ activeTab, collapsed, onIconClick }: ActivityBarProps) {
  const tabs = ACTIVITY_BAR_TABS;
  const topTabs = tabs.filter((t) => t.placement !== 'bottom');
  const bottomTabs = tabs.filter((t) => t.placement === 'bottom');

  const renderTab = (tab: (typeof tabs)[number]) => {
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
        <tab.icon class="activity-bar-glyph" />
      </button>
    );
  };

  return (
    <div class="activity-bar">
      <div class="activity-bar-group activity-bar-top">{topTabs.map(renderTab)}</div>
      <div class="activity-bar-group activity-bar-bottom">{bottomTabs.map(renderTab)}</div>
    </div>
  );
}

// ── ResizeHandle sub-component ───────────────────────────────────────

interface ResizeHandleProps {
  targetRef: { current: HTMLElement | null };
}

function ResizeHandle({ targetRef }: ResizeHandleProps) {
  // `dragging` is a ref (sync guard for pointermove — no stale-closure race);
  // `isDragging` is state, driving the visual `.dragging` class declaratively.
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = (e: PointerEvent) => {
    dragging.current = true;
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.current || !targetRef.current) return;
    let w = e.clientX;
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > SIDEBAR_MAX_WIDTH) w = SIDEBAR_MAX_WIDTH;
    targetRef.current.style.width = `${w}px`;
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging.current || !targetRef.current) return;
    dragging.current = false;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    _persistWidth(parseFloat(targetRef.current.style.width) || targetRef.current.offsetWidth);
  };

  return (
    <div
      class={`sidebar-resize-handle${isDragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

// ── Main component ───────────────────────────────────────────────────

export function LeftSidebar() {
  const sidebarRef = useRef<HTMLElement>(null);
  const activeTab = useSignal<SidebarTab>(SidebarTab.Tree);
  const collapsed = useSignal<boolean>(SIDEBAR_COLLAPSED.value);

  // Tree selection + hover paths, derived from picker signals.
  const selectedPath = useSignal<string | null>(null);
  const hoveredPath = useSignal<string | null>(null);
  // Stable expansion-state signal for the tree pane. The TreePane
  // component itself drives this via its selection→ancestor-chain
  // effect, so we just need a long-lived signal to pass in.
  const treeExpanded = useSignal<Set<string>>(new Set());

  // Mirror picker.selection.value → selectedPath. Re-runs on every
  // SCENE_HANDLE swap and every picker change.
  useSignalEffect(() => {
    const handle = SCENE_HANDLE.value;
    if (!handle) {
      selectedPath.value = null;
      return;
    }
    selectedPath.value = _pathOf(handle.picker.selection.value);
  });

  useSignalEffect(() => {
    const handle = SCENE_HANDLE.value;
    if (!handle) {
      hoveredPath.value = null;
      return;
    }
    hoveredPath.value = _pathOf(handle.picker.hover.value);
  });

  // Persist collapsed → localStorage via the persistedSignal.
  useSignalEffect(() => {
    SIDEBAR_COLLAPSED.value = collapsed.value;
  });

  // One-time setup: clear legacy localStorage keys + apply persisted width.
  useEffect(() => {
    _clearLegacyControlsState();
    const w = _readPersistedWidth();
    if (w != null && sidebarRef.current) {
      sidebarRef.current.style.width = `${w}px`;
    }
  }, []);

  // Auto-collapse when the manifest has no content (cold-boot empty state).
  // The activity bar stays visible but the panel is hidden.
  const manifestIsEmpty = useComputed(() => isEmptyManifest(MANIFEST.value));

  const onIconClick = (tab: SidebarTab) => {
    if (!collapsed.value && tab === activeTab.value) {
      collapsed.value = true;
      return;
    }
    if (collapsed.value) collapsed.value = false;
    activeTab.value = tab;
  };

  const onPaneClose = () => {
    collapsed.value = true;
  };

  // Tree event handlers — bound to the current SCENE_HANDLE at call
  // time so they always operate on the live scene.
  const onTreeSelect = (node: TreeNode) => {
    if (!node?.path) return;
    SCENE_HANDLE.peek()?.picker.selectByPath(node.path);
  };
  const onTreeFocus = (node: TreeNode) => {
    if (!node?.path) return;
    const handle = SCENE_HANDLE.peek();
    if (!handle) return;
    handle.rig.focusSelection(handle.picker.targetForPath(node.path));
  };
  const onTreeHover = (node: TreeNode) => {
    if (!node?.path) return;
    SCENE_HANDLE.peek()?.picker.hoverByPath(node.path);
  };
  const onTreeHoverEnd = () => {
    SCENE_HANDLE.peek()?.picker.setHover(null);
  };
  const onSearchSelect = (path: string) => {
    SCENE_HANDLE.peek()?.picker.selectByPath(path);
  };
  const onSearchFocus = (path: string) => {
    const handle = SCENE_HANDLE.peek();
    if (!handle) return;
    handle.rig.focusSelection(handle.picker.targetForPath(path));
  };
  const onRunCollisionCheck = () => {
    SCENE_HANDLE.peek()?.world.runCollisionCheck();
  };
  const onRunStemDiagnostic = () => {
    SCENE_HANDLE.peek()?.world.runStemPlacementDiagnostic();
  };

  // Effective collapsed: forced when manifest is empty.
  const effectiveCollapsed = collapsed.value || manifestIsEmpty.value;
  const tab = activeTab.value;

  return (
    <aside
      ref={sidebarRef}
      id={DOM_IDS.LEFT_SIDEBAR}
      class={effectiveCollapsed ? 'is-collapsed' : ''}
    >
      <ActivityBar
        activeTab={tab}
        collapsed={effectiveCollapsed}
        onIconClick={onIconClick}
      />
      <div class="pane">
        {tab === SidebarTab.Tree && (
          <TreePane
            manifest={MANIFEST}
            selectedPath={selectedPath}
            hoveredPath={hoveredPath}
            expanded={treeExpanded}
            rootPath={(MANIFEST.value as { tree?: TreeNode })?.tree?.path ?? ''}
            onClose={onPaneClose}
            onSelect={onTreeSelect}
            onFocus={onTreeFocus}
            onHover={onTreeHover}
            onHoverEnd={onTreeHoverEnd}
          />
        )}
        {tab === SidebarTab.Search && (
          <SearchPane
            manifest={MANIFEST}
            onClose={onPaneClose}
            onSelect={onSearchSelect}
            onFocus={onSearchFocus}
          />
        )}
        {tab === SidebarTab.Info && (
          <InfoPane manifest={MANIFEST} onClose={onPaneClose} />
        )}
        {tab === SidebarTab.Controls && (
          <ControlsPane
            onClose={onPaneClose}
            onRunCollisionCheck={onRunCollisionCheck}
            onRunStemDiagnostic={onRunStemDiagnostic}
            collapsed={effectiveCollapsed}
          />
        )}
      </div>
      <ResizeHandle targetRef={sidebarRef} />
    </aside>
  );
}
