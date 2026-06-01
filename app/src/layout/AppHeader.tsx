// layout/AppHeader.tsx — Sitewide top header. Composition shell only: derives
// display state from runtime signals and slots the header sub-components into a
// 3-column grid. The slot widgets are components/ (CommitChip, HeaderBreadcrumb,
// ProjectSwitcher, RepoLink, ResetViewButton); this file owns only the grid.
//
// Layout (left → right):
//   #app-header-left  — ResetViewButton + ProjectSwitcher + RepoLink
//   #app-title        — CommitChip | HeaderBreadcrumb (per current selection)
//   #app-header-right — reserved slot, currently unused

import type { ComponentChildren } from 'preact';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { SOURCE_INFO } from '@/state/stores/source';
import { openSourcePicker } from '@/state/stores/ui';
import { NodeKind } from '@/types';
import { ResetViewButton } from '@/components/ResetViewButton';
import { ProjectSwitcher } from '@/components/ProjectSwitcher';
import { RepoLink } from '@/components/RepoLink';
import { CommitChip } from '@/components/CommitChip';
import { HeaderBreadcrumb } from '@/components/HeaderBreadcrumb';

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
  const rootPath = handle?.world.getRoot()?.path ?? '';

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
    if (path && path !== rootPath) {
      title = (
        <HeaderBreadcrumb
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
    <header id="app-header">
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
      <div id="app-header-right" />
    </header>
  );
}
