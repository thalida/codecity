// components/SourceRow/SourceRow.tsx — one openable source: kind glyph, label,
// branch pill, and the raw src underneath. Shared by Recents and Discover,
// because a Discover row is a recent you haven't opened yet, and the two
// looking different would imply a difference that isn't there.
//
// Presentational and click-only. Everything around a row (the remove control on
// a recent, the active badge) belongs to whoever is listing it.

import './SourceRow.css';
import { Folder } from 'lucide-preact';
import { HostingIcon } from '@/components/HostingIcon';
import { srcKind, SourceKind } from '@/utils/sources';

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
  onOpen: () => void;
}

export function SourceRow({
  src,
  label,
  branch,
  active,
  unavailable,
  unavailableReason,
  onOpen,
}: SourceRowProps) {
  const isLocal = srcKind(src) === SourceKind.Local;

  return (
    <button
      type="button"
      class={`row source-row${active ? ' source-row--active' : ''}${
        unavailable ? ' source-row--unavailable' : ''
      }`}
      title={unavailable ? unavailableReason : undefined}
      aria-disabled={unavailable ? 'true' : undefined}
      onClick={unavailable ? undefined : onOpen}
    >
      <span class="source-row-icon">
        {isLocal ? <Folder class="icon" /> : <HostingIcon src={src} />}
      </span>
      <div class="source-row-body">
        <div class="source-row-label-row">
          <span class="source-row-label">{label}</span>
          {branch && (
            // Inner span so the pill can ellipsize: text-overflow doesn't reach
            // the anonymous text run of a flex container.
            <span class="app-header-branch-pill source-row-branch" title={branch}>
              <span class="source-row-branch-name">@{branch}</span>
            </span>
          )}
        </div>
        <div class="source-row-sub">
          <span class="source-row-src">{src}</span>
        </div>
      </div>
      {active && <span class="source-row-note">Active</span>}
    </button>
  );
}
