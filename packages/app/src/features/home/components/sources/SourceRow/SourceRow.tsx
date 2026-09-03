// features/home/components/sources/SourceRow/SourceRow.tsx — one openable source: kind glyph,
// label, branch pill, raw src. Shared by Recents and Discover. A real <a href>,
// so the destination shows on hover and the row cannot open a repo other than
// the one it names.

import './SourceRow.css';
import { Link } from 'wouter-preact';
import { BranchPill } from '@/components/BranchPill/BranchPill';
import { HostingIcon } from '@/features/home/components/sources/HostingIcon/HostingIcon';

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
  const className = `row source-row${active ? ' source-row--active' : ''}${
    unavailable ? ' source-row--unavailable' : ''
  }`;

  const body = (
    <>
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
    </>
  );

  // Nowhere to go, so not a link: a disabled anchor is still an anchor, and
  // this one would offer a destination that refuses to load.
  if (unavailable) {
    return (
      <div class={className} title={unavailableReason} aria-disabled="true">
        {body}
      </div>
    );
  }
  return (
    <Link href={href} class={className}>
      {body}
    </Link>
  );
}
