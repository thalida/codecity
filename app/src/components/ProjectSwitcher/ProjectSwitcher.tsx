// components/ProjectSwitcher.tsx — The project chip: icon + label + optional
// @branch pill + chevron. Click opens the source picker to switch projects.
// Renders nothing until a project is loaded (no label).

import './ProjectSwitcher.css';
import { ChevronDown, Map } from 'lucide-preact';

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
      <Map class="lucide-icon" />
      <span class="btn-chip-label">{rootLabel}</span>
      {branch && <span class="app-header-branch-pill">@{branch}</span>}
      <ChevronDown class="lucide-icon btn-chip-chevron" />
    </button>
  );
}
