// components/ProjectSwitcher.tsx — The project chip: label + optional @branch
// pill + a switch cue. Click opens the project switcher. The trailing glyph is
// ChevronsUpDown (a "switchable value" cue), not a down-caret, since clicking
// opens a full switcher screen rather than a dropdown menu.
// Renders nothing until a project is loaded (no label).

import './ProjectSwitcher.css';
import { ChevronsUpDown } from 'lucide-preact';

export interface ProjectSwitcherProps {
  rootLabel: string;
  branch: string | undefined;
  onSwitchSource?: () => void;
}

export function ProjectSwitcher({ rootLabel, branch, onSwitchSource }: ProjectSwitcherProps) {
  if (!rootLabel) return null;
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
      <span class="btn-chip-label">{rootLabel}</span>
      {branch && <span class="app-header-branch-pill">@{branch}</span>}
      <ChevronsUpDown class="icon btn-chip-affordance" />
    </button>
  );
}
