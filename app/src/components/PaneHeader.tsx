// components/paneHeader.tsx — Shared header bar used by every pane
// (Tree, Search, Info, Controls on the left sidebar; file-preview on
// the right). Single source of truth for the `.pane-header` row +
// `.text-pane-title` + `.pane-header-close` triplet, so the panes look
// identical and adding a new pane is a one-call affair.

import type { ComponentChildren } from 'preact';
import { Focus, X } from 'lucide-preact';

// ── Props interface ─────────────────────────────────────────────────────────

export interface PaneHeaderProps {
  /** Initial title text. */
  title: string;
  /** Render the title in monospace — used by panes whose title is a
   *  filename / path identifier instead of a label. Defaults to false. */
  mono?: boolean;
  /** fn() when the user clicks the focus button. Omit to render no button. */
  onFocus?: () => void;
  /** Tooltip text on the focus button. Defaults to "Focus camera". */
  focusTitle?: string;
  /** fn() when the user clicks the × close button. Omit to render no button. */
  onClose?: () => void;
  /** Tooltip text on the × button. Defaults to "Hide sidebar". */
  closeTitle?: string;
  /** Optional prefix element rendered between focus button and title. */
  prefixSlot?: ComponentChildren;
  /** Rich title content rendered inside the title element instead of the
   *  plain `title` string (e.g. CommitPane's "Commit <sha> + open-link"). */
  titleSlot?: ComponentChildren;
}

// ── Preact component ────────────────────────────────────────────────────────

export function PaneHeader({
  title,
  mono,
  onFocus,
  focusTitle = 'Focus camera',
  onClose,
  closeTitle = 'Hide sidebar',
  prefixSlot,
  titleSlot,
}: PaneHeaderProps) {
  return (
    <div class="pane-header">
      {typeof onFocus === 'function' && (
        <button
          type="button"
          class="btn-icon btn-icon--text"
          title={focusTitle}
          aria-label={focusTitle}
          onClick={(e) => {
            // Blur so a subsequent Space/Enter doesn't re-activate this button
            // (re-firing focus) — let those keystrokes fall through to the
            // document-level canvas keydown handler.
            (e.currentTarget as HTMLButtonElement).blur();
            onFocus();
          }}
        >
          <Focus class="lucide-icon" />
        </button>
      )}
      {prefixSlot ?? null}
      <h3 class={`text-pane-title${mono ? ' is-mono' : ''}`}>{titleSlot ?? title}</h3>
      {typeof onClose === 'function' && (
        <button
          type="button"
          class="btn-icon btn-icon--text"
          title={closeTitle}
          aria-label={closeTitle}
          onClick={() => onClose()}
        >
          <X class="lucide-icon" />
        </button>
      )}
    </div>
  );
}
