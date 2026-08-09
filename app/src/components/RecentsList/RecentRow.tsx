// components/RecentsList/RecentRow.tsx — a recent source: the shared SourceRow
// plus the two things only a recent has, an Active badge and a remove control.
// Remove is non-destructive (it forgets the entry, it does not clear the scan
// cache), and asking takes over the whole row so the list never reflows.

import { X } from 'lucide-preact';
import { SourceRow } from '@/components/SourceRow/SourceRow';
import type { RecentSource } from '@/state/stores/source';

const UNAVAILABLE_REASON = "Local paths aren't enabled, so this one can't be opened here.";

export interface RecentRowProps {
  recent: RecentSource;
  active: boolean;
  unavailable: boolean; // a local path while local repos are off
  confirmingRemove: boolean;
  onOpen: () => void;
  onAskRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}

export function RecentRow(props: RecentRowProps) {
  const { recent: r, active, unavailable, confirmingRemove } = props;

  if (confirmingRemove) {
    return (
      <div class="recent-item">
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
    <div class="recent-item">
      <SourceRow
        src={r.src}
        label={r.label}
        branch={r.branch}
        active={active}
        unavailable={unavailable}
        unavailableReason={UNAVAILABLE_REASON}
        onOpen={props.onOpen}
        trailing={active ? <span class="recent-row-badge">Active</span> : undefined}
      />

      <button
        type="button"
        class="btn-icon btn-icon--text"
        aria-label="Remove from recents"
        onClick={props.onAskRemove}
      >
        <X class="icon" />
      </button>
    </div>
  );
}
