// components/ProjectSwitcher.tsx — The project chip: gem + label + optional
// @branch pill + a switch cue. Click opens the project switcher. The trailing
// glyph is ChevronsUpDown (a "switchable value" cue), not a down-caret, since
// clicking opens a full switcher screen rather than a dropdown menu.
// The gem doubles as the app logo, so the chip renders even before a project
// loads: gem alone, still opening the switcher.

import './ProjectSwitcher.css';
import { ChevronsUpDown } from 'lucide-preact';
import { GemIcon } from '@/components/GemIcon/GemIcon';

export interface ProjectSwitcherProps {
  rootLabel: string;
  branch: string | undefined;
  onSwitchSource?: () => void;
}

export function ProjectSwitcher({ rootLabel, branch, onSwitchSource }: ProjectSwitcherProps) {
  return (
    <button
      type="button"
      class="btn-chip"
      title="Switch project"
      aria-label="Switch project"
      disabled={!onSwitchSource}
      onClick={() => {
        if (onSwitchSource) onSwitchSource();
      }}
    >
      <GemIcon class="btn-chip-gem" />
      {rootLabel && <span class="btn-chip-label">{rootLabel}</span>}
      {branch && <span class="app-header-branch-pill">@{branch}</span>}
      <ChevronsUpDown class="icon btn-chip-affordance" />
    </button>
  );
}
