// components/sources/RecentsList/RecentRow.tsx — a recent source: the shared SourceRow
// plus the one thing only a recent has, a remove control.
// Remove is non-destructive (it forgets the entry, it does not clear the scan
// cache), and asking takes over the whole row so the list never reflows.

import { X } from 'lucide-preact';
import { SourceRow } from '@/components/sources/SourceRow/SourceRow';
import type { RecentSource } from '@/state/recents';

const UNAVAILABLE_REASON = "Local paths aren't enabled, so this one can't be opened here.";

export interface RecentRowProps {
  recent: RecentSource;
  active: boolean;
  unavailable: boolean; // a local path while local repos are off
  confirmingRemove: boolean;
  href: string;
  onAskRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}

export function RecentRow(props: RecentRowProps) {
  const { recent: r, active, unavailable, confirmingRemove } = props;

  if (confirmingRemove) {
    return (
      <div class="source-list-item">
        <div class="recent-confirm">
          <span class="recent-confirm-text">
            Remove <strong>{r.label}</strong> from recents?
          </span>
          <span class="recent-confirm-actions">
            <button type="button" class="btn-icon btn-icon--text" onClick={props.onCancelRemove}>
              Cancel
            </button>
            <button
              type="button"
              class="btn-icon btn-icon--text recent-confirm-yes"
              onClick={props.onConfirmRemove}
            >
              Remove
            </button>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div class="source-list-item">
      <SourceRow
        src={r.src}
        label={r.label}
        // Display, not identity: a local row has no identity branch, and its
        // checkout is what distinguishes two worktrees of the same repo.
        branch={r.checkout ?? r.branch}
        active={active}
        unavailable={unavailable}
        unavailableReason={UNAVAILABLE_REASON}
        href={props.href}
      />

      {/* No --text here: that modifier is for a button with words in it, and it
          takes width from them, which on a lone glyph is a portrait box. */}
      <button
        type="button"
        class="btn-icon"
        aria-label="Remove from recents"
        onClick={props.onAskRemove}
      >
        <X class="icon" />
      </button>
    </div>
  );
}
