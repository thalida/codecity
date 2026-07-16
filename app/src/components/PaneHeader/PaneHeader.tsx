// components/PaneHeader.tsx — Shared header bar used by every pane
// (Tree, Search, Info, Controls on the left sidebar; file-preview on
// the right). Single source of truth for the `.pane-header` row +
// `.text-pane-title` + `.pane-header-close` triplet, so the panes look
// identical and adding a new pane is a one-call affair.

import './PaneHeader.css';
import type { ComponentChildren } from 'preact';
import { Focus, X, EyeOff } from 'lucide-preact';

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
  /** fn() when the user clicks the "exclude from city" button. Omit to render none. */
  onExclude?: () => void;
  /** Tooltip / aria-label for the exclude button. */
  excludeTitle?: string;
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
  onExclude,
  excludeTitle,
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
      {typeof onExclude === 'function' && (
        <button
          type="button"
          class="btn-icon"
          title={excludeTitle ?? 'Exclude from city'}
          aria-label={excludeTitle ?? 'Exclude from city'}
          onClick={() => onExclude()}
        >
          <EyeOff class="lucide-icon" />
        </button>
      )}
      {typeof onClose === 'function' && <PaneCloseButton onClose={onClose} title={closeTitle} />}
    </div>
  );
}

// ── Close button ────────────────────────────────────────────────────────────

export interface PaneCloseButtonProps {
  onClose: () => void;
  /** Tooltip / aria-label. Defaults to "Hide sidebar". */
  title?: string;
}

/** The pane's × close button. Shared by the default header and by panes that
 *  compose their own header (e.g. InfoPane's tab strip). Plain .btn-icon so it
 *  matches the icon-only buttons in the app header. */
export function PaneCloseButton({ onClose, title = 'Hide sidebar' }: PaneCloseButtonProps) {
  return (
    <button
      type="button"
      class="btn-icon"
      title={title}
      aria-label={title}
      onClick={() => onClose()}
    >
      <X class="lucide-icon" />
    </button>
  );
}
