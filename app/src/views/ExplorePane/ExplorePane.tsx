// views/ExplorePane/ExplorePane.tsx — the "Explore" sidebar section: browse the
// repo's actual content. Hosts two subtabs — File tree (default) and Readme —
// owning the Pane chrome + tab strip while the subtab bodies render themselves.
// The interpretive counterpart is InfoPane (Overview + Legend).

import './ExplorePane.css';
import { useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import type { Signal, ReadonlySignal } from '@preact/signals';
import { FolderTree, BookOpen } from 'lucide-preact';
import type { DirNode, Manifest, TreeNode } from '@/types';
import { Pane } from '@/components/Pane';
import { PaneCloseButton } from '@/components/PaneHeader/PaneHeader';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { TreePane } from '@/views/TreePane/TreePane';
import { ReadmePane } from '@/views/InfoPane/ReadmePane';

type ManifestSignal = Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;

export enum ExploreTab {
  Tree = 'tree',
  Readme = 'readme',
}

const EXPLORE_TABS = [
  { id: ExploreTab.Tree, label: 'File tree', icon: FolderTree },
  { id: ExploreTab.Readme, label: 'Readme', icon: BookOpen },
];

export interface ExplorePaneProps {
  manifest: ManifestSignal;
  selectedPath: ReadonlySignal<string | null>;
  hoveredPath: ReadonlySignal<string | null>;
  expanded: Signal<Set<string>>;
  rootPath: string;
  onClose?: () => void;
  onSelect?: (node: TreeNode) => void;
  onHover?: (node: TreeNode) => void;
  onHoverEnd?: (node: TreeNode) => void;
}

export function ExplorePane({
  manifest,
  selectedPath,
  hoveredPath,
  expanded,
  rootPath,
  onClose,
  onSelect,
  onHover,
  onHoverEnd,
}: ExplorePaneProps) {
  const [tab, setTab] = useState<ExploreTab>(ExploreTab.Tree);

  // Reset to the File tree when a new world commits — ExplorePane stays mounted
  // across world switches. Keyed on CURRENT_SOURCE (not the manifest), so an
  // in-place refresh keeps your subtab.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) setTab(ExploreTab.Tree);
  });

  return (
    <Pane
      paneClass="explore-pane"
      headerSlot={
        <div class="pane-header pane-header--tabs">
          <PaneTabs tabs={EXPLORE_TABS} active={tab} onSelect={(id) => setTab(id as ExploreTab)} />
          {onClose && <PaneCloseButton onClose={onClose} />}
        </div>
      }
    >
      {tab === ExploreTab.Tree ? (
        <TreePane
          manifest={manifest}
          selectedPath={selectedPath}
          hoveredPath={hoveredPath}
          expanded={expanded}
          rootPath={rootPath}
          onSelect={onSelect}
          onHover={onHover}
          onHoverEnd={onHoverEnd}
        />
      ) : (
        <div class="pane-body">
          <ReadmePane manifest={manifest} />
        </div>
      )}
    </Pane>
  );
}
