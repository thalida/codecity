// components/PaneHeader.tsx — Shared header bar used by every pane
// (Tree, Search, Info, Controls on the left sidebar; file-preview on
// the right). Single source of truth for the `.pane-header` row +
// `.text-pane-title` + `.pane-header-close` triplet, so the panes look
// identical and adding a new pane is a one-call affair.

import './PaneHeader.css';
import type { ComponentChildren } from 'preact';
import { Focus, X, EyeOff, ExternalLink, PanelLeftClose, PanelRightClose } from 'lucide-preact';
import { useContext } from 'preact/hooks';
import { CopyButton } from '@/components/CopyButton/CopyButton';
import { SidebarSide, SidebarSideContext } from '@/components/Sidebar/Sidebar';

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
  /** Text the copy button copies (a path, a SHA). Omit to render no copy button. */
  copyText?: string;
  /** Tooltip / aria-label for the copy button. */
  copyLabel?: string;
  /** Open-on-origin URL (a commit/file/dir link). Omit to render no open link. */
  openUrl?: string | null;
  /** Tooltip / aria-label for the open link. */
  openLabel?: string;
  /** Extra action buttons rendered in the right-hand group, between the open link
   *  and exclude (e.g. CommitPane's view-on-timeline). */
  actionsSlot?: ComponentChildren;
  /** fn() when the user clicks the × close button. Omit to render no button. */
  onClose?: () => void;
  /** Tooltip text on the × button. Defaults to "Hide sidebar". */
  closeTitle?: string;
  /** fn() when the user clicks the "exclude from city" button. Omit to render none. */
  onExclude?: () => void;
  /** Tooltip / aria-label for the exclude button. */
  excludeTitle?: string;
  /** Rich title content rendered inside the title element instead of the
   *  plain `title` string (e.g. a path breadcrumb, or "Commit <sha> · author"). */
  titleSlot?: ComponentChildren;
}

// ── Preact component ────────────────────────────────────────────────────────

export function PaneHeader({
  title,
  mono,
  onFocus,
  focusTitle = 'Focus camera',
  copyText,
  copyLabel,
  openUrl,
  openLabel = 'Open on origin',
  actionsSlot,
  onClose,
  closeTitle = 'Hide sidebar',
  onExclude,
  excludeTitle,
  titleSlot,
}: PaneHeaderProps) {
  return (
    <div class="pane-header">
      <div class="pane-header-lead">
        <h3 class={`text-pane-title${mono ? ' is-mono' : ''}`}>{titleSlot ?? title}</h3>
        {(copyText != null || openUrl) && (
          <div class="pane-header-identity">
            {copyText != null && <CopyButton text={copyText} label={copyLabel} />}
            {openUrl && (
              <a
                class="btn-icon btn-icon--link"
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={openLabel}
                aria-label={openLabel}
              >
                <ExternalLink class="icon" />
              </a>
            )}
          </div>
        )}
      </div>
      <div class="pane-header-actions">
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
            <Focus class="icon" />
          </button>
        )}
        {actionsSlot ?? null}
        {typeof onExclude === 'function' && (
          <button
            type="button"
            class="btn-icon"
            title={excludeTitle ?? 'Exclude from city'}
            aria-label={excludeTitle ?? 'Exclude from city'}
            onClick={() => onExclude()}
          >
            <EyeOff class="icon" />
          </button>
        )}
        {typeof onClose === 'function' && <PaneCloseButton onClose={onClose} title={closeTitle} />}
      </div>
    </div>
  );
}

// ── Close button ────────────────────────────────────────────────────────────

export interface PaneCloseButtonProps {
  onClose: () => void;
  /** Tooltip / aria-label. Defaults to "Hide sidebar". */
  title?: string;
}

/** The pane's close button. Shared by the default header and by panes that
 *  compose their own header (e.g. InfoPane's tab strip). Plain .btn-icon so it
 *  matches the icon-only buttons in the app header.
 *
 *  It puts a panel away rather than closing anything — a right-sidebar pane
 *  keeps its selection — so it draws the panel collapsing toward its own edge.
 *  An × would promise the thing is gone. Outside a sidebar there's no edge to
 *  collapse toward, and × is right again. */
export function PaneCloseButton({ onClose, title = 'Hide sidebar' }: PaneCloseButtonProps) {
  const side = useContext(SidebarSideContext);
  const Icon =
    side === SidebarSide.Right ? PanelRightClose : side === SidebarSide.Left ? PanelLeftClose : X;
  return (
    <button
      type="button"
      class="btn-icon"
      title={title}
      aria-label={title}
      onClick={() => onClose()}
    >
      <Icon class="icon" />
    </button>
  );
}
