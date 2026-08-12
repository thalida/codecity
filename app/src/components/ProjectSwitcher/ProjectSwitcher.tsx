// components/ProjectSwitcher.tsx — The project chip: gem + label + optional
// @branch pill + a switch cue. Click opens the project switcher. The trailing
// glyph is ChevronsUpDown (a "switchable value" cue), not a down-caret, since
// clicking opens a full switcher screen rather than a dropdown menu.
// The gem doubles as the app logo, so the chip renders even before a project
// loads: gem alone, still opening the switcher.

import './ProjectSwitcher.css';
import { ChevronsUpDown } from 'lucide-preact';
import { CLUSTER_ITEM_PRESS } from '@/components/ChromeCluster/ChromeCluster';
import { GemIcon } from '@/components/GemIcon/GemIcon';

export interface ProjectSwitcherProps {
  rootLabel: string;
  branch: string | undefined;
  onSwitchSource?: () => void;
}

export function ProjectSwitcher({ rootLabel, branch, onSwitchSource }: ProjectSwitcherProps) {
  // The label is "owner/repo" or a bare directory name, and the tail is what
  // identifies it — so the owner is what gives way when the chip runs short.
  const cut = rootLabel.lastIndexOf('/');
  const owner = cut === -1 ? '' : rootLabel.slice(0, cut);
  const name = cut === -1 ? rootLabel : rootLabel.slice(cut + 1);

  return (
    <button
      type="button"
      class={`${CLUSTER_ITEM_PRESS} project-switcher`}
      title="Switch project"
      aria-label="Switch project"
      disabled={!onSwitchSource}
      onClick={() => {
        if (onSwitchSource) onSwitchSource();
      }}
    >
      <GemIcon />
      {rootLabel && (
        <span class="project-switcher-label">
          {owner && <span class="project-switcher-owner">{owner}/</span>}
          <span class="project-switcher-name">{name}</span>
        </span>
      )}
      {branch && <span class="app-header-branch-pill">@{branch}</span>}
      <ChevronsUpDown class="icon cluster-cue" aria-hidden="true" />
    </button>
  );
}
