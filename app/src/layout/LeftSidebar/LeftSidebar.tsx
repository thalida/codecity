// layout/LeftSidebar.tsx — VSCode-style left sidebar.
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

import './LeftSidebar.css';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { ACTIVITY_BAR_TABS, DEFAULT_SIDEBAR_TAB, TabPlacement } from '@/constants/ui';
import { SIDEBAR_TAB, SIDEBAR_COLLAPSED } from '@/state/stores/ui';
import { CHANGED_SETTINGS_COUNT } from '@/state/stores/settingsIndicators';
import { PERSISTED_KEYS } from '@/constants/storage';
import { SidebarTab, NodeKind } from '@/types';
import type { PickTarget, TreeNode } from '@/types';
import { persistedSignal } from '@/state/persist';
import { SCENE_HANDLE, selectPath, hoverPath, clearHover } from '@/state/stores/scene';
import { MANIFEST } from '@/state/stores/manifest';
import { HISTORY_MANIFEST } from '@/state/stores/historyManifest';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { isEmptyManifest } from '@/utils/manifest';
import { ExplorePane } from '@/views/ExplorePane/ExplorePane';
import { InfoPane } from '@/views/InfoPane/InfoPane';
import { SearchPane } from '@/views/SearchPane/SearchPane';
import { ControlsPane } from '@/views/ControlsPane/ControlsPane';
import { Sidebar, SidebarSide } from '@/components/Sidebar/Sidebar';

// Persisted left-sidebar UI state. Both go through persistedSignal (the store
// abstraction) so persistence/hydration is handled for us — no hand-rolled
// localStorage. Width is null until the user first drags the resize handle
// (null ⇒ fall back to the CSS default width).
const LEFT_SIDEBAR_WIDTH = persistedSignal<number | null>(PERSISTED_KEYS.LEFT_SIDEBAR_WIDTH, null);

// ── Helpers ──────────────────────────────────────────────────────────

function _pathOf(target: PickTarget | null): string | null {
  if (!target) return null;
  if (target.kind === NodeKind.File) return target.file?.path ?? null;
  if (target.kind === NodeKind.Directory) return target.dir?.path ?? null;
  return null;
}

// "Settings differ from default" dot. Replays its ring on every `count` change:
// a keyed remount doesn't restart a CSS animation (Preact reuses the DOM node),
// so we force it with the animation-reset + reflow trick.
function SettingsChangeDot({ count }: { count: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetWidth; // reflow so the next assignment restarts the animation
    el.style.animation = '';
  }, [count]);
  return <span ref={ref} class="activity-bar-dot" aria-hidden="true" />;
}

// ── ActivityBar sub-component ────────────────────────────────────────

interface ActivityBarProps {
  activeTab: SidebarTab;
  collapsed: boolean;
  onIconClick: (tab: SidebarTab) => void;
}

function ActivityBar({ activeTab, collapsed, onIconClick }: ActivityBarProps) {
  const tabs = ACTIVITY_BAR_TABS;
  const topTabs = tabs.filter((t) => t.placement !== TabPlacement.Bottom);
  const bottomTabs = tabs.filter((t) => t.placement === TabPlacement.Bottom);
  // Total settings + excludes that differ from default. The Settings icon shows
  // a single dirty dot (the per-tab counts live on the subtabs); a customized
  // render stays discoverable from anywhere.
  const changedCount = CHANGED_SETTINGS_COUNT.value;

  const renderTab = (tab: (typeof tabs)[number]) => {
    const isActive = !collapsed && tab.id === activeTab;
    const showDot = tab.id === SidebarTab.Controls && changedCount > 0;
    return (
      <button
        key={tab.id}
        type="button"
        class={`activity-bar-icon${isActive ? ' active' : ''}`}
        data-tab={tab.id}
        title={showDot ? `${tab.title} (${changedCount} changed from default)` : tab.title}
        aria-label={showDot ? `${tab.title}, ${changedCount} changed from default` : tab.title}
        aria-pressed={isActive}
        onClick={() => onIconClick(tab.id)}
      >
        <tab.icon class="activity-bar-glyph" />
        {showDot && <SettingsChangeDot count={changedCount} />}
      </button>
    );
  };

  return (
    <nav class="activity-bar surface-chrome" aria-label="Sidebar sections">
      <div class="activity-bar-group activity-bar-top">{topTabs.map(renderTab)}</div>
      <div class="activity-bar-group activity-bar-bottom">{bottomTabs.map(renderTab)}</div>
    </nav>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function LeftSidebar() {
  // Both live in the store so the header can send you to a pane; still not
  // persisted, and still force-closed on every world load.
  const activeTab = SIDEBAR_TAB;
  const collapsed = SIDEBAR_COLLAPSED;

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

  // Force the sidebar closed and reset to Info on every world commit, so a new
  // world always opens with the city unobscured (the open state is never
  // remembered across worlds). Cold-boot ?src= and a user source switch both
  // write CURRENT_SOURCE; live-reloads don't, so this fires once per real load
  // and won't fight a manual tab/collapse change between loads.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) {
      activeTab.value = DEFAULT_SIDEBAR_TAB;
      collapsed.value = true;
    }
  });

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
  // Tree rows hand back a TreeNode → adapt to a path. Path/nullary handlers
  // (search, hover-end) use the scene commands directly in the JSX below.
  const onTreeSelect = (node: TreeNode) => {
    if (node?.path) selectPath(node.path);
  };
  const onTreeHover = (node: TreeNode) => {
    if (node?.path) hoverPath(node.path);
  };

  // Effective collapsed: forced when manifest is empty.
  const effectiveCollapsed = collapsed.value || manifestIsEmpty.value;
  const tab = activeTab.value;

  return (
    <Sidebar
      id="left-sidebar"
      side={SidebarSide.Left}
      ariaLabel="Explore"
      class={effectiveCollapsed ? 'is-collapsed' : ''}
      widthSignal={LEFT_SIDEBAR_WIDTH}
    >
      <ActivityBar activeTab={tab} collapsed={effectiveCollapsed} onIconClick={onIconClick} />
      {/* Phone-only by CSS: the drawer covers the city, so a tap there closes. */}
      {!effectiveCollapsed && (
        <button
          type="button"
          class="sidebar-scrim"
          aria-label="Close panel"
          onClick={onPaneClose}
        />
      )}
      <div class="pane">
        {tab === SidebarTab.Explore && (
          <ExplorePane
            manifest={HISTORY_MANIFEST}
            selectedPath={selectedPath}
            hoveredPath={hoveredPath}
            expanded={treeExpanded}
            rootPath={(HISTORY_MANIFEST.value as { tree?: TreeNode })?.tree?.path ?? ''}
            onClose={onPaneClose}
            onSelect={onTreeSelect}
            onHover={onTreeHover}
            onHoverEnd={clearHover}
          />
        )}
        {tab === SidebarTab.Search && (
          <SearchPane manifest={HISTORY_MANIFEST} onClose={onPaneClose} onSelect={selectPath} />
        )}
        {tab === SidebarTab.Info && <InfoPane manifest={MANIFEST} onClose={onPaneClose} />}
        {tab === SidebarTab.Controls && (
          <ControlsPane onClose={onPaneClose} collapsed={effectiveCollapsed} />
        )}
      </div>
    </Sidebar>
  );
}
