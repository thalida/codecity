// layout/AppHeader.tsx — Sitewide top header. Composition shell only: derives
// display state from runtime signals and slots the header sub-components into a
// 3-column grid. The slot widgets are components/ (CommitChip, PathBreadcrumbs,
// ProjectSwitcher, RepoLink, ResetViewButton); this file owns only the grid.
//
// Layout (left → right):
//   #app-header-left  — ResetViewButton + ProjectSwitcher + RepoLink
//   #app-title        — CommitChip | PathBreadcrumbs (per current selection)
//   #app-header-right — debug icon (flag-gated) + keyboard-shortcuts icon

import './AppHeader.css';
import type { ComponentChildren } from 'preact';
import { Keyboard, Bug } from 'lucide-preact';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { MANIFEST } from '@/state/stores/manifest';
import { ROOT_PATH } from '@/constants/manifest';
import { SOURCE_INFO } from '@/state/stores/source';
import { openSourcePicker, openShortcuts, openDebug } from '@/state/stores/ui';
import { isDebugMode } from '@/utils/debugMode';
import { NodeKind, type Manifest } from '@/types';
import { ResetViewButton } from '@/components/ResetViewButton';
import { ProjectSwitcher } from '@/components/ProjectSwitcher/ProjectSwitcher';
import { RepoLink } from '@/components/RepoLink';
import { CommitChip } from '@/components/CommitChip';
import { PathBreadcrumbs } from '@/components/PathBreadcrumbs/PathBreadcrumbs';

export interface AppHeaderProps {
  /** Fires when the user clicks a breadcrumb segment. */
  onSegmentClick?: ((path: string) => void) | null;
  /** Fires when the user clicks the project chip to switch source. */
  onSwitchSource?: () => void;
  /** Fires when the user clicks the reset-view (gem) button. */
  onResetView?: () => void;
  /** Fires when the user clicks the focus button next to the selection. */
  onFocus?: () => void;
}

export function AppHeader({
  onSegmentClick,
  onSwitchSource,
  onResetView,
  onFocus,
}: AppHeaderProps = {}) {
  const si = SOURCE_INFO.value;
  const handle = SCENE_HANDLE.value;
  const pickerSel = handle?.picker.selection.value ?? null;
  // Root path off the canonical MANIFEST signal. peek() so the header doesn't
  // gain a redundant subscription — it already re-renders on every manifest
  // change via SOURCE_INFO (a computed off MANIFEST).
  const rootPath = (MANIFEST.peek() as Manifest)?.tree?.path ?? ROOT_PATH;

  // Build the title-slot content from the current selection. Null/root-only
  // selections render nothing.
  let title: ComponentChildren = null;
  if (pickerSel?.kind === NodeKind.Commit) {
    title = (
      <CommitChip sha={pickerSel.commit.sha} authors={pickerSel.commit.authors} onFocus={onFocus} />
    );
  } else if (pickerSel?.kind === NodeKind.File || pickerSel?.kind === NodeKind.Directory) {
    const isDir = pickerSel.kind === NodeKind.Directory;
    const node = isDir ? pickerSel.dir : pickerSel.file;
    const path = node.path || node.fullPath || node.name || '';
    const extension = pickerSel.kind === NodeKind.File ? pickerSel.file.extension || '' : undefined;
    // Show the breadcrumb for any selection with a path — including root (a
    // selected dir whose path equals rootPath), which PathBreadcrumbs renders
    // as the repo label.
    if (path) {
      title = (
        <PathBreadcrumbs
          path={path}
          extension={extension}
          isDir={isDir}
          rootLabel={si.label}
          rootPath={rootPath}
          onSegmentClick={onSegmentClick}
          onFocus={onFocus}
        />
      );
    }
  }

  return (
    <header id="app-header" class="surface-chrome">
      <div id="app-header-left">
        <ResetViewButton onResetView={onResetView} />
        <ProjectSwitcher
          rootLabel={si.label}
          branch={si.branch}
          onSwitchSource={onSwitchSource ?? (() => openSourcePicker({ dismissible: true }))}
        />
        <RepoLink sourceUrl={si.sourceUrl} branch={si.branch} />
      </div>
      <div id="app-title">{title}</div>
      <div id="app-header-right">
        {isDebugMode() && (
          <button
            type="button"
            class="btn-icon btn-icon--no-drag"
            title="Debug tools"
            aria-label="Debug tools"
            onClick={openDebug}
          >
            <Bug class="lucide-icon" />
          </button>
        )}
        <button
          type="button"
          class="btn-icon btn-icon--no-drag"
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
          onClick={openShortcuts}
        >
          <Keyboard class="lucide-icon" />
        </button>
      </div>
    </header>
  );
}
