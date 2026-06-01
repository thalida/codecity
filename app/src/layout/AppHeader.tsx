// layout/AppHeader.tsx — Sitewide top header. Composition shell only:
// derives display state from runtime signals and slots the two sub-components
// (HeaderLeft, HeaderTitle) into a 3-column grid. Sub-components live in
// ./header/ next door — split out per the #34 cleanup.
//
// Layout (left → right):
//   #app-header-left   — HeaderLeft (reset-view, project chip, repo link)
//   #app-title         — HeaderTitle (badge + breadcrumb / commit chip)
//   #app-header-right  — reserved slot, currently unused

import { SCENE_HANDLE } from '@/state/stores/scene';
import { SOURCE_INFO } from '@/state/stores/source';
import { openSourcePicker } from '@/state/stores/ui';
import { NodeKind } from '@/types';
import { HeaderLeft } from './header/HeaderLeft';
import { HeaderTitle } from './header/HeaderTitle';
import type { HeaderSelection } from './header/HeaderTitle';

export type { HeaderSelection } from './header/HeaderTitle';

export interface AppHeaderProps {
  /** Fires when the user clicks a breadcrumb segment. */
  onSegmentClick?: ((path: string) => void) | null;
  /** Fires when the user clicks the project chip to switch source. */
  onSwitchSource?: () => void;
  /** Fires when the user clicks the reset-view (gem) button. */
  onResetView?: () => void;
  /** Fires when the user clicks the focus button next to the selected path. */
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
  const rootNode = handle?.world.getRoot() ?? null;
  const rootPath = rootNode?.path ?? '';

  let sel: HeaderSelection | null = null;
  if (pickerSel?.kind === NodeKind.Commit) {
    sel = { kind: NodeKind.Commit, sha: pickerSel.commit.sha, authors: pickerSel.commit.authors };
  } else if (pickerSel?.kind === NodeKind.File) {
    const node = pickerSel.file;
    sel = {
      kind: NodeKind.File,
      path: node.path || node.fullPath || node.name || '',
      fullPath: node.fullPath || '',
      extension: node.extension || '',
      isDir: false,
    };
  } else if (pickerSel?.kind === NodeKind.Directory) {
    const node = pickerSel.dir;
    sel = {
      kind: NodeKind.Directory,
      path: node.path || node.fullPath || node.name || '',
      fullPath: node.fullPath || '',
      isDir: true,
    };
  }

  return (
    <header id="app-header">
      <div id="app-header-left">
        <HeaderLeft
          rootLabel={si.label}
          branch={si.branch}
          sourceUrl={si.sourceUrl}
          onResetView={onResetView}
          onSwitchSource={onSwitchSource ?? (() => openSourcePicker({ dismissible: true }))}
        />
      </div>
      <div id="app-title">
        <HeaderTitle
          sel={sel}
          rootLabel={si.label}
          rootPath={rootPath}
          onSegmentClick={onSegmentClick}
          onFocus={onFocus}
        />
      </div>
      <div id="app-header-right" />
    </header>
  );
}
