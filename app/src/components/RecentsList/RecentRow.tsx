// components/RecentsList/RecentRow.tsx — one recent-source row: kind glyph,
// label, sub (src + branch pill + "(default)" tag), active badge, inline-confirm
// remove.

import { Folder, Trash2, TriangleAlert } from 'lucide-preact';
import { HostingIcon } from '@/components/HostingIcon';
import { srcKind, SourceKind } from '@/utils/sources';
import type { RecentSource } from '@/state/stores/source';

export interface RecentRowProps {
  recent: RecentSource;
  active: boolean;
  disabled: boolean; // local row while local repos are off
  confirmingRemove: boolean;
  onOpen: () => void;
  onAskRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}

export function RecentRow(props: RecentRowProps) {
  const { recent: r, active, disabled, confirmingRemove } = props;
  const isLocal = srcKind(r.src) === SourceKind.Local;
  const rowClass = [
    'row recent-row',
    active && 'recent-row--active',
    disabled && 'recent-row--disabled',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div class="recent-item">
      <button
        type="button"
        class={rowClass}
        disabled={active || disabled}
        title={
          disabled
            ? 'Local repos are disabled. Restart codecity with CODECITY_ALLOW_LOCAL_REPOS=1 to load this.'
            : undefined
        }
        onClick={props.onOpen}
      >
        <span class="recent-icon">
          {disabled ? (
            <TriangleAlert class="lucide-icon" />
          ) : isLocal ? (
            <Folder class="lucide-icon" />
          ) : (
            <HostingIcon src={r.src} />
          )}
        </span>
        <div class="recent-row-body">
          <div class="recent-label">{r.label}</div>
          <div class="recent-sub">
            <span class="recent-src">{r.src}</span>
            {r.branch && <span class="app-header-branch-pill">@{r.branch}</span>}
            {r.branchIsDefault && <span class="recent-default-tag">(default)</span>}
          </div>
        </div>
        {active && <span class="recent-row-badge">Active</span>}
      </button>

      {confirmingRemove ? (
        <span class="recent-remove-confirm">
          <span class="text-label">Remove?</span>
          <button type="button" class="btn-icon btn-icon--text" onClick={props.onCancelRemove}>
            Cancel
          </button>
          <button type="button" class="btn-icon btn-icon--text" onClick={props.onConfirmRemove}>
            Remove
          </button>
        </span>
      ) : (
        <button
          type="button"
          class="btn-icon btn-icon--text"
          aria-label="Remove from recents"
          onClick={props.onAskRemove}
        >
          <Trash2 class="lucide-icon" />
        </button>
      )}
    </div>
  );
}
