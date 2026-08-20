// components/sources/SourceRow/SourceRow.tsx — one openable source: kind glyph,
// label, branch pill, raw src. Shared by Recents and Discover, since a Discover
// row is a recent you haven't opened yet. Everything around a row (a remove
// control, an active badge) belongs to its lister.
//
// A real <a href>: the destination shows on hover, cmd-click opens a tab, and
// the row cannot open a repo other than the one it names.

import './SourceRow.css';
import { navigate } from '@/router/location';
import { BranchPill } from '@/components/sources/BranchPill/BranchPill';
import { HostingIcon } from '@/components/sources/HostingIcon/HostingIcon';

export interface SourceRowProps {
  src: string;
  label: string;
  branch?: string;
  /** This repo's city is the one on screen: highlighted and noted "Active".
   *  Still clickable, which reloads it. */
  active?: boolean;
  /** Can't load here (a local path while local repos are off). Dimmed and not
   *  clickable: attempting it only flashes the loading state before failing. */
  unavailable?: boolean;
  /** Why it's unavailable, as a hover title. */
  unavailableReason?: string;
  /** Where this row goes. Built by the lister from the row's own src+branch. */
  href: string;
}

export function SourceRow({
  src,
  label,
  branch,
  active,
  unavailable,
  unavailableReason,
  href,
}: SourceRowProps) {
  return (
    <a
      href={unavailable ? undefined : href}
      class={`row source-row${active ? ' source-row--active' : ''}${
        unavailable ? ' source-row--unavailable' : ''
      }`}
      title={unavailable ? unavailableReason : undefined}
      aria-disabled={unavailable ? 'true' : undefined}
      onClick={(e: MouseEvent) => {
        if (unavailable) return;
        // Modified clicks belong to the browser: a new tab is a new tab.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      <span class="source-row-icon">
        <HostingIcon src={src} />
      </span>
      <div class="source-row-body">
        <div class="source-row-label-row">
          <span class="source-row-label">{label}</span>
          {branch && (
            // Inner span so the pill can ellipsize: text-overflow doesn't reach
            // the anonymous text run of a flex container.
            <BranchPill branch={branch} class="source-row-branch" title={branch}>
              <span class="source-row-branch-name">@{branch}</span>
            </BranchPill>
          )}
        </div>
        <div class="source-row-sub">
          <span class="source-row-src">{src}</span>
        </div>
      </div>
      {active && <span class="source-row-note">Active</span>}
    </a>
  );
}
