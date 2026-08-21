// components/sources/ProjectSwitcher/ProjectSwitcher.tsx — The project chip: gem, repo kind, label,
// optional @branch pill, switch cue. A two-way arrow, not the popovers' caret:
// this trades one project for another, it doesn't open a menu. The gem doubles
// as the app logo, so the chip renders before a project loads: gem alone.

import './ProjectSwitcher.css';
import { BranchPill } from '@/components/sources/BranchPill/BranchPill';
import { ArrowRightLeft } from 'lucide-preact';
import { GemIcon } from '@/components/app/GemIcon/GemIcon';
import { HostingIcon } from '@/components/sources/HostingIcon/HostingIcon';

export interface ProjectSwitcherProps {
  rootLabel: string;
  branch: string | undefined;
  /** Source of the open repo, for its kind glyph. Absent before one loads. */
  src?: string;
  onSwitchSource?: () => void;
}

export function ProjectSwitcher({ rootLabel, branch, src, onSwitchSource }: ProjectSwitcherProps) {
  // The label is "owner/repo" or a bare directory name, and the tail is what
  // identifies it — so the owner is what gives way when the chip runs short.
  const cut = rootLabel.lastIndexOf('/');
  const owner = cut === -1 ? '' : rootLabel.slice(0, cut);
  const name = cut === -1 ? rootLabel : rootLabel.slice(cut + 1);

  return (
    <button
      type="button"
      class="project-switcher"
      title="Switch project"
      aria-label="Switch project"
      disabled={!onSwitchSource}
      onClick={() => {
        if (onSwitchSource) onSwitchSource();
      }}
    >
      <GemIcon />
      {/* Leading the name, not the chip: the gem is the app's mark, and this
          says which kind of repo the name belongs to. */}
      {src && (
        <span class="project-switcher-kind">
          <HostingIcon src={src} />
        </span>
      )}
      {rootLabel && (
        <span class="project-switcher-label">
          {owner && <span class="project-switcher-owner">{owner}/</span>}
          <span class="project-switcher-name">{name}</span>
        </span>
      )}
      {branch && <BranchPill branch={branch} />}
      <ArrowRightLeft class="icon cluster-cue" aria-hidden="true" />
    </button>
  );
}
